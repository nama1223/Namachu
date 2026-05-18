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
const MIN_VOLUME_GRID  = [2, 5, 10, 15, 22, 30];
const CLARITY_GRID     = [40, 55, 65, 75, 85, 92];
// 無音猶予[ms]: 短いドロップアウトをこの時間まで「持続音」とみなす
const SILENCE_GRACE_GRID = [40, 100, 160, 240];

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
      <span class="calib-note-count" id="calibNoteCount">0 / 8 音</span>
    </div>
    <div class="calib-meter"><div class="calib-meter-fill" id="calibMeter"></div></div>
  `);
  _setButtons([
    { label: '■ 停止して解析', cls: 'primary', onClick: 'stopCalibrationRecord' },
    { label: '↻ やり直し',     cls: '',        onClick: 'restartCalibrationRecord' },
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
  const isPerfect = best.noteCount === 8 && best.flips === 0 && best.gaps === 0;

  // 診断メッセージ
  const issues = [];
  if (!ok) {
    issues.push('音がほとんど検出されませんでした。マイクが入力されているか、音量が足りているか確認してください。');
  } else {
    if (best.noteCount < 8) {
      issues.push(`<b>検出ノートが${best.noteCount}/8</b>: 音が短すぎる／弱すぎる、または各音の間が繋がりすぎている可能性があります。`);
    } else if (best.noteCount > 8) {
      issues.push(`<b>検出ノートが${best.noteCount}/8</b>: 同じ音内で揺れが大きく別の音に分割されている可能性。ロングトーンを安定させて再演奏してください。`);
    }
    if (best.flips > 0) issues.push(`<b>裏返り${best.flips}回</b>: マイクが倍音を一瞬拾っています。もう少しマイクから離れる／向きを調整すると改善することがあります。`);
    if (best.gaps > 0) issues.push(`<b>途切れ${best.gaps}回</b>: 連続音の中にピッチ検出失敗があります。${best.silenceGrace >= 160 ? '無音猶予を最大に設定したので、録音側ではある程度補正されます。' : '息のコントロールやマイク位置を確認してください。'}`);
    if (best.silenceGrace >= 160) issues.push(`スマホ等で発生しやすい短時間ドロップアウト対策として<b>無音猶予 ${best.silenceGrace}ms</b> を適用しています。`);
    if (isPerfect) issues.push('✓ 完璧に検出できました。');
  }

  const summaryHTML = `
    <div class="calib-result">
      <div style="font-size:0.78rem;opacity:0.7;margin-bottom:4px;">※ 数値は ${MIN_VOLUME_GRID.length * CLARITY_GRID.length * SILENCE_GRACE_GRID.length} 通りのパラメータ組合せで最良だったものです</div>
      <div>検出ノート数: <b>${best.noteCount}</b> / 8　裏返り: <b>${best.flips}</b> 回　途切れ: <b>${best.gaps}</b> 箇所</div>
      <div style="margin-top:6px;">推奨設定 → 最小音量: <b>${best.minVolume}</b>　クラリティ: <b>${best.clarity}</b>　無音猶予: <b>${best.silenceGrace}</b>ms</div>
      <canvas id="calibTraceCanvas" class="calib-trace" width="600" height="80"></canvas>
      <div class="calib-issues">${issues.map(s => `<div>・${s}</div>`).join('')}</div>
    </div>`;

  _setStatus(ok ? '解析完了' : '解析失敗');
  _setVisual(summaryHTML);
  _drawTrace(best);

  const buttons = [];
  if (ok) buttons.push({ label: '✓ 適用',     cls: 'primary', onClick: 'applyCalibration' });
  buttons.push({ label: '↻ もう一度', cls: '', onClick: 'startCalibrationRecord' });
  buttons.push({ label: '閉じる',     cls: '', onClick: 'closeCalibration' });
  _setButtons(buttons);

  _state = 'done';
  window._calibBest = best;
}

// 解析結果のピッチトレースを小さなキャンバスに描画
function _drawTrace(best) {
  const canvas = document.getElementById('calibTraceCanvas');
  if (!canvas || !best.seq) return;
  const dpr = devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);

  const seq = best.seq;
  if (seq.length === 0) return;

  // freq 範囲を求める
  let lo = Infinity, hi = -Infinity;
  for (const f of seq) if (f) { if (f < lo) lo = f; if (f > hi) hi = f; }
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) { hi = lo * 2; }
  const loMidi = 69 + 12 * Math.log2(lo / 440) - 1;
  const hiMidi = 69 + 12 * Math.log2(hi / 440) + 1;
  const range = hiMidi - loMidi;

  const colW = w / seq.length;

  // 途切れ／裏返り箇所のマーカーをまず描画
  for (const x of (best.gapPositions || [])) {
    ctx.fillStyle = 'rgba(150,150,150,0.35)';
    ctx.fillRect(x * colW, 0, Math.max(1, colW), h);
  }

  // ピッチ点
  for (let i = 0; i < seq.length; i++) {
    const f = seq[i];
    if (!f) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const y = h - (midi - loMidi) / range * h;
    const isFlip = (best.flipPositions || []).includes(i);
    ctx.fillStyle = isFlip ? '#e53935' : '#1e88e5';
    ctx.beginPath();
    ctx.arc(i * colW + colW / 2, y, isFlip ? 3 * dpr : 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
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

  // リアルタイム ノート検出用ステート
  let liveNoteCount = 0;
  let liveLastMidi = null;
  let livePendingMidi = null;
  let livePendingCount = 0;
  let liveSilentFrames = 0;
  const sr = getSampleRate();

  setRawFrameCallback((buf, rms) => {
    if (_state !== 'recording') return;
    const tMs = performance.now() - _recordStart;
    _frames.push({ buf: new Float32Array(buf), rms, tMs });

    // ---- リアルタイム ノート検出（既定パラメータで判定） ----
    let detecting = false;
    if (rms >= 0.012) {
      const r = yinDetect(buf, sr);
      if (r.freq && r.clarity >= 0.80) {
        detecting = true;
        const midi = Math.round(69 + 12 * Math.log2(r.freq / 440));
        if (liveLastMidi === null) {
          // 最初の音
          if (livePendingMidi === midi) {
            livePendingCount++;
            if (livePendingCount >= 3) {
              liveLastMidi = midi;
              liveNoteCount = 1;
              livePendingMidi = null;
              livePendingCount = 0;
            }
          } else { livePendingMidi = midi; livePendingCount = 1; }
        } else if (midi !== liveLastMidi) {
          if (livePendingMidi === midi) {
            livePendingCount++;
            if (livePendingCount >= 3) {
              liveLastMidi = midi;
              liveNoteCount++;
              livePendingMidi = null;
              livePendingCount = 0;
            }
          } else { livePendingMidi = midi; livePendingCount = 1; }
        } else {
          livePendingMidi = null;
          livePendingCount = 0;
        }
        liveSilentFrames = 0;
      }
    }
    if (!detecting) {
      liveSilentFrames++;
      livePendingMidi = null;
      livePendingCount = 0;
    }

    // ---- UI ----
    const timer = document.getElementById('calibTimer');
    if (timer) timer.textContent = `${(tMs / 1000).toFixed(1)}s / ${RECORD_SECONDS}s`;
    const nc = document.getElementById('calibNoteCount');
    if (nc) nc.textContent = `${liveNoteCount} / 8 音`;
    const meter = document.getElementById('calibMeter');
    if (meter) {
      meter.style.width = Math.min(100, (tMs / (RECORD_SECONDS * 1000)) * 100) + '%';
      meter.style.background = detecting ? '#1e88e5' : 'var(--dot-weak)';
    }

    // ---- 8音検出後 1秒無音で自動終了 ----
    if (liveNoteCount >= 8 && liveSilentFrames >= 60) {
      stopCalibrationRecord();
    }
  });

  _stopTimer = setTimeout(stopCalibrationRecord, RECORD_SECONDS * 1000);
}

export function restartCalibrationRecord() {
  _stopCapture();
  _frames = [];
  startCalibrationRecord();
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

  // 全フレームの時間間隔（ms）= 想定 16.7ms / 60fps
  const frameMs = _frames.length >= 2
    ? (_frames[_frames.length - 1].tMs - _frames[0].tMs) / (_frames.length - 1)
    : 16.7;

  let best = null;
  for (const minVol of MIN_VOLUME_GRID) {
    const minRms = minVol / 100 * 0.15;
    for (const clar of CLARITY_GRID) {
      const clarThr = clar / 100;
      for (const graceMs of SILENCE_GRACE_GRID) {
        const graceFrames = Math.round(graceMs / frameMs);
        const seq = _buildSequence(yinResults, minRms, clarThr, graceFrames);
        const score = _scoreSequence(seq);
        if (!best || score.score > best.score) {
          best = { ...score, minVolume: minVol, clarity: clar, silenceGrace: graceMs };
        }
      }
    }
  }
  return best;
}

// 各フレームに pitch を割り当て、その後 graceFrames 分の短い null を補間で埋める
function _buildSequence(yinResults, minRms, clarThr, graceFrames) {
  const seq = [];
  for (let i = 0; i < _frames.length; i++) {
    const f = _frames[i];
    if (f.rms < minRms) { seq.push(null); continue; }
    const r = yinResults[i];
    if (!r.freq || r.clarity < clarThr) { seq.push(null); continue; }
    seq.push(r.freq);
  }
  // 猶予内かつ前後ピッチが近い場合のみ「線形補間（対数空間）」で穴を埋める
  if (graceFrames > 0) {
    let i = 0;
    while (i < seq.length) {
      if (seq[i] !== null) { i++; continue; }
      let j = i;
      while (j < seq.length && seq[j] === null) j++;
      const gapLen = j - i;
      const prev = i > 0 ? seq[i - 1] : null;
      const next = j < seq.length ? seq[j] : null;
      if (prev !== null && next !== null && gapLen <= graceFrames) {
        const semis = Math.abs(12 * Math.log2(next / prev));
        if (semis < 1.5) {
          for (let k = i; k < j; k++) {
            const t = (k - i + 1) / (gapLen + 1);
            seq[k] = prev * Math.pow(next / prev, t);
          }
        }
      }
      i = j;
    }
  }
  return seq;
}

// シーケンスをスコア化（プラトーベース）:
//   ・freq を MIDI float に変換
//   ・連続して ±0.7 半音以内に収まる区間をプラトー（音符）として検出
//   ・短い null は「プラトー内の途切れ」としてカウント、長い null は休符として無視
//   ・プラトー外への 1〜2 フレームの大ジャンプは裏返り
function _scoreSequence(seq) {
  const PLATEAU_TOLERANCE = 0.7;        // 同じ音とみなす半音範囲
  const MIN_PLATEAU_FRAMES = 4;          // プラトー最小持続
  const MAX_INNER_GAP = 4;               // プラトー内で許容する null 連続
  const FLIP_SEMIS = 5;                  // プラトー中心からこれ以上離れたら裏返り候補

  // MIDI float 変換
  const midis = seq.map(f => f ? 12 * Math.log2(f / 440) + 69 : null);

  // プラトー検出
  const plateaus = [];
  let i = 0;
  while (i < midis.length) {
    if (midis[i] === null) { i++; continue; }
    // i から始まるプラトー候補
    const samples = [midis[i]];
    let center = midis[i];
    let lastValidIdx = i;
    let j = i + 1;
    while (j < midis.length) {
      if (midis[j] === null) {
        if (j - lastValidIdx > MAX_INNER_GAP) break;
        j++;
        continue;
      }
      if (Math.abs(midis[j] - center) > PLATEAU_TOLERANCE) {
        // 中心から離れた → プラトー終了候補
        // ただし 1〜2 フレームの単発ジャンプ（裏返り）は許容
        let k = j + 1;
        let returns = false;
        while (k < midis.length && k - j < 3) {
          if (midis[k] !== null && Math.abs(midis[k] - center) <= PLATEAU_TOLERANCE) {
            returns = true; break;
          }
          k++;
        }
        if (returns) { j = k; continue; }
        break;
      }
      samples.push(midis[j]);
      // ゆっくり center を更新（揺らぎに追従）
      center = center * 0.9 + midis[j] * 0.1;
      lastValidIdx = j;
      j++;
    }
    const endIdx = lastValidIdx + 1;
    if (endIdx - i >= MIN_PLATEAU_FRAMES && samples.length >= 3) {
      samples.sort((a, b) => a - b);
      const med = samples[Math.floor(samples.length / 2)];
      plateaus.push({ start: i, end: endIdx, center: med });
    }
    i = endIdx > i ? endIdx : i + 1;
  }

  const notes = plateaus.map(p => p.center);

  // 裏返り: プラトー内で中心から FLIP_SEMIS 以上離れた点
  let flips = 0;
  const flipPositions = [];
  for (const p of plateaus) {
    for (let k = p.start; k < p.end; k++) {
      if (midis[k] === null) continue;
      if (Math.abs(midis[k] - p.center) >= FLIP_SEMIS) {
        flips++;
        flipPositions.push(k);
      }
    }
  }

  // 途切れ: プラトー内の null フレーム（連続まとめて 1 箇所とカウント）
  let gaps = 0;
  const gapPositions = [];
  for (const p of plateaus) {
    let inGap = false;
    for (let k = p.start; k < p.end; k++) {
      if (midis[k] === null) {
        gapPositions.push(k);
        if (!inGap) { gaps++; inGap = true; }
      } else {
        inGap = false;
      }
    }
  }

  // 単調増加（半音以上上昇している割合）
  let ascending = 0;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i] >= notes[i - 1] + 0.5) ascending++;
  }
  const ascRatio = notes.length > 1 ? ascending / (notes.length - 1) : 0;

  // スコア合成
  const noteCountScore = -Math.abs(notes.length - 8) * 35 + (notes.length === 8 ? 80 : notes.length >= 7 ? 40 : 0);
  const flipScore = -flips * 25;
  const gapScore = -gaps * 15;
  const ascScore = ascRatio * 80;
  const total = noteCountScore + flipScore + gapScore + ascScore + 100;

  return { score: total, noteCount: notes.length, flips, gaps, seq, flipPositions, gapPositions };
}

// ---- 適用 ----

export function applyCalibration() {
  const best = window._calibBest;
  if (!best) return;
  _onApply?.(best.minVolume, best.clarity, best.silenceGrace);
  showToast('感度設定を適用しました');
  closeCalibration();
}
