// routes/player.js
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publicPlayer } = require('./auth');
const { calcRP, getRankByRP, getPlayerLevel } = require('../gameLogic');

const router = express.Router();
const AVATARS = ['🧙', '⚔️', '🦸', '🗡️', '🔱', '💀', '🧟', '🐉', '🦅', '🤺'];

function enrich(player) {
  const rp = calcRP(player.stats);
  const rank = getRankByRP(rp);
  return {
    ...publicPlayer(player),
    rp,
    rank: { name: rank.name, icon: rank.icon },
    level: getPlayerLevel(player.stats),
  };
}

// GET /api/player/me
router.get('/me', requireAuth, (req, res) => {
  const player = db.getPlayer(req.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  res.json(enrich(player));
});

// PUT /api/player/profile  { name, avatar }
router.put('/profile', requireAuth, async (req, res) => {
  const { name, avatar } = req.body || {};
  const player = db.getPlayer(req.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

  const cleanName = (name || '').trim().slice(0, 14) || 'Chiến Binh';
  const cleanAvatar = AVATARS.includes(avatar) ? avatar : (player.profile.avatar || '🧙');

  player.profile = { name: cleanName, avatar: cleanAvatar };
  await db.savePlayer(player);
  res.json(enrich(player));
});

// POST /api/player/battle-result
// { win, level, wave, kills, coins, time, spree, dmg }
router.post('/battle-result', requireAuth, async (req, res) => {
  const player = db.getPlayer(req.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });

  const r = req.body || {};
  // Ép kiểu & giới hạn để tránh client gửi giá trị bậy làm sai lệch dữ liệu
  const win = !!r.win;
  const level = Math.max(1, parseInt(r.level) || 1);
  const wave = Math.max(1, parseInt(r.wave) || 1);
  const kills = Math.max(0, parseInt(r.kills) || 0);
  const coinsEarned = Math.max(0, Math.min(100000, parseInt(r.coins) || 0)); // trần chống gian lận
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

  await db.savePlayer(player);
  res.json(enrich(player));
});

module.exports = router;
