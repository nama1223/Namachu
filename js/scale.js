/* NamaChu — 音階測定タブ */

import { freqToMidi, midiToNoteInfo, noteName, clamp, lsGet, lsSet, showToast, openModal, closeModal, defaultSaveName } from './utils.js';
import { t } from './i18n.js';

// ---- Constants ----
const SHOTS_NEEDED = 3;
const TRIM_RATIO = 0.15;
const MIN_NOTE_MS = 300;
const STABILIZE_MS = 150;

// ---- State ----
let _instrument = null;
let _concertPitch = 440;
let _noteStyle = 'abc';
let _clarityThreshold = 0.85;
let measuring = false;

// Any-note mode: track shots per MIDI note
let shotsByMidi = {};          // { [midi]: number[] } shots (avg cents) per note
let currentDetectedMidi = null;
let noteBuffer = [];           // { cents, time } samples for current detection
let noteOnTime = null;

// Results: midiNote -> { avg, name }
let currentResults = {};

// Saved datasets for comparison
let savedDatasets = [];
const COLORS = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa','#00acc1'];

// Chart
let chartCanvas = null;
let chartCtx = null;

export function initScale(opts = {}) {
  _instrument = opts.instrument ?? null;
  _concertPitch = opts.concertPitch ?? 440;
  _noteStyle = opts.noteStyle ?? 'abc';
  _clarityThreshold = opts.clarityThreshold ?? 0.85;

  chartCanvas = document.getElementById('scaleChart');
  chartCtx = chartCanvas?.getContext('2d');

  loadSavedDatasets();
  renderChart();
  renderDataList();
}

export function setScaleInstrument(inst) { _instrument = inst; renderChart(); }
export function setScaleConcertPitch(hz) { _concertPitch = hz; }
export function setScaleNoteStyle(s) { _noteStyle = s; }
export function setScaleClarityThreshold(v) { _clarityThreshold = v; }
export function onScaleInstrumentChange() {}

// ---- Measure control ----
export function toggleScaleMeasure() {
  if (measuring) stopMeasure();
  else startMeasure();
}

function startMeasure() {
  if (!_instrument) { showToast('楽器を選択してください'); return; }
  measuring = true;
  currentResults = {};
  shotsByMidi = {};
  noteBuffer = [];
  noteOnTime = null;
  currentDetectedMidi = null;

  document.getElementById('scaleStartBtn')?.classList.add('measuring');
  const span = document.querySelector('#scaleStartBtn span');
  if (span) span.textContent = t('btn_stop');
  document.getElementById('scaleCurrentSection').style.display = '';
  document.getElementById('scaleCurrentNote').textContent = '--';
  document.getElementById('scaleCurrentCents').textContent = '-- ¢';
  updateShotDots(null);
  renderChart();
}

function stopMeasure() {
  // Commit any in-progress note
  commitNote(performance.now());
  measuring = false;
  currentDetectedMidi = null;

  document.getElementById('scaleStartBtn')?.classList.remove('measuring');
  const span = document.querySelector('#scaleStartBtn span');
  if (span) span.textContent = t('btn_scale_start');
  document.getElementById('scaleCurrentSection').style.display = 'none';
  renderChart();

  if (Object.keys(currentResults).length > 0) {
    finalizeMeasurement();
  }
}

function finalizeMeasurement() {
  const lang = document.documentElement.lang || 'ja';
  const instName = _instrument
    ? (_instrument[lang === 'ja' ? 'nameJa' : 'nameEn'] || _instrument.id)
    : '';
  const input = document.getElementById('scaleDatasetNameInput');
  if (input) input.value = instName;
  openModal('scaleNameModal');
}

export function confirmScaleDataset() {
  const input = document.getElementById('scaleDatasetNameInput');
  const name = input?.value.trim() || defaultSaveName();
  const color = COLORS[savedDatasets.length % COLORS.length];
  savedDatasets.push({ name, color, results: _currentResults() });
  lsSet('scaleDatasets', savedDatasets);
  closeModal('scaleNameModal');
  currentResults = {};
  renderChart();
  renderDataList();
  showToast(t('toast_saved'));
}

function _currentResults() {
  const out = {};
  for (const [m, v] of Object.entries(currentResults)) out[m] = v.avg;
  return out;
}

// ---- Called each audio frame ----
export function onScalePitch(freq, clarity) {
  const valid = freq && clarity >= _clarityThreshold;
  const now = performance.now();

  // Always update the tuning reference display (even when not measuring)
  if (valid) {
    const midi = freqToMidi(freq, _concertPitch);
    const info = midiToNoteInfo(midi);
    const sign = info.cents >= 0 ? '+' : '';
    document.getElementById('scaleRefNote').textContent =
      noteName(info.note, info.octave, _noteStyle, true);
    document.getElementById('scaleTuningCents').textContent = `${sign}${info.cents} ¢`;
  } else {
    document.getElementById('scaleTuningCents').textContent = '-- ¢';
  }

  if (!measuring) return;

  if (valid) {
    const midi = freqToMidi(freq, _concertPitch);
    const info = midiToNoteInfo(midi);
    const nearest = Math.round(midi);
    const sign = info.cents >= 0 ? '+' : '';
    document.getElementById('scaleCurrentCents').textContent = `${sign}${info.cents} ¢`;

    // Skip out-of-range notes
    if (_instrument && (nearest < _instrument.loMidi || nearest > _instrument.hiMidi)) {
      if (currentDetectedMidi !== null) { commitNote(now); currentDetectedMidi = null; }
      return;
    }

    if (nearest !== currentDetectedMidi) {
      // Note changed — commit previous
      commitNote(now);
      currentDetectedMidi = nearest;
      noteOnTime = now;
      noteBuffer = [];

      const newInfo = midiToNoteInfo(nearest);
      document.getElementById('scaleCurrentNote').textContent =
        noteName(newInfo.note, newInfo.octave, _noteStyle, true);
      updateShotDots(nearest);
    } else {
      // Same note continuing
      if (noteOnTime === null) noteOnTime = now;
      if (now - noteOnTime > STABILIZE_MS) {
        noteBuffer.push({ cents: info.cents, time: now });
      }
    }
  } else {
    // Silence
    if (currentDetectedMidi !== null) {
      commitNote(now);
      currentDetectedMidi = null;
      document.getElementById('scaleCurrentNote').textContent = '--';
      document.getElementById('scaleCurrentCents').textContent = '-- ¢';
      updateShotDots(null);
    }
  }
}

function commitNote(now) {
  if (currentDetectedMidi === null || noteBuffer.length === 0) {
    noteBuffer = [];
    noteOnTime = null;
    return;
  }
  const dur = noteOnTime ? now - noteOnTime : 0;
  if (dur < MIN_NOTE_MS) { noteBuffer = []; noteOnTime = null; return; }

  const trimCount = Math.floor(noteBuffer.length * TRIM_RATIO);
  const trimmed = noteBuffer.slice(trimCount, Math.max(trimCount + 1, noteBuffer.length - trimCount));
  if (trimmed.length === 0) { noteBuffer = []; noteOnTime = null; return; }

  const avg = trimmed.reduce((s, v) => s + v.cents, 0) / trimmed.length;

  if (!shotsByMidi[currentDetectedMidi]) shotsByMidi[currentDetectedMidi] = [];
  shotsByMidi[currentDetectedMidi].push(Math.round(avg));

  updateShotDots(currentDetectedMidi);

  if (shotsByMidi[currentDetectedMidi].length >= SHOTS_NEEDED) {
    const shots = shotsByMidi[currentDetectedMidi];
    const latest3 = shots.slice(-SHOTS_NEEDED);
    const finalAvg = latest3.reduce((s, v) => s + v, 0) / SHOTS_NEEDED;
    const info = midiToNoteInfo(currentDetectedMidi);
    const isNew = !currentResults[currentDetectedMidi];
    currentResults[currentDetectedMidi] = {
      avg: Math.round(finalAvg),
      name: noteName(info.note, info.octave, _noteStyle, true),
    };
    renderChart();
    if (isNew) showToast(`${currentResults[currentDetectedMidi].name} ✓`);
  }

  noteBuffer = [];
  noteOnTime = null;
}

function updateShotDots(midi) {
  const shots = midi !== null ? (shotsByMidi[midi] || []) : [];
  const done = midi !== null && !!currentResults[midi];
  for (let i = 0; i < SHOTS_NEEDED; i++) {
    const dot = document.getElementById('shot' + i);
    if (dot) {
      dot.classList.toggle('filled', i < shots.length || done);
      dot.classList.toggle('done', done);
    }
  }
}

// ---- Clear ----
export function clearScaleData() {
  currentResults = {};
  shotsByMidi = {};
  noteBuffer = [];
  noteOnTime = null;
  currentDetectedMidi = null;
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

// ---- Chart ----
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
  const YMAX = 30;
  const midY = padT + plotH / 2;

  // Grid
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

  // X axis labels
  const colW = plotW / noteCount;
  ctx.fillStyle = style.getPropertyValue('--text-color').trim();
  ctx.font = `${8 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i < noteCount; i++) {
    const m = loMidi + i;
    const info = midiToNoteInfo(m);
    if (info.note === 0) {
      const x = padL + (i + 0.5) * colW;
      ctx.fillText(noteName(info.note, info.octave, 'abc', true), x, h - padB + 10 * dpr);
    }
  }

  // Current measurement (dashed)
  drawDataset(ctx, currentResults, style.getPropertyValue('--text-color').trim() || '#888',
    loMidi, hiMidi, colW, midY, YMAX, padL, dpr, true);

  // Saved datasets
  savedDatasets.forEach(ds => {
    const r = {};
    for (const [m, v] of Object.entries(ds.results)) r[m] = { avg: v };
    drawDataset(ctx, r, ds.color, loMidi, hiMidi, colW, midY, YMAX, padL, dpr, false);
  });
}

function drawDataset(ctx, results, color, loMidi, hiMidi, colW, midY, YMAX, padL, dpr, isCurrent) {
  const pts = [];
  for (let m = loMidi; m <= hiMidi; m++) {
    const entry = results[m];
    if (!entry) continue;
    const cents = entry.avg ?? entry;
    const x = padL + (m - loMidi + 0.5) * colW;
    const y = midY - (clamp(cents, -YMAX, YMAX) / YMAX) * ((chartCanvas.height - 44 * dpr) / 2);
    pts.push({ x, y });
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
