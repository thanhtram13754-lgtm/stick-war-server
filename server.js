// ══════════════════════════════════════════════════════════
// STICK WAR SERVER - Bản có Log Dashboard + Player Admin Panel
// ══════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'stick-war-ultimate-secret-key-2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'stickwar-admin-2026-doiKeyNay'; // ⚠️ ĐỔI KEY NÀY TRONG RENDER ENV!
const DATA_FILE = path.join(__dirname, 'data', 'players.json');
const LOGS_FILE = path.join(__dirname, 'data', 'logs.json');

app.use(cors());
app.use(express.json());

// ── Đảm bảo file dữ liệu tồn tại ──
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ players: [] }, null, 2));
}
ensureDataFile();

function ensureLogsFile() {
  const dir = path.dirname(LOGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
}
ensureLogsFile();

function readDB() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try { return JSON.parse(raw); } catch (e) { return { players: [] }; }
}
function writeDB(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function findPlayer(username) {
  const db = readDB();
  return db.players.find(p => p.username === username.toLowerCase());
}
function savePlayer(player) {
  const db = readDB();
  const idx = db.players.findIndex(p => p.username === player.username);
  if (idx >= 0) db.players[idx] = player; else db.players.push(player);
  writeDB(db);
}

function readLogs() {
  ensureLogsFile();
  try { return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8')); } catch (e) { return []; }
}
function writeLogs(logs) {
  const trimmed = logs.slice(-2000);
  fs.writeFileSync(LOGS_FILE, JSON.stringify(trimmed, null, 2));
}

const SENSITIVE_FIELDS = ['password', 'oldpassword', 'newpassword', 'passwordhash', 'token', 'authorization'];
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      clean[key] = '***ĐÃ_ẨN***';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      clean[key] = sanitize(obj[key]);
    } else {
      clean[key] = obj[key];
    }
  }
  return clean;
}

// ── Rank / Level logic ──
const RANKS = [
  { min: 0,    name: 'Bronze I',    icon: '🥉' },
  { min: 200,  name: 'Bronze II',   icon: '🥉' },
  { min: 450,  name: 'Silver I',    icon: '🥈' },
  { min: 800,  name: 'Silver II',   icon: '🥈' },
  { min: 1200, name: 'Gold I',      icon: '🥇' },
  { min: 1800, name: 'Gold II',     icon: '🥇' },
  { min: 2600, name: 'Platinum',    icon: '💠' },
  { min: 3600, name: 'Diamond',     icon: '💎' },
  { min: 5000, name: 'Master',      icon: '👑' },
  { min: 7000, name: 'Grandmaster', icon: '🔱' },
];
function calcRP(stats) {
  return (stats.totalKills || 0) * 5 + (stats.wins || 0) * 25 + Math.floor((stats.bestTime || 0) / 10) * 2;
}
function getRankByRP(rp) {
  let r = RANKS[0];
  for (const rank of RANKS) { if (rp >= rank.min) r = rank; else break; }
  return r;
}
function getPlayerLevel(stats) {
  return Math.max(1, Math.floor(((stats.totalKills || 0) * 2 + (stats.games || 0) * 5 + (stats.wins || 0) * 10) / 100) + 1);
}
function publicPlayer(p) {
  const { passwordHash, ...safe } = p;
  const rp = calcRP(p.stats || {});
  const rank = getRankByRP(rp);
  return { ...safe, rp, rank: { name: rank.name, icon: rank.icon }, level: getPlayerLevel(p.stats || {}) };
}
function createNewPlayer(username, passwordHash) {
  return {
    username: username.toLowerCase(),
    passwordHash,
    createdAt: Date.now(),
    id: Math.floor(Math.random() * 999999) + 1,
    profile: { name: username, avatar: '🧙' },
    coins: 0,
    stats: { games: 0, wins: 0, totalKills: 0, bestTime: 0, bestWave: 1, bestSpree: 0, bestDmg: 0 },
    history: [],
  };
}

// ── Middleware xác thực người dùng (JWT) ──
function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.username = decoded.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

// ── Middleware xác thực Admin ──
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Sai admin key. Không có quyền truy cập.' });
  }
  next();
}

// ── Middleware TỰ ĐỘNG LOG mọi request/response ──
app.use((req, res, next) => {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const duration = Date.now() - start;
    try {
      const logs = readLogs();
      logs.push({
        time: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        requestBody: sanitize(req.body),
        responseSummary: sanitize(
          typeof body === 'object' && body ? { ...body, player: body.player ? '(player data - đã lược bớt)' : undefined } : body
        ),
      });
      writeLogs(logs);
    } catch (e) { /* không để lỗi log làm hỏng response chính */ }
    return originalJson(body);
  };
  next();
});

// ══════════════════════════════════════════════════════════
// ROUTES - AUTH & PLAYER (chức năng gốc, không đổi)
// ══════════════════════════════════════════════════════════

app.get('/', (req, res) => res.json({ ok: true, message: 'Stick War server đang chạy.' }));
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin.' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Tên tài khoản 3-20 ký tự, chỉ gồm chữ/số/_' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });
    if (findPlayer(username)) return res.status(409).json({ error: 'Tên tài khoản đã tồn tại.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const player = createNewPlayer(username, passwordHash);
    savePlayer(player);

    const token = jwt.sign({ username: player.username }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, player: publicPlayer(player) });
  } catch (e) {
    console.error('Lỗi đăng ký:', e);
    res.status(500).json({ error: 'Lỗi server khi đăng ký: ' + e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin.' });

    const player = findPlayer(username);
    if (!player) return res.status(401).json({ error: 'Sai tên tài khoản hoặc mật khẩu.' });

    const ok = await bcrypt.compare(password, player.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Sai tên tài khoản hoặc mật khẩu.' });

    const token = jwt.sign({ username: player.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, player: publicPlayer(player) });
  } catch (e) {
    console.error('Lỗi đăng nhập:', e);
    res.status(500).json({ error: 'Lỗi server khi đăng nhập: ' + e.message });
  }
});

app.put('/api/auth/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 6 ký tự.' });

    const player = findPlayer(req.username);
    if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

    const ok = await bcrypt.compare(oldPassword, player.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' });

    player.passwordHash = await bcrypt.hash(newPassword, 10);
    savePlayer(player);
    res.json({ success: true });
  } catch (e) {
    console.error('Lỗi đổi mật khẩu:', e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  try {
    const db = readDB();
    const before = db.players.length;
    db.players = db.players.filter(p => p.username !== req.username);
    if (db.players.length === before) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    console.error('Lỗi xoá tài khoản:', e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

app.get('/api/player/me', requireAuth, (req, res) => {
  try {
    const player = findPlayer(req.username);
    if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    res.json(publicPlayer(player));
  } catch (e) {
    console.error('Lỗi lấy thông tin player:', e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

const AVATARS = ['🧙', '⚔️', '🦸', '🗡️', '🔱', '💀', '🧟', '🐉', '🦅', '🤺'];
app.put('/api/player/profile', requireAuth, (req, res) => {
  try {
    const { name, avatar } = req.body || {};
    const player = findPlayer(req.username);
    if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

    const cleanName = (name || '').trim().slice(0, 14) || 'Chiến Binh';
    const cleanAvatar = AVATARS.includes(avatar) ? avatar : (player.profile.avatar || '🧙');
    player.profile = { name: cleanName, avatar: cleanAvatar };
    savePlayer(player);
    res.json(publicPlayer(player));
  } catch (e) {
    console.error('Lỗi cập nhật hồ sơ:', e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

app.post('/api/player/battle-result', requireAuth, (req, res) => {
  try {
    const player = findPlayer(req.username);
    if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

    const r = req.body || {};
    const win = !!r.win;
    const level = Math.max(1, parseInt(r.level) || 1);
    const wave = Math.max(1, parseInt(r.wave) || 1);
    const kills = Math.max(0, parseInt(r.kills) || 0);
    const coinsEarned = Math.max(0, Math.min(100000, parseInt(r.coins) || 0));
    const time = Math.max(0, parseInt(r.time) || 0);
    const spree = Math.max(0, parseInt(r.spree) || 0);
    const dmg = Math.max(0, parseInt(r.dmg) || 0);

    player.coins = Math.max(0, (player.coins || 0) + coinsEarned);
    const st = player.stats;
    st.games = (st.games || 0) + 1;
    if (win) st.wins = (st.wins || 0) + 1;
    st.totalKills = (st.totalKills || 0) + kills;
    if (time > (st.bestTime || 0)) st.bestTime = time;
    if (wave > (st.bestWave || 0)) st.bestWave = wave;
    if (spree > (st.bestSpree || 0)) st.bestSpree = spree;
    if (dmg > (st.bestDmg || 0)) st.bestDmg = dmg;

    player.history = player.history || [];
    player.history.unshift({ win, level, wave, kills, coins: coinsEarned, time });
    player.history = player.history.slice(0, 10);

    savePlayer(player);
    res.json(publicPlayer(player));
  } catch (e) {
    console.error('Lỗi lưu kết quả trận đấu:', e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════
// 📋 LOG DASHBOARD API (bảo mật bằng ADMIN_KEY)
// ══════════════════════════════════════════════════════════

app.get('/api/logs', requireAdmin, (req, res) => {
  const logs = readLogs();
  const limit = parseInt(req.query.limit) || 100;
  res.json({ total: logs.length, logs: logs.slice(-limit).reverse() });
});

app.delete('/api/logs', requireAdmin, (req, res) => {
  writeLogs([]);
  res.json({ ok: true, message: 'Đã xóa toàn bộ log.' });
});

// ══════════════════════════════════════════════════════════
// 👥 PLAYER ADMIN API (xem / sửa / xóa / cộng coin) — CẦN ADMIN_KEY
// ══════════════════════════════════════════════════════════

app.get('/api/admin/players', requireAdmin, (req, res) => {
  const db = readDB();
  const q = (req.query.search || '').toLowerCase().trim();
  let players = db.players.map(publicPlayer);
  if (q) players = players.filter(p => p.username.includes(q) || (p.profile?.name || '').toLowerCase().includes(q));
  players.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ total: players.length, players });
});

app.get('/api/admin/players/:username', requireAdmin, (req, res) => {
  const player = findPlayer(req.params.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy player.' });
  res.json(publicPlayer(player));
});

app.put('/api/admin/players/:username', requireAdmin, (req, res) => {
  const player = findPlayer(req.params.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy player.' });

  const { coins, name, avatar, stats } = req.body || {};

  if (coins !== undefined) player.coins = Math.max(0, parseInt(coins) || 0);
  if (name !== undefined) player.profile.name = String(name).trim().slice(0, 14) || player.profile.name;
  if (avatar !== undefined && AVATARS.includes(avatar)) player.profile.avatar = avatar;
  if (stats && typeof stats === 'object') {
    player.stats = {
      games: Math.max(0, parseInt(stats.games) || 0),
      wins: Math.max(0, parseInt(stats.wins) || 0),
      totalKills: Math.max(0, parseInt(stats.totalKills) || 0),
      bestTime: Math.max(0, parseInt(stats.bestTime) || 0),
      bestWave: Math.max(1, parseInt(stats.bestWave) || 1),
      bestSpree: Math.max(0, parseInt(stats.bestSpree) || 0),
      bestDmg: Math.max(0, parseInt(stats.bestDmg) || 0),
    };
  }

  savePlayer(player);
  res.json(publicPlayer(player));
});

app.post('/api/admin/players/:username/coins', requireAdmin, (req, res) => {
  const player = findPlayer(req.params.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy player.' });

  const delta = parseInt(req.body?.delta) || 0;
  player.coins = Math.max(0, (player.coins || 0) + delta);
  savePlayer(player);
  res.json(publicPlayer(player));
});

app.delete('/api/admin/players/:username', requireAdmin, (req, res) => {
  const db = readDB();
  const before = db.players.length;
  db.players = db.players.filter(p => p.username !== req.params.username.toLowerCase());
  if (db.players.length === before) return res.status(404).json({ error: 'Không tìm thấy player.' });
  writeDB(db);
  res.json({ ok: true, message: 'Đã xóa player.' });
});

// ══════════════════════════════════════════════════════════
// 🖥️ DASHBOARD TRANG WEB
// ══════════════════════════════════════════════════════════

const DASHBOARD_STYLE = `
  *{box-sizing:border-box;}
  body{font-family:'Courier New',monospace;background:#0a0f1a;color:#c8e6ff;margin:0;padding:16px;}
  h1{color:#ffd700;font-size:20px;margin:0 0 8px;}
  .nav{display:flex;gap:8px;margin-bottom:16px;}
  .nav a{color:#00d2ff;text-decoration:none;font-size:12px;padding:6px 12px;border:1px solid #00d2ff44;border-radius:6px;}
  .nav a.active{background:#00d2ff22;}
  .bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
  input,button{padding:10px;border-radius:8px;border:1px solid #334;background:#111827;color:#fff;font-family:inherit;}
  button{background:#00d2ff;color:#000;font-weight:bold;cursor:pointer;border:none;}
  button.danger{background:#e74c3c;color:#fff;}
  button.gold{background:#f1c40f;color:#000;}
  button.small{padding:6px 10px;font-size:11px;}
  #status{color:#888;font-size:12px;margin-bottom:12px;}
`;

app.get('/admin/logs', (req, res) => {
  res.send('<!doctype html><html lang="vi"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>📋 Log Dashboard - Stick War</title>'
    + '<style>' + DASHBOARD_STYLE + `
      .log{background:#111827;border-left:4px solid #00d2ff;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px;}
      .log.status-4,.log.status-5{border-left-color:#e74c3c;}
      .log.status-2{border-left-color:#2ecc71;}
      .log-top{display:flex;justify-content:space-between;color:#888;margin-bottom:6px;flex-wrap:wrap;gap:6px;}
      .method{font-weight:bold;color:#ffd700;}
      .path{color:#00d2ff;}
      .status{font-weight:bold;}
      pre{white-space:pre-wrap;word-break:break-all;background:#0d1117;padding:8px;border-radius:6px;margin:4px 0 0;font-size:11px;color:#9ad;}
      label{display:flex;align-items:center;gap:6px;color:#888;font-size:12px;}
    </style></head>
    <body>
      <h1>📋 STICK WAR — DASHBOARD</h1>
      <div class="nav">
        <a href="/admin/logs" class="active">📋 Logs</a>
        <a href="/admin/players">👥 Players</a>
      </div>
      <div class="bar">
        <input type="password" id="adminKey" placeholder="Nhập Admin Key..." style="flex:1;min-width:200px;">
        <button onclick="loadLogs()">🔍 Xem Log</button>
        <button onclick="clearLogs()" class="danger">🗑️ Xóa Hết</button>
        <label><input type="checkbox" id="autoRefresh"> Tự động làm mới (5s)</label>
      </div>
      <div id="status">Chưa tải log nào.</div>
      <div id="logList"></div>
      <script>
        if(localStorage.getItem('sw_admin_key')) document.getElementById('adminKey').value = localStorage.getItem('sw_admin_key');
        let refreshTimer = null;
        function getKey(){ const k=document.getElementById('adminKey').value.trim(); if(k) localStorage.setItem('sw_admin_key',k); return k; }

        async function loadLogs(){
          const key = getKey();
          if(!key){ alert('Vui lòng nhập Admin Key!'); return; }
          document.getElementById('status').textContent = 'Đang tải...';
          try{
            const res = await fetch('/api/logs?limit=200', { headers: { 'x-admin-key': key } });
            const data = await res.json();
            if(!res.ok){ document.getElementById('status').textContent = '❌ ' + (data.error||'Lỗi'); return; }
            document.getElementById('status').textContent = 'Tổng: ' + data.total + ' log · Hiện: ' + data.logs.length;
            renderLogs(data.logs);
          }catch(e){ document.getElementById('status').textContent = '❌ Không kết nối được server'; }
        }

        function renderLogs(logs){
          const el = document.getElementById('logList');
          el.innerHTML = logs.map(l => {
            const statusClass = 'status-' + String(l.status)[0];
            return '<div class="log ' + statusClass + '">'
              + '<div class="log-top">'
              + '<span><span class="method">' + l.method + '</span> <span class="path">' + l.path + '</span></span>'
              + '<span class="status">' + l.status + ' · ' + l.durationMs + 'ms</span>'
              + '</div>'
              + '<div style="color:#666;">🕐 ' + new Date(l.time).toLocaleString('vi-VN') + ' · IP: ' + (l.ip||'?') + '</div>'
              + (l.requestBody && Object.keys(l.requestBody).length ? '<pre>📤 ' + JSON.stringify(l.requestBody) + '</pre>' : '')
              + '</div>';
          }).join('') || '<p style="color:#666;">Không có log nào.</p>';
        }

        async function clearLogs(){
          const key = getKey();
          if(!key){ alert('Vui lòng nhập Admin Key!'); return; }
          if(!confirm('Xóa toàn bộ log?')) return;
          await fetch('/api/logs', { method:'DELETE', headers:{ 'x-admin-key': key } });
          loadLogs();
        }

        document.getElementById('autoRefresh').addEventListener('change', (e)=>{
          if(e.target.checked){ refreshTimer = setInterval(loadLogs, 5000); }
          else { clearInterval(refreshTimer); }
        });
        document.getElementById('adminKey').addEventListener('keydown', e=>{ if(e.key==='Enter') loadLogs(); });
        if(document.getElementById('adminKey').value) loadLogs();
      </script>
    </body></html>`);
});

app.get('/admin/players', (req, res) => {
  res.send('<!doctype html><html lang="vi"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>👥 Player Admin - Stick War</title>'
    + '<style>' + DASHBOARD_STYLE + `
      .player{background:#111827;border-left:4px solid #c8aa6e;border-radius:8px;padding:12px 14px;margin-bottom:10px;}
      .p-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;}
      .p-name{font-weight:bold;color:#ffd700;font-size:14px;}
      .p-user{color:#00d2ff;font-size:11px;}
      .p-stats{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#9ad;margin-bottom:8px;}
      .p-actions{display:flex;gap:6px;flex-wrap:wrap;}
      .edit-panel{display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #334;}
      .edit-panel.show{display:block;}
      .edit-row{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;}
      .edit-row label{min-width:80px;color:#888;font-size:11px;}
      .edit-row input{flex:1;min-width:100px;padding:6px;font-size:12px;}
    </style></head>
    <body>
      <h1>👥 STICK WAR — PLAYER ADMIN</h1>
      <div class="nav">
        <a href="/admin/logs">📋 Logs</a>
        <a href="/admin/players" class="active">👥 Players</a>
      </div>
      <div class="bar">
        <input type="password" id="adminKey" placeholder="Nhập Admin Key..." style="flex:1;min-width:150px;">
        <input type="text" id="searchBox" placeholder="🔍 Tìm username..." style="flex:1;min-width:150px;">
        <button onclick="loadPlayers()">🔍 Tải Danh Sách</button>
      </div>
      <div id="status">Chưa tải danh sách.</div>
      <div id="playerList"></div>
      <script>
        if(localStorage.getItem('sw_admin_key')) document.getElementById('adminKey').value = localStorage.getItem('sw_admin_key');
        function getKey(){ const k=document.getElementById('adminKey').value.trim(); if(k) localStorage.setItem('sw_admin_key',k); return k; }

        async function loadPlayers(){
          const key = getKey();
          if(!key){ alert('Vui lòng nhập Admin Key!'); return; }
          const q = document.getElementById('searchBox').value.trim();
          document.getElementById('status').textContent = 'Đang tải...';
          try{
            const res = await fetch('/api/admin/players?search=' + encodeURIComponent(q), { headers: { 'x-admin-key': key } });
            const data = await res.json();
            if(!res.ok){ document.getElementById('status').textContent = '❌ ' + (data.error||'Lỗi'); return; }
            document.getElementById('status').textContent = 'Tổng: ' + data.total + ' người chơi';
            renderPlayers(data.players);
          }catch(e){ document.getElementById('status').textContent = '❌ Không kết nối được server'; }
        }

        function renderPlayers(players){
          const el = document.getElementById('playerList');
          el.innerHTML = players.map(p => {
            const uname = p.username;
            return '<div class="player" id="card-' + uname + '">'
              + '<div class="p-top">'
              + '<div><div class="p-name">' + (p.profile && p.profile.avatar || '🧙') + ' ' + (p.profile && p.profile.name || uname) + '</div>'
              + '<div class="p-user">@' + uname + ' · ID#' + p.id + '</div></div>'
              + '<div style="text-align:right;color:#888;font-size:11px;">' + p.rank.icon + ' ' + p.rank.name + ' · LV.' + p.level + '</div>'
              + '</div>'
              + '<div class="p-stats">'
              + '<span>💰 ' + p.coins + ' coin</span>'
              + '<span>🎮 ' + (p.stats.games||0) + ' trận</span>'
              + '<span>🏆 ' + (p.stats.wins||0) + ' thắng</span>'
              + '<span>💀 ' + (p.stats.totalKills||0) + ' kill</span>'
              + '</div>'
              + '<div class="p-actions">'
              + '<button class="small gold" onclick="quickCoin(\\'' + uname + '\\', 100)">+100💰</button>'
              + '<button class="small gold" onclick="quickCoin(\\'' + uname + '\\', 1000)">+1000💰</button>'
              + '<button class="small danger" onclick="quickCoin(\\'' + uname + '\\', -100)">-100💰</button>'
              + '<button class="small" onclick="toggleEdit(\\'' + uname + '\\')">✏️ Sửa</button>'
              + '<button class="small danger" onclick="deletePlayer(\\'' + uname + '\\')">🗑️ Xóa</button>'
              + '</div>'
              + '<div class="edit-panel" id="edit-' + uname + '">'
              + '<div class="edit-row"><label>Tên:</label><input id="in-name-' + uname + '" value="' + (p.profile && p.profile.name || '') + '"></div>'
              + '<div class="edit-row"><label>Coin:</label><input type="number" id="in-coins-' + uname + '" value="' + p.coins + '"></div>'
              + '<div class="edit-row"><label>Games:</label><input type="number" id="in-games-' + uname + '" value="' + (p.stats.games||0) + '"></div>'
              + '<div class="edit-row"><label>Wins:</label><input type="number" id="in-wins-' + uname + '" value="' + (p.stats.wins||0) + '"></div>'
              + '<div class="edit-row"><label>Kills:</label><input type="number" id="in-kills-' + uname + '" value="' + (p.stats.totalKills||0) + '"></div>'
              + '<button onclick="saveEdit(\\'' + uname + '\\')">💾 Lưu Thay Đổi</button>'
              + '</div>'
              + '</div>';
          }).join('') || '<p style="color:#666;">Không tìm thấy player nào.</p>';
        }

        function toggleEdit(uname){
          document.getElementById('edit-' + uname).classList.toggle('show');
        }

        async function quickCoin(uname, delta){
          const key = getKey();
          const res = await fetch('/api/admin/players/' + uname + '/coins', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'x-admin-key': key },
            body: JSON.stringify({ delta })
          });
          const data = await res.json();
          if(!res.ok){ alert('❌ ' + (data.error||'Lỗi')); return; }
          loadPlayers();
        }

        async function saveEdit(uname){
          const key = getKey();
          const body = {
            name: document.getElementById('in-name-'+uname).value,
            coins: parseInt(document.getElementById('in-coins-'+uname).value)||0,
            stats: {
              games: parseInt(document.getElementById('in-games-'+uname).value)||0,
              wins: parseInt(document.getElementById('in-wins-'+uname).value)||0,
              totalKills: parseInt(document.getElementById('in-kills-'+uname).value)||0,
            }
          };
          const res = await fetch('/api/admin/players/' + uname, {
            method: 'PUT',
            headers: { 'Content-Type':'application/json', 'x-admin-key': key },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if(!res.ok){ alert('❌ ' + (data.error||'Lỗi')); return; }
          alert('✅ Đã lưu!');
          loadPlayers();
        }

        async function deletePlayer(uname){
          if(!confirm('Xóa vĩnh viễn player "' + uname + '"?')) return;
          const key = getKey();
          const res = await fetch('/api/admin/players/' + uname, { method: 'DELETE', headers: { 'x-admin-key': key } });
          const data = await res.json();
          if(!res.ok){ alert('❌ ' + (data.error||'Lỗi')); return; }
          loadPlayers();
        }

        document.getElementById('adminKey').addEventListener('keydown', e=>{ if(e.key==='Enter') loadPlayers(); });
        document.getElementById('searchBox').addEventListener('keydown', e=>{ if(e.key==='Enter') loadPlayers(); });
        if(document.getElementById('adminKey').value) loadPlayers();
      </script>
    </body></html>`);
});

// ── Bắt lỗi cuối cùng ──
app.use((err, req, res, next) => {
  console.error('Lỗi server không lường trước:', err);
  res.status(500).json({ error: 'Lỗi server nội bộ: ' + (err.message || 'unknown') });
});

app.listen(PORT, () => {
  console.log(`✅ Stick War server đang chạy tại http://localhost:${PORT}`);
  console.log(`📋 Log Dashboard: http://localhost:${PORT}/admin/logs`);
  console.log(`👥 Player Admin: http://localhost:${PORT}/admin/players`);
});
