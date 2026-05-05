/* NamaChu — 記録タブ */

import { freqToMidi, midiToNoteInfo, noteName, clamp, formatTime, defaultSaveName, lsGet, lsSet, lsDel, lsKeys, showToast, openModal, closeModal } from './utils.js';
import { playSynthSequence } from './audio.js';
import { t } from './i18n.js';

// ---- State ----
let _instrument = null;
let _concertPitch = 440;
let _noteStyle = 'abc';

let recording = false;
let playing = false;
let recordStartTime = 0;

// Each event: { timeMs, freq, midi, cents, durationMs }
let recordEvents = [];
let _lastFreq = null;
let _lastEventStart = 0;
let _currentSynthHandle = null;
let _playbackTimer = null;

// Canvas
let canvas = null;
let ctx = null;
let rafId = null;

// Scroll position (ms shown at left edge)
let scrollMs = 0;
const SCROLL_SPEED_PX_PER_MS = 0.05; // pixels per ms at default zoom
let viewMs = 8000; // ms visible in canvas

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
  startDrawLoop();
}

export function setRecordInstrument(inst) {
  _instrument = inst;
  buildPitchAxis();
}
export function setRecordConcertPitch(hz) { _concertPitch = hz; }
export function setRecordNoteStyle(s) { _noteStyle = s; }

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
}

// ---- Pitch axis labels ----
function buildPitchAxis() {
  const el = document.getElementById('recordPitchAxis');
  if (!el || !_instrument) return;
  const notes = [];
  for (let m = _instrument.hiMidi; m >= _instrument.loMidi; m--) {
    const info = midiToNoteInfo(m);
    // show natural notes only to avoid clutter
    if ([0,2,4,5,7,9,11].includes(info.note)) {
      notes.push(noteName(info.note, info.octave, _noteStyle, false));
    } else {
      notes.push('');
    }
  }
  el.innerHTML = notes.map(n => `<span>${n}</span>`).join('');
}

// ---- Recording ----
export function toggleRecording() {
  if (playing) stopPlayback();
  if (recording) stopRecording();
  else startRecording();
}

function startRecording() {
  recording = true;
  recordEvents = [];
  recordStartTime = performance.now();
  scrollMs = 0;
  _lastFreq = null;
  document.getElementById('recBtn')?.classList.add('recording');
  document.getElementById('playBackBtn').disabled = true;
  updateTimeBar();
}

function stopRecording() {
  recording = false;
  finalizeCurrentEvent(performance.now());
  document.getElementById('recBtn')?.classList.remove('recording');
  document.getElementById('playBackBtn').disabled = recordEvents.length === 0;
}

/** Called from audio pipeline each frame while recording */
export function onRecordPitch(freq, clarity, clarityThreshold) {
  if (!recording) return;
  const now = performance.now();
  const timeMs = now - recordStartTime;

  const valid = freq && clarity >= clarityThreshold;

  if (valid) {
    const midi = freqToMidi(freq, _concertPitch);
    const info = midiToNoteInfo(midi);
    if (_lastFreq === null) {
      _lastEventStart = timeMs;
    }
    _lastFreq = freq;
    // auto-scroll
    scrollMs = Math.max(0, timeMs - viewMs * 0.75);
  } else {
    if (_lastFreq !== null) finalizeCurrentEvent(now);
    _lastFreq = null;
  }

  updateTimeBar();
}

function finalizeCurrentEvent(now) {
  if (_lastFreq === null) return;
  const timeMs = now - recordStartTime;
  const dur = timeMs - _lastEventStart;
  if (dur < 80) return; // discard very short blips
  const midi = freqToMidi(_lastFreq, _concertPitch);
  const info = midiToNoteInfo(midi);
  recordEvents.push({
    timeMs: _lastEventStart,
    freq: _lastFreq,
    midi,
    note: info.note,
    octave: info.octave,
    cents: info.cents,
    durationMs: dur,
  });
  _lastFreq = null;
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

  const totalMs = recordEvents.reduce((max, e) => Math.max(max, e.timeMs + e.durationMs), 0);
  let startWall = performance.now();

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
}

function stopPlayback() {
  _currentSynthHandle?.stop();
  onPlaybackEnd();
}

// ---- Clear ----
export function clearRecording() {
  stopPlayback();
  stopRecording();
  recordEvents = [];
  scrollMs = 0;
  document.getElementById('playBackBtn').disabled = true;
  updateTimeBar();
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
  const defName = defaultSaveName();
  const input = document.getElementById('saveNameInput');
  if (input) input.value = defName;
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
    container.innerHTML = '<p style="opacity:0.6;text-align:center">なし</p>';
  } else {
    container.innerHTML = keys.map(k => {
      const d = lsGet(k);
      if (!d) return '';
      const dateStr = d.savedAt ? new Date(d.savedAt).toLocaleString() : '';
      return `<div class="record-item">
        <div>
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
  const w = canvas.width;
  const h = canvas.height;
  const dpr = devicePixelRatio;
  const style = getComputedStyle(document.documentElement);

  // Background
  ctx.fillStyle = style.getPropertyValue('--bg-color').trim();
  ctx.fillRect(0, 0, w, h);

  const loMidi = _instrument.loMidi;
  const hiMidi = _instrument.hiMidi;
  const noteRange = hiMidi - loMidi + 1;
  const laneH = h / noteRange;

  // Note lane backgrounds (alternating)
  for (let m = loMidi; m <= hiMidi; m++) {
    const laneY = h - (m - loMidi + 1) * laneH;
    const info = midiToNoteInfo(m);
    const isBlack = [1,3,6,8,10].includes(info.note);
    ctx.fillStyle = isBlack
      ? style.getPropertyValue('--dot-bg').trim()
      : style.getPropertyValue('--surface-color').trim();
    ctx.fillRect(0, laneY, w, laneH);

    // Lane separator
    ctx.strokeStyle = style.getPropertyValue('--dot-weak').trim();
    ctx.lineWidth = 0.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, laneY + laneH);
    ctx.lineTo(w, laneY + laneH);
    ctx.stroke();
  }

  // Events
  const msPerPx = viewMs / w;
  const inTuneColor = style.getPropertyValue('--in-tune-color').trim();
  const sharpColor  = style.getPropertyValue('--sharp-color').trim();
  const flatColor   = style.getPropertyValue('--flat-color').trim();

  for (const ev of recordEvents) {
    const midiRounded = Math.round(ev.midi);
    if (midiRounded < loMidi || midiRounded > hiMidi) continue;

    const x0 = (ev.timeMs - scrollMs) / msPerPx;
    const evW = Math.max(4 * dpr, ev.durationMs / msPerPx);
    if (x0 + evW < 0 || x0 > w) continue;

    const laneIdx = midiRounded - loMidi;
    const laneY = h - (laneIdx + 1) * laneH;

    // Cents position within lane (±50¢ → top/bottom of lane)
    const centsOffset = clamp(ev.cents / 50, -1, 1);
    const innerH = laneH * 0.7;
    const innerY = laneY + (laneH - innerH) / 2;
    const centY = innerY + innerH * 0.5 - (centsOffset * innerH * 0.5);
    const dotH = Math.max(4 * dpr, innerH * 0.3);

    const color = Math.abs(ev.cents) <= 5 ? inTuneColor
                : ev.cents > 0 ? sharpColor : flatColor;

    const rx = Math.max(0, x0);
    const rw = Math.min(w - rx, evW - (rx - x0));
    const ry = centY - dotH / 2;
    const rr = Math.min(2 * dpr, rw / 2, dotH / 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(rx, ry, rw, dotH, rr);
    } else {
      ctx.rect(rx, ry, rw, dotH);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Current position line (recording or playing)
  if (recording || playing) {
    ctx.strokeStyle = style.getPropertyValue('--primary-color').trim();
    ctx.lineWidth = 2 * dpr;
    const posX = w * 0.75;
    ctx.beginPath();
    ctx.moveTo(posX, 0);
    ctx.lineTo(posX, h);
    ctx.stroke();
  }
}
