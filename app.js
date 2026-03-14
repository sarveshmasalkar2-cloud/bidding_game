/* ================================================================
   MASTERPIECE MARKET — app.js
   Full game logic: canvas, bidding, Supabase Realtime subscriptions
   ================================================================ */

// ================================================================
// SECTION 1: CONFIG — REPLACE THESE WITH YOUR SUPABASE CREDENTIALS
// ================================================================
const SUPABASE_URL = 'https://xswgwxtqsuacohyvvqdl.supabase.co';       // e.g. https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhzd2d3eHRxc3VhY29oeXZ2cWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDg3NTcsImV4cCI6MjA4OTA4NDc1N30.E6_nb6VKH73MDYHWqpdmUHXYF0_UIXRV5yF9FgpQQ5E'; // your project's anon key

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================================================================
// SECTION 2: DRAWING PROMPTS
// ================================================================
const PROMPTS = [
  "A penguin leading a revolution",
  "A haunted birthday cake",
  "An astronaut herding cats on Mars",
  "A dragon terrified of fire",
  "The world's worst superhero",
  "A mermaid at a job interview",
  "Two bears starting a restaurant",
  "A robot experiencing its first sunset",
  "A wizard who forgot their spell",
  "A snail winning the Olympics",
  "A skyscraper made entirely of cheese",
  "A dog running for president",
  "A ghost who is afraid of humans",
  "Time travel gone horribly wrong",
  "A pirate who hates the ocean",
  "A very confused time traveler",
  "Bigfoot opening a yoga studio",
  "A medieval knight using a smartphone",
  "A fish trying to climb a tree",
  "The last doughnut on Earth",
  "A cactus attending a pool party",
  "A vampire who only drinks orange juice",
  "A very polite tornado",
  "An ant lifting a car",
];

// ================================================================
// SECTION 3: COLOR PALETTE
// ================================================================
const COLORS = [
  // Row 1: Reds & Oranges
  '#e63946', '#f4722b', '#ff9f1c', '#f7c59f',
  // Row 2: Yellows & Greens
  '#ffdd00', '#9bc53d', '#2dc653', '#1db954',
  // Row 3: Blues & Purples
  '#0077b6', '#00b4d8', '#9b5de5', '#f15bb5',
  // Row 4: Pastels
  '#ffc8dd', '#ffafcc', '#bde0fe', '#cdb4db',
  // Row 5: Neutrals
  '#ffffff', '#d0cfc9', '#8d8d8d', '#4a4a4a',
  // Row 6: Earth & Dark
  '#8b4513', '#5c3317', '#1a1a2e', '#000000',
];

// ================================================================
// SECTION 4: APP STATE
// ================================================================
const state = {
  // Player info
  nickname:     '',
  roomId:       null,
  roomCode:     '',
  playerId:     null,
  isHost:       false,
  balance:      1000,

  // Room settings
  settings: {
    maxPlayers:   4,
    drawTime:     60,
    bidTime:      30,
    startBalance: 1000,
  },

  // Game flow
  currentRoom:           null,  // Full room row from DB
  currentDrawings:       [],    // All drawings for this room
  currentAuctionDrawing: null,  // The drawing currently being auctioned
  auctionOrder:          [],    // Array of drawing IDs in auction order

  // Drawing canvas
  canvasZoom:   1,
  currentColor: '#000000',
  currentTool:  'brush',    // brush | bucket | eraser-pixel | eraser-line
  brushSize:    6,
  isDrawing:    false,
  lastX:        0,
  lastY:        0,
  historyStack: [],         // For undo
  MAX_HISTORY:  20,

  // Timers (host-side)
  drawTimerInterval:  null,
  drawTimeLeft:       60,
  bidTimerInterval:   null,
  bidTimeLeft:        30,
  promptCountdown:    null,
};

let realtimeChannel = null;

// ================================================================
// SECTION 5: PAGE NAVIGATION
// ================================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.remove('hidden');
    // Trigger reflow before adding active for CSS transition
    requestAnimationFrame(() => target.classList.add('active'));
  }
}

// ================================================================
// SECTION 6: UTILITY HELPERS
// ================================================================
function showLoading(text = 'Loading…') {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = text;
  el.classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, duration);
}

function formatMoney(n) {
  return '$' + Number(n).toLocaleString();
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // omit I and O (confusing)
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ================================================================
// SECTION 7: PAGE 1 — LANDING
// ================================================================
const nicknameInput = document.getElementById('nickname-input');
const btnEnter      = document.getElementById('btn-enter');

nicknameInput.addEventListener('input', () => {
  const val = nicknameInput.value.trim();
  btnEnter.disabled = val.length < 1 || val.length > 20;
  state.nickname = val;
});

btnEnter.addEventListener('click', () => {
  if (!state.nickname) return;
  // Remember nickname across sessions
  try { localStorage.setItem('mm_nickname', state.nickname); } catch(e) {}
  generateAndShowCode();
  showPage('page-2');
});

// ================================================================
// SECTION 8: PAGE 2 — GATEWAY (Create / Join)
// ================================================================
function generateAndShowCode() {
  state.roomCode = generateCode();
  document.getElementById('generated-code').textContent = state.roomCode;
}

// Sliders
document.getElementById('slider-players').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  state.settings.maxPlayers = v;
  document.getElementById('val-players').textContent = v;
});
document.getElementById('slider-time').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  state.settings.drawTime = v;
  document.getElementById('val-time').textContent = v + 's';
});
document.getElementById('slider-bidtime').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  state.settings.bidTime = v;
  document.getElementById('val-bidtime').textContent = v + 's';
});
document.getElementById('slider-money').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  state.settings.startBalance = v;
  document.getElementById('val-money').textContent = formatMoney(v);
});

// ── CREATE ROOM ──────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', async () => {
  showLoading('Creating your room…');
  try {
    // Insert room
    const { data: room, error: roomErr } = await db
      .from('rooms')
      .insert({
        code:          state.roomCode,
        host_nickname: state.nickname,
        game_state:    'lobby',
        settings: {
          maxPlayers:   state.settings.maxPlayers,
          drawTime:     state.settings.drawTime,
          bidTime:      state.settings.bidTime,
          startBalance: state.settings.startBalance,
        },
      })
      .select()
      .single();

    if (roomErr) throw roomErr;
    state.roomId = room.id;

    // Insert host as player
    const { data: player, error: playerErr } = await db
      .from('players')
      .insert({
        room_id:  room.id,
        nickname: state.nickname,
        is_host:  true,
        balance:  state.settings.startBalance,
      })
      .select()
      .single();

    if (playerErr) throw playerErr;
    state.playerId = player.id;
    state.isHost   = true;
    state.balance  = state.settings.startBalance;

    hideLoading();
    initWaitingRoom();
  } catch (err) {
    hideLoading();
    showToast('Error: ' + err.message);
    console.error(err);
  }
});

// ── JOIN ROOM ────────────────────────────────────────────────────
const joinInput = document.getElementById('join-input');
const btnJoin   = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');

joinInput.addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  btnJoin.disabled = e.target.value.length !== 4;
  joinError.classList.add('hidden');
});

btnJoin.addEventListener('click', async () => {
  const code = joinInput.value.trim().toUpperCase();
  showLoading('Joining room…');
  try {
    // Find room
    const { data: room, error: roomErr } = await db
      .from('rooms')
      .select('*')
      .eq('code', code)
      .single();

    if (roomErr || !room) throw new Error('Room not found.');
    if (room.game_state !== 'lobby') throw new Error('Game already started.');

    const maxP = room.settings?.maxPlayers || 4;

    // Check player count
    const { count } = await db
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id);

    if (count >= maxP) throw new Error('Room is full!');

    // Check nickname isn't taken
    const { data: existing } = await db
      .from('players')
      .select('id')
      .eq('room_id', room.id)
      .eq('nickname', state.nickname)
      .maybeSingle();

    if (existing) throw new Error('Nickname already taken in this room.');

    // Join as player
    const { data: player, error: playerErr } = await db
      .from('players')
      .insert({
        room_id:  room.id,
        nickname: state.nickname,
        is_host:  false,
        balance:  room.settings?.startBalance || 1000,
      })
      .select()
      .single();

    if (playerErr) throw playerErr;

    state.roomId   = room.id;
    state.roomCode = room.code;
    state.playerId = player.id;
    state.isHost   = false;
    state.balance  = player.balance;
    Object.assign(state.settings, room.settings);

    hideLoading();
    initWaitingRoom();
  } catch (err) {
    hideLoading();
    joinError.textContent = err.message;
    joinError.classList.remove('hidden');
    console.error(err);
  }
});

// ================================================================
// SECTION 9: PAGE 3 — WAITING ROOM
// ================================================================
async function initWaitingRoom() {
  showPage('page-3');
  document.getElementById('waiting-code').textContent = state.roomCode;
  document.getElementById('players-max').textContent  = state.settings.maxPlayers;

  await refreshPlayerList();
  subscribeToRoom();
}

async function refreshPlayerList() {
  const { data: players } = await db
    .from('players')
    .select('nickname, is_host')
    .eq('room_id', state.roomId)
    .order('created_at');

  document.getElementById('players-joined').textContent = players?.length || 1;

  const list = document.getElementById('player-list');
  list.innerHTML = '';
  players?.forEach(p => {
    const li = document.createElement('li');
    if (p.is_host) li.classList.add('is-host');
    li.textContent = p.nickname;
    list.appendChild(li);
  });

  // Show start button for host when enough players have joined
  const startBtn = document.getElementById('btn-host-start');
  if (state.isHost && players?.length >= state.settings.maxPlayers) {
    startBtn.classList.remove('hidden');
    document.getElementById('waiting-hint').textContent = 'Everyone is here! You can start.';
  } else {
    startBtn.classList.add('hidden');
  }
}

document.getElementById('btn-host-start').addEventListener('click', async () => {
  await hostStartGame();
});

// ================================================================
// SECTION 10: SUPABASE REALTIME SUBSCRIPTIONS
// ================================================================
function subscribeToRoom() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
  }

  realtimeChannel = db
    .channel('room-' + state.roomId)

    // Watch for room state changes
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${state.roomId}`,
    }, (payload) => {
      handleRoomUpdate(payload.new);
    })

    // Watch for new players joining
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'players',
      filter: `room_id=eq.${state.roomId}`,
    }, () => {
      refreshPlayerList();
    })

    // Watch for new drawings submitted
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'drawings',
      filter: `room_id=eq.${state.roomId}`,
    }, (payload) => {
      handleDrawingSubmitted(payload.new);
    })

    // Watch for bids (host uses this to know when all players have bid)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'bids',
      filter: `room_id=eq.${state.roomId}`,
    }, (payload) => {
      handleBidReceived(payload.new);
    })

    .subscribe((status) => {
      console.log('Realtime status:', status);
    });
}

// ================================================================
// SECTION 11: ROOM STATE MACHINE — Handle server-side state changes
// ================================================================
async function handleRoomUpdate(room) {
  state.currentRoom = room;

  // Sync settings from room
  if (room.settings) {
    Object.assign(state.settings, room.settings);
  }

  console.log('Room state →', room.game_state, '| auction phase →', room.auction_phase);

  // ── LOBBY ────────────────────────────────────────────────────
  if (room.game_state === 'lobby') {
    refreshPlayerList();
    return;
  }

  // ── PROMPT ───────────────────────────────────────────────────
  if (room.game_state === 'prompt') {
    transitionToPrompt(room.current_prompt);
    return;
  }

  // ── DRAWING ──────────────────────────────────────────────────
  if (room.game_state === 'drawing') {
    transitionToStudio(room.current_prompt);
    return;
  }

  // ── AUCTION ──────────────────────────────────────────────────
  if (room.game_state === 'auction') {
    state.auctionOrder = room.drawing_order || [];

    if (room.auction_phase === 'reveal') {
      await transitionToAuctionReveal(room.current_auction_index);
    } else if (room.auction_phase === 'bidding') {
      startBiddingPhase();
    } else if (room.auction_phase === 'next') {
      // Host silently resolved bids, move straight to next lot or results
      // Non-host clients just wait for the next reveal/results update
    }
    return;
  }

  // ── RESULTS ──────────────────────────────────────────────────
  if (room.game_state === 'results') {
    transitionToResults();
    return;
  }
}

// ================================================================
// SECTION 12: HOST GAME CONTROLS
// ================================================================

// ── STEP 1: HOST STARTS GAME → assign unique prompt per player, push 'prompt' state ──
async function hostStartGame() {
  // Fetch all players in the room
  const { data: players } = await db
    .from('players')
    .select('id, nickname')
    .eq('room_id', state.roomId);

  if (!players?.length) { showToast('No players found!'); return; }

  // Shuffle prompts pool and assign one unique prompt to each player
  const shuffled = shuffleArray([...PROMPTS]);
  const promptMap = {}; // { nickname: prompt }
  players.forEach((p, i) => {
    promptMap[p.nickname] = shuffled[i % shuffled.length];
  });

  const { error } = await db
    .from('rooms')
    .update({
      game_state:       'prompt',
      // Store all per-player prompts as JSON so everyone's client can look up theirs
      current_prompt:   JSON.stringify(promptMap),
    })
    .eq('id', state.roomId);

  if (error) { showToast('Error starting game.'); console.error(error); }
}

// ── STEP 2: HOST STARTS DRAWING PHASE after prompt countdown ─────
async function hostStartDrawing() {
  const { error } = await db
    .from('rooms')
    .update({ game_state: 'drawing' })
    .eq('id', state.roomId);

  if (error) console.error(error);
}

// ── STEP 3: HOST STARTS AUCTION after drawings are in ─────────────
async function hostStartAuction() {
  // Fetch all drawings for this room
  const { data: drawings, error } = await db
    .from('drawings')
    .select('id')
    .eq('room_id', state.roomId);

  if (error || !drawings?.length) {
    showToast('No drawings found!');
    return;
  }

  // Shuffle order
  const order = shuffleArray(drawings.map(d => d.id));

  const { error: updateErr } = await db
    .from('rooms')
    .update({
      game_state:            'auction',
      drawing_order:          order,
      current_auction_index:  0,
      auction_phase:         'reveal',
    })
    .eq('id', state.roomId);

  if (updateErr) console.error(updateErr);
}

// ── STEP 4: HOST ADVANCES to next auction lot ─────────────────────
async function hostNextLot() {
  const room = state.currentRoom;
  const nextIndex = (room.current_auction_index || 0) + 1;

  if (nextIndex >= (room.drawing_order?.length || 0)) {
    // All lots done → results
    await hostEndGame();
    return;
  }

  const { error } = await db
    .from('rooms')
    .update({
      current_auction_index: nextIndex,
      auction_phase:         'reveal',
    })
    .eq('id', state.roomId);

  if (error) console.error(error);
}

// ── STEP 5: HOST ENDS GAME → results ─────────────────────────────
async function hostEndGame() {
  const { error } = await db
    .from('rooms')
    .update({ game_state: 'results' })
    .eq('id', state.roomId);

  if (error) console.error(error);
}

// ── HOST: resolve bids for current lot, then advance ──────────────
async function hostResolveBids(drawingId) {
  try {
    const { data: bids, error: bidsErr } = await db
      .from('bids')
      .select('*')
      .eq('drawing_id', drawingId)
      .order('amount', { ascending: false });

    if (bidsErr) throw bidsErr;

    let winnerNickname = null;
    let winningBid     = 0;

    if (bids && bids.length > 0) {
      const top      = bids[0];
      winnerNickname = top.player_nickname;
      winningBid     = top.amount;

      // Fetch winner's current balance
      const { data: winnerPlayer } = await db
        .from('players')
        .select('id, balance, won_painting_ids')
        .eq('room_id', state.roomId)
        .eq('nickname', winnerNickname)
        .single();

      if (winnerPlayer) {
        const newBalance     = Math.max(0, winnerPlayer.balance - winningBid);
        const newPaintingIds = [...(winnerPlayer.won_painting_ids || []), drawingId];
        await db
          .from('players')
          .update({ balance: newBalance, won_painting_ids: newPaintingIds })
          .eq('id', winnerPlayer.id);
      }
    }

    // Update drawing record with winner
    await db
      .from('drawings')
      .update({ winner_nickname: winnerNickname, winning_bid: winningBid })
      .eq('id', drawingId);

    // No winner overlay — go straight to next lot
    bidsThisRound = 0;
    await hostNextLot();

  } catch (err) {
    console.error('Error resolving bids:', err);
  }
}

// ================================================================
// SECTION 13: PAGE 4 — PROMPT REVEAL
// ================================================================
function transitionToPrompt(promptData) {
  if (!promptData) return;

  // Only show prompt page if we're not already drawing
  const currentPage = document.querySelector('.page.active')?.id;
  if (currentPage === 'page-5') return;

  // promptData is a JSON string mapping nickname → prompt
  let myPrompt = promptData;
  try {
    const map = JSON.parse(promptData);
    if (map && typeof map === 'object') {
      myPrompt = map[state.nickname] || Object.values(map)[0] || promptData;
    }
  } catch(e) {
    // Plain string fallback
    myPrompt = promptData;
  }

  // Store for later use in studio
  state.myPrompt = myPrompt;

  showPage('page-4');
  document.getElementById('prompt-text').textContent = myPrompt;

  let count = 5;
  document.getElementById('prompt-countdown').textContent = count;

  clearInterval(state.promptCountdown);
  state.promptCountdown = setInterval(() => {
    count--;
    document.getElementById('prompt-countdown').textContent = count;
    if (count <= 0) {
      clearInterval(state.promptCountdown);
      if (state.isHost) {
        hostStartDrawing();
      }
    }
  }, 1000);
}

// ================================================================
// SECTION 14: PAGE 5 — STUDIO / DRAWING CANVAS
// ================================================================
let canvas, ctx;
let isMouseDown = false;

function transitionToStudio(promptData) {
  showPage('page-5');
  // Use the already-resolved per-player prompt if available
  const prompt = state.myPrompt || promptData || 'Draw something!';
  document.getElementById('studio-prompt-display').textContent = prompt;
  document.getElementById('studio-balance').textContent = formatMoney(state.balance);

  initCanvas();
  buildColorPalette();
  startDrawTimer();

  // Enable submit button immediately (they can submit early)
  document.getElementById('btn-submit-drawing').disabled = false;
  document.getElementById('submit-status').textContent = '';
}

// ── Canvas Init ───────────────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById('drawing-canvas');
  ctx    = canvas.getContext('2d');

  // Compute canvas size from its container
  const frame    = canvas.closest('.ornate-frame');
  const maxW     = frame.clientWidth  - 108; // account for frame.png padding (54px each side)
  const maxH     = frame.clientHeight - 96;  // account for frame.png padding (48px each side)
  // Fall back to sensible defaults if the frame isn't sized yet
  const cw = Math.max(300, Math.min(maxW || 500, 600));
  const ch = Math.round(cw * 0.75); // 4:3 ratio

  canvas.width  = cw;
  canvas.height = ch;
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);

  saveHistory();
  setupCanvasEvents();
}

// ── Canvas History (Undo) ─────────────────────────────────────────
function saveHistory() {
  if (state.historyStack.length >= state.MAX_HISTORY) {
    state.historyStack.shift();
  }
  state.historyStack.push(canvas.toDataURL());
}

document.getElementById('btn-undo').addEventListener('click', () => {
  if (state.historyStack.length <= 1) return;
  state.historyStack.pop(); // remove current
  const prev = state.historyStack[state.historyStack.length - 1];
  const img  = new Image();
  img.onload = () => { ctx.drawImage(img, 0, 0); };
  img.src    = prev;
});

document.getElementById('btn-clear').addEventListener('click', () => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveHistory();
});

// ── Zoom ──────────────────────────────────────────────────────────
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  state.canvasZoom = Math.min(state.canvasZoom + 0.25, 3);
  applyZoom();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  state.canvasZoom = Math.max(state.canvasZoom - 0.25, 0.5);
  applyZoom();
});
function applyZoom() {
  const frame = canvas.closest('.ornate-frame');
  if (frame) {
    canvas.style.transform       = `scale(${state.canvasZoom})`;
    canvas.style.transformOrigin = 'top left';
  }
}

// ── Color Palette ─────────────────────────────────────────────────
function buildColorPalette() {
  const palette = document.getElementById('color-palette');
  palette.innerHTML = '';
  COLORS.forEach(hex => {
    const swatch = document.createElement('button');
    swatch.className   = 'color-swatch';
    swatch.style.background = hex;
    swatch.title       = hex;
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      state.currentColor = hex;
      state.currentTool  = (state.currentTool === 'eraser') ? 'pencil' : state.currentTool;
      updateBrushPreview();
    });
    if (hex === state.currentColor) swatch.classList.add('active');
    palette.appendChild(swatch);
  });
}

// ── Brush Tool Buttons ────────────────────────────────────────────
document.querySelectorAll('.brush-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.brush-tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentTool = btn.dataset.tool;
    // Cursor hint
    if (state.currentTool === 'bucket')       canvas && (canvas.style.cursor = 'cell');
    else if (state.currentTool === 'eraser-line') canvas && (canvas.style.cursor = 'not-allowed');
    else                                       canvas && (canvas.style.cursor = 'crosshair');
  });
});

// ── Brush Size Slider ─────────────────────────────────────────────
document.getElementById('brush-size-slider').addEventListener('input', e => {
  state.brushSize = parseInt(e.target.value);
  updateBrushPreview();
});
function updateBrushPreview() {
  const preview = document.getElementById('brush-preview');
  const size    = Math.min(state.brushSize, 36);
  const isEraser = state.currentTool === 'eraser-pixel' || state.currentTool === 'eraser-line';
  preview.style.width  = size + 'px';
  preview.style.height = size + 'px';
  preview.style.background = isEraser ? '#ffffff' : state.currentColor;
  preview.style.border = isEraser ? '1px solid #aaa' : 'none';
}

// ── Canvas Mouse + Touch Events ───────────────────────────────────
function setupCanvasEvents() {
  // Mouse
  canvas.addEventListener('mousedown',  onPointerDown);
  canvas.addEventListener('mousemove',  onPointerMove);
  canvas.addEventListener('mouseup',    onPointerUp);
  canvas.addEventListener('mouseleave', onPointerUp);

  // Touch
  canvas.addEventListener('touchstart',  e => { e.preventDefault(); onPointerDown(touchToMouse(e)); }, { passive: false });
  canvas.addEventListener('touchmove',   e => { e.preventDefault(); onPointerMove(touchToMouse(e)); }, { passive: false });
  canvas.addEventListener('touchend',    e => { e.preventDefault(); onPointerUp(); });
  canvas.addEventListener('touchcancel', e => { e.preventDefault(); onPointerUp(); });
}

function touchToMouse(e) {
  const touch  = e.touches[0];
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / (rect.width  / state.canvasZoom);
  const scaleY = canvas.height / (rect.height / state.canvasZoom);
  return {
    offsetX: (touch.clientX - rect.left) / state.canvasZoom * scaleX,
    offsetY: (touch.clientY - rect.top)  / state.canvasZoom * scaleY,
  };
}

function getCanvasXY(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / (rect.width  / state.canvasZoom);
  const scaleY = canvas.height / (rect.height / state.canvasZoom);
  return {
    x: (e.offsetX !== undefined ? e.offsetX : e.clientX - rect.left) / state.canvasZoom * scaleX,
    y: (e.offsetY !== undefined ? e.offsetY : e.clientY - rect.top)  / state.canvasZoom * scaleY,
  };
}

// ── Line Eraser State ─────────────────────────────────────────────
// Stores the pixel positions the eraser crossed during a drag gesture.
// On pointer-up we scan each history snapshot to find which strokes
// overlap those pixels and restore the last snapshot that doesn't.
// Simpler & more reliable: we just erase the thick region under the
// eraser path by painting white along it with a wide brush.
let lineEraserPath = [];

function onPointerDown(e) {
  isMouseDown = true;
  const { x, y } = getCanvasXY(e);
  state.lastX = x;
  state.lastY = y;

  if (state.currentTool === 'bucket') {
    floodFill(Math.round(x), Math.round(y), state.currentColor);
    saveHistory();
    return;
  }

  if (state.currentTool === 'eraser-line') {
    // Start collecting the eraser path
    lineEraserPath = [{ x, y }];
    return;
  }

  // Normal drawing start
  ctx.beginPath();
  applyBrushSettings();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 0.1, y + 0.1);
  ctx.stroke();
}

function onPointerMove(e) {
  if (!isMouseDown) return;
  const { x, y } = getCanvasXY(e);

  if (state.currentTool === 'bucket') return;

  if (state.currentTool === 'eraser-line') {
    lineEraserPath.push({ x, y });
    // Draw a faint red highlight so the user can see what they're erasing
    ctx.save();
    ctx.strokeStyle = 'rgba(255,80,80,0.35)';
    ctx.lineWidth   = state.brushSize * 3;
    ctx.lineCap     = 'round';
    ctx.shadowBlur  = 0;
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
    state.lastX = x;
    state.lastY = y;
    return;
  }

  if (state.currentTool === 'eraser-pixel') {
    ctx.beginPath();
    applyBrushSettings();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    state.lastX = x;
    state.lastY = y;
    return;
  }

  // Normal brush
  ctx.beginPath();
  applyBrushSettings();
  ctx.moveTo(state.lastX, state.lastY);
  ctx.lineTo(x, y);
  ctx.stroke();

  state.lastX = x;
  state.lastY = y;
}

function onPointerUp() {
  if (!isMouseDown) return;
  isMouseDown = false;

  if (state.currentTool === 'eraser-line' && lineEraserPath.length > 1) {
    applyLineEraser();
    lineEraserPath = [];
    return;
  }

  saveHistory();
}

// ── Line Eraser: erase entire strokes that were crossed ────────────
// Strategy: walk backward through history snapshots.
// For each snapshot, check if ANY pixel under our eraser path changed
// color compared to an even older snapshot — meaning a stroke was laid
// there. We find the deepest snapshot where those pixels are "clean"
// and restore from there, effectively deleting the stroke.
// For simplicity we do a fast version: paint a thick white line along
// the eraser path (same as pixel eraser but much wider), then saveHistory.
// This reliably "cuts through" any strokes the user dragged over,
// which visually matches the Notability-style line eraser behavior.
function applyLineEraser() {
  // Paint opaque white along the recorded eraser path
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = Math.max(state.brushSize * 4, 20); // wide enough to cut full stroke
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowBlur  = 0;

  ctx.beginPath();
  ctx.moveTo(lineEraserPath[0].x, lineEraserPath[0].y);
  for (let i = 1; i < lineEraserPath.length; i++) {
    ctx.lineTo(lineEraserPath[i].x, lineEraserPath[i].y);
  }
  ctx.stroke();
  ctx.restore();

  saveHistory();
}

function applyBrushSettings() {
  let size  = state.brushSize;
  let color = state.currentColor;
  let cap   = 'round';
  let blur  = 0;

  switch (state.currentTool) {
    case 'brush':
      // Normal brush — smooth, slightly soft
      blur = 0.8;
      break;
    case 'eraser-pixel':
      // Pixel eraser — white paint
      color = '#ffffff';
      size  = state.brushSize * 1.5;
      break;
    case 'eraser-line':
      // Line eraser draws in white too during stroke,
      // but the actual line-delete logic is in onPointerUp
      color = 'rgba(255,255,255,0)'; // invisible during drag
      size  = state.brushSize;
      break;
    // bucket handled separately, no brush settings needed
  }

  ctx.strokeStyle  = color;
  ctx.lineWidth    = size;
  ctx.lineCap      = cap;
  ctx.lineJoin     = 'round';
  ctx.shadowBlur   = blur;
  ctx.shadowColor  = blur > 0 ? color : 'transparent';
  ctx.globalAlpha  = 1;
}

// ── Flood Fill (Bucket Tool) ──────────────────────────────────────
function floodFill(startX, startY, fillHex) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data    = imgData.data;
  const w       = canvas.width;
  const h       = canvas.height;

  // Get target color at click position
  const idx     = (startY * w + startX) * 4;
  const tr = data[idx], tg = data[idx+1], tb = data[idx+2], ta = data[idx+3];

  // Parse fill color
  const fillRGB  = hexToRGB(fillHex);
  const fr = fillRGB[0], fg = fillRGB[1], fb = fillRGB[2];

  // Don't fill if already the same color
  if (tr === fr && tg === fg && tb === fb) return;

  const tolerance = 30; // how similar colors need to be to get filled

  function colorMatch(i) {
    return Math.abs(data[i]   - tr) <= tolerance &&
           Math.abs(data[i+1] - tg) <= tolerance &&
           Math.abs(data[i+2] - tb) <= tolerance &&
           Math.abs(data[i+3] - ta) <= tolerance;
  }

  // BFS fill
  const queue   = [[startX, startY]];
  const visited = new Uint8Array(w * h);
  visited[startY * w + startX] = 1;

  while (queue.length > 0) {
    const [cx, cy] = queue.pop();
    const i = (cy * w + cx) * 4;

    if (!colorMatch(i)) continue;

    data[i]   = fr;
    data[i+1] = fg;
    data[i+2] = fb;
    data[i+3] = 255;

    const neighbors = [
      [cx-1, cy], [cx+1, cy],
      [cx, cy-1], [cx, cy+1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const ni = ny * w + nx;
        if (!visited[ni]) {
          visited[ni] = 1;
          queue.push([nx, ny]);
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

function hexToRGB(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1],16), parseInt(result[2],16), parseInt(result[3],16)]
    : [0, 0, 0];
}

// ── Draw Timer (Host Runs It) ─────────────────────────────────────
function startDrawTimer() {
  state.drawTimeLeft = state.settings.drawTime;
  const timerEl = document.getElementById('draw-timer');
  timerEl.textContent  = state.drawTimeLeft;
  timerEl.classList.remove('urgent');

  clearInterval(state.drawTimerInterval);
  state.drawTimerInterval = setInterval(() => {
    state.drawTimeLeft--;
    timerEl.textContent = state.drawTimeLeft;

    if (state.drawTimeLeft <= 10) timerEl.classList.add('urgent');

    if (state.drawTimeLeft <= 0) {
      clearInterval(state.drawTimerInterval);
      timerEl.textContent = '0';
      // Auto-submit if they haven't yet
      const submitBtn = document.getElementById('btn-submit-drawing');
      if (!submitBtn.disabled) {
        submitDrawing();
      }
    }
  }, 1000);
}

// ── Submit Drawing ────────────────────────────────────────────────
document.getElementById('btn-submit-drawing').addEventListener('click', submitDrawing);

let drawingSubmitted = false;

async function submitDrawing() {
  if (drawingSubmitted) return;
  drawingSubmitted = true;

  clearInterval(state.drawTimerInterval);

  const submitBtn = document.getElementById('btn-submit-drawing');
  const statusEl  = document.getElementById('submit-status');
  submitBtn.disabled  = true;
  statusEl.textContent = 'Compressing your masterpiece…';

  // Compress canvas to JPEG base64
  // Resize to max 480px wide for smaller payload
  const compCanvas  = document.createElement('canvas');
  const maxW        = 480;
  const ratio       = Math.min(maxW / canvas.width, 1);
  compCanvas.width  = Math.round(canvas.width  * ratio);
  compCanvas.height = Math.round(canvas.height * ratio);
  const compCtx     = compCanvas.getContext('2d');
  compCtx.drawImage(canvas, 0, 0, compCanvas.width, compCanvas.height);
  const imageData   = compCanvas.toDataURL('image/jpeg', 0.5); // 50% JPEG quality

  try {
    const prompt = document.getElementById('studio-prompt-display').textContent;

    const { error } = await db.from('drawings').insert({
      room_id:         state.roomId,
      player_id:       state.playerId,
      player_nickname: state.nickname,
      image_data:      imageData,
      prompt:          prompt,
      // secret_value is assigned automatically by Postgres DEFAULT
    });

    if (error) throw error;

    statusEl.textContent = '✅ Masterpiece submitted! Waiting for others…';
    drawingSubmitted = true;

    // Host: once submitted, check if everyone is in; if so, start auction
    if (state.isHost) {
      setTimeout(checkAllDrawingsIn, 1500);
    }

  } catch (err) {
    submitBtn.disabled   = false;
    drawingSubmitted     = false;
    statusEl.textContent = 'Error: ' + err.message;
    console.error(err);
  }
}

// Host checks if all players have submitted drawings
async function checkAllDrawingsIn() {
  const { count: playerCount } = await db
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', state.roomId);

  const { count: drawingCount } = await db
    .from('drawings')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', state.roomId);

  if (drawingCount >= playerCount) {
    await hostStartAuction();
  } else {
    // Check again in a few seconds
    setTimeout(checkAllDrawingsIn, 3000);
  }
}

function handleDrawingSubmitted(drawing) {
  console.log('Drawing submitted by:', drawing.player_nickname);
  showToast(drawing.player_nickname + ' submitted their painting!');
}

// ================================================================
// SECTION 15: PAGE 6 — AUCTION HALL
// ================================================================

// ── Transition to Auction → Reveal Phase ──────────────────────────
async function transitionToAuctionReveal(auctionIndex) {
  showPage('page-6');

  // Reset bidding UI
  document.getElementById('bid-controls').style.display = 'flex';
  document.getElementById('bid-locked-msg').classList.add('hidden');
  document.getElementById('bid-amount-input').value = '';
  document.getElementById('bid-amount-input').disabled = false;
  document.getElementById('btn-lock-bid').disabled = false;

  // Curtains closed while image loads
  const curtainL = document.getElementById('curtain-left');
  const curtainR = document.getElementById('curtain-right');
  curtainL.classList.remove('open');
  curtainR.classList.remove('open');

  // Update lot counter
  const totalLots = state.auctionOrder.length;
  document.getElementById('auction-round-display').textContent =
    `${auctionIndex + 1} / ${totalLots}`;

  // Update balance
  document.getElementById('auction-balance').textContent = formatMoney(state.balance);

  // Fetch the drawing for this lot
  const drawingId = state.auctionOrder[auctionIndex];
  if (!drawingId) return;

  const { data: drawing, error } = await db
    .from('drawings')
    .select('*')
    .eq('id', drawingId)
    .single();

  if (error || !drawing) { console.error('Drawing not found', error); return; }

  state.currentAuctionDrawing = drawing;

  // Load painting — artist stays anonymous until results
  document.getElementById('auction-painting').src = drawing.image_data;
  document.getElementById('artist-name').textContent = 'Mystery Artist';

  // Open curtains instantly after short image-load pause
  setTimeout(() => {
    curtainL.classList.add('open');
    curtainR.classList.add('open');

    // Host pushes bidding phase
    if (state.isHost) {
      db.from('rooms')
        .update({ auction_phase: 'bidding' })
        .eq('id', state.roomId)
        .then(() => {});
    }
  }, 400);
}

// ── Bidding Phase ─────────────────────────────────────────────────
function startBiddingPhase() {
  const bidTimeLeft_init = state.settings.bidTime || 30;
  let bidTimeLeft = bidTimeLeft_init;

  const bidTimerEl = document.getElementById('bid-timer');
  bidTimerEl.textContent = bidTimeLeft;
  bidTimerEl.classList.remove('urgent');

  // Balance display
  document.getElementById('auction-balance').textContent = formatMoney(state.balance);

  clearInterval(state.bidTimerInterval);
  state.bidTimerInterval = setInterval(async () => {
    bidTimeLeft--;
    bidTimerEl.textContent = bidTimeLeft;

    if (bidTimeLeft <= 10) bidTimerEl.classList.add('urgent');

    if (bidTimeLeft <= 0) {
      clearInterval(state.bidTimerInterval);
      bidTimerEl.textContent = '0';

      // Host resolves bids
      if (state.isHost && state.currentAuctionDrawing) {
        await hostResolveBids(state.currentAuctionDrawing.id);
      }
    }
  }, 1000);
}

// Bid counter: host tracks how many bids have come in
let bidsThisRound = 0;

function handleBidReceived(bid) {
  bidsThisRound++;
  console.log('Bid received from:', bid.player_nickname);

  if (state.isHost) {
    // If all players have bid, resolve early
    db.from('players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', state.roomId)
      .then(({ count }) => {
        if (bidsThisRound >= count) {
          clearInterval(state.bidTimerInterval);
          hostResolveBids(state.currentAuctionDrawing.id);
        }
      });
  }
}

// ── Lock Bid Button ───────────────────────────────────────────────
document.getElementById('btn-lock-bid').addEventListener('click', async () => {
  const amountRaw = document.getElementById('bid-amount-input').value;
  const amount    = parseInt(amountRaw) || 0;

  if (amount < 0) { showToast('Bid must be $0 or more.'); return; }
  if (amount > state.balance) { showToast("You can't bid more than your balance!"); return; }

  const drawing = state.currentAuctionDrawing;
  if (!drawing) return;

  document.getElementById('btn-lock-bid').disabled = true;
  document.getElementById('bid-amount-input').disabled = true;

  try {
    const { error } = await db.from('bids').upsert({
      room_id:         state.roomId,
      drawing_id:      drawing.id,
      player_id:       state.playerId,
      player_nickname: state.nickname,
      amount:          amount,
    }, { onConflict: 'drawing_id,player_id' });

    if (error) throw error;

    document.getElementById('bid-controls').style.display = 'none';
    document.getElementById('bid-locked-msg').classList.remove('hidden');
  } catch (err) {
    document.getElementById('btn-lock-bid').disabled = false;
    document.getElementById('bid-amount-input').disabled = false;
    showToast('Error placing bid: ' + err.message);
    console.error(err);
  }
});

// (winner overlay removed — results screen shows all paintings at end)

// ================================================================
// SECTION 16: PAGE 7 — RESULTS
// ================================================================
async function transitionToResults() {
  showPage('page-7');

  const { data: players } = await db
    .from('players')
    .select('*')
    .eq('room_id', state.roomId);

  const { data: drawings } = await db
    .from('drawings')
    .select('*')
    .eq('room_id', state.roomId);

  if (!players || !drawings) return;

  // Map drawing id → drawing row
  const drawingMap = {};
  drawings.forEach(d => { drawingMap[d.id] = d; });

  // Map player nickname → their drawn painting (they created it)
  const drawnByPlayer = {};
  drawings.forEach(d => { drawnByPlayer[d.player_nickname] = d; });

  // Calculate scores
  const scores = players.map(p => {
    const wonIds       = p.won_painting_ids || [];
    const paintingVal  = wonIds.reduce((sum, id) => sum + (drawingMap[id]?.secret_value || 0), 0);
    const total        = p.balance + paintingVal;
    const wonDrawings  = wonIds.map(id => drawingMap[id]).filter(Boolean);
    return { ...p, paintingVal, total, wonDrawings };
  }).sort((a, b) => b.total - a.total);

  const lb = document.getElementById('leaderboard');
  lb.innerHTML = '';

  scores.forEach((s, i) => {
    const medals  = ['🥇', '🥈', '🥉'];
    const rankTxt = medals[i] || `#${i + 1}`;
    const isMe    = s.nickname === state.nickname;

    // Their own drawn painting (what they created)
    const theirPainting = drawnByPlayer[s.nickname];

    // Paintings they WON at auction
    const wonImgHTML = s.wonDrawings.map(d => `
      <div class="lb-painting-frame" title="Painted by ${d.player_nickname} — True value: ${formatMoney(d.secret_value)}">
        <img class="lb-painting" src="${d.image_data}" alt="Won painting by ${d.player_nickname}">
        <div class="lb-painting-label">by ${d.player_nickname}</div>
      </div>
    `).join('');

    const li = document.createElement('li');
    li.style.animationDelay = (i * 0.12) + 's';
    li.innerHTML = `
      <span class="lb-rank ${i === 0 ? 'top-rank' : ''}">${rankTxt}</span>

      <div class="lb-info">
        <div class="lb-name">
          ${s.nickname}
          ${isMe ? '<span class="lb-you">← you</span>' : ''}
        </div>
        <div class="lb-breakdown">
          ${formatMoney(s.balance)} left &nbsp;+&nbsp; ${formatMoney(s.paintingVal)} in paintings
        </div>
        ${s.wonDrawings.length > 0 ? `<div class="lb-won-paintings">${wonImgHTML}</div>` : '<div class="lb-no-wins">No paintings won</div>'}
      </div>

      ${theirPainting ? `
        <div class="lb-their-art" title="What ${s.nickname} drew: ${theirPainting.prompt}">
          <div class="lb-painting-frame">
            <img class="lb-painting" src="${theirPainting.image_data}" alt="Drew by ${s.nickname}">
          </div>
          <div class="lb-art-caption">They drew</div>
        </div>
      ` : ''}

      <span class="lb-score">${formatMoney(s.total)}</span>
    `;
    lb.appendChild(li);
  });
}

// ================================================================
// SECTION 17: HELP MODAL
// ================================================================
document.getElementById('help-tab').addEventListener('click', () => {
  document.getElementById('help-modal').classList.remove('hidden');
});
document.getElementById('help-close').addEventListener('click', () => {
  document.getElementById('help-modal').classList.add('hidden');
});
document.getElementById('help-close-btn').addEventListener('click', () => {
  document.getElementById('help-modal').classList.add('hidden');
});

// ================================================================
// SECTION 18: ROOM CLEANUP
// Call this when the host leaves / game ends to delete all data.
// Cascade deletes handle players, drawings, bids automatically.
// ================================================================
async function destroyRoom() {
  if (!state.roomId || !state.isHost) return;
  try {
    await db.from('rooms').delete().eq('id', state.roomId);
    console.log('Room and all related data deleted.');
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Auto-cleanup when host closes/refreshes the tab
window.addEventListener('beforeunload', () => {
  if (state.isHost && state.roomId) {
    // Use sendBeacon for reliable fire-and-forget on tab close
    // Supabase REST DELETE via fetch won't complete on unload, but
    // we try anyway — add a scheduled cleanup job in Supabase for prod.
    destroyRoom();
  }
});

// ================================================================
// SECTION 19: INIT
// ================================================================
(function init() {
  showPage('page-1');

  // Restore last used nickname from localStorage
  try {
    const saved = localStorage.getItem('mm_nickname');
    if (saved) {
      nicknameInput.value  = saved;
      state.nickname       = saved;
      btnEnter.disabled    = false;
    }
  } catch(e) {}

  updateBrushPreview();
  console.log('🎨 Masterpiece Market ready.');
})();
