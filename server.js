// ══════════════════════════════════════════════════════════
// STICK WAR SERVER - Bản viết lại, gộp 1 file, dễ bảo trì
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
const DATA_FILE = path.join(__dirname, 'data', 'players.json');

app.use(cors()); // cho phép mọi domain gọi API (đơn giản hoá, tránh lỗi CORS)
app.use(express.json());

// ── Đảm bảo file dữ liệu tồn tại trước khi server nhận request ──
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ players: [] }, null, 2));
}
ensureDataFile();

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

// ── Rank / Level logic (giống client) ──
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

// ── Middleware xác thực token ──
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

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════

app.get('/', (req, res) => res.json({ ok: true, message: 'Stick War server đang chạy.' }));
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Đăng ký
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

// Đăng nhập
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

// Đổi mật khẩu
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

// Xoá tài khoản
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

// Lấy thông tin player hiện tại
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

// Cập nhật hồ sơ (tên, avatar)
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

// Ghi nhận kết quả trận đấu
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

// ── Bắt lỗi cuối cùng, tránh server sập vì lỗi bất ngờ ──
app.use((err, req, res, next) => {
  console.error('Lỗi server không lường trước:', err);
  res.status(500).json({ error: 'Lỗi server nội bộ: ' + (err.message || 'unknown') });
});

app.listen(PORT, () => {
  console.log(`✅ Stick War server (bản mới) đang chạy tại http://localhost:${PORT}`);
});
