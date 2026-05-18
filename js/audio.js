/* NamaChu — Web Audio API + pitch detection (YIN algorithm) */

const SAMPLE_RATE_DEFAULT = 44100;
const BUFFER_SIZE = 2048;
const YIN_THRESHOLD = 0.10;

let audioCtx = null;
let analyser = null;
let micStream = null;
let sourceNode = null;
let _onPitch = null;
let _running = false;
let _deviceId = null;
let _rawFrameCallback = null; // 校正用: フレーム毎に生バッファ＋RMSを渡す

export function setRawFrameCallback(fn) { _rawFrameCallback = fn; }
export function getSampleRate() { return audioCtx?.sampleRate || SAMPLE_RATE_DEFAULT; }
export function getBufferSize() { return BUFFER_SIZE; }

export function setMicDeviceId(id) { _deviceId = id || null; }

export async function getMicDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    tmp.getTracks().forEach(t => t.stop());
  } catch {}
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter(d => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `マイク ${i + 1}` }));
}

export async function startMic(onPitch) {
  if (_running) return;
  _onPitch = onPitch;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioConstraints = _deviceId ? { deviceId: { exact: _deviceId } } : true;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });

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
  if (audioCtx?.state !== 'closed') audioCtx?.close();
  audioCtx = analyser = micStream = sourceNode = null;
}

export function isMicRunning() { return _running; }

export let minRms = 0.01;
export let clarityThreshold = 0.85;
export function setMinRms(v) { minRms = v; }
export function setClarityThreshold(v) { clarityThreshold = v; }

let _buf = null;
function _loop() {
  if (!_running) return;
  requestAnimationFrame(_loop);
  if (!analyser) return;
  const len = analyser.fftSize;
  if (!_buf || _buf.length !== len) _buf = new Float32Array(len);
  analyser.getFloatTimeDomainData(_buf);
  const rms = calcRms(_buf);
  // 校正用フック: コピーを渡して保存できるようにする
  if (_rawFrameCallback) _rawFrameCallback(_buf, rms);
  if (rms < minRms) { _onPitch?.(null, 0, rms); return; }
  const sampleRate = audioCtx?.sampleRate || SAMPLE_RATE_DEFAULT;
  const result = yinDetect(_buf, sampleRate);
  _onPitch?.(result.freq, result.clarity, rms);
}

export function calcRms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function yinDetect(buf, sampleRate) {
  const N = buf.length;
  const halfN = Math.floor(N / 2);
  const d = new Float32Array(halfN);

  for (let tau = 1; tau < halfN; tau++) {
    let s = 0;
    for (let i = 0; i < halfN; i++) {
      const delta = buf[i] - buf[i + tau];
      s += delta * delta;
    }
    d[tau] = s;
  }

  const cmnd = new Float32Array(halfN);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfN; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum === 0 ? 0 : d[tau] * tau / runningSum;
  }

  let tau = -1;
  for (let t = 2; t < halfN; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 < halfN && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }

  if (tau === -1) return { freq: null, clarity: 0 };
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

// ---- Playback synth ----
let playbackCtx = null;

/**
 * Play recorded events using actual pitch data (freqSamples) for vibrato reproduction.
 */
export function playSynthSequence(events, onEnd) {
  if (playbackCtx) { playbackCtx.close(); playbackCtx = null; }
  playbackCtx = new (window.AudioContext || window.webkitAudioContext)();

  const masterGain = playbackCtx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(playbackCtx.destination);

  const startTime = playbackCtx.currentTime;
  let lastEnd = startTime;

  for (const ev of events) {
    if (!ev.freq) continue;
    const t0 = startTime + ev.timeMs / 1000;
    const dur = ev.durationMs / 1000;
    if (dur <= 0) continue;

    // Per-note gain for fade in/out (avoids clicks)
    const noteGain = playbackCtx.createGain();
    noteGain.connect(masterGain);
    const fadeIn  = Math.min(0.02, dur * 0.08);
    const fadeOut = Math.min(0.03, dur * 0.10);
    noteGain.gain.setValueAtTime(0, t0);
    noteGain.gain.linearRampToValueAtTime(1, t0 + fadeIn);
    noteGain.gain.setValueAtTime(1, t0 + dur - fadeOut);
    noteGain.gain.linearRampToValueAtTime(0, t0 + dur);

    const osc = playbackCtx.createOscillator();
    osc.type = 'sine';
    osc.connect(noteGain);

    // Schedule actual pitch variation (vibrato, slides, etc.)
    const samples = ev.freqSamples;
    if (samples && samples.length > 1) {
      osc.frequency.setValueAtTime(samples[0].freq, t0);
      for (let i = 1; i < samples.length; i++) {
        osc.frequency.linearRampToValueAtTime(
          samples[i].freq,
          t0 + samples[i].offsetMs / 1000
        );
      }
    } else {
      osc.frequency.value = ev.freq;
    }

    osc.start(t0);
    osc.stop(t0 + dur);
    lastEnd = Math.max(lastEnd, t0 + dur);
  }

  if (lastEnd > startTime) {
    setTimeout(onEnd, (lastEnd - startTime) * 1000 + 150);
  } else {
    onEnd?.();
  }

  return {
    stop() { playbackCtx?.close(); playbackCtx = null; }
  };
}
