const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_B64 = 'bXlzcWw6Ly9hdm5hZG1pbjpBVk5TX2xxWFMxRXRORHI0NzgtV3VlcGNAbXlzcWwtMmY4OWExM2Uta2tuLXVudXN1bHRyYS0yMDI2LmEuYWl2ZW5jbG91ZC5jb206MTcwNDkvZGVmYXVsdGRi';
const DEFAULT_URI = Buffer.from(DEFAULT_B64, 'base64').toString('utf-8');

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  }

  // Handle stream body if req.body is empty
  if (!body.username && req.readable) {
    try {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      const dataStr = Buffer.concat(buffers).toString('utf-8');
      if (dataStr) {
        body = JSON.parse(dataStr);
      }
    } catch (e) {}
  }

  const username = body.username;
  const password = body.password;

  if (!username || !password) {
    return sendJson(res, 400, { success: false, message: 'Username dan password harus diisi.' });
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

    const [rows] = await conn.query('SELECT * FROM admin WHERE username = ?', [username]);
    await conn.end().catch(() => {});

    const admin = rows[0];
    if (!admin) {
      return sendJson(res, 401, { success: false, message: 'Username atau password salah.' });
    }

    const isMatch = bcrypt.compareSync(password, admin.password_hash);
    if (!isMatch) {
      return sendJson(res, 401, { success: false, message: 'Username atau password salah.' });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, 'kemenham_magang_absensi_super_secret_key_12345', {
      expiresIn: '8h'
    });

    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);

    return sendJson(res, 200, {
      success: true,
      message: 'Login berhasil.',
      admin: { id: admin.id, username: admin.username }
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      message: `Error: ${error.message || String(error)}`
    });
  }
};
