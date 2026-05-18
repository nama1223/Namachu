/* NamaChu — shared utilities */

// ---- Music / pitch math ----

export const NOTE_NAMES_ABC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const NOTE_NAMES_DO  = ['ド','ド#','レ','レ#','ミ','ファ','ファ#','ソ','ソ#','ラ','ラ#','シ'];

export function freqToMidi(freq, concertPitchA4 = 440) {
  return 69 + 12 * Math.log2(freq / concertPitchA4);
}

export function midiToNoteInfo(midi) {
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const note = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return { note, octave, cents };
}

export function noteName(noteIndex, octave, style = 'abc', showOctave = false) {
  const names = style === 'do' ? NOTE_NAMES_DO : NOTE_NAMES_ABC;
  return showOctave ? `${names[noteIndex]}${octave}` : names[noteIndex];
}

export function midiToFreq(midi, concertPitchA4 = 440) {
  return concertPitchA4 * Math.pow(2, (midi - 69) / 12);
}

// ---- Display transposition options ----
// trans: semitones to subtract from concert MIDI to get displayed (written) MIDI
export const DISPLAY_TRANSPOSITIONS = [
  { id: 'C',       nameJa: 'C (実音)',        nameEn: 'C (concert)',    trans: 0   },
  { id: 'Bb',      nameJa: 'B♭ (Bb管)',      nameEn: 'B♭ (Bb)',       trans: -2  },
  { id: 'Eb',      nameJa: 'E♭ (Eb管/Alto)', nameEn: 'E♭ (Eb/Alto)',  trans: -9  },
  { id: 'F',       nameJa: 'F (F管)',         nameEn: 'F (F)',          trans: -7  },
  { id: 'Eb_high', nameJa: 'E♭ (高音Eb)',    nameEn: 'E♭ (high Eb)',  trans: 3   },
  { id: 'Bb_low',  nameJa: 'B♭ (低音Bb)',    nameEn: 'B♭ (low Bb)',   trans: -14 },
  { id: 'Eb_low',  nameJa: 'E♭ (低音Eb)',    nameEn: 'E♭ (low Eb)',   trans: -21 },
];

// ---- Instrument families ----
export const INSTRUMENT_FAMILIES = [
  { id: 'double_reed', nameJa: 'ダブルリード',   nameEn: 'Double Reed' },
  { id: 'single_reed', nameJa: 'シングルリード', nameEn: 'Single Reed' },
  { id: 'air_reed',    nameJa: 'エアリード',     nameEn: 'Air Reed / Flute' },
  { id: 'brass_high',  nameJa: '金管高音',       nameEn: 'High Brass' },
  { id: 'brass_mid',   nameJa: '金管中音',       nameEn: 'Mid Brass' },
  { id: 'brass_low',   nameJa: '金管低音',       nameEn: 'Low Brass' },
  { id: 'other',       nameJa: 'その他',         nameEn: 'Other' },
];

// ---- Instrument definitions ----
// trans: informational (written vs concert semitone difference)
// loMidi/hiMidi: concert pitch range
export const INSTRUMENTS = [
  // Double Reed
  { id: 'ob',           family: 'double_reed', nameJa: 'オーボエ',                   nameEn: 'Oboe',                trans: 0,   loMidi: 58, hiMidi: 91 },
  { id: 'cor_anglais',  family: 'double_reed', nameJa: 'コールアングレ',             nameEn: 'Cor Anglais (F)',     trans: -7,  loMidi: 51, hiMidi: 81 },
  { id: 'fg',           family: 'double_reed', nameJa: 'ファゴット',                 nameEn: 'Bassoon',             trans: 0,   loMidi: 34, hiMidi: 75 },
  { id: 'contrafg',     family: 'double_reed', nameJa: 'コントラファゴット',         nameEn: 'Contrabassoon',       trans: 12,  loMidi: 22, hiMidi: 63 },

  // Single Reed — Saxophone
  { id: 'sopranino_sax',family: 'single_reed', nameJa: 'ソプラニーノサックス (Eb)', nameEn: 'Sopranino Sax (Eb)',  trans: 3,   loMidi: 55, hiMidi: 87 },
  { id: 'sop_sax',      family: 'single_reed', nameJa: 'ソプラノサックス (Bb)',     nameEn: 'Soprano Sax (Bb)',    trans: -2,  loMidi: 56, hiMidi: 88 },
  { id: 'eb_alto',      family: 'single_reed', nameJa: 'アルトサックス (Eb)',       nameEn: 'Alto Sax (Eb)',       trans: -9,  loMidi: 49, hiMidi: 80 },
  { id: 'bb_tenor',     family: 'single_reed', nameJa: 'テナーサックス (Bb)',       nameEn: 'Tenor Sax (Bb)',      trans: -14, loMidi: 44, hiMidi: 75 },
  { id: 'eb_bari',      family: 'single_reed', nameJa: 'バリトンサックス (Eb)',     nameEn: 'Bari Sax (Eb)',       trans: -21, loMidi: 37, hiMidi: 68 },
  { id: 'bass_sax',     family: 'single_reed', nameJa: 'バスサックス (Bb)',         nameEn: 'Bass Sax (Bb)',       trans: -26, loMidi: 30, hiMidi: 61 },
  // Single Reed — Clarinet
  { id: 'eb_clar',      family: 'single_reed', nameJa: 'クラリネット (Eb)',         nameEn: 'Clarinet (Eb)',       trans: 3,   loMidi: 55, hiMidi: 96 },
  { id: 'bb_clar',      family: 'single_reed', nameJa: 'クラリネット (Bb)',         nameEn: 'Clarinet (Bb)',       trans: -2,  loMidi: 50, hiMidi: 94 },
  { id: 'a_clar',       family: 'single_reed', nameJa: 'クラリネット (A)',          nameEn: 'Clarinet (A)',        trans: -3,  loMidi: 49, hiMidi: 93 },
  { id: 'bassclar',     family: 'single_reed', nameJa: 'バスクラリネット (Bb)',     nameEn: 'Bass Clarinet (Bb)', trans: -14, loMidi: 38, hiMidi: 80 },
  { id: 'contraclar',   family: 'single_reed', nameJa: 'コントラバスクラリネット',  nameEn: 'Contrabass Clarinet', trans: -26, loMidi: 26, hiMidi: 68 },

  // Air Reed
  { id: 'piccolo',      family: 'air_reed',    nameJa: 'ピッコロ',                  nameEn: 'Piccolo',             trans: 12,  loMidi: 74, hiMidi: 108 },
  { id: 'fl',           family: 'air_reed',    nameJa: 'フルート',                  nameEn: 'Flute',               trans: 0,   loMidi: 60, hiMidi: 96  },
  { id: 'alt_fl',       family: 'air_reed',    nameJa: 'アルトフルート (G)',         nameEn: 'Alto Flute (G)',      trans: -7,  loMidi: 55, hiMidi: 91  },
  { id: 'bass_fl',      family: 'air_reed',    nameJa: 'バスフルート',              nameEn: 'Bass Flute',          trans: -12, loMidi: 48, hiMidi: 84  },

  // High Brass
  { id: 'eb_trumpet',   family: 'brass_high',  nameJa: 'トランペット (Eb)',          nameEn: 'Trumpet (Eb)',        trans: 3,   loMidi: 55, hiMidi: 87 },
  { id: 'bb_trumpet',   family: 'brass_high',  nameJa: 'トランペット (Bb)',          nameEn: 'Trumpet (Bb)',        trans: -2,  loMidi: 52, hiMidi: 84 },
  { id: 'c_trumpet',    family: 'brass_high',  nameJa: 'トランペット (C)',           nameEn: 'Trumpet (C)',         trans: 0,   loMidi: 52, hiMidi: 84 },
  { id: 'cornet',       family: 'brass_high',  nameJa: 'コルネット (Bb)',            nameEn: 'Cornet (Bb)',         trans: -2,  loMidi: 52, hiMidi: 84 },
  { id: 'flugelhorn',   family: 'brass_high',  nameJa: 'フリューゲルホルン (Bb)',   nameEn: 'Flugelhorn (Bb)',     trans: -2,  loMidi: 52, hiMidi: 81 },

  // Mid Brass
  { id: 'f_horn',       family: 'brass_mid',   nameJa: 'ホルン (F)',                 nameEn: 'Horn (F)',            trans: -7,  loMidi: 34, hiMidi: 77 },
  { id: 'tenor_horn',   family: 'brass_mid',   nameJa: 'テナーホーン (Eb)',          nameEn: 'Tenor Horn (Eb)',     trans: 3,   loMidi: 43, hiMidi: 77 },
  { id: 'bb_trombone',  family: 'brass_mid',   nameJa: 'テナートロンボーン',         nameEn: 'Trombone (Bb)',       trans: 0,   loMidi: 40, hiMidi: 77 },
  { id: 'bass_trombone',family: 'brass_mid',   nameJa: 'バストロンボーン',           nameEn: 'Bass Trombone',       trans: 0,   loMidi: 34, hiMidi: 72 },
  { id: 'bb_euph',      family: 'brass_mid',   nameJa: 'ユーフォニアム (Bb)',        nameEn: 'Euphonium (Bb)',      trans: -2,  loMidi: 36, hiMidi: 72 },

  // Low Brass
  { id: 'bb_tuba',      family: 'brass_low',   nameJa: 'テューバ (Bb)',              nameEn: 'Tuba (Bb)',           trans: -2,  loMidi: 29, hiMidi: 65 },
  { id: 'c_tuba',       family: 'brass_low',   nameJa: 'テューバ (C)',               nameEn: 'Tuba (C)',            trans: 0,   loMidi: 29, hiMidi: 65 },
  { id: 'eb_tuba',      family: 'brass_low',   nameJa: 'テューバ (Eb)',              nameEn: 'Tuba (Eb)',           trans: 3,   loMidi: 29, hiMidi: 65 },
  { id: 'f_tuba',       family: 'brass_low',   nameJa: 'テューバ (F)',               nameEn: 'Tuba (F)',            trans: -7,  loMidi: 29, hiMidi: 65 },

  // Other
  { id: 'concert',      family: 'other',       nameJa: 'Concert (C)',               nameEn: 'Concert (C)',         trans: 0,   loMidi: 48, hiMidi: 84 },
];

export function getInstrument(id) {
  return INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS.find(i => i.id === 'concert') || INSTRUMENTS[0];
}

// ---- Misc UI utils ----

let toastTimer = null;
export function showToast(msg, durationMs = 2000) {
  const el = document.getElementById('toastMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), durationMs);
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

export function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function defaultSaveName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function mapRange(v, inLo, inHi, outLo, outHi) {
  return outLo + (outHi - outLo) * ((v - inLo) / (inHi - inLo));
}

// ---- LocalStorage helpers ----
const LS_PREFIX = 'namaChu_';

export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
}

export function lsDel(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

export function lsKeys(prefix = '') {
  const results = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LS_PREFIX + prefix)) results.push(k.slice(LS_PREFIX.length));
  }
  return results;
}
