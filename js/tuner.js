/* NamaChu — チューナータブ (meter + time-graph) */

import { freqToMidi, midiToNoteInfo, noteName } from './utils.js';

// ---- State ----
let _concertPitch = 440;
let _noteStyle = 'abc';
let _instrument = null; // instrument object
let _clarityThreshold = 0.85;

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

  buildMeterTicks();
  initTimeGraph();
  resetDisplay();
}

export function setTunerConcertPitch(hz) { _concertPitch = hz; }
export function setTunerNoteStyle(s) { _noteStyle = s; }
export function setTunerInstrument(inst) { _instrument = inst; }
export function setTunerClarityThreshold(v) { _clarityThreshold = v; }

// ---- Called each audio frame ----
export function onPitch(freq, clarity, rms) {
  if (!freq || clarity < _clarityThreshold) {
    pushGraph(null);
    animateNeedleTo(0);
    setDisplaySilent();
    return;
  }

  const midi = freqToMidi(freq, _concertPitch);
  const { note, octave, cents } = midiToNoteInfo(midi);

  // Account for instrument transposition: display written pitch
  let displayMidi = midi;
  if (_instrument?.trans) displayMidi = midi - _instrument.trans;
  const dispInfo = midiToNoteInfo(displayMidi);

  const name = noteName(dispInfo.note, dispInfo.octave, _noteStyle, false);
  const inTune = Math.abs(cents) <= 5;

  pushGraph({ cents, inTune });
  animateNeedleTo(cents);
  updateDisplay(name, dispInfo.octave, cents, freq, inTune);
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
  const minAngle = -65, maxAngle = 65;

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

export function stopGraphLoop() {
  cancelAnimationFrame(graphRaf);
  graphRaf = null;
}
