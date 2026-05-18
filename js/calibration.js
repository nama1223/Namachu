/* NamaChu — マイク感度の自動調整
 *
 * 流れ:
 *   1) 生PCMフレームを 10 秒分収集（カウントダウン後）
 *   2) (minRms, clarityThreshold) のグリッドでオフライン再解析
 *   3) 各組合せの結果をスコアリング: 8音検出 / 裏返り少 / 途切れ少 / 単調増加
 *   4) ベストスコアのパラメータを設定に反映
 */

import { setRawFrameCallback, getSampleRate, yinDetect, calcRms, isMicRunning, startMic } from './audio.js';
import { closeModal, openModal, showToast } from './utils.js';

const RECORD_SECONDS = 10;
const FRAME_INTERVAL_MS = 1000 / 60; // 60fps想定

// グリッド（スライダー値）
const MIN_VOLUME_GRID = [3, 6, 10, 15, 22, 30];
const CLARITY_GRID    = [55, 65, 72, 80, 86, 92];

let _state = 'idle'; // idle | countdown | recording | analyzing | done
let _frames = [];    // [{ buf: Float32Array, rms: number, tMs: number }]
let _recordStart = 0;
let _stopTimer = null;
let _onApply = null; // (minVolume, clarity) => void

export function initCalibration(onApply) {
  _onApply = onApply;
}

export function openCalibration() {
  _resetState();
  openModal('calibrationModal');
  _renderIdle();

  // マイクが動いていなければ起動
  if (!isMicRunning()) {
    startMic(() => {}).catch(() => showToast('マイクを開始できませんでした'));
  }
}

export function closeCalibration() {
  _stopCapture();
  closeModal('calibrationModal');
  _resetState();
}

function _resetState() {
  _state = 'idle';
  _frames = [];
  clearTimeout(_stopTimer);
  _stopTimer = null;
  setRawFrameCallback(null);
}

// ---- UI 状態 ----

function _renderIdle() {
  _setStatus('開始ボタンを押して「4分音符のスラーで1オクターヴの長音階」を演奏してください（約8秒）');
  _setVisual('');
  _setButtons([
    { label: '▶ 演奏開始', cls: 'primary', onClick: 'startCalibrationRecord' },
    { label: '閉じる',    cls: '',        onClick: 'closeCalibration' },
  ]);
}

function _renderCountdown(n) {
  _setStatus('構えてください…');
  _setVisual(`<div class="calib-countdown">${n}</div>`);
  _setButtons([{ label: 'キャンセル', cls: '', onClick: 'closeCalibration' }]);
}

function _renderRecording() {
  _setStatus('録音中…ゆっくり明瞭に演奏してください');
  _setVisual(`
    <div class="calib-rec-indicator">
      <span class="calib-rec-dot"></span>
      <span id="calibTimer">0.0s / ${RECORD_SECONDS}s</span>
    </div>
    <div class="calib-meter"><div class="calib-meter-fill" id="calibMeter"></div></div>
  `);
  _setButtons([
    { label: '■ 停止して解析', cls: 'primary', onClick: 'stopCalibrationRecord' },
    { label: 'キャンセル',     cls: '',        onClick: 'closeCalibration' },
  ]);
}

function _renderAnalyzing() {
  _setStatus('解析中…');
  _setVisual('<div class="calib-spinner"></div>');
  _setButtons([]);
}

function _renderDone(best) {
  const ok = best.score > 0;
  const summary = ok
    ? `検出ノート数: <b>${best.noteCount}</b> / 8　裏返り: <b>${best.flips}</b> 回　途切れ: <b>${best.gaps}</b><br>
       推奨設定 → 最小音量: <b>${best.minVolume}</b>　クラリティ: <b>${best.clarity}</b>`
    : '十分な音が検出できませんでした。もう一度お試しください。';

  _setStatus(ok ? '解析完了！この設定を適用しますか？' : '解析失敗');
  _setVisual(`<div class="calib-result">${summary}</div>`);
  const buttons = [];
  if (ok) buttons.push({ label: '✓ 適用',     cls: 'primary', onClick: 'applyCalibration' });
  buttons.push({ label: '↻ もう一度', cls: '', onClick: 'startCalibrationRecord' });
  buttons.push({ label: '閉じる',     cls: '', onClick: 'closeCalibration' });
  _setButtons(buttons);

  _state = 'done';
  window._calibBest = best;
}

function _setStatus(html) {
  const el = document.getElementById('calibStatus');
  if (el) el.innerHTML = html;
}
function _setVisual(html) {
  const el = document.getElementById('calibVisual');
  if (el) el.innerHTML = html;
}
function _setButtons(items) {
  const el = document.getElementById('calibButtons');
  if (!el) return;
  el.innerHTML = items.map(it =>
    `<button class="calib-btn ${it.cls}" onclick="${it.onClick}()">${it.label}</button>`
  ).join('');
}

// ---- 録音 ----

export function startCalibrationRecord() {
  if (!isMicRunning()) {
    showToast('マイクが起動していません');
    return;
  }
  _frames = [];
  _state = 'countdown';

  let n = 3;
  _renderCountdown(n);
  const cd = setInterval(() => {
    n--;
    if (n > 0) _renderCountdown(n);
    else {
      clearInterval(cd);
      _beginCapture();
    }
  }, 800);
}

function _beginCapture() {
  _state = 'recording';
  _renderRecording();
  _recordStart = performance.now();

  setRawFrameCallback((buf, rms) => {
    if (_state !== 'recording') return;
    const tMs = performance.now() - _recordStart;
    // バッファをコピーして保持
    _frames.push({ buf: new Float32Array(buf), rms, tMs });

    // UI更新（メーター・タイマー）
    const timer = document.getElementById('calibTimer');
    if (timer) timer.textContent = `${(tMs / 1000).toFixed(1)}s / ${RECORD_SECONDS}s`;
    const meter = document.getElementById('calibMeter');
    if (meter) meter.style.width = Math.min(100, (tMs / (RECORD_SECONDS * 1000)) * 100) + '%';
  });

  _stopTimer = setTimeout(stopCalibrationRecord, RECORD_SECONDS * 1000);
}

export function stopCalibrationRecord() {
  if (_state !== 'recording') {
    // 録音中でなくても結果画面から呼ばれる場合は再録音として開始
    if (_state === 'done' || _state === 'idle') {
      startCalibrationRecord();
      return;
    }
  }
  _stopCapture();
  _state = 'analyzing';
  _renderAnalyzing();
  // 解析は重いので次フレームに回す
  setTimeout(() => {
    const best = _analyzeAll();
    _renderDone(best);
  }, 50);
}

function _stopCapture() {
  setRawFrameCallback(null);
  clearTimeout(_stopTimer);
  _stopTimer = null;
}

// ---- 解析 ----

function _analyzeAll() {
  if (_frames.length < 30) {
    return { score: -1, noteCount: 0, flips: 0, gaps: 0, minVolume: 10, clarity: 85 };
  }
  const sampleRate = getSampleRate();

  // フレーム毎の YIN 結果をキャッシュ（minRms に依存しないので一度だけ）
  const yinResults = _frames.map(f => yinDetect(f.buf, sampleRate));

  let best = null;
  for (const minVol of MIN_VOLUME_GRID) {
    const minRms = minVol / 100 * 0.15;
    for (const clar of CLARITY_GRID) {
      const clarThr = clar / 100;
      const seq = _buildSequence(yinResults, minRms, clarThr);
      const score = _scoreSequence(seq);
      if (!best || score.score > best.score) {
        best = { ...score, minVolume: minVol, clarity: clar };
      }
    }
  }
  return best;
}

// 各フレームに pitch を割り当て（最小音量 & クラリティ閾値で無音化）
function _buildSequence(yinResults, minRms, clarThr) {
  const seq = [];
  for (let i = 0; i < _frames.length; i++) {
    const f = _frames[i];
    if (f.rms < minRms) { seq.push(null); continue; }
    const r = yinResults[i];
    if (!r.freq || r.clarity < clarThr) { seq.push(null); continue; }
    seq.push(r.freq);
  }
  return seq;
}

// シーケンスをスコア化:
//   +ノート数（8 ちょうどで最大ボーナス）
//   -オクターヴ跳躍（1フレーム単独の大ジャンプ）
//   -連続音内の小さな穴（前後同じ pitch なのに null）
//   +単調増加性
function _scoreSequence(seq) {
  // null を境界として「ノート」にグルーピング
  const groups = [];
  let cur = [];
  for (let i = 0; i < seq.length; i++) {
    const f = seq[i];
    if (f === null) {
      if (cur.length > 0) { groups.push(cur); cur = []; }
    } else cur.push(f);
  }
  if (cur.length > 0) groups.push(cur);

  // 最低 3 フレーム持続（≈ 50ms）以上のものだけ「ノート」と認める
  const notes = groups.filter(g => g.length >= 3).map(g => {
    g.sort((a, b) => a - b);
    return g[Math.floor(g.length / 2)]; // 中央値
  });

  // 裏返り検出: 全フレームを舐めて、隣接フレーム間で 7 半音以上ジャンプし、
  // かつそれが 1〜2 フレーム後に元に戻る = 裏返り
  let flips = 0;
  for (let i = 1; i < seq.length - 2; i++) {
    if (!seq[i - 1] || !seq[i] || !seq[i + 1]) continue;
    const semisIn = Math.abs(12 * Math.log2(seq[i] / seq[i - 1]));
    const semisBackTo1 = Math.abs(12 * Math.log2(seq[i + 1] / seq[i - 1]));
    const semisBackTo2 = seq[i + 2] ? Math.abs(12 * Math.log2(seq[i + 2] / seq[i - 1])) : 99;
    if (semisIn >= 6 && (semisBackTo1 <= 3 || semisBackTo2 <= 3)) flips++;
  }

  // 穴検出: 1〜2 フレームの単発 null が前後同じピッチ帯（±3半音）に挟まれている
  let gaps = 0;
  for (let i = 1; i < seq.length - 1; i++) {
    if (seq[i] !== null) continue;
    // i から null 連続区間を探す
    let j = i;
    while (j < seq.length && seq[j] === null) j++;
    const gapLen = j - i;
    if (gapLen > 3) { i = j; continue; } // 大きすぎる穴はノート間休符
    const prev = seq[i - 1];
    const next = seq[j];
    if (prev && next) {
      const semis = Math.abs(12 * Math.log2(next / prev));
      if (semis <= 3) gaps++;
    }
    i = j;
  }

  // 単調増加性
  let ascending = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i] > notes[i - 1] * 1.02) ascending++;
  }
  const ascRatio = notes.length > 1 ? ascending / (notes.length - 1) : 0;

  // スコア合成
  const noteCountScore = -Math.abs(notes.length - 8) * 30 + (notes.length >= 6 ? 50 : 0);
  const flipScore = -flips * 25;
  const gapScore = -gaps * 8;
  const ascScore = ascRatio * 60;
  const total = noteCountScore + flipScore + gapScore + ascScore + 100;

  return { score: total, noteCount: notes.length, flips, gaps };
}

// ---- 適用 ----

export function applyCalibration() {
  const best = window._calibBest;
  if (!best) return;
  _onApply?.(best.minVolume, best.clarity);
  showToast('感度設定を適用しました');
  closeCalibration();
}
