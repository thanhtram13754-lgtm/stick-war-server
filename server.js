// ══════════════════════════════════════════════════════════
// STICK WAR SERVER - Bản có Logging Dashboard bảo mật
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
  const trimmed = logs.slice(-2000); // Giữ tối đa 2000 log gần nhất
  fs.writeFileSync(LOGS_FILE, JSON.stringify(trimmed, null, 2));
}

// Các field KHÔNG BAO GIỜ được log (bảo mật tuyệt đối)
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

// ── Middleware xác thực Admin (bảo vệ dashboard log) ──
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Sai admin key. Không có quyền truy cập.' });
  }
  next();
}

// ── Middleware TỰ ĐỘNG LOG mọi request/response (đặt SAU cors/json, TRƯỚC routes) ──
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
// ROUTES
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
// 📋 LOG DASHBOARD (bảo mật bằng ADMIN_KEY)
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

app.get('/admin/logs', (req, res) => {
  res.send(`<!doctype html>
<html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📋 Log Dashboard - Stick War</title>
<style>
  *{box-sizing:border-box;}
  body{font-family:'Courier New',monospace;background:#0a0f1a;color:#c8e6ff;margin:0;padding:16px;}
  h1{color:#ffd700;font-size:20px;margin:0 0 16px;}
  .bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
  input,button{padding:10px;border-radius:8px;border:1px solid #334;background:#111827;color:#fff;font-family:inherit;}
  button{background:#00d2ff;color:#000;font-weight:bold;cursor:pointer;border:none;}
  button.danger{background:#e74c3c;color:#fff;}
  #status{color:#888;font-size:12px;margin-bottom:12px;}
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
  <h1>📋 STICK WAR — LOG DASHBOARD</h1>
  <div class="bar">
    <input type="password" id="adminKey" placeholder="Nhập Admin Key..." style="flex:1;min-width:200px;">
    <button onclick="loadLogs()">🔍 Xem Log</button>
    <button onclick="clearLogs()" class="danger">🗑️ Xóa Hết</button>
    <label><input type="checkbox" id="autoRefresh"> Tự động làm mới (5s)</label>
  </div>
  <div id="status">Chưa tải log nào.</div>
  <div id="logList"></div>

<script>
let refreshTimer = null;
function getKey(){ return document.getElementById('adminKey').value.trim(); }

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
  }catch(e){
    document.getElementById('status').textContent = '❌ Không kết nối được server';
  }
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
});
