/* NamaChu — internationalization (ja / en) */

export const STRINGS = {
  ja: {
    app_title: 'NamaChu',
    app_subtitle: '管楽器チューナー',
    tab_tuner: 'チューナー',
    tab_record: '記録',
    tab_scale: '音階測定',
    tab_settings: '設定',
    btn_record: '録音',
    btn_play: '再生',
    btn_stop: '停止',
    btn_save: '保存',
    btn_cancel: 'キャンセル',
    btn_close: '閉じる',
    btn_export: 'エクスポート',
    btn_export_all: '全データ出力',
    btn_import: 'インポート',
    btn_clear_all: '全消去',
    btn_auto_calibrate: '▶ 感度の自動調整',
    calib_title: 'マイク感度の自動調整',
    btn_scale_start: 'スタート',
    btn_scale_clear: 'クリア',
    label_instrument: '楽器',
    label_transposition: '移調',
    label_range: '音域',
    label_concert_pitch: 'コンサートピッチ',
    label_note_name_style: '音名表記',
    label_display_trans: '表示移調',
    label_mic_input: 'マイク入力',
    label_mic_refresh: '更新',
    label_theme: 'テーマ',
    label_mic_sensitivity: 'マイク感度 / 閾値',
    label_min_volume: '最小音量',
    label_clarity: 'クラリティ閾値',
    label_data: 'データ管理',
    label_saved_records: '保存済み記録',
    label_save_name: '保存名',
    label_compare: '比較',
    hint_scale_tuning: 'まずA4（または楽器の基準音）でチューニングしてください',
    hint_mic_start: 'マイクボタンで計測開始',
    hint_tap_note: '音を吹くと自動で検知します',
    help_scale_title: '音階測定とは',
    help_scale_body: '楽器固有の音程の癖を記録します。各音を3回吹くと平均値を記録します。吹き始めと吹き終わりは除外されます。',
    theme_default: 'ナチュラル',
    theme_dark: 'ダーク',
    theme_light: 'ライト',
    theme_darkred: '赤黒',
    theme_navy: 'ネイビー',
    confirm_clear_all: '全データを消去しますか？この操作は取り消せません。',
    toast_saved: '保存しました',
    toast_loaded: '読み込みました',
    toast_deleted: '削除しました',
    toast_mic_denied: 'マイクへのアクセスが拒否されました',
    toast_export_done: 'エクスポートしました',
    help_mic_title: 'マイク感度について',
    help_mic_body_min: '最小音量: 小さな音を無視するための閾値。環境ノイズが多い場合は上げてください。低すぎるとノイズを音として拾います。',
    help_mic_body_clarity: 'クラリティ閾値: 音程の信頼度。高いほど確実な音程のみ表示します。低すぎると不安定な検出が増えます。',
  },
  en: {
    app_title: 'NamaTune',
    app_subtitle: 'Wind Instrument Tuner',
    tab_tuner: 'Tuner',
    tab_record: 'Record',
    tab_scale: 'Scale Check',
    tab_settings: 'Settings',
    btn_record: 'Record',
    btn_play: 'Play',
    btn_stop: 'Stop',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_close: 'Close',
    btn_export: 'Export',
    btn_export_all: 'Export All',
    btn_import: 'Import',
    btn_clear_all: 'Clear All',
    btn_auto_calibrate: '▶ Auto-Calibrate',
    calib_title: 'Auto-Calibrate Mic Sensitivity',
    btn_scale_start: 'Start',
    btn_scale_clear: 'Clear',
    label_instrument: 'Instrument',
    label_transposition: 'Transposition',
    label_range: 'Range',
    label_concert_pitch: 'Concert Pitch',
    label_note_name_style: 'Note Names',
    label_display_trans: 'Display Transposition',
    label_mic_input: 'Microphone',
    label_mic_refresh: 'Refresh',
    label_theme: 'Theme',
    label_mic_sensitivity: 'Mic Sensitivity / Threshold',
    label_min_volume: 'Min Volume',
    label_clarity: 'Clarity Threshold',
    label_data: 'Data Management',
    label_saved_records: 'Saved Recordings',
    label_save_name: 'Name',
    label_compare: 'Compare',
    hint_scale_tuning: 'First tune A4 (or the instrument\'s reference note)',
    hint_mic_start: 'Tap the mic button to start',
    hint_tap_note: 'Play a note and it will be detected automatically',
    help_scale_title: 'About Scale Check',
    help_scale_body: 'Records pitch tendencies specific to your instrument. Play each note 3 times to record the average deviation. Attack and release are excluded.',
    theme_default: 'Natural',
    theme_dark: 'Dark',
    theme_light: 'Light',
    theme_darkred: 'Dark Red',
    theme_navy: 'Navy',
    confirm_clear_all: 'Clear all data? This cannot be undone.',
    toast_saved: 'Saved',
    toast_loaded: 'Loaded',
    toast_deleted: 'Deleted',
    toast_mic_denied: 'Microphone access denied',
    toast_export_done: 'Exported',
    help_mic_title: 'Microphone Sensitivity',
    help_mic_body_min: 'Min Volume: threshold to ignore quiet sounds. Increase if ambient noise is picked up. Too low = noise detected as pitch.',
    help_mic_body_clarity: 'Clarity Threshold: pitch confidence level. Higher = only stable pitches shown. Too low = unstable detections increase.',
  }
};

let currentLang = 'ja';

export function initI18n(lang) {
  currentLang = lang || (navigator.language.startsWith('ja') ? 'ja' : 'en');
  applyI18n();
}

export function setLang(lang) {
  currentLang = lang;
  applyI18n();
  localStorage.setItem('namaChu_lang', lang);
}

export function getLang() { return currentLang; }

export function t(key) {
  return (STRINGS[currentLang] || STRINGS.ja)[key] || key;
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    const val = t(key);
    if (val) el.placeholder = val;
  });

  // app title / subtitle
  const titleEl = document.getElementById('appTitle');
  if (titleEl) titleEl.textContent = t('app_title');
  document.title = t('app_title');
  const subEl = document.getElementById('appSubtitle');
  if (subEl) subEl.textContent = t('app_subtitle');

  // lang buttons
  document.getElementById('langJa')?.classList.toggle('active', currentLang === 'ja');
  document.getElementById('langEn')?.classList.toggle('active', currentLang === 'en');
}
