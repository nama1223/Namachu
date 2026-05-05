/* NamaChu — Web Audio API + pitch detection (YIN algorithm) */

const SAMPLE_RATE_DEFAULT = 44100;
const BUFFER_SIZE = 4096; // must be power-of-2; larger = lower detection floor
const YIN_THRESHOLD = 0.10; // lower = stricter (0.10–0.15 typical)

let audioCtx = null;
let analyser = null;
let micStream = null;
let sourceNode = null;
let scriptNode = null;
let _onPitch = null; // callback(freq, clarity, rms)
let _running = false;

/**
 * Start microphone capture and pitch detection.
 * onPitch(freq: number|null, clarity: number, rms: number) is called ~30 fps.
 */
export async function startMic(onPitch) {
  if (_running) return;
  _onPitch = onPitch;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  sourceNode = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = BUFFER_SIZE;
  analyser.smoothingTimeConstant = 0;
  sourceNode.connect(analyser);

  _running = true;
  _loop();
}

export function stopMic() {
  _running = false;
  micStream?.getTracks().forEach(t => t.stop());
  sourceNode?.disconnect();
  analyser?.disconnect();
  scriptNode?.disconnect();
  if (audioCtx?.state !== 'closed') audioCtx?.close();
  audioCtx = analyser = micStream = sourceNode = scriptNode = null;
}

export function isMicRunning() { return _running; }

// Settings injected from outside
export let minRms = 0.01;        // volume floor
export let clarityThreshold = 0.85; // 0–1

export function setMinRms(v) { minRms = v; }
export function setClarityThreshold(v) { clarityThreshold = v; }

// ---- Detection loop (rAF) ----
let _buf = null;
function _loop() {
  if (!_running) return;
  requestAnimationFrame(_loop);

  if (!analyser) return;
  const len = analyser.fftSize;
  if (!_buf || _buf.length !== len) _buf = new Float32Array(len);
  analyser.getFloatTimeDomainData(_buf);

  const rms = calcRms(_buf);
  if (rms < minRms) {
    _onPitch?.(null, 0, rms);
    return;
  }

  const sampleRate = audioCtx?.sampleRate || SAMPLE_RATE_DEFAULT;
  const result = yinDetect(_buf, sampleRate);
  _onPitch?.(result.freq, result.clarity, rms);
}

// ---- RMS ----
function calcRms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// ---- YIN pitch detection ----
// Reference: de Cheveigné & Kawahara (2002), simplified
function yinDetect(buf, sampleRate) {
  const N = buf.length;
  const halfN = Math.floor(N / 2);
  const d = new Float32Array(halfN);

  // Step 1: difference function
  for (let tau = 1; tau < halfN; tau++) {
    let s = 0;
    for (let i = 0; i < halfN; i++) {
      const delta = buf[i] - buf[i + tau];
      s += delta * delta;
    }
    d[tau] = s;
  }

  // Step 2: cumulative mean normalized difference
  const cmnd = new Float32Array(halfN);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfN; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum === 0 ? 0 : d[tau] * tau / runningSum;
  }

  // Step 3: absolute threshold — find first tau below threshold
  let tau = -1;
  for (let t = 2; t < halfN; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      // local minimum search
      while (t + 1 < halfN && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }

  if (tau === -1) return { freq: null, clarity: 0 };

  // Step 4: parabolic interpolation for sub-sample accuracy
  const tauFine = parabolicInterp(cmnd, tau);
  const freq = sampleRate / tauFine;
  const clarity = 1 - cmnd[tau];

  return { freq, clarity };
}

function parabolicInterp(arr, i) {
  if (i <= 0 || i >= arr.length - 1) return i;
  const s0 = arr[i - 1], s1 = arr[i], s2 = arr[i + 1];
  const denom = 2 * (2 * s1 - s2 - s0);
  if (Math.abs(denom) < 1e-10) return i;
  return i + (s2 - s0) / denom;
}

// ---- Playback synth (for Record tab replay) ----
let playbackCtx = null;

/**
 * Play a sequence of pitch events as digital sine waves.
 * events: Array<{ timeMs: number, freq: number|null, durationMs: number }>
 */
export function playSynthSequence(events, onEnd) {
  if (playbackCtx) {
    playbackCtx.close();
    playbackCtx = null;
  }
  playbackCtx = new (window.AudioContext || window.webkitAudioContext)();
  const gain = playbackCtx.createGain();
  gain.gain.value = 0.4;
  gain.connect(playbackCtx.destination);

  const startTime = playbackCtx.currentTime;
  let lastEnd = startTime;

  for (const ev of events) {
    if (!ev.freq) continue;
    const t0 = startTime + ev.timeMs / 1000;
    const dur = ev.durationMs / 1000;
    const osc = playbackCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = ev.freq;
    osc.connect(gain);
    // fade in/out to avoid clicks
    const g2 = playbackCtx.createGain();
    osc.connect(g2);
    g2.connect(gain);
    g2.gain.setValueAtTime(0, t0);
    g2.gain.linearRampToValueAtTime(1, t0 + Math.min(0.01, dur * 0.1));
    g2.gain.setValueAtTime(1, t0 + dur - Math.min(0.01, dur * 0.1));
    g2.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur);
    lastEnd = Math.max(lastEnd, t0 + dur);
  }

  if (lastEnd > startTime) {
    setTimeout(onEnd, (lastEnd - startTime) * 1000 + 100);
  } else {
    onEnd?.();
  }

  return {
    stop() {
      playbackCtx?.close();
      playbackCtx = null;
    }
  };
}
