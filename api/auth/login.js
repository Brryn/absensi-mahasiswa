const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbHelper } = require('../../backend/config/database');
const { JWT_SECRET } = require('../../backend/middleware/auth');

module.exports = async (req, res) => {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

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

    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, {
      expiresIn: '8h'
    });

    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);

    return res.json({
      success: true,
      message: 'Login berhasil.',
      admin: { id: admin.id, username: admin.username }
    });
  } catch (error) {
    console.error('Error saat login serverless:', error);
    return res.status(500).json({
      success: false,
      message: `Database Error: ${error.sqlMessage || error.message || String(error)}`
    });
  }
};
