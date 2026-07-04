require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET || !process.env.ADMIN_SECRET) {
  console.error('❌ Thiếu JWT_SECRET hoặc ADMIN_SECRET');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.listen(PORT, () => {
  console.log(`✅ Stick War server chạy tại http://localhost:${PORT}`);
});
