/* NamaChu — 外部機器入力（キーボード・MIDI） */

import { openModal, closeModal } from './utils.js';
import { t } from './i18n.js';

const LS_KEY = 'namaChu_extInput';

// { action1: Binding|null, action2: Binding|null }
// Binding: { type:'key', code, key, label } | { type:'midi', ch, note, label }
let _bindings = { action1: null, action2: null };
let _callbacks = { action1: null, action2: null };

let _detectingFor = null;   // null | 'action1' | 'action2'
let _pendingDetected = null;
let _midiAccess = null;

// ---- Storage ----
function _save() {
  localStorage.setItem(LS_KEY, JSON.stringify(_bindings));
  _refreshUI();
}

function _load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _bindings = { action1: null, action2: null, ...JSON.parse(raw) };
  } catch { _bindings = { action1: null, action2: null }; }
}

// ---- Labels ----
function _keyLabel(code, key) {
  const map = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc',
  };
  return map[code] || key || code;
}

function _bindingLabel(b) {
  if (!b) return t('ext_input_not_set');
  return b.label;
}

// ---- MIDI ----
function _onMidi(msg) {
  const [status, note, velocity] = msg.data;
  const cmd = status & 0xF0;
  const ch  = status & 0x0F;
  if (cmd !== 0x90 || velocity === 0) return; // Note On のみ

  if (_detectingFor) {
    const label = `MIDI Ch${ch + 1} Note ${note}`;
    _showDetected({ type: 'midi', ch, note, label });
    return;
  }
  // トリガー
  for (const [actionId, b] of Object.entries(_bindings)) {
    if (b?.type === 'midi' && b.ch === ch && b.note === note) {
      _callbacks[actionId]?.();
    }
  }
}

// ---- Key listener ----
function _onKeyDown(e) {
  if (_detectingFor) {
    // モーダル内のボタン操作（Enter/Escape）は除外
    if (e.target && e.target.tagName === 'BUTTON') return;
    if (e.code === 'Escape') { closeExtInputModal(); return; }
    const label = _keyLabel(e.code, e.key);
    _showDetected({ type: 'key', code: e.code, key: e.key, label });
    e.preventDefault();
    return;
  }
  // トリガー
  for (const [actionId, b] of Object.entries(_bindings)) {
    if (b?.type === 'key' && b.code === e.code) {
      e.preventDefault();
      _callbacks[actionId]?.();
    }
  }
}

// ---- Init ----
export function initExtInput(cb1, cb2) {
  _callbacks.action1 = cb1;
  _callbacks.action2 = cb2;
  _load();
  _refreshUI();

  window.addEventListener('keydown', _onKeyDown);

  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(acc => {
      _midiAccess = acc;
      acc.inputs.forEach(input => { input.onmidimessage = _onMidi; });
      acc.onstatechange = () => {
        acc.inputs.forEach(input => { input.onmidimessage = _onMidi; });
      };
    }).catch(() => {}); // MIDI 非対応でも無視
  }
}

// ---- Modal: open / close / retry / save ----
export function openExtInputModal(actionId) {
  _detectingFor = actionId;
  _pendingDetected = null;

  const labelEl = document.getElementById('extInputActionLabel');
  if (labelEl) {
    labelEl.textContent = actionId === 'action1' ? t('ext_input_action1') : t('ext_input_action2');
  }
  _setModalState('waiting');
  openModal('extInputModal');
}

export function closeExtInputModal() {
  _detectingFor = null;
  _pendingDetected = null;
  closeModal('extInputModal');
}

export function retryExtInput() {
  _pendingDetected = null;
  _setModalState('waiting');
}

export function saveExtInput() {
  if (!_detectingFor || !_pendingDetected) return;
  _bindings[_detectingFor] = _pendingDetected;
  _detectingFor = null;
  _pendingDetected = null;
  _save();
  closeModal('extInputModal');
}

// ---- Internal helpers ----
function _showDetected(binding) {
  _pendingDetected = binding;

  const typeStr = binding.type === 'key'
    ? t('ext_input_type_key')
    : t('ext_input_type_midi');

  let detail = '';
  if (binding.type === 'key') {
    detail = `<div>${t('ext_input_type_key')}: <strong>${binding.label}</strong></div>`
           + `<div style="opacity:0.6;font-size:0.82rem">code: ${binding.code}</div>`;
  } else {
    detail = `<div>MIDI: <strong>${binding.label}</strong></div>`
           + `<div style="opacity:0.6;font-size:0.82rem">ch ${binding.ch + 1} / note ${binding.note}</div>`;
  }

  const infoEl = document.getElementById('extInputDetectedInfo');
  if (infoEl) { infoEl.innerHTML = detail; infoEl.style.display = 'block'; }

  const statusEl = document.getElementById('extInputStatus');
  if (statusEl) statusEl.textContent = t('ext_input_detected');

  const saveBtn = document.getElementById('extInputSaveBtn');
  if (saveBtn) saveBtn.disabled = false;
}

function _setModalState(state) {
  const statusEl = document.getElementById('extInputStatus');
  if (statusEl) statusEl.textContent = state === 'waiting' ? t('ext_input_waiting') : '';

  const infoEl = document.getElementById('extInputDetectedInfo');
  if (infoEl) { infoEl.innerHTML = ''; infoEl.style.display = 'none'; }

  const saveBtn = document.getElementById('extInputSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
}

function _refreshUI() {
  const el1 = document.getElementById('extInputBinding1');
  if (el1) el1.textContent = _bindingLabel(_bindings.action1);
  const el2 = document.getElementById('extInputBinding2');
  if (el2) el2.textContent = _bindingLabel(_bindings.action2);
}
