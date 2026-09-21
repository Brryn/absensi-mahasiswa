const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_B64 = 'bXlzcWw6Ly9hdm5hZG1pbjpBVk5TX2xxWFMxRXRORHI0NzgtV3VlcGNAbXlzcWwtMmY4OWExM2Uta2tuLXVudXN1bHRyYS0yMDI2LmEuYWl2ZW5jbG91ZC5jb206MTcwNDkvZGVmYXVsdGRi';
const DEFAULT_URI = Buffer.from(DEFAULT_B64, 'base64').toString('utf-8');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const connStr = process.env.DATABASE_URL || process.env.MYSQL_URL || DEFAULT_URI;
    const u = new URL(connStr);
    
    const conn = await mysql.createConnection({
      host: u.hostname,
      port: parseInt(u.port || '3306', 10),
      user: u.username,
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'defaultdb',
      ssl: { rejectUnauthorized: false }
    });

    const body = req.body || {};
    const username = body.username;
    const password = body.password;

    if (!username || !password) {
      await conn.end().catch(() => {});
      return res.status(400).json({ success: false, message: 'Username dan password harus diisi.' });
    }

    const [rows] = await conn.query('SELECT * FROM admin WHERE username = ?', [username]);
    await conn.end().catch(() => {});

    const admin = rows[0];
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const isMatch = bcrypt.compareSync(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, 'kemenham_magang_absensi_super_secret_key_12345', {
      expiresIn: '8h'
    });

    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);

    return res.json({
      success: true,
      message: 'Login berhasil.',
      admin: { id: admin.id, username: admin.username }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Error: ${error.message || String(error)}`
    });
  }
};
