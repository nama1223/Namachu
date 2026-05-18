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

// 音名ごとの色 (6色 × 2 = 12半音をカバー。C/F#=赤, C#/G=橙, D/G#=緑, D#/A=黄, E/A#=青, F/B=紫)
const NOTE_COLORS_6 = ['#e53935','#fb8c00','#43a047','#f9a825','#1e88e5','#7b1fa2'];
function _noteColor(midi) {
  return NOTE_COLORS_6[((Math.round(midi) % 12) + 12) % 12 % 6];
}

// グラフ/リスト表示切り替え
let _scaleViewMode = 'graph'; // 'graph' | 'list'

export function switchScaleView(mode) {
  _scaleViewMode = mode;
  document.querySelectorAll('.scale-view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  renderChart();
}

// ポップアップ
let _scalePopup = null;
let _popupTimer = null;

// Chart
let chartCanvas = null;
let chartCtx = null;

// Mini-tuner graph (pre-measurement)
let miniCanvas = null;
let miniCtx = null;
const MINI_BUF_SIZE = 300; // ~5s at 60fps
const _miniBuf = [];       // { cents: number|null, noteName: string|null }
let _miniRafId = null;

export function initScale(opts = {}) {
  _instrument = opts.instrument ?? null;
  _concertPitch = opts.concertPitch ?? 440;
  _noteStyle = opts.noteStyle ?? 'abc';
  _clarityThreshold = opts.clarityThreshold ?? 0.85;

  chartCanvas = document.getElementById('scaleChart');
  chartCtx = chartCanvas?.getContext('2d');

  miniCanvas = document.getElementById('scaleMiniTuner');
  miniCtx = miniCanvas?.getContext('2d');

  loadSavedDatasets();
  renderChart();
  renderDataList();
  _startMiniLoop();
  _initChartInteraction();
}

export function setScaleInstrument(inst) { _instrument = inst; renderChart(); }
export function setScaleConcertPitch(hz) { _concertPitch = hz; }
export function setScaleNoteStyle(s) { _noteStyle = s; }
export function setScaleClarityThreshold(v) { _clarityThreshold = v; }
// onScaleInstrumentChange は settings.js で定義・app.js でグローバル登録

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
  // チューニングセクションを非表示に
  const tuningSection = document.getElementById('scaleTuningSection');
  if (tuningSection) tuningSection.style.display = 'none';
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
  // チューニングセクションを再表示
  const tuningSection = document.getElementById('scaleTuningSection');
  if (tuningSection) tuningSection.style.display = '';
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

  // ミニチューナーグラフ用バッファ更新（測定前のみ）
  if (!measuring) {
    if (valid) {
      const midi = freqToMidi(freq, _concertPitch);
      const info = midiToNoteInfo(midi);
      _miniBuf.push({ cents: info.cents, label: noteName(info.note, info.octave, _noteStyle, true) });
    } else {
      _miniBuf.push({ cents: null, label: null });
    }
    if (_miniBuf.length > MINI_BUF_SIZE) _miniBuf.shift();
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

// ---- Chart クリックポップアップ ----
function _initChartInteraction() {
  if (!chartCanvas) return;
  chartCanvas.addEventListener('click', _onChartClick);
  chartCanvas.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 0) return;
    const t = e.changedTouches[0];
    _onChartClick({ clientX: t.clientX, clientY: t.clientY });
  });
  // 外側クリックで閉じる
  document.addEventListener('click', (e) => {
    if (e.target !== chartCanvas && _scalePopup) _scalePopup.style.display = 'none';
  });
}

function _ensurePopup() {
  if (_scalePopup) return _scalePopup;
  _scalePopup = document.createElement('div');
  _scalePopup.style.cssText = [
    'position:fixed', 'z-index:3000', 'pointer-events:none', 'display:none',
    'padding:8px 14px', 'border-radius:10px', 'line-height:1.5',
    'background:var(--surface-color,#fff)', 'color:var(--text-color,#333)',
    'border:1px solid var(--dot-weak,#ccc)', 'box-shadow:0 2px 10px rgba(0,0,0,0.2)',
    'font-size:0.9rem', 'font-weight:bold', 'text-align:center',
  ].join(';');
  document.body.appendChild(_scalePopup);
  return _scalePopup;
}

function _showScalePopup(clientX, clientY, entries) {
  const popup = _ensurePopup();
  popup.innerHTML = entries.map(({ name, cents, color }) => {
    const sign = cents >= 0 ? '+' : '';
    return `<div style="color:${color};font-size:1.05rem">${name}</div>` +
           `<div style="font-size:0.85rem;opacity:0.85">${sign}${cents} ¢</div>`;
  }).join('<hr style="border:none;border-top:1px solid var(--dot-weak);margin:4px 0">');
  popup.style.display = 'block';
  const vw = window.innerWidth, vh = window.innerHeight;
  const pw = 110, ph = 60 * entries.length;
  popup.style.left = Math.min(clientX + 12, vw - pw - 8) + 'px';
  popup.style.top  = Math.max(8, Math.min(clientY - ph / 2, vh - ph - 8)) + 'px';
  clearTimeout(_popupTimer);
  _popupTimer = setTimeout(() => { popup.style.display = 'none'; }, 4000);
}

function _onChartClick(e) {
  if (!chartCanvas || !_instrument) return;
  const rect = chartCanvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;

  const noteCount = _instrument.hiMidi - _instrument.loMidi + 1;
  const padL = 36, padR = 12;
  const plotW = chartCanvas.offsetWidth - padL - padR;
  const colW = plotW / noteCount;
  const relX = cssX - padL;
  if (relX < 0 || relX > plotW) { if (_scalePopup) _scalePopup.style.display = 'none'; return; }

  const i = Math.floor(relX / colW);
  const m = _instrument.loMidi + i;
  if (m < _instrument.loMidi || m > _instrument.hiMidi) return;

  const info = midiToNoteInfo(m);
  const noteLbl = noteName(info.note, info.octave, _noteStyle, true);
  const color = _noteColor(m);
  const entries = [];

  if (currentResults[m]) {
    entries.push({ name: noteLbl + ' (現在)', cents: Math.round(currentResults[m].avg), color });
  }
  savedDatasets.forEach(ds => {
    const val = ds.results[m];
    if (val !== undefined) {
      const cents = typeof val === 'object' ? val.avg : val;
      entries.push({ name: `${noteLbl} (${ds.name})`, cents: Math.round(cents), color: ds.color });
    }
  });

  if (entries.length > 0) {
    _showScalePopup(e.clientX, e.clientY, entries);
  } else {
    if (_scalePopup) _scalePopup.style.display = 'none';
  }
}

// ---- Mini-tuner graph ----
function _startMiniLoop() {
  cancelAnimationFrame(_miniRafId);
  function loop() {
    _miniRafId = requestAnimationFrame(loop);
    if (!measuring) _drawMiniTuner();
  }
  loop();
}

function _drawMiniTuner() {
  if (!miniCtx || !miniCanvas) return;
  const dpr = devicePixelRatio;
  const w = miniCanvas.offsetWidth * dpr;
  const h = miniCanvas.offsetHeight * dpr;
  if (w === 0 || h === 0) return;
  if (miniCanvas.width !== w || miniCanvas.height !== h) {
    miniCanvas.width = w;
    miniCanvas.height = h;
  }

  const ctx = miniCtx;
  const style = getComputedStyle(document.documentElement);
  const YMAX = 50;
  const padL = 28 * dpr, padR = 6 * dpr, padT = 4 * dpr, padB = 4 * dpr;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const midY = padT + plotH / 2;

  ctx.fillStyle = style.getPropertyValue('--bg-color').trim() || '#fff';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = style.getPropertyValue('--dot-weak').trim();
  ctx.lineWidth = 1 * dpr;
  for (const c of [-50, -25, 0, 25, 50]) {
    const y = midY - (c / YMAX) * (plotH / 2);
    ctx.setLineDash(c === 0 ? [] : [3 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    if (c !== 0) {
      ctx.fillStyle = style.getPropertyValue('--text-color').trim();
      ctx.font = `${8 * dpr}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText((c > 0 ? '+' : '') + c, padL - 2 * dpr, y + 3 * dpr);
    }
  }

  const inTune = style.getPropertyValue('--in-tune-color').trim() || '#4caf50';
  const sharp  = style.getPropertyValue('--sharp-color').trim()  || '#e53935';
  const flat   = style.getPropertyValue('--flat-color').trim()   || '#1e88e5';

  const buf = _miniBuf;
  if (buf.length === 0) return;

  const colW = plotW / MINI_BUF_SIZE;
  const offsetX = padL + (MINI_BUF_SIZE - buf.length) * colW;

  // Draw line + dots
  let prevPt = null;
  let lastLabel = null;
  for (let i = 0; i < buf.length; i++) {
    const entry = buf[i];
    if (entry.cents === null) { prevPt = null; continue; }
    const x = offsetX + i * colW;
    const cents = clamp(entry.cents, -YMAX, YMAX);
    const y = midY - (cents / YMAX) * (plotH / 2);
    const color = Math.abs(cents) <= 5 ? inTune : cents > 0 ? sharp : flat;

    if (prevPt) {
      ctx.strokeStyle = prevPt.color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(prevPt.x, prevPt.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 1 * dpr, 0, Math.PI * 2);
    ctx.fill();

    prevPt = { x, y, color };
    if (entry.label) lastLabel = entry.label;
  }

  // 現在の音名を右端に表示
  if (lastLabel && buf[buf.length - 1]?.cents !== null) {
    const lastEntry = buf[buf.length - 1];
    const color = Math.abs(lastEntry.cents) <= 5 ? inTune : lastEntry.cents > 0 ? sharp : flat;
    ctx.font = `bold ${11 * dpr}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(lastLabel, padL + 4 * dpr, padT + 14 * dpr);
  }
}

// ---- Chart dispatcher ----
function renderChart() {
  if (_scaleViewMode === 'list') _renderList();
  else _renderGraph();
}

// ---- Graph view ----
function _renderGraph() {
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

  // padT は上部ラベル用に大きめ
  const padL = 36 * dpr, padR = 12 * dpr, padT = 26 * dpr, padB = 28 * dpr;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const YMAX = 50;
  const midY = padT + plotH / 2;
  const textColor = style.getPropertyValue('--text-color').trim();

  // Grid: 10¢ ごと
  ctx.strokeStyle = style.getPropertyValue('--dot-weak').trim();
  ctx.lineWidth = 1 * dpr;
  for (let c = -50; c <= 50; c += 10) {
    const y = midY - (c / YMAX) * (plotH / 2);
    ctx.setLineDash(c === 0 ? [] : (Math.abs(c) === 50 ? [5 * dpr, 3 * dpr] : [2 * dpr, 4 * dpr]));
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = textColor;
    ctx.font = `${9 * dpr}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText((c > 0 ? '+' : '') + c, padL - 3 * dpr, y + 3 * dpr);
  }

  // X axis labels — 衝突なしでできるだけ多く表示
  // 自然音は下側、黒鍵は上側
  const colW = plotW / noteCount;
  const BLACK_SET = new Set([1, 3, 6, 8, 10]);
  const NATURAL_PRI = [0, 7, 4, 9, 2, 5, 11]; // C G E A D F B の優先度
  const minGap = 8 * dpr;
  const usedBelow = [];
  const usedAbove = [];

  for (const pri of NATURAL_PRI) {
    for (let i = 0; i < noteCount; i++) {
      const m = loMidi + i;
      const info = midiToNoteInfo(m);
      if (info.note !== pri) continue;
      const x = padL + (i + 0.5) * colW;
      if (usedBelow.some(ox => Math.abs(x - ox) < minGap)) continue;
      usedBelow.push(x);
      const isC = (pri === 0);
      ctx.font = `${isC ? 'bold ' : ''}${8 * dpr}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = _noteColor(m);
      ctx.globalAlpha = isC ? 1 : 0.85;
      const label = isC
        ? noteName(info.note, info.octave, _noteStyle, true)
        : noteName(info.note, info.octave, _noteStyle, false);
      ctx.fillText(label, x, h - padB + 10 * dpr);
      ctx.globalAlpha = 1;
    }
  }

  for (let i = 0; i < noteCount; i++) {
    const m = loMidi + i;
    const info = midiToNoteInfo(m);
    if (!BLACK_SET.has(info.note)) continue;
    const x = padL + (i + 0.5) * colW;
    if (usedAbove.some(ox => Math.abs(x - ox) < minGap)) continue;
    usedAbove.push(x);
    ctx.font = `${7 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = _noteColor(m);
    ctx.globalAlpha = 0.7;
    ctx.fillText(noteName(info.note, info.octave, _noteStyle, false), x, padT - 5 * dpr);
    ctx.globalAlpha = 1;
  }

  // Current measurement (dashed)
  drawDataset(ctx, currentResults, textColor || '#888',
    loMidi, hiMidi, colW, midY, YMAX, padL, padT, padB, dpr, true);

  // Saved datasets
  savedDatasets.forEach(ds => {
    const r = {};
    for (const [m, v] of Object.entries(ds.results)) r[m] = { avg: v };
    drawDataset(ctx, r, ds.color, loMidi, hiMidi, colW, midY, YMAX, padL, padT, padB, dpr, false);
  });
}

function drawDataset(ctx, results, color, loMidi, hiMidi, colW, midY, YMAX, padL, padT, padB, dpr, isCurrent) {
  const plotH = chartCanvas.height - padT - padB;
  const pts = [];
  for (let m = loMidi; m <= hiMidi; m++) {
    const entry = results[m];
    if (!entry) continue;
    const cents = entry.avg ?? entry;
    const x = padL + (m - loMidi + 0.5) * colW;
    const y = midY - (clamp(cents, -YMAX, YMAX) / YMAX) * (plotH / 2);
    pts.push({ x, y, m });
  }
  if (pts.length === 0) return;

  // 接続線: データセット色（現在測定は点線・半透明）
  ctx.strokeStyle = color;
  ctx.lineWidth = (isCurrent ? 1.5 : 2) * dpr;
  ctx.globalAlpha = isCurrent ? 0.4 : 0.7;
  ctx.setLineDash(isCurrent ? [4 * dpr, 3 * dpr] : []);
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);

  // ドット: 音名カラー
  ctx.globalAlpha = isCurrent ? 0.8 : 1;
  for (const p of pts) {
    ctx.fillStyle = _noteColor(p.m);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    // 白い縁取りで視認性UP
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---- List view ----
function _renderList() {
  if (!chartCtx || !chartCanvas || !_instrument) return;
  const dpr = devicePixelRatio;
  const w = chartCanvas.offsetWidth * dpr;
  const h = chartCanvas.offsetHeight * dpr;
  chartCanvas.width = w;
  chartCanvas.height = h;
  const ctx = chartCtx;
  const style = getComputedStyle(document.documentElement);

  const bgColor   = style.getPropertyValue('--bg-color').trim()        || '#fff';
  const textColor = style.getPropertyValue('--text-color').trim()       || '#333';
  const dotWeak   = style.getPropertyValue('--dot-weak').trim()         || '#ccc';
  const inTuneCol = style.getPropertyValue('--in-tune-color').trim()    || '#4caf50';
  const sharpCol  = style.getPropertyValue('--sharp-color').trim()      || '#e53935';
  const flatCol   = style.getPropertyValue('--flat-color').trim()       || '#1e88e5';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const loMidi = _instrument.loMidi;
  const hiMidi = _instrument.hiMidi;
  // MIDI octave: C4=60 → octave = floor(midi/12)-1
  const loOct = Math.floor(loMidi / 12) - 1;
  const hiOct = Math.floor(hiMidi / 12) - 1;
  const octCount = hiOct - loOct + 1;

  const ROW_COUNT = 12;
  const padL = 4 * dpr, padR = 4 * dpr, padT = 18 * dpr, padB = 4 * dpr;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const colW  = plotW / octCount;
  const rowH  = plotH / ROW_COUNT;
  // 行の高さに合わせてフォントサイズを決める（最大11dpr, 最小7dpr）
  const fontSize = clamp(rowH * 0.38, 7 * dpr, 11 * dpr);
  const BLACK_SET = new Set([1, 3, 6, 8, 10]);

  // オクターブ列ヘッダー（例: C4 の "4"）
  ctx.font = `bold ${clamp(fontSize * 0.9, 7 * dpr, 10 * dpr)}px sans-serif`;
  ctx.textAlign = 'center';
  for (let oct = loOct; oct <= hiOct; oct++) {
    const x = padL + (oct - loOct + 0.5) * colW;
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.55;
    ctx.fillText(`C${oct}`, x, padT - 4 * dpr);
  }
  ctx.globalAlpha = 1;

  // 縦区切り線
  ctx.strokeStyle = dotWeak;
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i <= octCount; i++) {
    const x = padL + i * colW;
    ctx.beginPath();
    ctx.moveTo(x, padT - 16 * dpr);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 各行（半音）を描画
  for (let row = 0; row < ROW_COUNT; row++) {
    const semitone = row; // 0=C … 11=B (下へいくほど高い音)
    const isBlack = BLACK_SET.has(semitone);
    const ry = padT + row * rowH;

    // 黒鍵行の背景を薄く着色
    if (isBlack) {
      ctx.fillStyle = dotWeak;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(padL, ry, plotW, rowH);
      ctx.globalAlpha = 1;
    }

    // 行区切り線
    ctx.strokeStyle = dotWeak;
    ctx.lineWidth = 0.5 * dpr;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(padL, ry);
    ctx.lineTo(w - padR, ry);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 各列（オクターブ）
    for (let oct = loOct; oct <= hiOct; oct++) {
      const midi = (oct + 1) * 12 + semitone;
      if (midi < loMidi || midi > hiMidi) continue;

      const cx = padL + (oct - loOct) * colW;
      const noteColor = _noteColor(midi);
      const info = midiToNoteInfo(midi);
      // C は "C4" 形式、それ以外は音名のみ
      const label = noteName(info.note, info.octave, _noteStyle, semitone === 0);

      // 音名
      ctx.font = `${isBlack ? '' : 'bold '}${fontSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = noteColor;
      ctx.globalAlpha = isBlack ? 0.75 : 0.9;
      ctx.fillText(label, cx + 3 * dpr, ry + rowH * 0.62);
      ctx.globalAlpha = 1;

      // cents 値（現在測定＋保存データセット）
      const allVals = [];
      if (currentResults[midi]) {
        allVals.push({ cents: currentResults[midi].avg, isCurrent: true });
      }
      savedDatasets.forEach(ds => {
        const v = ds.results[midi];
        if (v !== undefined) {
          allVals.push({ cents: Math.round(typeof v === 'object' ? v.avg : v), isCurrent: false, dsColor: ds.color });
        }
      });

      if (allVals.length > 0) {
        const vFontSize = clamp(fontSize * (allVals.length > 1 ? 0.72 : 0.88), 6 * dpr, 10 * dpr);
        ctx.font = `bold ${vFontSize}px sans-serif`;
        ctx.textAlign = 'right';
        const rightX = cx + colW - 3 * dpr;
        allVals.forEach((v, vi) => {
          const sign = v.cents >= 0 ? '+' : '';
          ctx.fillStyle = Math.abs(v.cents) <= 5 ? inTuneCol : v.cents > 0 ? sharpCol : flatCol;
          // 複数ある場合は上下に分割配置
          const fracY = allVals.length === 1
            ? 0.62
            : 0.28 + vi * (0.65 / (allVals.length - 1));
          ctx.fillText(`${sign}${v.cents}`, rightX, ry + rowH * fracY);
        });
      }
    }
  }
}
