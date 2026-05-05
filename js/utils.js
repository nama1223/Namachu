/* NamaChu — shared utilities */

// ---- Music / pitch math ----

export const NOTE_NAMES_ABC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const NOTE_NAMES_DO  = ['ド','ド#','レ','レ#','ミ','ファ','ファ#','ソ','ソ#','ラ','ラ#','シ'];

/**
 * Convert frequency (Hz) to MIDI note number (float).
 * A4 = 69, configurable via concertPitchA4.
 */
export function freqToMidi(freq, concertPitchA4 = 440) {
  return 69 + 12 * Math.log2(freq / concertPitchA4);
}

/**
 * Convert MIDI note number (float) to { note, octave, cents }.
 * note: 0-11 (C=0), octave: integer, cents: ±50
 */
export function midiToNoteInfo(midi) {
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const note = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return { note, octave, cents };
}

/**
 * Return note name string.
 * style: 'abc' | 'do'
 * showOctave: boolean
 */
export function noteName(noteIndex, octave, style = 'abc', showOctave = false) {
  const names = style === 'do' ? NOTE_NAMES_DO : NOTE_NAMES_ABC;
  return showOctave ? `${names[noteIndex]}${octave}` : names[noteIndex];
}

/**
 * Frequency of a given MIDI note number.
 */
export function midiToFreq(midi, concertPitchA4 = 440) {
  return concertPitchA4 * Math.pow(2, (midi - 69) / 12);
}

// ---- Instrument definitions ----
// transpositionSemitones: concert pitch offset (positive = instrument sounds higher than written)
// e.g. Bb trumpet: written C sounds as concert Bb → concertPitch = written - 2
export const INSTRUMENTS = [
  { id: 'concert',    nameJa: 'Concert (C)',         nameEn: 'Concert (C)',       trans: 0,  loMidi: 48, hiMidi: 84 },
  { id: 'bb_trumpet', nameJa: 'トランペット (Bb)',   nameEn: 'Trumpet (Bb)',      trans: -2, loMidi: 52, hiMidi: 84 },
  { id: 'bb_clar',    nameJa: 'クラリネット (Bb)',   nameEn: 'Clarinet (Bb)',     trans: -2, loMidi: 50, hiMidi: 89 },
  { id: 'eb_alto',    nameJa: 'アルトサックス (Eb)', nameEn: 'Alto Sax (Eb)',     trans: -9, loMidi: 49, hiMidi: 80 },
  { id: 'bb_tenor',   nameJa: 'テナーサックス (Bb)', nameEn: 'Tenor Sax (Bb)',    trans: -14,loMidi: 44, hiMidi: 75 },
  { id: 'eb_bari',    nameJa: 'バリサックス (Eb)',   nameEn: 'Bari Sax (Eb)',     trans: -21,loMidi: 37, hiMidi: 68 },
  { id: 'f_horn',     nameJa: 'ホルン (F)',          nameEn: 'Horn (F)',           trans: -7, loMidi: 40, hiMidi: 77 },
  { id: 'bb_euph',    nameJa: 'ユーフォニアム (Bb)', nameEn: 'Euphonium (Bb)',    trans: -2, loMidi: 36, hiMidi: 72 },
  { id: 'bb_tuba',    nameJa: 'チューバ (Bb)',       nameEn: 'Tuba (Bb)',         trans: -2, loMidi: 29, hiMidi: 65 },
  { id: 'fl',         nameJa: 'フルート',            nameEn: 'Flute',             trans: 0,  loMidi: 60, hiMidi: 96 },
  { id: 'ob',         nameJa: 'オーボエ',            nameEn: 'Oboe',              trans: 0,  loMidi: 58, hiMidi: 91 },
  { id: 'fg',         nameJa: 'ファゴット',          nameEn: 'Bassoon',           trans: 0,  loMidi: 34, hiMidi: 75 },
];

export function getInstrument(id) {
  return INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];
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

/** Format seconds as M:SS */
export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Generate default save name: yyyy-mm-dd_hhmm */
export function defaultSaveName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Clamp value between min and max. */
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Linear interpolation. */
export function lerp(a, b, t) { return a + (b - a) * t; }

/** Map value from one range to another. */
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
