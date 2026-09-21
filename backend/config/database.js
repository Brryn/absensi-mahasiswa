require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DEFAULT_AIVEN_URI = Buffer.from('bXlzcWw6Ly9hdm5hZG1pbjpBVk5TX2xxWFMxRXRORHI0NzgtV3VlcGNAbXlzcWwtMmY4OWExM2Uta2tuLXVudXN1bHRyYS0yMDI2LmEuYWl2ZW5jbG91ZC5jb206MTcwNDkvZGVmYXVsdGRi', 'base64').toString('utf-8');
const connectionString = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQLURL || DEFAULT_AIVEN_URI;

let pool = null;

async function getPool() {
  if (!pool) {
    let poolConfig = {};

    if (connectionString) {
      console.log('🔌 Menggunakan Connection String / URI URL Database...');
      try {
        const u = new URL(connectionString);
        poolConfig = {
          host: u.hostname,
          port: parseInt(u.port || '3306', 10),
          user: u.username,
          password: decodeURIComponent(u.password),
          database: u.pathname.replace(/^\//, '') || 'defaultdb',
          waitForConnections: true,
          connectionLimit: 5,
          queueLimit: 0,
          dateStrings: true,
          connectTimeout: 15000,
          ssl: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
        };
      } catch (e) {
        poolConfig = {
          uri: connectionString,
          waitForConnections: true,
          connectionLimit: 5,
          queueLimit: 0,
          dateStrings: true,
          connectTimeout: 15000,
          ssl: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
        };
      }
    } else {
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
      const dbUser = process.env.DB_USER || 'root';
      const dbPassword = process.env.DB_PASSWORD || '';
      const dbName = process.env.DB_NAME || 'kemenham_absensi';
      const isCloudHost = dbHost !== 'localhost' && dbHost !== '127.0.0.1';

      poolConfig = {
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        dateStrings: true,
        connectTimeout: 20000
      };

      if (isCloudHost) {
        poolConfig.ssl = { rejectUnauthorized: false };
      } else {
        // Pastikan Database MySQL Lokal (XAMPP) Sudah Ada
        try {
          const connTemp = await mysql.createConnection({
            host: dbHost,
            port: dbPort,
            user: dbUser,
            password: dbPassword
          });
          await connTemp.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          await connTemp.end();
        } catch (e) {
          console.warn('⚠️ Perhatian saat mengecek DB lokal:', e.message);
        }
      }
    }

    try {
      pool = mysql.createPool(poolConfig);
      pool.on('error', (err) => {
        console.error('⚠️ MySQL Pool Error Event:', err.message);
      });
      console.log('🔌 Koneksi Pool Database MySQL berhasil dibuat.');
    } catch (err) {
      console.error('❌ Gagal terhubung ke MySQL Host:', err.message);
      throw err;
    }
  }
  return pool;
}

// Helper query universal untuk Express Routes
const dbHelper = {
  async run(sql, params = []) {
    const p = await getPool();
    const [result] = await p.query(sql, params);
    return { id: result.insertId, changes: result.affectedRows };
  },
  async get(sql, params = []) {
    const p = await getPool();
    const [rows] = await p.query(sql, params);
    return rows[0] || null;
  },
  async all(sql, params = []) {
    const p = await getPool();
    const [rows] = await p.query(sql, params);
    return rows;
  }
};

// Inisialisasi Otomatis Seluruh Tabel Database MySQL
async function initDb() {
  try {
    const p = await getPool();

    // 1. Tabel Kampus
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`kampus\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`nama_kampus\` VARCHAR(255) NOT NULL,
        \`alamat\` TEXT NULL,
        \`status_aktif\` TINYINT(1) DEFAULT 1,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_nama_kampus\` (\`nama_kampus\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Tabel Mahasiswa
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`mahasiswa\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`nama\` VARCHAR(255) NOT NULL,
        \`nim\` VARCHAR(100) NULL,
        \`kampus_id\` INT NULL,
        \`no_hp\` VARCHAR(50) NULL,
        \`pembimbing\` VARCHAR(255) NULL,
        \`tgl_mulai\` DATE NULL,
        \`tgl_selesai\` DATE NULL,
        \`face_descriptor\` LONGTEXT NULL,
        \`angkatan\` VARCHAR(50) NULL,
        \`jenis_program\` VARCHAR(100) DEFAULT 'Magang',
        \`status_aktif\` TINYINT(1) DEFAULT 1,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_nim\` (\`nim\`),
        CONSTRAINT \`fk_mahasiswa_kampus\` FOREIGN KEY (\`kampus_id\`) REFERENCES \`kampus\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Tabel Absensi
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`absensi\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`mahasiswa_id\` INT NOT NULL,
        \`tanggal\` DATE NOT NULL,
        \`jam_masuk\` DATETIME NULL,
        \`jam_pulang\` DATETIME NULL,
        \`latitude\` DOUBLE NULL,
        \`longitude\` DOUBLE NULL,
        \`akurasi_gps\` DOUBLE NULL,
        \`status\` ENUM('hadir','izin','sakit','alpha','terlambat') NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`unique_mhs_tgl\` (\`mahasiswa_id\`, \`tanggal\`),
        CONSTRAINT \`fk_absensi_mahasiswa\` FOREIGN KEY (\`mahasiswa_id\`) REFERENCES \`mahasiswa\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Tabel Admin
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`admin\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`username\` VARCHAR(100) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_username\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Tabel Pengaturan
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`pengaturan\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`latitude_kantor\` DOUBLE NULL,
        \`longitude_kantor\` DOUBLE NULL,
        \`radius_meter\` INT DEFAULT 100,
        \`threshold_wajah\` DOUBLE DEFAULT 0.45,
        \`notifikasi_email\` TINYINT(1) DEFAULT 1,
        \`notifikasi_wa\` TINYINT(1) DEFAULT 0,
        \`jam_masuk\` VARCHAR(10) DEFAULT '07:30',
        \`jam_terlambat\` VARCHAR(10) DEFAULT '08:00',
        \`jam_pulang\` VARCHAR(10) DEFAULT '16:00',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Tabel Log Aktivitas
    await p.query(`
      CREATE TABLE IF NOT EXISTS \`log_aktivitas\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`tanggal\` VARCHAR(100) NULL,
        \`aktivitas\` TEXT NULL,
        \`admin_username\` VARCHAR(100) NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ Inisialisasi struktur tabel MySQL selesai.');

    // Seed data admin jika kosong
    const adminCount = await dbHelper.get('SELECT COUNT(*) as count FROM admin');
    if (!adminCount || adminCount.count === 0) {
      const defaultUsername = 'admin';
      const defaultPassword = 'admin123';
      const hash = bcrypt.hashSync(defaultPassword, 10);
      await dbHelper.run(
        'INSERT INTO admin (username, password_hash) VALUES (?, ?)',
        [defaultUsername, hash]
      );
      console.log('Seed data admin default MySQL berhasil dibuat: admin / admin123');
    }

    // Seed data pengaturan jika kosong
    const settingCount = await dbHelper.get('SELECT COUNT(*) as count FROM pengaturan');
    if (!settingCount || settingCount.count === 0) {
      const defaultLat = -3.9778;
      const defaultLng = 122.5150;
      const defaultRadius = 100;
      await dbHelper.run(
        'INSERT INTO pengaturan (latitude_kantor, longitude_kantor, radius_meter) VALUES (?, ?, ?)',
        [defaultLat, defaultLng, defaultRadius]
      );
      console.log(`Seed data pengaturan default MySQL berhasil dibuat: Lat ${defaultLat}, Lng ${defaultLng}, Radius ${defaultRadius}m`);
    }

  } catch (err) {
    console.error('Gagal menginisialisasi database MySQL:', err.message);
  }
}

module.exports = {
  dbHelper,
  initDb
};
