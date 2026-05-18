/* NamaChu — 設定タブ */

import { INSTRUMENTS, INSTRUMENT_FAMILIES, DISPLAY_TRANSPOSITIONS, getInstrument, noteName, midiToNoteInfo, lsGet, lsSet, showToast } from './utils.js';
import { getMicDevices, setMicDeviceId } from './audio.js';
import { t, getLang } from './i18n.js';

// ---- Default settings ----
const DEFAULTS = {
  instrumentId: 'bb_clar',
  concertPitch: 442,
  noteStyle: 'abc',
  displayTransId: 'C',
  micDeviceId: null,
  theme: 'default',
  minVolume: 10,
  clarity: 85,
  silenceGrace: 100, // ms; 持続音中のドロップアウトをこの時間まで許容
  collapsedCards: [],
};

let _settings = { ...DEFAULTS };
let _onChange = null;

export function initSettings(onChange) {
  _onChange = onChange;
  const saved = lsGet('settings');
  if (saved) _settings = { ...DEFAULTS, ...saved };

  populateInstrumentSelect();
  populateDisplayTransSelect();
  buildThemeGrid();
  restoreUI();
  applyTheme(_settings.theme);
  restoreCollapsedCards();
}

export function getSettings() { return { ..._settings }; }

// ---- Instrument select (2カラム: ファミリー選択 + 楽器選択) ----

// 現在の楽器IDからファミリーIDを取得
function _getFamilyForInstrument(instId) {
  return INSTRUMENTS.find(i => i.id === instId)?.family || INSTRUMENT_FAMILIES[0].id;
}

// 指定ファミリーの楽器を instSelId に再充填し、選択値（文字列）を返す
function _refillInstsByFamily(instSelId, familyId, selectedInstId) {
  const lang = getLang();
  const instSel = document.getElementById(instSelId);
  if (!instSel) return null;
  const insts = INSTRUMENTS.filter(i => i.family === familyId);
  instSel.innerHTML = insts.map(inst => {
    const name = lang === 'ja' ? inst.nameJa : inst.nameEn;
    return `<option value="${inst.id}">${name}</option>`;
  }).join('');
  if (selectedInstId) instSel.value = selectedInstId;
  return instSel.value; // selectedInstId がそのファミリーになければ先頭を返す
}

// すべてのファミリー選択肢を構築する HTML
function _buildFamilyHtml(lang) {
  return INSTRUMENT_FAMILIES.map(fam => {
    const name = lang === 'ja' ? fam.nameJa : fam.nameEn;
    return `<option value="${fam.id}">${name}</option>`;
  }).join('');
}

// (ファミリーセレクト, 楽器セレクト) のペア定義
const _SELECT_PAIRS = [
  ['familySelect',      'instrumentSelect'],
  ['scaleFamilySelect', 'scaleMeasureInstrument'],
];

function populateInstrumentSelect() {
  const lang = getLang();
  const currentInstId = _settings.instrumentId;
  const currentFamily = _getFamilyForInstrument(currentInstId);
  const famHtml = _buildFamilyHtml(lang);

  for (const [famSelId, instSelId] of _SELECT_PAIRS) {
    const famSel = document.getElementById(famSelId);
    if (famSel) { famSel.innerHTML = famHtml; famSel.value = currentFamily; }
    _refillInstsByFamily(instSelId, currentFamily, currentInstId);
  }
  updateInstrumentInfo();
}

// 設定タブ: ファミリー変更
export function onFamilyChange() {
  const famSel = document.getElementById('familySelect');
  if (!famSel) return;
  const familyId = famSel.value;
  const newInstId = _refillInstsByFamily('instrumentSelect', familyId, null);
  _settings.instrumentId = newInstId;
  // スケールタブも同期
  const scaleFamSel = document.getElementById('scaleFamilySelect');
  if (scaleFamSel) scaleFamSel.value = familyId;
  _refillInstsByFamily('scaleMeasureInstrument', familyId, newInstId);
  updateInstrumentInfo();
  saveAndNotify();
}

// 設定タブ: 楽器変更
export function onInstrumentChange() {
  const sel = document.getElementById('instrumentSelect');
  if (!sel) return;
  _settings.instrumentId = sel.value;
  const scaleInstSel = document.getElementById('scaleMeasureInstrument');
  if (scaleInstSel) scaleInstSel.value = _settings.instrumentId;
  updateInstrumentInfo();
  saveAndNotify();
}

// スケールタブ: ファミリー変更
export function onScaleFamilyChange() {
  const famSel = document.getElementById('scaleFamilySelect');
  if (!famSel) return;
  const familyId = famSel.value;
  const newInstId = _refillInstsByFamily('scaleMeasureInstrument', familyId, null);
  _settings.instrumentId = newInstId;
  // 設定タブも同期
  const settingsFamSel = document.getElementById('familySelect');
  if (settingsFamSel) settingsFamSel.value = familyId;
  _refillInstsByFamily('instrumentSelect', familyId, newInstId);
  updateInstrumentInfo();
  saveAndNotify();
}

// スケールタブ: 楽器変更
export function onScaleInstrumentChange() {
  const sel = document.getElementById('scaleMeasureInstrument');
  if (!sel) return;
  _settings.instrumentId = sel.value;
  const settingsInstSel = document.getElementById('instrumentSelect');
  if (settingsInstSel) settingsInstSel.value = _settings.instrumentId;
  updateInstrumentInfo();
  saveAndNotify();
}

function updateInstrumentInfo() {
  const inst = getInstrument(_settings.instrumentId);
  const lang = getLang();

  const transEl = document.getElementById('transpositionLabel');
  if (transEl) {
    const semi = inst.trans;
    transEl.textContent = semi === 0 ? 'C (concert)' : `${semi > 0 ? '+' : ''}${semi} ${t('label_semitone')}`;
  }

  const rangeEl = document.getElementById('rangeLabel');
  if (rangeEl) {
    const lo = midiToNoteInfo(inst.loMidi);
    const hi = midiToNoteInfo(inst.hiMidi);
    const loName = noteName(lo.note, lo.octave, _settings.noteStyle, true);
    const hiName = noteName(hi.note, hi.octave, _settings.noteStyle, true);
    rangeEl.textContent = `${loName} – ${hiName}`;
  }

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

// ---- Display transposition ----
function populateDisplayTransSelect() {
  const sel = document.getElementById('displayTransSelect');
  if (!sel) return;
  const lang = getLang();
  sel.innerHTML = DISPLAY_TRANSPOSITIONS.map(dt =>
    `<option value="${dt.id}">${lang === 'ja' ? dt.nameJa : dt.nameEn}</option>`
  ).join('');
  sel.value = _settings.displayTransId || 'C';
}

export function onDisplayTransChange() {
  const sel = document.getElementById('displayTransSelect');
  _settings.displayTransId = sel?.value || 'C';
  saveAndNotify();
}

export function getDisplayTrans() {
  return DISPLAY_TRANSPOSITIONS.find(d => d.id === _settings.displayTransId)
    ?? DISPLAY_TRANSPOSITIONS[0];
}

// ---- Mic selection ----
export async function refreshMicDevices() {
  const sel = document.getElementById('micDeviceSelect');
  if (!sel) return;
  try {
    const devices = await getMicDevices();
    const current = _settings.micDeviceId;
    sel.innerHTML = [
      `<option value="">${t('label_mic_default')}</option>`,
      ...devices.map(d => `<option value="${d.deviceId}">${d.label}</option>`)
    ].join('');
    sel.value = current || '';
  } catch {
    sel.innerHTML = `<option value="">${t('label_mic_error')}</option>`;
  }
}

export function onMicDeviceChange() {
  const sel = document.getElementById('micDeviceSelect');
  _settings.micDeviceId = sel?.value || null;
  setMicDeviceId(_settings.micDeviceId);
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

// ---- Mic sensitivity sliders ----
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

// ---- Accordion cards ----
export function toggleCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.toggle('collapsed');
  const collapsed = [...document.querySelectorAll('.setting-card.collapsed')].map(c => c.id);
  _settings.collapsedCards = collapsed;
  lsSet('settings', _settings);
}

function restoreCollapsedCards() {
  const collapsed = _settings.collapsedCards || [];
  collapsed.forEach(id => {
    document.getElementById(id)?.classList.add('collapsed');
  });
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

// ---- Restore UI ----
function restoreUI() {
  populateInstrumentSelect();
  populateDisplayTransSelect();

  document.getElementById('concertPitchVal').textContent = _settings.concertPitch;
  document.getElementById('concertPitchBadge').textContent = `A = ${_settings.concertPitch} Hz`;

  const radio = document.querySelector(`input[name="noteStyle"][value="${_settings.noteStyle}"]`);
  if (radio) radio.checked = true;

  buildThemeGrid();
  applyTheme(_settings.theme);

  const minVol = document.getElementById('minVolumeSlider');
  if (minVol) { minVol.value = _settings.minVolume; document.getElementById('minVolumeVal').textContent = _settings.minVolume; }
  const clar = document.getElementById('claritySlider');
  if (clar) { clar.value = _settings.clarity; document.getElementById('clarityVal').textContent = _settings.clarity; }

  if (_settings.micDeviceId) setMicDeviceId(_settings.micDeviceId);
  updateCardSummaries();
}

function saveAndNotify() {
  lsSet('settings', _settings);
  updateCardSummaries();
  _onChange?.(_settings);
}

function updateCardSummaries() {
  const lang = getLang();
  const inst = getInstrument(_settings.instrumentId);
  const instName = lang === 'ja' ? inst.nameJa : inst.nameEn;
  const dt = getDisplayTrans();
  const dtName = lang === 'ja' ? dt.nameJa : dt.nameEn;
  const noteStyleLabel = _settings.noteStyle === 'do' ? t('label_solfege') : 'CDEFG';

  _setSummary('summary-instrument', instName);
  _setSummary('summary-pitch', `A = ${_settings.concertPitch} Hz`);
  _setSummary('summary-notestyle', `${noteStyleLabel} / ${dtName}`);
  _setSummary('summary-sensitivity', `${t('label_vol_short')} ${_settings.minVolume} / ${t('label_clarity_short')} ${_settings.clarity}`);
}

function _setSummary(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function minVolumeToRms(v) { return v / 100 * 0.15; }
export function clarityToThreshold(v) { return v / 100; }

export function getSilenceGrace() { return _settings.silenceGrace ?? 100; }

// 言語切り替え後に動的コンテンツを再構築
export function refreshSettingsUI() {
  populateInstrumentSelect();
  populateDisplayTransSelect();
  buildThemeGrid();
  updateInstrumentInfo();
  updateCardSummaries();
  refreshMicDevices(); // async, fire-and-forget
}

// ---- 自動校正からの設定適用 ----
export function applyCalibratedSensitivity(minVolume, clarity, silenceGrace) {
  _settings.minVolume = minVolume;
  _settings.clarity = clarity;
  if (typeof silenceGrace === 'number') _settings.silenceGrace = silenceGrace;
  const mv = document.getElementById('minVolumeSlider');
  const cl = document.getElementById('claritySlider');
  if (mv) { mv.value = minVolume; document.getElementById('minVolumeVal').textContent = minVolume; }
  if (cl) { cl.value = clarity;   document.getElementById('clarityVal').textContent   = clarity; }
  saveAndNotify();
}
