/* NamaChu — チューナータブ (meter + time-graph) */

import { freqToMidi, midiToNoteInfo, noteName } from './utils.js';

// ---- State ----
let _concertPitch = 442;
let _noteStyle = 'abc';
let _instrument = null;
let _displayTrans = 0; // semitones: displayMidi = concertMidi - _displayTrans
let _clarityThreshold = 0.85;
let _fullColorEnabled = false;

// Time-graph circular buffer (3段表示用に 30 秒分)
const GRAPH_SECONDS = 30;
const GRAPH_FPS = 30;
const GRAPH_POINTS = GRAPH_SECONDS * GRAPH_FPS;
const NUM_ROWS = 3;
const POINTS_PER_ROW = GRAPH_POINTS / NUM_ROWS;
const graphBuf = new Array(GRAPH_POINTS).fill(null); // null | { cents, inTune, name }
let graphHead = 0;

// Needle smoothing
let needleCents = 0;
const NEEDLE_SMOOTH = 0.25; // lerp factor per frame

// SVG tick marks (drawn once)
let ticksBuilt = false;

export function initTuner(opts = {}) {
  _concertPitch = opts.concertPitch ?? 440;
  _noteStyle = opts.noteStyle ?? 'abc';
  _instrument = opts.instrument ?? null;
  _clarityThreshold = opts.clarityThreshold ?? 0.85;
  _displayTrans = opts.displayTrans ?? 0;

  buildMeterTicks();
  initTimeGraph();
  resetDisplay();
}

export function setTunerConcertPitch(hz) { _concertPitch = hz; }
export function setTunerNoteStyle(s) { _noteStyle = s; }
export function setTunerInstrument(inst) { _instrument = inst; }
export function setTunerDisplayTrans(semitones) { _displayTrans = semitones; }
export function setTunerClarityThreshold(v) { _clarityThreshold = v; }

export function toggleFullColor() {
  _fullColorEnabled = !_fullColorEnabled;
  const btn = document.getElementById('fullColorBtn');
  if (btn) {
    btn.classList.toggle('active', _fullColorEnabled);
    btn.dataset.on = _fullColorEnabled ? '1' : '0';
  }
  if (!_fullColorEnabled) _clearFullColorBg();
}

function _clearFullColorBg() {
  const cont = document.querySelector('.container');
  if (cont) cont.style.backgroundColor = '';
}

// ---- Called each audio frame ----
export function onPitch(freq, clarity, rms) {
  if (!freq || clarity < _clarityThreshold) {
    // 無音時はグラフを進めず一時停止（針と表示だけ更新）
    animateNeedleTo(0);
    setDisplaySilent();
    updateFullColorBg(null);
    return;
  }

  const midi = freqToMidi(freq, _concertPitch);
  const { cents } = midiToNoteInfo(midi);

  // Apply display transposition (written pitch for transposing instruments)
  const displayMidi = midi - _displayTrans;
  const dispInfo = midiToNoteInfo(displayMidi);

  const name = noteName(dispInfo.note, dispInfo.octave, _noteStyle, false);
  const inTune = Math.abs(cents) <= 5;

  pushGraph({ cents, inTune, name: name + dispInfo.octave });
  animateNeedleTo(cents);
  updateDisplay(name, dispInfo.octave, cents, freq, inTune);
  updateFullColorBg(cents);
}

// ---- Meter needle ----
function buildMeterTicks() {
  if (ticksBuilt) return;
  ticksBuilt = true;
  const g = document.getElementById('meterTicks');
  if (!g) return;

  // Arc: -50¢ (left) to +50¢ (right), centered at top
  // 0¢ = angle 0 (pointing up from pivot at 150,150)
  // ±50¢ = ±65°
  const cx = 150, cy = 150, r = 120;
  const maxAngle = 65;

  for (let c = -50; c <= 50; c += 5) {
    const angle = (c / 50) * maxAngle * (Math.PI / 180);
    const isMajor = c % 25 === 0;
    const isCenter = c === 0;
    const len = isCenter ? 22 : isMajor ? 16 : 10;
    const x1 = cx + Math.sin(angle) * r;
    const y1 = cy - Math.cos(angle) * r;
    const x2 = cx + Math.sin(angle) * (r - len);
    const y2 = cy - Math.cos(angle) * (r - len);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toFixed(1));
    line.setAttribute('y1', y1.toFixed(1));
    line.setAttribute('x2', x2.toFixed(1));
    line.setAttribute('y2', y2.toFixed(1));
    line.setAttribute('stroke-width', isCenter ? 3 : isMajor ? 2 : 1);
    if (isCenter) line.classList.add('center');
    else if (isMajor) line.classList.add('major');
    g.appendChild(line);
  }

  // Pure intonation third markers (triangles pointing inward, base on arc)
  // Major 3rd below root: -13.7¢  Minor 3rd above root: +15.6¢
  const thirdCents = [-13.7, 15.6];
  const triR = r + 10; // base sits just outside the arc (r=120), tip points inward
  for (const c of thirdCents) {
    const aRad = (c / 50) * maxAngle * (Math.PI / 180);
    const sinA = Math.sin(aRad), cosA = Math.cos(aRad);
    // Tip: at the arc edge
    const tx = (cx + sinA * r).toFixed(1);
    const ty = (cy - cosA * r).toFixed(1);
    // Base: 10px outside the arc, ±5px tangential
    const ox = cx + sinA * triR, oy = cy - cosA * triR;
    const b1x = (ox + cosA * 5).toFixed(1);
    const b1y = (oy + sinA * 5).toFixed(1);
    const b2x = (ox - cosA * 5).toFixed(1);
    const b2y = (oy - sinA * 5).toFixed(1);
    const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    tri.setAttribute('points', `${tx},${ty} ${b1x},${b1y} ${b2x},${b2y}`);
    tri.classList.add('just-third-mark');
    g.appendChild(tri);
  }
}

function centsToNeedleAngle(cents) {
  return Math.max(-65, Math.min(65, cents / 50 * 65));
}

let _needleRaf = null;
function animateNeedleTo(targetCents) {
  needleCents = needleCents + (targetCents - needleCents) * NEEDLE_SMOOTH;
  const angle = centsToNeedleAngle(needleCents);
  const needle = document.getElementById('meterNeedle');
  if (needle) {
    needle.style.transform = `rotate(${angle}deg)`;
    const inTune = Math.abs(needleCents) <= 5;
    needle.classList.toggle('in-tune', inTune);
  }
}

// ---- Note display ----
function updateDisplay(name, octave, cents, freq, inTune) {
  const nameEl = document.getElementById('noteName');
  const octEl = document.getElementById('noteOctave');
  const centsEl = document.getElementById('noteCents');
  const freqEl = document.getElementById('noteFreq');

  if (nameEl) nameEl.textContent = name;
  if (octEl) octEl.textContent = octave;
  if (centsEl) {
    const sign = cents >= 0 ? '+' : '';
    centsEl.textContent = `${sign}${cents} ¢`;
    centsEl.className = 'note-cents ' + (inTune ? 'in-tune' : cents > 0 ? 'sharp' : 'flat');
  }
  if (freqEl) freqEl.textContent = `${freq.toFixed(1)} Hz`;
}

function setDisplaySilent() {
  // Keep last note displayed, just clear cents/freq to show silence
  const centsEl = document.getElementById('noteCents');
  if (centsEl) { centsEl.textContent = '-- ¢'; centsEl.className = 'note-cents'; }
}

function resetDisplay() {
  const nameEl = document.getElementById('noteName');
  const octEl = document.getElementById('noteOctave');
  const centsEl = document.getElementById('noteCents');
  const freqEl = document.getElementById('noteFreq');
  if (nameEl) nameEl.textContent = '--';
  if (octEl) octEl.textContent = '';
  if (centsEl) { centsEl.textContent = '±0 ¢'; centsEl.className = 'note-cents'; }
  if (freqEl) freqEl.textContent = '-- Hz';
  graphBuf.fill(null);
  graphHead = 0;
}

// ---- Time-graph canvas ----
let graphCanvas = null;
let graphCtx = null;
let graphRaf = null;

function initTimeGraph() {
  graphCanvas = document.getElementById('timeGraph');
  if (!graphCanvas) return;
  graphCtx = graphCanvas.getContext('2d');
  resizeGraph();
  window.addEventListener('resize', resizeGraph);
  drawGraph();
}

function resizeGraph() {
  if (!graphCanvas) return;
  graphCanvas.width = graphCanvas.offsetWidth * devicePixelRatio;
  graphCanvas.height = graphCanvas.offsetHeight * devicePixelRatio;
}

function pushGraph(point) {
  graphBuf[graphHead % GRAPH_POINTS] = point;
  graphHead++;
}

function drawGraph() {
  graphRaf = requestAnimationFrame(drawGraph);
  if (!graphCtx || !graphCanvas) return;

  const w = graphCanvas.width;
  const h = graphCanvas.height;
  const ctx = graphCtx;
  const dpr = devicePixelRatio;
  const bgStyle = getComputedStyle(document.documentElement);

  // Background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgStyle.getPropertyValue('--bg-color').trim() || '#e6d5c3';
  ctx.fillRect(0, 0, w, h);

  const inTuneCol = bgStyle.getPropertyValue('--in-tune-color').trim() || '#4caf50';
  const sharpCol  = bgStyle.getPropertyValue('--sharp-color').trim()  || '#e53935';
  const flatCol   = bgStyle.getPropertyValue('--flat-color').trim()   || '#1e88e5';
  const dotWeak   = bgStyle.getPropertyValue('--dot-weak').trim()     || '#bda692';
  const textCol   = bgStyle.getPropertyValue('--text-color').trim()   || '#333';

  const rowH = h / NUM_ROWS;
  const colW = w / POINTS_PER_ROW;

  // 行ごとの背景ガイド線
  for (let row = 0; row < NUM_ROWS; row++) {
    const yOffset = row * rowH;
    const midY = yOffset + rowH / 2;

    ctx.strokeStyle = dotWeak;
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, midY); ctx.lineTo(w, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(0, yOffset + rowH * 0.25); ctx.lineTo(w, yOffset + rowH * 0.25);
    ctx.moveTo(0, yOffset + rowH * 0.75); ctx.lineTo(w, yOffset + rowH * 0.75);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 行の境界線（太め・高コントラストで３段を明確に分ける）
  ctx.strokeStyle = textCol;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, rowH);     ctx.lineTo(w, rowH);
  ctx.moveTo(0, rowH * 2); ctx.lineTo(w, rowH * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const total = Math.min(graphHead, GRAPH_POINTS);
  if (total === 0) return;

  // 位置計算ヘルパ: i (0..total-1, oldest..newest) → {row, xInRow}
  // 上段=最新の POINTS_PER_ROW 個, 中段=その前, 下段=さらに前
  function posOf(i) {
    const ageFromNewest = total - 1 - i;
    if (ageFromNewest < POINTS_PER_ROW) {
      return { row: 0, xInRow: POINTS_PER_ROW - 1 - ageFromNewest };
    } else if (ageFromNewest < 2 * POINTS_PER_ROW) {
      return { row: 1, xInRow: (2 * POINTS_PER_ROW - 1) - ageFromNewest };
    } else {
      return { row: 2, xInRow: (3 * POINTS_PER_ROW - 1) - ageFromNewest };
    }
  }

  // 音名ラベル（変化時）
  ctx.font = `bold ${11 * dpr}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let prevName = null;
  for (let i = 0; i < total; i++) {
    const idx = (graphHead - total + i + GRAPH_POINTS) % GRAPH_POINTS;
    const pt = graphBuf[idx];
    if (!pt || !pt.name) { prevName = null; continue; }
    if (pt.name !== prevName) {
      const p = posOf(i);
      const x = p.xInRow * colW + colW / 2;
      const yTop = p.row * rowH;
      // 縦の薄い区切り線
      ctx.strokeStyle = textCol;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, yTop); ctx.lineTo(x, yTop + rowH);
      ctx.stroke();
      // 音名テキスト
      ctx.fillStyle = textCol;
      ctx.globalAlpha = 0.85;
      ctx.fillText(pt.name, x + 2 * dpr, yTop + 2 * dpr);
      ctx.globalAlpha = 1;
      prevName = pt.name;
    }
  }

  // ピッチ点
  for (let i = 0; i < total; i++) {
    const idx = (graphHead - total + i + GRAPH_POINTS) % GRAPH_POINTS;
    const pt = graphBuf[idx];
    if (!pt) continue;
    const p = posOf(i);
    const cents = Math.max(-50, Math.min(50, pt.cents));
    const midY = p.row * rowH + rowH / 2;
    const y = midY - (cents / 50) * (rowH / 2 - 4 * dpr);
    const x = p.xInRow * colW + colW / 2;
    ctx.fillStyle = pt.inTune ? inTuneCol : (cents > 0 ? sharpCol : flatCol);
    ctx.beginPath();
    ctx.arc(x, y, 1.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- Full-color background ----
function hexToRgb(hex) {
  const h = hex.replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(full.slice(0,2),16), parseInt(full.slice(2,4),16), parseInt(full.slice(4,6),16)];
}

function blendRgb(bgHex, fgHex, ratio) {
  const bg = hexToRgb(bgHex || '#dccaaf');
  const fg = hexToRgb(fgHex || '#888888');
  return bg.map((b, i) => Math.round(b * (1 - ratio) + fg[i] * ratio));
}

function updateFullColorBg(cents) {
  const onTunerTab = document.getElementById('tab-tuner')?.classList.contains('active');
  if (!_fullColorEnabled || !onTunerTab || cents === null) {
    _clearFullColorBg();
    return;
  }

  // ±0で純白、deviation が増えるほど sharp/flat 色へ濃くブレンド
  const abs = Math.abs(cents);
  const cs = getComputedStyle(document.documentElement);
  const baseHex = '#ffffff';
  const fgHex = cents >= 0
    ? (cs.getPropertyValue('--sharp-color').trim() || '#e53935')
    : (cs.getPropertyValue('--flat-color').trim()  || '#1e88e5');
  // 0¢ → 0% (純白), 50¢ → 75% (かなり濃い)
  const ratio = Math.min(0.75, (abs / 50) * 0.75);

  const [r, g, b] = blendRgb(baseHex, fgHex, ratio);
  const cont = document.querySelector('.container');
  if (cont) cont.style.backgroundColor = `rgb(${r},${g},${b})`;
}

export function stopGraphLoop() {
  cancelAnimationFrame(graphRaf);
  graphRaf = null;
}
