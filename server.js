'use strict';
const path = require('path');
const express = require('express');

// Ortam değişkenleri — .env dosyası opsiyonel (Vercel env'leri otomatik gelir)
try { require('dotenv').config(); } catch {}

const { initSchema, ensureFirstAdmin } = require('./src/db/database');
const authRoutes    = require('./src/routes/auth');
const adminRoutes   = require('./src/routes/admin');
const licenseRoutes = require('./src/routes/license');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Init: şema + ilk admin (ilk istekte bir kez, sonra önbellek) ────
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await ensureFirstAdmin();
    })();
    readyPromise.catch(() => { readyPromise = null; });
  }
  return readyPromise;
}
app.use(async (req, res, next) => {
  try { await ready(); next(); } catch (e) { next(e); }
});

// ── Middleware ───────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Statik dosyalar (index.html, css, js)
app.use(express.static(path.join(__dirname, 'public')));

// CORS (geliştirme için herkese açık; production'da daralt)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── API rotaları ────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);      // register, login, me
app.use('/api/admin',    adminRoutes);     // kullanıcı/key yönetimi
app.use('/api/license',  licenseRoutes);   // activate, validate (loader)

// ── SPA fallback ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel için express app'i export et
module.exports = app;

// Yerelde test için: node server.js
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   CALAMITY License Server — Neon (Vercel)     ║
  ║   http://localhost:${String(PORT).padEnd(4)}                       ║
  ║   Admin hesap: ENV ADMIN_USER / ADMIN_PASS    ║
  ╚═══════════════════════════════════════════════╝
    `);
  });
}