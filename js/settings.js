/* NamaChu — 設定タブ */

import { INSTRUMENTS, getInstrument, noteName, midiToNoteInfo, lsGet, lsSet, showToast } from './utils.js';
import { t, getLang } from './i18n.js';

// ---- Default settings ----
const DEFAULTS = {
  instrumentId: 'concert',
  concertPitch: 440,
  noteStyle: 'abc',
  theme: 'default',
  minVolume: 10,   // 0–100 → mapped to minRms
  clarity: 85,     // 0–100 → mapped to clarityThreshold 0–1
};

let _settings = { ...DEFAULTS };
let _onChange = null; // callback(settings)

export function initSettings(onChange) {
  _onChange = onChange;
  const saved = lsGet('settings');
  if (saved) _settings = { ...DEFAULTS, ...saved };

  populateInstrumentSelect();
  buildThemeGrid();
  restoreUI();
  applyTheme(_settings.theme);
}

export function getSettings() { return { ..._settings }; }

// ---- Instrument select ----
function populateInstrumentSelect() {
  const sel = document.getElementById('instrumentSelect');
  const sel2 = document.getElementById('scaleMeasureInstrument');
  const lang = getLang();
  const opts = INSTRUMENTS.map(inst => {
    const name = lang === 'ja' ? inst.nameJa : inst.nameEn;
    return `<option value="${inst.id}">${name}</option>`;
  }).join('');
  if (sel) { sel.innerHTML = opts; sel.value = _settings.instrumentId; }
  if (sel2) { sel2.innerHTML = opts; sel2.value = _settings.instrumentId; }
  updateInstrumentInfo();
}

export function onInstrumentChange() {
  const sel = document.getElementById('instrumentSelect');
  _settings.instrumentId = sel?.value || 'concert';
  // sync scale tab selector
  const sel2 = document.getElementById('scaleMeasureInstrument');
  if (sel2) sel2.value = _settings.instrumentId;
  updateInstrumentInfo();
  saveAndNotify();
}

function updateInstrumentInfo() {
  const inst = getInstrument(_settings.instrumentId);
  const lang = getLang();

  // Transposition label
  const transEl = document.getElementById('transpositionLabel');
  if (transEl) {
    const semi = inst.trans;
    transEl.textContent = semi === 0 ? 'C (concert)' : `${semi > 0 ? '+' : ''}${semi} 半音`;
  }

  // Range label
  const rangeEl = document.getElementById('rangeLabel');
  if (rangeEl) {
    const lo = midiToNoteInfo(inst.loMidi);
    const hi = midiToNoteInfo(inst.hiMidi);
    const loName = noteName(lo.note, lo.octave, _settings.noteStyle, true);
    const hiName = noteName(hi.note, hi.octave, _settings.noteStyle, true);
    rangeEl.textContent = `${loName} – ${hiName}`;
  }

  // Instrument badge on tuner tab
  const badge = document.getElementById('instrumentBadge');
  if (badge) badge.textContent = lang === 'ja' ? inst.nameJa : inst.nameEn;
}

// ---- Concert pitch ----
export function adjustConcertPitch(delta) {
  _settings.concertPitch = Math.max(400, Math.min(480, _settings.concertPitch + delta));
  document.getElementById('concertPitchVal').textContent = _settings.concertPitch;
  document.getElementById('concertPitchBadge').textContent = `A = ${_settings.concertPitch} Hz`;
  saveAndNotify();
}

// ---- Note style ----
export function onNoteStyleChange() {
  const checked = document.querySelector('input[name="noteStyle"]:checked');
  _settings.noteStyle = checked?.value || 'abc';
  updateInstrumentInfo();
  saveAndNotify();
}

// ---- Theme ----
function buildThemeGrid() {
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  const themes = [
    { id: 'default', labelJa: 'ナチュラル', labelEn: 'Natural' },
    { id: 'dark',    labelJa: 'ダーク',     labelEn: 'Dark' },
    { id: 'light',   labelJa: 'ライト',     labelEn: 'Light' },
    { id: 'darkred', labelJa: '赤黒',       labelEn: 'DarkRed' },
    { id: 'navy',    labelJa: 'ネイビー',   labelEn: 'Navy' },
  ];
  const lang = getLang();
  grid.innerHTML = themes.map(th => {
    const label = lang === 'ja' ? th.labelJa : th.labelEn;
    return `<button class="theme-btn${_settings.theme === th.id ? ' active' : ''}" data-theme="${th.id}" onclick="applyThemeUI('${th.id}')">${label}</button>`;
  }).join('');
}

export function applyThemeUI(themeId) {
  _settings.theme = themeId;
  applyTheme(themeId);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === themeId);
  });
  saveAndNotify();
}

function applyTheme(themeId) {
  const el = document.documentElement;
  el.removeAttribute('data-theme');
  if (themeId && themeId !== 'default') el.setAttribute('data-theme', themeId);
}

// ---- Mic sliders ----
export function onMinVolumeChange() {
  const v = parseInt(document.getElementById('minVolumeSlider').value);
  _settings.minVolume = v;
  document.getElementById('minVolumeVal').textContent = v;
  saveAndNotify();
}

export function onClarityChange() {
  const v = parseInt(document.getElementById('claritySlider').value);
  _settings.clarity = v;
  document.getElementById('clarityVal').textContent = v;
  saveAndNotify();
}

// ---- Data management ----
export function exportAllData() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('namaChu_')) out[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'NamaChu_backup_' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast(t('toast_export_done'));
}

export function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith('namaChu_')) localStorage.setItem(k, v);
        }
        showToast(t('toast_loaded'));
        restoreUI();
        saveAndNotify();
      } catch { showToast('インポートエラー'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

export function clearAllData() {
  if (!confirm(t('confirm_clear_all'))) return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith('namaChu_')) localStorage.removeItem(k);
  }
  _settings = { ...DEFAULTS };
  restoreUI();
  applyTheme(_settings.theme);
  saveAndNotify();
}

// ---- Restore UI from _settings ----
function restoreUI() {
  // Instrument
  const sel = document.getElementById('instrumentSelect');
  if (sel) sel.value = _settings.instrumentId;
  const sel2 = document.getElementById('scaleMeasureInstrument');
  if (sel2) sel2.value = _settings.instrumentId;
  updateInstrumentInfo();

  // Concert pitch
  document.getElementById('concertPitchVal').textContent = _settings.concertPitch;
  document.getElementById('concertPitchBadge').textContent = `A = ${_settings.concertPitch} Hz`;

  // Note style
  const radio = document.querySelector(`input[name="noteStyle"][value="${_settings.noteStyle}"]`);
  if (radio) radio.checked = true;

  // Theme
  buildThemeGrid();
  applyTheme(_settings.theme);

  // Sliders
  const minVol = document.getElementById('minVolumeSlider');
  if (minVol) { minVol.value = _settings.minVolume; document.getElementById('minVolumeVal').textContent = _settings.minVolume; }
  const clar = document.getElementById('claritySlider');
  if (clar) { clar.value = _settings.clarity; document.getElementById('clarityVal').textContent = _settings.clarity; }
}

function saveAndNotify() {
  lsSet('settings', _settings);
  _onChange?.(_settings);
}

/** minVolume 0-100 → rms float */
export function minVolumeToRms(v) { return v / 100 * 0.15; }
/** clarity 0-100 → threshold 0-1 */
export function clarityToThreshold(v) { return v / 100; }
