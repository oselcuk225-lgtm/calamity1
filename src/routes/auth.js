'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const dbMod = require('../db/database');
const { signToken, authUser } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register  — Türkçe kullanıcı kaydı
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const name = (username || '').trim();
    const pass = password || '';

    if (name.length < 3 || name.length > 24) {
      return res.status(400).json({ ok: false, error: 'Kullanıcı adı 3-24 karakter olmalı' });
    }
    if (!/^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ.-]+$/.test(name)) {
      return res.status(400).json({ ok: false, error: 'Geçersiz kullanıcı adı formatı' });
    }
    if (pass.length < 6) {
      return res.status(400).json({ ok: false, error: 'Şifre en az 6 karakter olmalı' });
    }
    if (await dbMod.getUserByUsername(name)) {
      return res.status(409).json({ ok: false, error: 'Bu kullanıcı adı zaten alınmış' });
    }

    const hash = bcrypt.hashSync(pass, 10);
    const user = await dbMod.createUser({ username: name, passwordHash: hash, role: 'user' });

    return res.status(201).json({
      ok: true,
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const name = (username || '').trim();

    const user = await dbMod.getUserByUsername(name);
    if (!user || !bcrypt.compareSync(password || '', user.password)) {
      return res.status(401).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı' });
    }
    if (user.role === 'banned') {
      return res.status(403).json({ ok: false, error: 'Hesap engellenmiş (banlı)' });
    }

    return res.json({
      ok: true,
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// GET /api/auth/me  — token sahibi + kendi key'leri
router.get('/me', authUser, async (req, res) => {
  try {
    const u = await dbMod.getUserById(req.user.id);
    if (!u) return res.status(404).json({ ok: false, error: 'Kullanıcı bulunamadı' });

    const keys = (await dbMod.listKeys({ userId: u.id })).map((k) => ({
      ...k,
      duration_label: dbMod.DURATION_LABELS[k.duration_type] || k.duration_type,
    }));

    return res.json({
      ok: true,
      user: { id: u.id, username: u.username, role: u.role, created_at: u.created_at },
      keys,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası: ' + e.message });
  }
});

module.exports = router;