/* NamaChu — app entry point */

import { initI18n, setLang, applyI18n, t } from './i18n.js';
import { showToast, closeModal, openModal, getInstrument, lsSet } from './utils.js';
import { startMic, stopMic, isMicRunning, setMinRms, setClarityThreshold, resumeAudioIfSuspended } from './audio.js';
import { initTuner, onPitch as tunerOnPitch, setTunerConcertPitch, setTunerNoteStyle, setTunerInstrument, setTunerClarityThreshold, setTunerDisplayTrans, toggleFullColor, toggleRefPitch, stepRefPitch } from './tuner.js';
import { initRecord, onRecordPitch, toggleRecording, togglePlayback, clearRecording, saveRecording, confirmSaveRecording, showRecordList, hideRecordList, loadRecording, deleteRecording, setRecordInstrument, setRecordConcertPitch, setRecordNoteStyle, setRecordSilenceGrace, setRecordRepairCallback, setRecordPreStartHook } from './record.js';
import { initScale, toggleScaleMeasure, clearScaleData, exportScaleData, importScaleData, deleteDataset, onScalePitch, setScaleInstrument, setScaleConcertPitch, setScaleNoteStyle, setScaleClarityThreshold, confirmScaleDataset, switchScaleView } from './scale.js';
import { initSettings, getSettings, onFamilyChange, onInstrumentChange, onScaleFamilyChange, onScaleInstrumentChange as _settingsScaleInstChange, adjustConcertPitch, onNoteStyleChange, onDisplayTransChange, onMicDeviceChange, onMinVolumeChange, onClarityChange, exportAllData, importData, clearAllData, applyThemeUI, minVolumeToRms, clarityToThreshold, getDisplayTrans, refreshMicDevices, toggleCard, applyCalibratedSensitivity, getSilenceGrace, refreshSettingsUI } from './settings.js';
import { initCalibration, openCalibration, closeCalibration, startCalibrationRecord, stopCalibrationRecord, restartCalibrationRecord, applyCalibration } from './calibration.js';

// ---- Tab management ----
let _currentTab = 'tuner';

function switchTab(name) {
  _currentTab = name;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  document.getElementById('tabBtn-' + name)?.classList.add('active');

  // Auto-start mic when entering pitch-detection tabs
  if ((name === 'tuner' || name === 'scale' || name === 'record') && !isMicRunning()) {
    startMic(onAudioFrame)
      .then(() => _setMicActive(true))
      .catch(() => showToast(t('toast_mic_denied')));
  }
}

// ---- Mic toggle ----
let _clarityThreshold = 0.85;
let _minRms = 0.01;

function _setMicActive(active) {
  const btn = document.getElementById('micToggleBtn');
  const txt = document.getElementById('micStatusText');
  btn?.classList.toggle('active', active);
  if (txt) txt.textContent = active ? 'ON' : 'OFF';
}

async function toggleMic() {
  if (isMicRunning()) {
    stopMic();
    _setMicActive(false);
  } else {
    try {
      await startMic(onAudioFrame);
      _setMicActive(true);
    } catch (e) {
      showToast(t('toast_mic_denied'));
    }
  }
}

// ---- Central audio callback ----
function onAudioFrame(freq, clarity, rms) {
  tunerOnPitch(freq, clarity, rms);
  onRecordPitch(freq, clarity, _clarityThreshold);
  onScalePitch(freq, clarity);
}

// ---- Settings change callback ----
function onSettingsChange(s) {
  const inst = getInstrument(s.instrumentId);
  const cp = s.concertPitch;
  const ns = s.noteStyle;
  _clarityThreshold = clarityToThreshold(s.clarity);
  _minRms = minVolumeToRms(s.minVolume);

  setMinRms(_minRms);
  setClarityThreshold(_clarityThreshold);

  setTunerConcertPitch(cp);
  setTunerNoteStyle(ns);
  setTunerInstrument(inst);
  setTunerClarityThreshold(_clarityThreshold);
  setTunerDisplayTrans(getDisplayTrans().trans);

  setRecordConcertPitch(cp);
  setRecordNoteStyle(ns);
  setRecordInstrument(inst);
  setRecordSilenceGrace(getSilenceGrace());

  setScaleConcertPitch(cp);
  setScaleNoteStyle(ns);
  setScaleInstrument(inst);
  setScaleClarityThreshold(_clarityThreshold);
}

// ---- Bootstrap ----
function init() {
  // Language
  const savedLang = localStorage.getItem('namaChu_lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
  initI18n(savedLang);

  // Settings (must come before other inits so instrument etc. are ready)
  initSettings(onSettingsChange);
  const s = getSettings();
  const inst = getInstrument(s.instrumentId);

  // Sub-module init
  initTuner({
    concertPitch: s.concertPitch,
    noteStyle: s.noteStyle,
    instrument: inst,
    clarityThreshold: clarityToThreshold(s.clarity),
    displayTrans: getDisplayTrans().trans,
  });

  initRecord({
    instrument: inst,
    concertPitch: s.concertPitch,
    noteStyle: s.noteStyle,
  });
  setRecordSilenceGrace(getSilenceGrace());

  initScale({
    instrument: inst,
    concertPitch: s.concertPitch,
    noteStyle: s.noteStyle,
    clarityThreshold: clarityToThreshold(s.clarity),
  });

  // Recording reliability: resume AudioContext before recording, repair on freeze
  setRecordPreStartHook(async () => {
    await resumeAudioIfSuspended();
    if (!isMicRunning()) {
      try {
        await startMic(onAudioFrame);
        _setMicActive(true);
      } catch (e) {
        showToast(t('toast_mic_denied'));
      }
    }
  });

  setRecordRepairCallback(async () => {
    console.warn('[NamaChu] repair: restarting mic');
    stopMic();
    _setMicActive(false);
    try {
      await startMic(onAudioFrame);
      _setMicActive(true);
    } catch (e) {
      showToast(t('toast_mic_denied'));
    }
  });

  // Calibration
  initCalibration(applyCalibratedSensitivity);

  // Apply i18n again after all elements rendered
  applyI18n();

  // Expose globals for inline HTML onclick handlers
  exposeGlobals();
}

function exposeGlobals() {
  const g = window;
  g.switchTab = switchTab;
  g.toggleMic = toggleMic;
  g.toggleFullColor = toggleFullColor;
  g.toggleRefPitch = toggleRefPitch;
  g.stepRefPitch = stepRefPitch;
  g.setLang = (lang) => { setLang(lang); applyI18n(); refreshSettingsUI(); };

  // Settings tab
  g.onFamilyChange = onFamilyChange;
  g.onInstrumentChange = onInstrumentChange;
  g.adjustConcertPitch = adjustConcertPitch;
  g.onNoteStyleChange = onNoteStyleChange;
  g.onDisplayTransChange = onDisplayTransChange;
  g.onMicDeviceChange = onMicDeviceChange;
  g.refreshMicDevices = refreshMicDevices;
  g.toggleCard = toggleCard;
  g.openModal = openModal;
  g.onMinVolumeChange = onMinVolumeChange;
  g.onClarityChange = onClarityChange;
  g.exportAllData = exportAllData;
  g.importData = importData;
  g.clearAllData = clearAllData;
  g.applyThemeUI = applyThemeUI;

  // Record tab
  g.toggleRecording = toggleRecording;
  g.togglePlayback = togglePlayback;
  g.clearRecording = clearRecording;
  g.saveRecording = saveRecording;
  g.confirmSaveRecording = confirmSaveRecording;
  g.showRecordList = showRecordList;
  g.hideRecordList = hideRecordList;
  g.loadRecording = loadRecording;
  g.deleteRecording = deleteRecording;

  // Scale tab
  g.toggleScaleMeasure = toggleScaleMeasure;
  g.clearScaleData = clearScaleData;
  g.exportScaleData = exportScaleData;
  g.importScaleData = importScaleData;
  g.deleteDataset = deleteDataset;
  g.confirmScaleDataset = confirmScaleDataset;
  g.onScaleFamilyChange = onScaleFamilyChange;
  g.onScaleInstrumentChange = _settingsScaleInstChange;
  g.switchScaleView = switchScaleView;
  g.showScaleHelp = () => openModal('scaleHelpModal');

  // Calibration
  g.openCalibration = openCalibration;
  g.closeCalibration = closeCalibration;
  g.startCalibrationRecord = startCalibrationRecord;
  g.stopCalibrationRecord = stopCalibrationRecord;
  g.restartCalibrationRecord = restartCalibrationRecord;
  g.applyCalibration = applyCalibration;

  // Modal helpers
  g.closeModal = closeModal;
}

document.addEventListener('DOMContentLoaded', init);
