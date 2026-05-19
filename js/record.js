/* NamaChu — 記録タブ */

import { freqToMidi, midiToNoteInfo, noteName, clamp, formatTime, defaultSaveName, lsGet, lsSet, lsDel, lsKeys, showToast, openModal, closeModal } from './utils.js';
import { playSynthSequence } from './audio.js';
import { t } from './i18n.js';

// ---- Constants ----
const MIN_NOTE_MS          = 25;   // 最小音符長（16分音符三連符 tempo170 ≈ 59ms に対応）
const OCTAVE_REJECT_SEMIS  = 7;    // これ以上のセミトーン差は棄却
const FREQ_EMA_ALPHA       = 0.35; // 周波数EMAの追跡速度（高=速）
const OCTAVE_CONFIRM_FRAMES = 4;   // 何フレーム連続でオクターヴずれが続いたら本物の跳躍とみなすか（≈67ms）

// ---- State ----
let _instrument = null;
let _concertPitch = 440;
let _noteStyle = 'abc';
let _silenceGraceMs = 100; // 持続音中のドロップアウト許容時間

let recording = false;
let playing = false;
let recordStartTime = 0;

// Each event: { timeMs, freq, midi, note, octave, cents, durationMs, freqSamples }
let recordEvents = [];
let _lastFreq = null;
let _lastEventStart = 0;
let _freqSamples = [];    // [{offsetMs, freq}] for current ongoing note
let _currentSynthHandle = null;
let _playbackTimer = null;

// ---- Pitch sanity state ----
let _freqEma = null;          // 周波数の指数移動平均（オクターヴ補正用）
let _octaveShiftCount = 0;    // オクターヴずれが何フレーム連続したか
let _silenceStartMs = null;   // 直前まで音があり無音に入った時刻（猶予判定用）

// ---- Drag scroll ----
let _dragActive = false;
let _dragStartX = 0;
let _dragStartScrollMs = 0;

// ---- Watchdog ----
let _lastAudioFrameMs = 0;    // onRecordPitch が最後に呼ばれた時刻
let _watchdogTimer = null;    // setInterval ID
let _repairCallback = null;   // マイク再起動などの修復コールバック
let _preStartHook = null;     // 録音開始前に呼ぶ async フック（AudioContext resume など）

// Canvas
let canvas = null;
let ctx = null;
let rafId = null;

let scrollMs = 0;
let viewMs = 8000;

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export function initRecord(opts = {}) {
  _instrument = opts.instrument ?? null;
  _concertPitch = opts.concertPitch ?? 440;
  _noteStyle = opts.noteStyle ?? 'abc';

  canvas = document.getElementById('recordCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  buildPitchAxis();
  _initDragScroll();
  startDrawLoop();
}

export function setRecordInstrument(inst) { _instrument = inst; buildPitchAxis(); }
export function setRecordConcertPitch(hz) { _concertPitch = hz; }
export function setRecordNoteStyle(s) { _noteStyle = s; buildPitchAxis(); }
export function setRecordSilenceGrace(ms) { _silenceGraceMs = ms; }
export function setRecordRepairCallback(fn) { _repairCallback = fn; }
export function setRecordPreStartHook(fn) { _preStartHook = fn; }

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
}

// ---- Pitch axis labels (chromatic) ----
function buildPitchAxis() {
  const el = document.getElementById('recordPitchAxis');
  if (!el || !_instrument) return;
  const spans = [];
  for (let m = _instrument.hiMidi; m >= _instrument.loMidi; m--) {
    const info = midiToNoteInfo(m);
    const isBlack = BLACK_KEYS.has(info.note);
    // Label all white keys; show octave number only on C to mark octave boundaries
    const label = isBlack ? '' : noteName(info.note, info.octave, _noteStyle, info.note === 0);
    spans.push(`<span class="${isBlack ? 'axis-black' : 'axis-white'}">${label}</span>`);
  }
  el.innerHTML = spans.join('');
}

// ---- Drag scroll ----
function _initDragScroll() {
  if (!canvas) return;

  function canDrag() { return !recording && !playing && getTotalDuration() > 0; }

  function startDrag(clientX) {
    if (!canDrag()) return;
    _dragActive = true;
    _dragStartX = clientX;
    _dragStartScrollMs = scrollMs;
    canvas.style.cursor = 'grabbing';
  }

  function moveDrag(clientX) {
    if (!_dragActive) return;
    const dx = clientX - _dragStartX;
    const msPerPx = viewMs / (canvas.offsetWidth || 1);
    const maxScroll = Math.max(0, getTotalDuration() - viewMs * 0.1);
    scrollMs = Math.max(0, Math.min(_dragStartScrollMs - dx * msPerPx, maxScroll));
    updateTimeBar(scrollMs + viewMs * 0.75, getTotalDuration());
  }

  function endDrag() {
    _dragActive = false;
    canvas.style.cursor = canDrag() ? 'grab' : '';
  }

  // マウス
  canvas.addEventListener('mousedown',  (e) => startDrag(e.clientX));
  canvas.addEventListener('mousemove',  (e) => moveDrag(e.clientX));
  canvas.addEventListener('mouseup',    endDrag);
  canvas.addEventListener('mouseleave', endDrag);

  // タッチ
  canvas.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX), { passive: true });
  canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); moveDrag(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('touchend',   endDrag);

  // カーソル（録音データがある時は grab を示す）
  canvas.addEventListener('mouseenter', () => { if (canDrag()) canvas.style.cursor = 'grab'; });
}

// ---- Watchdog helpers ----
function _startWatchdog() {
  _lastAudioFrameMs = performance.now();
  _stopWatchdog();
  _watchdogTimer = setInterval(() => {
    if (!recording) { _stopWatchdog(); return; }
    const age = performance.now() - _lastAudioFrameMs;
    if (age > 1500) {
      console.warn('[NamaChu] watchdog: no audio frame for', age.toFixed(0), 'ms — repairing');
      _lastAudioFrameMs = performance.now(); // reset to avoid rapid re-trigger
      _repairCallback?.();
    }
  }, 500);
}

function _stopWatchdog() {
  clearInterval(_watchdogTimer);
  _watchdogTimer = null;
}

// ---- Recording ----
export async function toggleRecording() {
  if (playing) stopPlayback();
  if (recording) {
    stopRecording();
  } else {
    if (_preStartHook) await _preStartHook();
    startRecording();
  }
}

function startRecording() {
  recording = true;
  recordEvents = [];
  recordStartTime = performance.now();
  scrollMs = 0;
  _lastFreq = null;
  _freqSamples = [];
  _freqEma = null;
  _octaveShiftCount = 0;
  _silenceStartMs = null;
  document.getElementById('recBtn')?.classList.add('recording');
  document.getElementById('playBackBtn').disabled = true;
  updateTimeBar(0, 0);
  _startWatchdog();
}

function stopRecording() {
  _stopWatchdog();
  recording = false;
  finalizeCurrentEvent(performance.now());
  trimLeadingSilence();
  document.getElementById('recBtn')?.classList.remove('recording');
  const totalMs = getTotalDuration();
  updateTimeBar(totalMs, totalMs);
  document.getElementById('playBackBtn').disabled = recordEvents.length === 0;
}

// 冒頭の無音時間が 1 秒を超える場合、1 秒に揃える
function trimLeadingSilence() {
  if (recordEvents.length === 0) return;
  const firstStart = recordEvents[0].timeMs;
  if (firstStart > 1000) {
    const shift = firstStart - 1000;
    for (const ev of recordEvents) ev.timeMs -= shift;
  }
}

function getTotalDuration() {
  return recordEvents.reduce((max, e) => Math.max(max, e.timeMs + e.durationMs), 0);
}

// ---- オクターヴ誤検出フィルタ＆補正 ----
// ・1〜数フレームの短いオクターヴずれ → 誤検出として補正
// ・OCTAVE_CONFIRM_FRAMES フレーム以上持続 → 本物のオクターヴ跳躍として受け入れ
function sanitizeFreq(freq) {
  if (_freqEma === null) { _freqEma = freq; _octaveShiftCount = 0; return freq; }
  const ratio = freq / _freqEma;
  const octaves = Math.round(Math.log2(ratio));

  if (octaves !== 0) {
    const corrected = freq / Math.pow(2, octaves);
    const correctedSemis = Math.abs(12 * Math.log2(corrected / _freqEma));

    if (correctedSemis <= 4) {
      // オクターヴ分ずれているが補正後はEMAに近い → 誤検出 or 本物の跳躍
      _octaveShiftCount++;
      if (_octaveShiftCount >= OCTAVE_CONFIRM_FRAMES) {
        // 連続して同じオクターヴずれ → 本物の跳躍として確定、EMAをリセット
        _freqEma = freq;
        _octaveShiftCount = 0;
        return freq;
      }
      // まだ短い → 誤検出として元のオクターヴに補正
      freq = corrected;
    } else if (Math.abs(12 * Math.log2(freq / _freqEma)) > OCTAVE_REJECT_SEMIS) {
      _octaveShiftCount = 0;
      return null; // 補正不能 → 棄却
    } else {
      _octaveShiftCount = 0;
    }
  } else {
    _octaveShiftCount = 0; // 正常範囲に戻ったらカウントリセット
  }

  _freqEma = _freqEma * Math.pow(freq / _freqEma, FREQ_EMA_ALPHA);
  return freq;
}

export function onRecordPitch(freq, clarity, clarityThreshold) {
  if (!recording) return;
  const now = performance.now();
  _lastAudioFrameMs = now; // watchdog リセット
  const timeMs = now - recordStartTime;

  // --- 無音判定 ---
  if (!freq || clarity < clarityThreshold) {
    if (_lastFreq !== null) {
      // 持続音中の無音 → 猶予で待機
      if (_silenceStartMs === null) _silenceStartMs = timeMs;
      const silentFor = timeMs - _silenceStartMs;
      if (silentFor > _silenceGraceMs) {
        // 猶予を超えた → 音符を確定
        finalizeCurrentEvent(now);
        _lastFreq = null;
        _freqSamples = [];
        _freqEma = null;
        _octaveShiftCount = 0;
        _silenceStartMs = null;
      }
      // 猶予中はサンプルを追加せず、音符は開いたまま
    } else {
      _freqEma = null;
      _octaveShiftCount = 0;
    }
    updateTimeBar(timeMs, timeMs);
    return;
  }

  // --- オクターヴ誤検出フィルタ＆補正 ---
  const safeFreq = sanitizeFreq(freq);
  if (safeFreq === null) {
    updateTimeBar(timeMs, timeMs);
    return;
  }

  // --- 猶予中の復帰チェック ---
  if (_silenceStartMs !== null) {
    if (_lastFreq !== null) {
      // 直前の音と近いピッチなら同じ音として継続、遠ければ新規音として分離
      const semis = Math.abs(12 * Math.log2(safeFreq / _lastFreq));
      if (semis > 1.5) {
        finalizeCurrentEvent(now);
        _lastFreq = null;
        _freqSamples = [];
        _freqEma = null;
        _octaveShiftCount = 0;
      }
    }
    _silenceStartMs = null;
  }

  // --- 有効サンプル処理 ---
  if (_lastFreq === null) {
    _lastEventStart = timeMs;
    _freqSamples = [];
  }

  _lastFreq = safeFreq;
  _freqSamples.push({ offsetMs: timeMs - _lastEventStart, freq: safeFreq });
  scrollMs = Math.max(0, timeMs - viewMs * 0.75);
  updateTimeBar(timeMs, timeMs);
}

function finalizeCurrentEvent(now) {
  if (_lastFreq === null || _freqSamples.length === 0) {
    _lastFreq = null;
    _freqSamples = [];
    return;
  }
  const timeMs = now - recordStartTime;
  const dur = timeMs - _lastEventStart;
  if (dur < MIN_NOTE_MS) { _lastFreq = null; _freqSamples = []; return; }

  // ---- 最頻 MIDI 値（モード）でレーン位置とオクターヴ基準を決定 ----
  const midiCounts = {};
  _freqSamples.forEach(s => {
    const m = Math.round(freqToMidi(s.freq, _concertPitch));
    midiCounts[m] = (midiCounts[m] || 0) + 1;
  });
  const modeMidi = +Object.keys(midiCounts).reduce((a, b) =>
    midiCounts[a] > midiCounts[b] ? a : b
  );

  // ---- 音符内オクターヴ補正 ----
  // モードから 9半音以上外れたサンプルは、オクターヴ単位の倍率で補正を試みる
  const correctedSamples = _freqSamples.map(s => {
    const m = freqToMidi(s.freq, _concertPitch);
    const diff = m - modeMidi;
    if (Math.abs(diff) < 9) return s;
    const oct = Math.round(diff / 12);
    if (oct === 0) return s;
    const correctedFreq = s.freq / Math.pow(2, oct);
    const newDiff = freqToMidi(correctedFreq, _concertPitch) - modeMidi;
    if (Math.abs(newDiff) < 4) return { ...s, freq: correctedFreq };
    return s;
  });
  _freqSamples = correctedSamples;

  const info = midiToNoteInfo(modeMidi);
  // 最終 freq は補正後の最終サンプルを優先
  const lastSampleFreq = _freqSamples[_freqSamples.length - 1]?.freq ?? _lastFreq;

  recordEvents.push({
    timeMs: _lastEventStart,
    freq: lastSampleFreq,
    midi: modeMidi,
    note: info.note,
    octave: info.octave,
    cents: info.cents,
    durationMs: dur,
    freqSamples: [..._freqSamples],
  });
  _lastFreq = null;
  _freqSamples = [];
}

// ---- Playback ----
export function togglePlayback() {
  if (playing) stopPlayback();
  else startPlayback();
}

function startPlayback() {
  if (recordEvents.length === 0) return;
  playing = true;
  scrollMs = 0;
  document.getElementById('playBackBtn').classList.add('playing');
  document.querySelector('#playBackBtn span').textContent = t('btn_stop');
  document.getElementById('recBtn').disabled = true;

  _currentSynthHandle = playSynthSequence(recordEvents, onPlaybackEnd);

  const totalMs = getTotalDuration();
  const startWall = performance.now();

  function tick() {
    if (!playing) return;
    const elapsed = performance.now() - startWall;
    scrollMs = Math.max(0, elapsed - viewMs * 0.75);
    updateTimeBar(elapsed, totalMs);
    if (elapsed < totalMs + 500) _playbackTimer = setTimeout(tick, 33);
    else onPlaybackEnd();
  }
  tick();
}

function onPlaybackEnd() {
  playing = false;
  _currentSynthHandle = null;
  clearTimeout(_playbackTimer);
  document.getElementById('playBackBtn')?.classList.remove('playing');
  const span = document.querySelector('#playBackBtn span');
  if (span) span.textContent = t('btn_play');
  document.getElementById('recBtn').disabled = false;
  const totalMs = getTotalDuration();
  updateTimeBar(totalMs, totalMs);
}

function stopPlayback() {
  _currentSynthHandle?.stop();
  onPlaybackEnd();
}

// ---- Clear ----
export function clearRecording() {
  stopPlayback();
  if (recording) stopRecording();
  recordEvents = [];
  scrollMs = 0;
  _lastFreq = null;
  _freqSamples = [];
  _freqEma = null;
  document.getElementById('playBackBtn').disabled = true;
  updateTimeBar(0, 0);
}

// ---- Time bar ----
function updateTimeBar(currentMs = 0, totalMs = 0) {
  document.getElementById('recordTimeCurrent').textContent = formatTime(currentMs / 1000);
  document.getElementById('recordTimeTotal').textContent = formatTime(totalMs / 1000);
  const pct = totalMs > 0 ? Math.min(100, (currentMs / totalMs) * 100) : 0;
  const fill = document.getElementById('recordProgressFill');
  if (fill) fill.style.width = pct + '%';
}

// ---- Save / Load ----
export function saveRecording() {
  if (recordEvents.length === 0) return;
  const input = document.getElementById('saveNameInput');
  if (input) input.value = defaultSaveName();
  openModal('saveNameModal');
}

export function confirmSaveRecording() {
  const name = document.getElementById('saveNameInput')?.value.trim() || defaultSaveName();
  const data = {
    name,
    savedAt: Date.now(),
    instrument: _instrument?.id,
    concertPitch: _concertPitch,
    events: recordEvents,
  };
  lsSet('rec_' + name, data);
  showToast(t('toast_saved'));
  closeModal('saveNameModal');
}

export function showRecordList() {
  const container = document.getElementById('recordListItems');
  if (!container) return;
  const keys = lsKeys('rec_').sort().reverse();
  if (keys.length === 0) {
    container.innerHTML = `<p style="opacity:0.6;text-align:center">${t('label_none')}</p>`;
  } else {
    container.innerHTML = keys.map(k => {
      const d = lsGet(k);
      if (!d) return '';
      const dateStr = d.savedAt ? new Date(d.savedAt).toLocaleString() : '';
      return `<div class="record-item">
        <div style="flex:1;min-width:0">
          <div class="record-item-name">${d.name || k}</div>
          <div class="record-item-date">${dateStr}</div>
        </div>
        <button class="record-item-load" onclick="loadRecording('${k}')">読込</button>
        <button class="record-item-del" onclick="deleteRecording('${k}')">✕</button>
      </div>`;
    }).join('');
  }
  document.getElementById('recordListOverlay')?.classList.add('active');
}

export function hideRecordList() {
  document.getElementById('recordListOverlay')?.classList.remove('active');
}

export function loadRecording(key) {
  const data = lsGet(key);
  if (!data) return;
  recordEvents = data.events || [];
  scrollMs = 0;
  document.getElementById('playBackBtn').disabled = recordEvents.length === 0;
  const totalMs = getTotalDuration();
  updateTimeBar(totalMs, totalMs);
  hideRecordList();
  showToast(t('toast_loaded'));
}

export function deleteRecording(key) {
  lsDel(key);
  showRecordList();
  showToast(t('toast_deleted'));
}

// ---- Draw loop ----
function startDrawLoop() {
  cancelAnimationFrame(rafId);
  function draw() {
    rafId = requestAnimationFrame(draw);
    drawCanvas();
  }
  draw();
}

function drawCanvas() {
  if (!ctx || !canvas || !_instrument) return;
  if (canvas.width === 0 || canvas.height === 0) {
    resizeCanvas();
    if (canvas.width === 0) return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const dpr = devicePixelRatio;
  const style = getComputedStyle(document.documentElement);

  ctx.fillStyle = style.getPropertyValue('--bg-color').trim();
  ctx.fillRect(0, 0, w, h);

  const loMidi = _instrument.loMidi;
  const hiMidi = _instrument.hiMidi;
  const noteRange = hiMidi - loMidi + 1;
  const laneH = h / noteRange;

  const surfaceColor = style.getPropertyValue('--surface-color').trim();
  const dotBg        = style.getPropertyValue('--dot-bg').trim();
  const dotWeak      = style.getPropertyValue('--dot-weak').trim();
  const textColor    = style.getPropertyValue('--text-color').trim();

  // Lane backgrounds
  for (let m = loMidi; m <= hiMidi; m++) {
    const laneY = h - (m - loMidi + 1) * laneH;
    const info = midiToNoteInfo(m);
    const isBlack = BLACK_KEYS.has(info.note);
    ctx.fillStyle = isBlack ? dotBg : surfaceColor;
    ctx.fillRect(0, laneY, w, laneH);
    ctx.strokeStyle = info.note === 0 ? textColor : dotWeak;
    ctx.lineWidth = (info.note === 0 ? 1.5 : 0.5) * dpr;
    ctx.beginPath();
    ctx.moveTo(0, laneY + laneH);
    ctx.lineTo(w, laneY + laneH);
    ctx.stroke();
  }

  const msPerPx = viewMs / w;
  const inTuneColor = style.getPropertyValue('--in-tune-color').trim() || '#4caf50';
  const sharpColor  = style.getPropertyValue('--sharp-color').trim()  || '#e53935';
  const flatColor   = style.getPropertyValue('--flat-color').trim()   || '#1e88e5';

  // ピッチグラフとしてイベントを描画（実際の周波数サンプルを点＋線で表示）
  function drawEvent(ev, alpha) {
    const samples = ev.freqSamples;
    if (!samples || samples.length === 0) return;

    const pts = [];
    for (const s of samples) {
      const x = (ev.timeMs + s.offsetMs - scrollMs) / msPerPx;
      if (x < -6 || x > w + 6) continue;
      const midiF = freqToMidi(s.freq, _concertPitch);
      if (midiF < loMidi - 0.5 || midiF > hiMidi + 0.5) continue;
      const y = h - (midiF - loMidi) / noteRange * h;
      const centsF = (midiF - Math.round(midiF)) * 100;
      const color = Math.abs(centsF) <= 5 ? inTuneColor : centsF > 0 ? sharpColor : flatColor;
      pts.push({ x, y, color });
    }
    if (pts.length === 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 線（隣接点ごとに色付け）
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.strokeStyle = pts[i].color;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
    // ドット
    for (const p of pts) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Completed events
  for (const ev of recordEvents) drawEvent(ev, 0.85);

  // Active (in-progress) note during recording
  if (recording && _lastFreq !== null && _freqSamples.length > 0) {
    drawEvent({ timeMs: _lastEventStart, freqSamples: _freqSamples }, 0.95);
  }

  // Playhead line
  if (recording || playing) {
    ctx.strokeStyle = style.getPropertyValue('--primary-color').trim() || '#a0522d';
    ctx.lineWidth = 2 * dpr;
    const posX = w * 0.75;
    ctx.beginPath();
    ctx.moveTo(posX, 0);
    ctx.lineTo(posX, h);
    ctx.stroke();
  }
}
