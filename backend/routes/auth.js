const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbHelper } = require('../config/database');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');
const { catatAktivitas } = require('../utils/logger');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const body = req.body || {};
  const username = body.username;
  const password = body.password;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password harus diisi.' });
  }

  try {
    const admin = await dbHelper.get('SELECT * FROM admin WHERE username = ?', [username]);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const isMatch = bcrypt.compareSync(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    // Buat JWT Token
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, {
      expiresIn: '8h'
    });

    // Simpan di cookie HTTP-only
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000 // 8 jam
    });

    res.json({
      success: true,
      message: 'Login berhasil.',
      admin: { id: admin.id, username: admin.username }
    });
  } catch (error) {
    console.error('Error saat login:', error);
    const msg = error ? (error.sqlMessage || error.message || error.code || String(error)) : 'Unknown error';
    res.status(500).json({ 
      success: false, 
      message: `Database Error: ${msg}` 
    });
  }
});

// POST /api/auth/logout
router.post('/logout', verifyToken, async (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logout berhasil.' });
});

// GET /api/auth/me
router.get('/me', verifyToken, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// GET /api/auth/pengaturan (Ambil Pengaturan Kantor)
router.get('/pengaturan', verifyToken, async (req, res) => {
  try {
    const settings = await dbHelper.get('SELECT * FROM pengaturan ORDER BY id DESC LIMIT 1');
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error ambil pengaturan:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan.' });
  }
});

// POST /api/auth/pengaturan (Update Pengaturan Kantor & Sistem)
router.post('/pengaturan', verifyToken, async (req, res) => {
  const { 
    latitude_kantor, 
    longitude_kantor, 
    radius_meter,
    threshold_wajah,
    notifikasi_email,
    notifikasi_wa,
    jam_masuk,
    jam_terlambat,
    jam_pulang
  } = req.body;

  if (latitude_kantor === undefined || longitude_kantor === undefined || radius_meter === undefined) {
    return res.status(400).json({ success: false, message: 'Semua kolom utama pengaturan harus diisi.' });
  }

  try {
    const settings = await dbHelper.get('SELECT * FROM pengaturan ORDER BY id DESC LIMIT 1');
    
    // Set default value jika opsional kosong
    const thresh = threshold_wajah !== undefined ? threshold_wajah : (settings ? settings.threshold_wajah : 0.45);
    const emailNotify = notifikasi_email !== undefined ? notifikasi_email : (settings ? settings.notifikasi_email : 1);
    const waNotify = notifikasi_wa !== undefined ? notifikasi_wa : (settings ? settings.notifikasi_wa : 0);
    const jMasuk = jam_masuk || (settings && settings.jam_masuk ? settings.jam_masuk : '07:30');
    const jTerlambat = jam_terlambat || (settings && settings.jam_terlambat ? settings.jam_terlambat : '08:00');
    const jPulang = jam_pulang || (settings && settings.jam_pulang ? settings.jam_pulang : '16:00');

    if (settings) {
      await dbHelper.run(
        `UPDATE pengaturan 
         SET latitude_kantor = ?, longitude_kantor = ?, radius_meter = ?, 
             threshold_wajah = ?, notifikasi_email = ?, notifikasi_wa = ?,
             jam_masuk = ?, jam_terlambat = ?, jam_pulang = ?
         WHERE id = ?`,
        [latitude_kantor, longitude_kantor, radius_meter, thresh, emailNotify, waNotify, jMasuk, jTerlambat, jPulang, settings.id]
      );
    } else {
      await dbHelper.run(
        `INSERT INTO pengaturan (latitude_kantor, longitude_kantor, radius_meter, threshold_wajah, notifikasi_email, notifikasi_wa, jam_masuk, jam_terlambat, jam_pulang) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [latitude_kantor, longitude_kantor, radius_meter, thresh, emailNotify, waNotify, jMasuk, jTerlambat, jPulang]
      );
    }

    // Catat log
    await catatAktivitas(req.admin.username, 'Memperbarui konfigurasi sistem (Jadwal Kerja/Koordinat Kantor).');

    res.json({ success: true, message: 'Pengaturan berhasil diperbarui.' });
  } catch (error) {
    console.error('Error update pengaturan:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui pengaturan.' });
  }
});

// POST /api/auth/update-account (Ganti username & password admin aktif)
router.post('/update-account', verifyToken, async (req, res) => {
  const { usernameBaru, passwordLama, passwordBaru } = req.body;

  try {
    const admin = await dbHelper.get('SELECT * FROM admin WHERE id = ?', [req.admin.id]);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan.' });
    }

    let finalUsername = admin.username;
    let usernameChanged = false;
    let passwordChanged = false;

    const hasNewUsername = usernameBaru && usernameBaru.trim() !== '' && usernameBaru.trim() !== admin.username;
    const hasNewPassword = passwordBaru && passwordBaru.trim() !== '';

    if (!hasNewUsername && !hasNewPassword) {
      return res.status(400).json({ success: false, message: 'Tidak ada perubahan username atau password yang dimasukkan.' });
    }

    // Jika ingin mengubah password, password lama wajib diisi & diverifikasi
    if (hasNewPassword) {
      if (!passwordLama) {
        return res.status(400).json({ success: false, message: 'Password lama wajib diisi untuk mengubah password.' });
      }
      const isMatch = bcrypt.compareSync(passwordLama, admin.password_hash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Password lama salah.' });
      }
      if (passwordBaru.length < 6) {
        return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter.' });
      }
      const newHash = bcrypt.hashSync(passwordBaru, 10);
      await dbHelper.run('UPDATE admin SET password_hash = ? WHERE id = ?', [newHash, req.admin.id]);
      passwordChanged = true;
    } else if (passwordLama && passwordLama.trim() !== '') {
      // Jika password lama diisi meskipun tidak ubah password, tetap verifikasi demi keamanan
      const isMatch = bcrypt.compareSync(passwordLama, admin.password_hash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Password lama (verifikasi) salah.' });
      }
    }

    // Ubah username jika ada perubahan
    if (hasNewUsername) {
      const targetUsername = usernameBaru.trim();
      const existing = await dbHelper.get('SELECT id FROM admin WHERE username = ? AND id != ?', [targetUsername, req.admin.id]);
      if (existing) {
        return res.status(400).json({ success: false, message: `Username "${targetUsername}" sudah digunakan oleh admin lain.` });
      }
      await dbHelper.run('UPDATE admin SET username = ? WHERE id = ?', [targetUsername, req.admin.id]);
      finalUsername = targetUsername;
      usernameChanged = true;
    }

    // Terbitkan ulang JWT token dengan data username terbaru jika ada perubahan
    if (usernameChanged || passwordChanged) {
      const newToken = jwt.sign({ id: admin.id, username: finalUsername }, JWT_SECRET, {
        expiresIn: '8h'
      });

      res.cookie('token', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
      });
    }

    // Catat log aktivitas
    let logMsg = 'Memperbarui profil akun admin.';
    if (usernameChanged && passwordChanged) logMsg = `Mengubah username menjadi "${finalUsername}" dan memperbarui password.`;
    else if (usernameChanged) logMsg = `Mengubah username akun menjadi "${finalUsername}".`;
    else if (passwordChanged) logMsg = 'Mengubah password keamanan akun.';

    await catatAktivitas(finalUsername, logMsg);

    res.json({
      success: true,
      message: 'Profil akun berhasil diperbarui.',
      admin: { id: admin.id, username: finalUsername }
    });
  } catch (error) {
    console.error('Error update account:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan internal server saat memperbarui akun.' });
  }
});

// POST /api/auth/ganti-password (Tetap dipertahankan untuk backward-compatibility)
router.post('/ganti-password', verifyToken, async (req, res) => {
  const { passwordLama, passwordBaru } = req.body;

  if (!passwordLama || !passwordBaru) {
    return res.status(400).json({ success: false, message: 'Password lama dan password baru wajib diisi.' });
  }

  try {
    const admin = await dbHelper.get('SELECT * FROM admin WHERE id = ?', [req.admin.id]);
    
    // Verifikasi password lama
    const isMatch = bcrypt.compareSync(passwordLama, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Password lama salah.' });
    }

    // Hash password baru
    const newHash = bcrypt.hashSync(passwordBaru, 10);
    await dbHelper.run('UPDATE admin SET password_hash = ? WHERE id = ?', [newHash, req.admin.id]);

    // Catat log
    await catatAktivitas(req.admin.username, 'Mengubah password keamanan akun.');

    res.json({ success: true, message: 'Password berhasil diperbarui.' });
  } catch (error) {
    console.error('Error ganti password:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan internal server.' });
  }
});

// GET /api/auth/admins (Ambil daftar seluruh akun admin)
router.get('/admins', verifyToken, async (req, res) => {
  try {
    const list = await dbHelper.all('SELECT id, username FROM admin ORDER BY id ASC');
    res.json({ success: true, list });
  } catch (error) {
    console.error('Error ambil daftar admin:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil daftar akun admin.' });
  }
});

// POST /api/auth/tambah-admin (Tambah akun admin baru)
router.post('/tambah-admin', verifyToken, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password admin baru minimal 6 karakter.' });
  }

  const cleanUsername = username.trim();

  try {
    const existing = await dbHelper.get('SELECT id FROM admin WHERE username = ?', [cleanUsername]);
    if (existing) {
      return res.status(400).json({ success: false, message: `Username "${cleanUsername}" sudah terdaftar.` });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await dbHelper.run('INSERT INTO admin (username, password_hash) VALUES (?, ?)', [cleanUsername, hash]);

    await catatAktivitas(req.admin.username, `Menambahkan akun admin baru: ${cleanUsername}`);

    res.status(201).json({
      success: true,
      message: `Akun admin "${cleanUsername}" berhasil ditambahkan.`,
      id: result.id
    });
  } catch (error) {
    console.error('Error tambah admin:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan akun admin baru.' });
  }
});

// DELETE /api/auth/admin/:id (Hapus akun admin tambahan)
router.delete('/admin/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const targetId = parseInt(id, 10);

  if (targetId === req.admin.id) {
    return res.status(400).json({ success: false, message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang digunakan.' });
  }

  try {
    const countRes = await dbHelper.get('SELECT COUNT(*) as total FROM admin');
    if (countRes && countRes.total <= 1) {
      return res.status(400).json({ success: false, message: 'Gagal menghapus. Minimal harus ada 1 akun admin aktif dalam sistem.' });
    }

    const targetAdmin = await dbHelper.get('SELECT username FROM admin WHERE id = ?', [targetId]);
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan.' });
    }

    await dbHelper.run('DELETE FROM admin WHERE id = ?', [targetId]);

    await catatAktivitas(req.admin.username, `Menghapus akun admin: ${targetAdmin.username}`);

    res.json({ success: true, message: `Akun admin "${targetAdmin.username}" berhasil dihapus.` });
  } catch (error) {
    console.error('Error hapus admin:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus akun admin.' });
  }
});

// GET /api/auth/log-aktivitas (Ambil daftar log aktivitas sistem tanpa login/logout)
router.get('/log-aktivitas', verifyToken, async (req, res) => {
  try {
    const logs = await dbHelper.all(`
      SELECT * FROM log_aktivitas 
      WHERE aktivitas NOT LIKE '%login%' 
        AND aktivitas NOT LIKE '%logout%' 
      ORDER BY tanggal DESC 
      LIMIT 100
    `);
    res.json({ success: true, list: logs });
  } catch (error) {
    console.error('Error ambil log aktivitas:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil log aktivitas.' });
  }
});

module.exports = router;
