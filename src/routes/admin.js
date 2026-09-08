'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const dbMod = require('../db/database');
const { authUser, authAdmin } = require('../middleware/auth');

const router = express.Router();

// Tüm admin rotaları token + admin gerektirir
router.use(authUser, authAdmin);

// ── Kullanıcı yönetimi ──────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await dbMod.listUsers();
    return res.json({ ok: true, users });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body || {};
    const name = (username || '').trim();
    if (name.length < 3) return res.status(400).json({ ok: false, error: 'Kullanıcı adı 3+ karakter' });
    if ((password || '').length < 6) return res.status(400).json({ ok: false, error: 'Şifre 6+ karakter' });

    const allowed = ['user', 'admin', 'banned'];
    if (!allowed.includes(role)) return res.status(400).json({ ok: false, error: 'Geçersiz rol' });

    if (await dbMod.getUserByUsername(name)) return res.status(409).json({ ok: false, error: 'Kullanıcı mevcut' });

    const hash = bcrypt.hashSync(password, 10);
    const user = await dbMod.createUser({ username: name, passwordHash: hash, role });
    return res.status(201).json({ ok: true, user });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { role } = req.body || {};
    const id = +req.params.id;
    const target = await dbMod.getUserById(id);
    if (!target) return res.status(404).json({ ok: false, error: 'Kullanıcı yok' });
    if (target.id === req.user.id && role === 'user') {
      return res.status(400).json({ ok: false, error: 'Kendi admin rolünü kaldıramazsın' });
    }
    const allowed = ['user', 'admin', 'banned'];
    if (!allowed.includes(role)) return res.status(400).json({ ok: false, error: 'Geçersiz rol' });
    await dbMod.setUserRole(id, role);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    if (id === req.user.id) return res.status(400).json({ ok: false, error: 'Kendini silemezsin' });
    if (!await dbMod.getUserById(id)) return res.status(404).json({ ok: false, error: 'Kullanıcı yok' });
    await dbMod.deleteUser(id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Key yönetimi ────────────────────────────────────────────────────
// POST /api/admin/keys  { count?, duration_type: day|week|month|year|unlimited, value?, userId? }
router.post('/keys', async (req, res) => {
  try {
    const { duration_type: type, value = 1, userId = null, count = 1 } = req.body || {};
    const valid = ['day', 'week', 'month', 'year', 'unlimited'];
    if (!valid.includes(type)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz süre tipi (day/week/month/year/unlimited)' });
    }
    const keys = await dbMod.createKeys({
      userId: userId || null,
      type,
      value: +value || 1,
      count: +count || 1,
    });
    return res.status(201).json({ ok: true, keys, count: keys.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/keys', async (req, res) => {
  try {
    const rows = (await dbMod.listKeysWithOwner()).map((k) => ({
      ...k,
      duration_label: dbMod.DURATION_LABELS[k.duration_type] || k.duration_type,
    }));
    return res.json({ ok: true, keys: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/keys/:id/revoke', async (req, res) => {
  try {
    const id = +req.params.id;
    const row = await dbMod.getKeyById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Key yok' });
    const rev = !row.revoked;
    await dbMod.setRevoked(id, rev);
    return res.json({ ok: true, revoked: rev });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Genel istatistik (dashboard üst kartları) ───────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await dbMod.getStats();
    return res.json({ ok: true, stats });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;