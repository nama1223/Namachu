/* NamaChu — 音階測定タブ */

import { freqToMidi, midiToNoteInfo, noteName, clamp, lsGet, lsSet, showToast } from './utils.js';
import { t } from './i18n.js';

// ---- Constants ----
const SHOTS_NEEDED = 3;
const TRIM_RATIO = 0.15;     // trim this fraction from start & end of each note
const MIN_NOTE_MS = 300;     // ignore notes shorter than this
const STABILIZE_MS = 150;    // wait this long after note onset before sampling

// ---- State ----
let _instrument = null;
let _concertPitch = 440;
let _noteStyle = 'abc';
let _clarityThreshold = 0.85;
let measuring = false;

// Per-note accumulation
let currentTargetMidi = null;  // which note we're waiting for
let noteBuffer = [];           // { cents, time } samples for current note
let noteOnTime = null;
let shots = [];                // completed shot averages for current note

// Result map: midiNote -> average cents (for current instrument)
let currentResults = {}; // midiNote -> { avg, count, name }

// Saved datasets for comparison
let savedDatasets = [];        // [{ name, color, results }]

// Chart
let chartCanvas = null;
let chartCtx = null;

const COLORS = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa','#00acc1'];

export function initScale(opts = {}) {
  _instrument = opts.instrument ?? null;
  _concertPitch = opts.concertPitch ?? 440;
  _noteStyle = opts.noteStyle ?? 'abc';
  _clarityThreshold = opts.clarityThreshold ?? 0.85;

  chartCanvas = document.getElementById('scaleChart');
  chartCtx = chartCanvas?.getContext('2d');

  populateInstrumentSelect();
  loadSavedDatasets();
  renderChart();
  renderDataList();
}

export function setScaleInstrument(inst) {
  _instrument = inst;
  nextNote();
}
export function setScaleConcertPitch(hz) { _concertPitch = hz; }
export function setScaleNoteStyle(s) { _noteStyle = s; }
export function setScaleClarityThreshold(v) { _clarityThreshold = v; }

// ---- Instrument select (独自) ----
function populateInstrumentSelect() {
  const sel = document.getElementById('scaleMeasureInstrument');
  if (!sel || !_instrument) return;
  // populated by settings.js; just sync selection
}

export function onScaleInstrumentChange() {
  // handled by app.js
}

// ---- Measure control ----
export function toggleScaleMeasure() {
  if (measuring) stopMeasure();
  else startMeasure();
}

function startMeasure() {
  if (!_instrument) return;
  measuring = true;
  currentResults = {};
  shots = [];
  noteBuffer = [];
  noteOnTime = null;

  document.getElementById('scaleStartBtn')?.classList.add('measuring');
  const span = document.querySelector('#scaleStartBtn span');
  if (span) span.textContent = t('btn_stop');
  document.getElementById('scaleCurrentSection').style.display = '';

  nextNote();
}

function stopMeasure() {
  measuring = false;
  document.getElementById('scaleStartBtn')?.classList.remove('measuring');
  const span = document.querySelector('#scaleStartBtn span');
  if (span) span.textContent = t('btn_scale_start');
  document.getElementById('scaleCurrentSection').style.display = 'none';
  renderChart();
}

/** Move to next un-measured note (ascending from loMidi) */
function nextNote() {
  if (!_instrument) return;
  for (let m = _instrument.loMidi; m <= _instrument.hiMidi; m++) {
    if (!currentResults[m]) {
      currentTargetMidi = m;
      shots = [];
      noteBuffer = [];
      noteOnTime = null;
      updateShotDots();
      const info = midiToNoteInfo(m);
      const el = document.getElementById('scaleCurrentNote');
      if (el) el.textContent = noteName(info.note, info.octave, _noteStyle, true);
      document.getElementById('scaleCurrentCents').textContent = '-- ¢';
      return;
    }
  }
  // All notes done
  finalizeMeasurement();
}

function finalizeMeasurement() {
  stopMeasure();
  // Save as dataset
  const lang = document.documentElement.lang || 'ja';
  const name = _instrument ? (_instrument[lang === 'ja' ? 'nameJa' : 'nameEn']) : 'Unknown';
  const color = COLORS[savedDatasets.length % COLORS.length];
  savedDatasets.push({ name, color, results: { ..._currentResults() } });
  lsSet('scaleDatasets', savedDatasets);
  renderChart();
  renderDataList();
  showToast('測定完了');
}

function _currentResults() {
  const out = {};
  for (const [m, v] of Object.entries(currentResults)) {
    out[m] = v.avg;
  }
  return out;
}

// ---- Called each audio frame while measuring ----
export function onScalePitch(freq, clarity) {
  if (!measuring || currentTargetMidi === null) return;

  const valid = freq && clarity >= _clarityThreshold;
  const now = performance.now();

  // Update tuning display in upper part
  if (valid) {
    const midi = freqToMidi(freq, _concertPitch);
    const info = midiToNoteInfo(midi);
    const nearest = Math.round(midi);
    document.getElementById('scaleCurrentCents').textContent =
      `${info.cents >= 0 ? '+' : ''}${info.cents} ¢`;

    if (nearest === currentTargetMidi) {
      if (noteOnTime === null) noteOnTime = now;
      const elapsed = now - noteOnTime;
      if (elapsed > STABILIZE_MS) {
        noteBuffer.push({ cents: info.cents, time: now });
      }
    } else {
      // Different note — commit if long enough
      commitNote(now);
    }
  } else {
    commitNote(now);
  }
}

function commitNote(now) {
  if (noteBuffer.length === 0) { noteOnTime = null; return; }
  const dur = now - noteOnTime;
  if (dur < MIN_NOTE_MS) { noteBuffer = []; noteOnTime = null; return; }

  // Trim head & tail
  const trimCount = Math.floor(noteBuffer.length * TRIM_RATIO);
  const trimmed = noteBuffer.slice(trimCount, noteBuffer.length - trimCount);
  if (trimmed.length === 0) { noteBuffer = []; noteOnTime = null; return; }

  const avg = trimmed.reduce((s, v) => s + v.cents, 0) / trimmed.length;
  shots.push(Math.round(avg));
  noteBuffer = [];
  noteOnTime = null;

  updateShotDots();

  if (shots.length >= SHOTS_NEEDED) {
    const finalAvg = shots.reduce((s, v) => s + v, 0) / shots.length;
    currentResults[currentTargetMidi] = {
      avg: Math.round(finalAvg),
      name: (() => { const i = midiToNoteInfo(currentTargetMidi); return noteName(i.note, i.octave, _noteStyle, true); })()
    };
    renderChart();
    nextNote();
  }
}

function updateShotDots() {
  for (let i = 0; i < SHOTS_NEEDED; i++) {
    document.getElementById('shot' + i)?.classList.toggle('filled', i < shots.length);
  }
}

// ---- Clear ----
export function clearScaleData() {
  currentResults = {};
  shots = [];
  noteBuffer = [];
  if (measuring) stopMeasure();
  renderChart();
}

// ---- Persist / compare ----
function loadSavedDatasets() {
  savedDatasets = lsGet('scaleDatasets') || [];
}

export function exportScaleData() {
  const data = JSON.stringify({ datasets: savedDatasets }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'NamaChu_scale_' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(t('toast_export_done'));
}

export function deleteDataset(idx) {
  savedDatasets.splice(idx, 1);
  lsSet('scaleDatasets', savedDatasets);
  renderChart();
  renderDataList();
}

function renderDataList() {
  const el = document.getElementById('scaleDataList');
  if (!el) return;
  if (savedDatasets.length === 0) {
    el.innerHTML = '<p style="font-size:0.8rem;opacity:0.6">なし</p>';
    return;
  }
  el.innerHTML = savedDatasets.map((ds, i) => `
    <div class="scale-data-item">
      <span class="scale-data-color" style="background:${ds.color}"></span>
      <span class="scale-data-name">${ds.name}</span>
      <button class="scale-data-del" onclick="deleteDataset(${i})">✕</button>
    </div>`).join('');
}

// ---- Chart (canvas) ----
function renderChart() {
  if (!chartCtx || !chartCanvas || !_instrument) return;
  const dpr = devicePixelRatio;
  const w = chartCanvas.offsetWidth * dpr;
  const h = chartCanvas.offsetHeight * dpr;
  chartCanvas.width = w;
  chartCanvas.height = h;
  const ctx = chartCtx;
  const style = getComputedStyle(document.documentElement);

  ctx.fillStyle = style.getPropertyValue('--bg-color').trim();
  ctx.fillRect(0, 0, w, h);

  const loMidi = _instrument.loMidi;
  const hiMidi = _instrument.hiMidi;
  const noteCount = hiMidi - loMidi + 1;

  const padL = 36 * dpr, padR = 12 * dpr, padT = 16 * dpr, padB = 28 * dpr;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Y axis: ±30¢
  const YMAX = 30;
  const midY = padT + plotH / 2;

  // Grid lines
  ctx.strokeStyle = style.getPropertyValue('--dot-weak').trim();
  ctx.lineWidth = 1 * dpr;
  for (const c of [-25, -10, 0, 10, 25]) {
    const y = midY - (c / YMAX) * (plotH / 2);
    ctx.setLineDash(c === 0 ? [] : [4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = style.getPropertyValue('--text-color').trim();
    ctx.font = `${9 * dpr}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText((c > 0 ? '+' : '') + c, padL - 3 * dpr, y + 3 * dpr);
  }

  // X axis ticks + labels
  const colW = plotW / noteCount;
  ctx.fillStyle = style.getPropertyValue('--text-color').trim();
  ctx.font = `${8 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i < noteCount; i++) {
    const m = loMidi + i;
    const info = midiToNoteInfo(m);
    const x = padL + (i + 0.5) * colW;
    if ([0,4,7,9,11].includes(info.note)) {
      ctx.fillText(noteName(info.note, info.octave, 'abc', false), x, h - padB + 10 * dpr);
    }
  }

  // Current measurement
  drawDataset(ctx, currentResults, '#888', loMidi, hiMidi, plotW, plotH, padL, padT, colW, midY, YMAX, dpr, true);

  // Saved datasets
  savedDatasets.forEach(ds => {
    const r = {};
    for (const [m, v] of Object.entries(ds.results)) r[m] = { avg: v };
    drawDataset(ctx, r, ds.color, loMidi, hiMidi, plotW, plotH, padL, padT, colW, midY, YMAX, dpr, false);
  });
}

function drawDataset(ctx, results, color, loMidi, hiMidi, plotW, plotH, padL, padT, colW, midY, YMAX, dpr, isCurrent) {
  const pts = [];
  for (let m = loMidi; m <= hiMidi; m++) {
    const entry = results[m];
    if (!entry) continue;
    const cents = entry.avg ?? entry;
    const x = padL + (m - loMidi + 0.5) * colW;
    const y = midY - (clamp(cents, -YMAX, YMAX) / YMAX) * (plotH / 2);
    pts.push({ x, y, cents });
  }
  if (pts.length === 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = (isCurrent ? 1.5 : 2) * dpr;
  ctx.globalAlpha = isCurrent ? 0.5 : 0.9;
  ctx.setLineDash(isCurrent ? [4 * dpr, 3 * dpr] : []);
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
