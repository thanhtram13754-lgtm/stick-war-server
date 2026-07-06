// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function createNewPlayer(username, passwordHash) {
  return {
    username: username.toLowerCase(),
    passwordHash,
    createdAt: Date.now(),
    id: Math.floor(Math.random() * 999999) + 1,
    profile: { name: username, avatar: '🧙' },
    coins: 0,
    stats: {
      games: 0, wins: 0, totalKills: 0,
      bestTime: 0, bestWave: 1, bestSpree: 0, bestDmg: 0,
    },
    history: [],
  };
}

function publicPlayer(p) {
  // Không bao giờ trả passwordHash ra ngoài
  const { passwordHash, ...safe } = p;
  return safe;
}

// POST /api/auth/register  { username, password }
router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin.' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Tên tài khoản 3-20 ký tự, chỉ gồm chữ/số/_' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });
  if (db.getPlayer(username)) return res.status(409).json({ error: 'Tên tài khoản đã tồn tại.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const player = createNewPlayer(username, passwordHash);
  await db.savePlayer(player);

  const token = jwt.sign({ username: player.username }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, player: publicPlayer(player) });
});

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đủ thông tin.' });

  const player = db.getPlayer(username);
  if (!player) return res.status(401).json({ error: 'Sai tên tài khoản hoặc mật khẩu.' });

  const ok = await bcrypt.compare(password, player.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Sai tên tài khoản hoặc mật khẩu.' });

  const token = jwt.sign({ username: player.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, player: publicPlayer(player) });
});

// PUT /api/auth/password  { oldPassword, newPassword }  (cần token)
router.put('/password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 6 ký tự.' });

  const player = db.getPlayer(req.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

  const ok = await bcrypt.compare(oldPassword, player.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' });

  const same = await bcrypt.compare(newPassword, player.passwordHash);
  if (same) return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu cũ.' });

  player.passwordHash = await bcrypt.hash(newPassword, 10);
  await db.savePlayer(player);
  res.json({ success: true });
});

// DELETE /api/auth/account  (cần token) - tự xóa tài khoản của chính mình
router.delete('/account', requireAuth, async (req, res) => {
  const deleted = db.deletePlayer(req.username);
  if (!deleted) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  res.json({ success: true });
});

module.exports = { router, publicPlayer };
