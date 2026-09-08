'use strict';

const express = require('express');
const crypto = require('crypto');
const dbMod = require('../db/database');
const { authUser } = require('../middleware/auth');

const router = express.Router();

function normalizeKey(raw) {
  return (raw || '').trim().toUpperCase();
}

function isExpired(check, error) {
  if (error) return { expired: true, reason: error };
  if (check.revoked) return { expired: true, reason: 'Key iptal edilmiş (revoked)' };
  if (check.expires_at !== null && check.expires_at !== undefined
      && check.expires_at > 0 && check.now > check.expires_at) {
    return { expired: true, reason: 'Key süresi dolmuş' };
  }
  return { expired: false };
}

// POST /api/license/activate — Kullanıcı kendi key'ini aktifleştirir
// Gövde: { key: "CALAMITY-XXXX-...", hwid: "abc123" }
router.post('/activate', authUser, async (req, res) => {
  try {
    const key = normalizeKey(req.body?.key);
    const hwid = (req.body?.hwid || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'Key girilmedi' });
    if (!hwid) return res.status(400).json({ ok: false, error: 'HWID bulunamadı' });

    const row = await dbMod.getKeyByString(key);
    if (!row) return res.status(404).json({ ok: false, error: 'Geçersiz key' });
    if (row.revoked) return res.status(403).json({ ok: false, error: 'Bu key iptal edilmiş' });

    const now = dbMod.nowSec();

    // Henüz kullanılmamış → aktifleştir ve HWID'e bağla
    if (!row.activated_at) {
      const expires = dbMod.computeExpiry(now, row.duration_type, row.duration_value);
      await dbMod.activateKey(row.id, {
        userId: req.user.id, hwid, nowSec: now, expiresAt: expires,
      });
      const updated = await dbMod.getKeyByString(key);
      return res.json({ ok: true, activated: true, key: updated });
    }

    // Zaten aktif — iptal / süre kontrolü
    const chk = isExpired({ ...row, now }, null);
    if (chk.expired) return res.status(403).json({ ok: false, error: chk.reason });

    // HWID eşleşmesi zorunlu: key başka makineye bağlıysa red
    if (row.hwid && row.hwid !== hwid) {
      return res.status(403).json({ ok: false, error: 'Bu key farklı bir cihaza (HWID) bağlı' });
    }

    await dbMod.touchKey(row.id, now);
    const updated = await dbMod.getKeyByString(key);
    return res.json({ ok: true, activated: true, key: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// POST /api/license/validate — Loader her açılışta key/hwid doğrular
// Gövde: { key, hwid }  → ok:true ise loader çalışmaya devam eder
router.post('/validate', async (req, res) => {
  try {
    const key = normalizeKey(req.body?.key);
    const hwid = (req.body?.hwid || '').trim();
    if (!key) return res.json({ ok: false, error: 'Key girilmedi' });

    const row = await dbMod.getKeyByString(key);
    if (!row) return res.json({ ok: false, error: 'Geçersiz key' });

    const now = dbMod.nowSec();
    const chk = isExpired({ ...row, now }, null);
    if (chk.expired) return res.json({ ok: false, error: chk.reason });

    if (!row.activated_at) {
      return res.json({
        ok: false,
        error: 'Key henüz aktifleştirilmedi (kullanıcı panelinden)',
        requires_activation: true,
      });
    }

    // HWID kontrolü: key hangi makineye bağlandıysa o makine kullanabilir
    if (hwid && row.hwid && row.hwid !== hwid) {
      return res.json({ ok: false, error: 'HWID eşleşmiyor (farklı cihaz)' });
    }

    await dbMod.touchKey(row.id, now);

    return res.json({
      ok: true,
      expires_at: row.expires_at,
      duration_type: row.duration_type,
      duration_value: row.duration_value,
      duration_label: dbMod.DURATION_LABELS[row.duration_type] || row.duration_type,
      now,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// POST /api/license/hwid — Yeni hwid hash üret (loader kullanır, opsiyonel)
router.post('/hwid', (req, res) => {
  try {
    const seed = (req.body?.mac || '').toString();
    const salt = process.env.HWID_SALT || 'CALAMITY-HWID';
    const hwid = crypto.createHash('sha256')
      .update(`${salt}:${seed}`).digest('hex');
    return res.json({ ok: true, hwid });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;