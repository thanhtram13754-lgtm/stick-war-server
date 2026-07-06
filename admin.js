// routes/admin.js
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { publicPlayer } = require('./auth');
const { calcRP, getRankByRP } = require('../gameLogic');

const router = express.Router();

// GET /api/admin/players
router.get('/players', requireAdmin, (req, res) => {
  const players = db.getAllPlayers().map(p => {
    const rp = calcRP(p.stats);
    const rank = getRankByRP(rp);
    return { ...publicPlayer(p), rp, rank: { name: rank.name, icon: rank.icon } };
  });
  res.json({ count: players.length, players });
});

// PUT /api/admin/players/:username/coins  { coins }
router.put('/players/:username/coins', requireAdmin, async (req, res) => {
  const player = db.getPlayer(req.params.username);
  if (!player) return res.status(404).json({ error: 'Không tìm thấy người chơi.' });
  const coins = Math.max(0, parseInt(req.body.coins) || 0);
  player.coins = coins;
  await db.savePlayer(player);
  res.json({ success: true, coins });
});

// DELETE /api/admin/players/:username
router.delete('/players/:username', requireAdmin, (req, res) => {
  const deleted = db.deletePlayer(req.params.username);
  if (!deleted) return res.status(404).json({ error: 'Không tìm thấy người chơi.' });
  res.json({ success: true });
});

// DELETE /api/admin/players  - xóa toàn bộ (nuke)
router.delete('/players', requireAdmin, async (req, res) => {
  await db.deleteAllPlayers();
  res.json({ success: true });
});

module.exports = router;
