/* NamaChu — チューナータブ (meter + time-graph) */

import { freqToMidi, midiToNoteInfo, noteName } from './utils.js';

// ---- State ----
let _concertPitch = 442;
let _noteStyle = 'abc';
let _instrument = null;
let _displayTrans = 0; // semitones: displayMidi = concertMidi - _displayTrans
let _clarityThreshold = 0.85;
let _fullColorEnabled = false;

// Time-graph circular buffer
const GRAPH_SECONDS = 10;
const GRAPH_FPS = 30;
const GRAPH_POINTS = GRAPH_SECONDS * GRAPH_FPS;
const graphBuf = new Array(GRAPH_POINTS).fill(null); // null | { cents, inTune }
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
    pushGraph(null);
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

  pushGraph({ cents, inTune });
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

  // Pure intonation third markers (triangles pointing inward)
  // Major 3rd below root: -13.7¢  Minor 3rd above root: +15.6¢
  const thirdCents = [-13.7, 15.6];
  for (const c of thirdCents) {
    const aRad = (c / 50) * maxAngle * (Math.PI / 180);
    const sinA = Math.sin(aRad), cosA = Math.cos(aRad);
    // Tip: 14px inward from arc
    const tx = (cx + sinA * (r - 14)).toFixed(1);
    const ty = (cy - cosA * (r - 14)).toFixed(1);
    // Base: on the arc, ±5px tangential
    const ox = cx + sinA * r, oy = cy - cosA * r;
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

  // Background
  ctx.clearRect(0, 0, w, h);
  const bgStyle = getComputedStyle(document.documentElement);
  ctx.fillStyle = bgStyle.getPropertyValue('--bg-color').trim() || '#e6d5c3';
  ctx.fillRect(0, 0, w, h);

  // Center line (0¢)
  const midY = h / 2;
  ctx.strokeStyle = bgStyle.getPropertyValue('--dot-weak').trim() || '#bda692';
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ±25¢ guide lines
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  const y25p = midY - (h * 0.25);
  const y25n = midY + (h * 0.25);
  ctx.moveTo(0, y25p); ctx.lineTo(w, y25p);
  ctx.moveTo(0, y25n); ctx.lineTo(w, y25n);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Pitch points (newest on right)
  const total = Math.min(graphHead, GRAPH_POINTS);
  const colW = w / GRAPH_POINTS;

  for (let i = 0; i < total; i++) {
    const idx = (graphHead - total + i + GRAPH_POINTS) % GRAPH_POINTS;
    const pt = graphBuf[idx];
    if (!pt) continue;

    const x = i * colW;
    const cents = Math.max(-50, Math.min(50, pt.cents));
    const y = midY - (cents / 50) * (h / 2 - 4 * dpr);

    const inTune = bgStyle.getPropertyValue('--in-tune-color').trim() || '#4caf50';
    const sharp = bgStyle.getPropertyValue('--sharp-color').trim() || '#e53935';
    const flat  = bgStyle.getPropertyValue('--flat-color').trim()  || '#1e88e5';
    ctx.fillStyle = pt.inTune ? inTune : (cents > 0 ? sharp : flat);
    ctx.beginPath();
    ctx.arc(x + colW / 2, y, 3 * dpr, 0, Math.PI * 2);
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

  const abs = Math.abs(cents);
  const cs = getComputedStyle(document.documentElement);
  // ブレンド基色は内側カードの --surface-color
  const bgHex = cs.getPropertyValue('--surface-color').trim();
  let fgHex, ratio;

  if (abs <= 5) {
    fgHex = cs.getPropertyValue('--in-tune-color').trim() || '#4caf50';
    ratio = 0.10;
  } else if (cents > 0) {
    fgHex = cs.getPropertyValue('--sharp-color').trim() || '#e53935';
    ratio = Math.min(0.42, (abs - 5) / 45 * 0.42);
  } else {
    fgHex = cs.getPropertyValue('--flat-color').trim() || '#1e88e5';
    ratio = Math.min(0.42, (abs - 5) / 45 * 0.42);
  }

  const [r, g, b] = blendRgb(bgHex, fgHex, ratio);
  const cont = document.querySelector('.container');
  if (cont) cont.style.backgroundColor = `rgb(${r},${g},${b})`;
}

export function stopGraphLoop() {
  cancelAnimationFrame(graphRaf);
  graphRaf = null;
}
