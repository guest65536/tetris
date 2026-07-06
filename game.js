'use strict';

/* =========================================================
   テトリス(クラシック・シンプル版)
   高齢の親向け調整:
   - 操作は 左・右・回転・下 の4つだけ(タップ1回=1マス)
   - 速度は緩やかに上がり、上限に達したらまた遅くなる循環
   - 短いロックディレイあり
   - バックグラウンドで自動一時停止
   ========================================================= */

// ----- 盤面サイズ -----
const COLS = 10;
const ROWS = 20;

// ----- ミノの色(高コントラスト) -----
const COLORS = {
  I: '#00E5FF',
  O: '#FFD600',
  T: '#D500F9',
  S: '#00E676',
  Z: '#FF3D00',
  J: '#2979FF',
  L: '#FF9100',
};

// ----- ミノの形(スポーン時の並び) -----
const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
const TYPES = ['I','O','T','S','Z','J','L'];

// ----- 速度の循環設定 -----
const BASE_INTERVAL = 1000; // いちばん遅い落下間隔(ミリ秒)
const MIN_INTERVAL  = 350;  // いちばん速い落下間隔(上限)
const STEP          = 50;   // 1段階ごとに速くなる量
const LINES_PER_STEP = 2;   // 何ライン消すごとに1段階速くするか
const LOCK_DELAY    = 500;  // 着地してから固定されるまでの猶予(ミリ秒)
const MAX_LOCK_RESET = 8;   // ロックディレイをリセットできる回数の上限
const CLEAR_DURATION = 380; // ライン消去エフェクトの長さ(ミリ秒)

// =========================================================
//  DOM 取得
// =========================================================
const boardCanvas = document.getElementById('board');
const boardCtx = boardCanvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');

// =========================================================
//  ゲームの状態
// =========================================================
let grid;            // 盤面(固定されたブロック)
let current;         // 今操作しているミノ
let nextType;        // 次のミノの種類
let score;
let linesCleared;
let dropInterval;    // 現在の落下間隔
let dropTimer;       // 落下用の経過時間
let lockTimer;       // ロックディレイ用の経過時間
let lockResets;      // ロックディレイをリセットした回数
let landed;          // 着地中かどうか
let running;         // ゲーム進行中か
let paused;          // 一時停止中か
let lastTime;        // 前フレームの時刻
let cell;            // 盤面の1マスの大きさ(px)
let nextCell;        // 「つぎ」表示の1マスの大きさ(px)
let clearAnim;       // ライン消去エフェクト中の状態({ rows, elapsed })

// =========================================================
//  キャンバスのサイズ調整(高精細対応)
// =========================================================
function setupCanvas() {
  const area = boardCanvas.parentElement;
  const SIDE_W = 84;   // 右側「つぎ」欄の幅
  const GAP = 12;      // 盤面と「つぎ」欄のすき間
  const maxW = area.clientWidth - SIDE_W - GAP;
  const maxH = area.clientHeight;
  // 盤面のアスペクト比 COLS:ROWS を保ったまま最大化
  cell = Math.floor(Math.min(maxW / COLS, maxH / ROWS));
  cell = Math.max(cell, 14);

  const w = cell * COLS;
  const h = cell * ROWS;
  const dpr = window.devicePixelRatio || 1;

  boardCanvas.style.width = w + 'px';
  boardCanvas.style.height = h + 'px';
  boardCanvas.width = w * dpr;
  boardCanvas.height = h * dpr;
  boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 次のミノ表示(4x4ぶん・盤面とは別の小さめマス)
  nextCell = Math.floor(SIDE_W / 4);
  const nc = nextCell * 4;
  nextCanvas.style.width = nc + 'px';
  nextCanvas.style.height = nc + 'px';
  nextCanvas.width = nc * dpr;
  nextCanvas.height = nc * dpr;
  nextCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  draw();
}

// =========================================================
//  ミノの生成・回転
// =========================================================
function randomType() {
  return TYPES[Math.floor(Math.random() * TYPES.length)];
}

function makePiece(type) {
  const shape = SHAPES[type].map(row => row.slice());
  const x = Math.floor((COLS - shape[0].length) / 2);
  return { type, shape, x, y: 0 };
}

// 行列を時計回りに90度回転
function rotateMatrix(m) {
  const n = m.length;
  const res = [];
  for (let i = 0; i < n; i++) {
    res.push([]);
    for (let j = 0; j < n; j++) {
      res[i].push(m[n - 1 - j][i]);
    }
  }
  return res;
}

// =========================================================
//  当たり判定
// =========================================================
function collides(shape, offX, offY) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const x = offX + c;
      const y = offY + r;
      if (x < 0 || x >= COLS || y >= ROWS) return true; // 壁・床
      if (y >= 0 && grid[y][x]) return true;            // 他ブロック
    }
  }
  return false;
}

// =========================================================
//  操作
// =========================================================
function move(dx) {
  if (!canControl()) return;
  if (!collides(current.shape, current.x + dx, current.y)) {
    current.x += dx;
    onSuccessfulMove();
    Sound.move();
    draw();
  }
}

function rotate() {
  if (!canControl()) return;
  const rotated = rotateMatrix(current.shape);
  // 壁蹴りなし:回せなければそのまま(仕様どおり)
  if (!collides(rotated, current.x, current.y)) {
    current.shape = rotated;
    onSuccessfulMove();
    Sound.rotate();
    draw();
  }
}

function softDrop() {
  if (!canControl()) return;
  if (!collides(current.shape, current.x, current.y + 1)) {
    current.y += 1;
    dropTimer = 0;
    Sound.move();
    draw();
  } else {
    // これ以上下がれない → 着地扱い(すぐには固定しない)
    startLanding();
  }
}

// 横移動・回転が成功したとき:着地状態を見直す
function onSuccessfulMove() {
  if (collides(current.shape, current.x, current.y + 1)) {
    // まだ着地中:ロックディレイをリセット(回数制限あり)
    if (landed && lockResets < MAX_LOCK_RESET) {
      lockTimer = 0;
      lockResets++;
    } else if (!landed) {
      startLanding();
    }
  } else {
    // 下に空きができた → 着地解除
    landed = false;
    lockTimer = 0;
  }
}

function startLanding() {
  if (!landed) {
    landed = true;
    lockTimer = 0;
    lockResets = 0;
  }
}

function canControl() {
  return running && !paused && current;
}

// =========================================================
//  固定・ライン消し
// =========================================================
function lockPiece() {
  const { shape, x, y, type } = current;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const gy = y + r;
        const gx = x + c;
        if (gy >= 0) grid[gy][gx] = type;
      }
    }
  }
  Sound.lock();

  // そろった行を探す
  const fullRows = [];
  for (let r = 0; r < ROWS; r++) {
    if (grid[r].every(v => v)) fullRows.push(r);
  }

  if (fullRows.length > 0) {
    // 消去エフェクトを開始(演出が終わってから実際に消す)
    clearAnim = { rows: fullRows, elapsed: 0 };
    current = null;          // 演出中は操作させない
    Sound.line();
  } else {
    spawn();
  }
}

// エフェクト終了後に実際に行を消し、詰めて、次のミノを出す
function finishClear() {
  const rows = new Set(clearAnim.rows);
  const n = clearAnim.rows.length;
  const remaining = grid.filter((_, r) => !rows.has(r));
  while (remaining.length < ROWS) remaining.unshift(new Array(COLS).fill(0));
  grid = remaining;

  const points = [0, 100, 300, 500, 800];
  score += points[n];
  linesCleared += n;
  updateSpeed();
  updateScore();

  clearAnim = null;
  spawn();
}

// 速度の循環:ラインを消すごとに速くなり、上限で遅さに戻る
function updateSpeed() {
  const stepCount = Math.floor(linesCleared / LINES_PER_STEP);
  const cycleLength = Math.floor((BASE_INTERVAL - MIN_INTERVAL) / STEP) + 1;
  const phase = stepCount % cycleLength; // 0..cycleLength-1 を繰り返す
  dropInterval = BASE_INTERVAL - phase * STEP;
}

// =========================================================
//  スポーン / ゲームオーバー
// =========================================================
function spawn() {
  current = makePiece(nextType);
  nextType = randomType();
  landed = false;
  lockTimer = 0;
  lockResets = 0;
  dropTimer = 0;
  drawNext();

  // 出た瞬間に重なっていたらゲームオーバー
  if (collides(current.shape, current.x, current.y)) {
    gameOver();
  } else {
    draw();
  }
}

function gameOver() {
  running = false;
  current = null;
  Sound.gameover();
  finalScoreEl.textContent = score;
  gameoverScreen.classList.remove('hidden');
}

// =========================================================
//  描画
// =========================================================
function drawCell(ctx, x, y, color, size = cell) {
  const px = x * size;
  const py = y * size;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, size, size);
  // 立体感の枠(高コントラスト)
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(px, py, size, size * 0.16);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(px, py + size * 0.84, size, size * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
}

function draw() {
  if (!grid) return;
  const w = cell * COLS;
  const h = cell * ROWS;
  boardCtx.clearRect(0, 0, w, h);

  // 背景の薄いグリッド
  boardCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  boardCtx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    boardCtx.beginPath();
    boardCtx.moveTo(c * cell, 0);
    boardCtx.lineTo(c * cell, h);
    boardCtx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, r * cell);
    boardCtx.lineTo(w, r * cell);
    boardCtx.stroke();
  }

  // 固定されたブロック
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) drawCell(boardCtx, c, r, COLORS[grid[r][c]]);
    }
  }

  // 操作中のミノ
  if (current) {
    const { shape, x, y, type } = current;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] && y + r >= 0) {
          drawCell(boardCtx, x + c, y + r, COLORS[type]);
        }
      }
    }
  }
}

function drawNext() {
  const size = nextCell * 4;
  nextCtx.clearRect(0, 0, size, size);
  const shape = SHAPES[nextType];
  const offX = (4 - shape[0].length) / 2;
  const offY = (4 - shape.length) / 2;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) drawCell(nextCtx, offX + c, offY + r, COLORS[nextType], nextCell);
    }
  }
}

// ライン消去の演出:光るバーが点滅しながら中央に縮んで消える(達成感)
function drawClearing() {
  draw(); // 下地(盤面)を描く
  const w = cell * COLS;
  const t = Math.min(clearAnim.elapsed / CLEAR_DURATION, 1);
  const blink = (Math.floor(clearAnim.elapsed / 55) % 2 === 0) ? 1 : 0.35; // 点滅
  boardCtx.save();
  boardCtx.shadowColor = '#FFFFFF';
  boardCtx.shadowBlur = 26 * (1 - t);
  for (const r of clearAnim.rows) {
    const cy = r * cell + cell / 2;
    const h = cell * (1 - t * 0.85);            // だんだん縮む
    boardCtx.fillStyle = `rgba(255,255,255,${0.55 + 0.4 * blink})`;
    boardCtx.fillRect(0, cy - h / 2, w, h);
  }
  boardCtx.restore();
}

function updateScore() {
  scoreEl.textContent = score;
}

// =========================================================
//  メインループ
// =========================================================
function loop(time) {
  if (running && !paused) {
    const delta = time - lastTime;
    lastTime = time;

    if (clearAnim) {
      // ライン消去の演出中:落下は止めて演出を進める
      clearAnim.elapsed += delta;
      drawClearing();
      if (clearAnim.elapsed >= CLEAR_DURATION) {
        finishClear();
      }
    } else if (landed) {
      // 着地中:ロックディレイを数える
      lockTimer += delta;
      if (lockTimer >= LOCK_DELAY) {
        // まだ本当に下がれないなら固定
        if (collides(current.shape, current.x, current.y + 1)) {
          lockPiece();
        } else {
          landed = false;
          lockTimer = 0;
        }
      }
    } else {
      // 通常落下
      dropTimer += delta;
      if (dropTimer >= dropInterval) {
        dropTimer = 0;
        if (!collides(current.shape, current.x, current.y + 1)) {
          current.y += 1;
          draw();
        } else {
          startLanding();
        }
      }
    }
  } else {
    lastTime = time;
  }
  requestAnimationFrame(loop);
}

// =========================================================
//  ゲーム開始・一時停止
// =========================================================
function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function newGame() {
  grid = emptyGrid();
  score = 0;
  linesCleared = 0;
  dropInterval = BASE_INTERVAL;
  dropTimer = 0;
  lockTimer = 0;
  lockResets = 0;
  landed = false;
  paused = false;
  running = true;
  clearAnim = null;
  nextType = randomType();
  updateScore();
  spawn();
}

function startGame() {
  Sound.init();
  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  newGame();
}

function togglePause(force) {
  if (!running) return;
  const wantPause = (force === undefined) ? !paused : force;
  if (wantPause === paused) return;
  paused = wantPause;
  if (paused) {
    pauseScreen.classList.remove('hidden');
  } else {
    pauseScreen.classList.add('hidden');
    lastTime = performance.now();
  }
}

// =========================================================
//  効果音(Web Audio でシンプルなビープ)
// =========================================================
const Sound = {
  ctx: null,
  muted: false,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, type = 'square', vol = 0.15) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  move()   { this.beep(220, 0.05); },
  rotate() { this.beep(330, 0.06); },
  lock()   { this.beep(160, 0.08); },
  line()   { this.beep(523, 0.12); setTimeout(() => this.beep(784, 0.14), 90); },
  gameover(){ this.beep(200, 0.3, 'sawtooth'); setTimeout(() => this.beep(120, 0.4, 'sawtooth'), 150); },
};

// =========================================================
//  入力(ボタン=タップ1回で1マス)
// =========================================================
function bindTap(id, handler) {
  const el = document.getElementById(id);
  // pointerdown で反応(押した瞬間=キビキビ)。既定動作は抑制
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handler();
  });
}

// 押しっぱなしで一定間隔ごとに繰り返す(下ボタン用)
function bindHold(id, handler, interval) {
  const el = document.getElementById(id);
  let timer = null;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handler();                       // 押した瞬間に1マス
    stop();
    timer = setInterval(handler, interval);
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
  window.addEventListener('pointerup', stop);
  window.addEventListener('blur', stop);
}

bindTap('btn-left',   () => move(-1));
bindTap('btn-right',  () => move(1));
bindTap('btn-rotate', () => rotate());
bindHold('btn-down',  softDrop, 140); // 押しっぱなしで連続落下(ゆっくりめ)

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', () => togglePause(false));
document.getElementById('pause-btn').addEventListener('click', () => togglePause());

document.getElementById('mute-btn').addEventListener('click', (e) => {
  Sound.muted = !Sound.muted;
  e.currentTarget.textContent = Sound.muted ? '🔇' : '🔊';
});

// キーボードでも操作可(パソコンでの確認用)
window.addEventListener('keydown', (e) => {
  if (!running) return;
  switch (e.key) {
    case 'ArrowLeft':  move(-1); break;
    case 'ArrowRight': move(1); break;
    case 'ArrowUp':    rotate(); break;
    case 'ArrowDown':  softDrop(); break;
    case ' ':          togglePause(); e.preventDefault(); break;
  }
});

// バックグラウンドに移ったら自動で一時停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden) togglePause(true);
});

window.addEventListener('resize', setupCanvas);
window.addEventListener('orientationchange', setupCanvas);

// =========================================================
//  Service Worker 登録(PWA・オフライン対応)
// =========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 失敗しても通常どおり遊べる */ });
  });
}

// =========================================================
//  起動
// =========================================================
grid = emptyGrid();          // 盤面を先に用意(描画時のエラー防止)
setupCanvas();
requestAnimationFrame(loop);
