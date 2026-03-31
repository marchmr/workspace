const express = require('express');
const cors = require('cors');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = path.join(__dirname, 'videos.db');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const FRONTEND_DIR = path.join(__dirname, 'public');
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const ADMIN_DEFAULT_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || 1000 * 60 * 60 * 12);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (process.env.NODE_ENV === 'production' && ADMIN_DEFAULT_PASSWORD === 'admin123') {
  console.error('Sicherheitsfehler: ADMIN_PASSWORD darf in Produktion nicht auf Standardwert stehen.');
  process.exit(1);
}

const adminTokens = new Map();

function nowIso() {
  return new Date().toISOString();
}

function nowDe() {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const candidates = [];

  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : String(forwarded);
    candidates.push(...raw.split(',').map((entry) => entry.trim()).filter(Boolean));
  }
  if (realIp) {
    candidates.push(String(Array.isArray(realIp) ? realIp[0] : realIp).trim());
  }
  if (Array.isArray(req.ips) && req.ips.length) {
    candidates.push(...req.ips.map((entry) => String(entry).trim()));
  }
  candidates.push(String(req.ip || '').trim());
  candidates.push(String(req.socket?.remoteAddress || '').trim());

  for (const entry of candidates) {
    if (!entry || entry.toLowerCase() === 'unknown') continue;
    const normalized = entry.replace(/^::ffff:/, '');
    if (normalized === '::1') return '127.0.0.1';
    return normalized;
  }

  return 'unknown';
}

function createRateLimiter({ maxRequests, windowMs, keyFn }) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || now > current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retrySeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    }

    return next();
  };
}

const loginLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
  keyFn: (req) => `login:${getClientIp(req)}`,
});

const codeLimiter = createRateLimiter({
  maxRequests: 50,
  windowMs: 15 * 60 * 1000,
  keyFn: (req) => `code:${getClientIp(req)}`,
});

const streamLimiter = createRateLimiter({
  maxRequests: 800,
  windowMs: 15 * 60 * 1000,
  keyFn: (req) => `stream:${getClientIp(req)}:${String(req.query.code || '').toUpperCase()}`,
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (!mime.startsWith('video/')) {
      cb(new Error('Nur Video-Dateien sind erlaubt.'));
      return;
    }
    cb(null, true);
  },
});

function sanitizeCode(input) {
  return String(input || '').trim().toUpperCase();
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'VID-';
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function createPasswordSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 120000, 32, 'sha256').toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(password, salt);
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(String(expectedHash || ''), 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let current = 0;
  const out = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) continue;
    current = (current << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function formatTotpSecret(secret) {
  return String(secret || '')
    .replace(/[^A-Z2-7]/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function generateTotpCode(secret, step = 30, digits = 6, atMs = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(atMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codeInt % (10 ** digits)).padStart(digits, '0');
}

function verifyTotp(secret, token, window = 1) {
  const cleanToken = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanToken) || !secret) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const at = now + offset * 30000;
    if (generateTotpCode(secret, 30, 6, at) === cleanToken) return true;
  }
  return false;
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht autorisiert.' });

  const token = header.slice('Bearer '.length);
  const session = adminTokens.get(token);
  if (!session) return res.status(401).json({ error: 'Session ungültig.' });

  if (Date.now() > session.expiresAtMs) {
    adminTokens.delete(token);
    return res.status(401).json({ error: 'Session abgelaufen. Bitte neu anmelden.' });
  }

  req.admin = session;
  req.adminToken = token;
  return next();
}

function getAdminSessionFromToken(token) {
  if (!token) return null;
  const session = adminTokens.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAtMs) {
    adminTokens.delete(token);
    return null;
  }
  return session;
}

function isCodeExpired(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

function shouldLogStream(rangeHeader) {
  if (!rangeHeader) return true;
  return /^bytes=0-/.test(String(rangeHeader));
}

async function logActivity(db, req, payload) {
  const row = {
    id: uuidv4(),
    createdAtIso: nowIso(),
    createdAtDe: nowDe(),
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    eventType: payload.eventType,
    code: payload.code || null,
    videoId: payload.videoId || null,
    videoTitle: payload.videoTitle || null,
    customerId: payload.customerId || null,
    customerName: payload.customerName || null,
    success: payload.success ? 1 : 0,
    detail: payload.detail || null,
  };

  await db.run(
    `INSERT INTO activity_logs (
      id, createdAtIso, createdAtDe, ip, userAgent, eventType, code,
      videoId, videoTitle, customerId, customerName, success, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.createdAtIso,
      row.createdAtDe,
      row.ip,
      row.userAgent,
      row.eventType,
      row.code,
      row.videoId,
      row.videoTitle,
      row.customerId,
      row.customerName,
      row.success,
      row.detail,
    ]
  );
}

async function loadAdminAccount(db) {
  return db.get(
    `SELECT id, username, passwordHash, passwordSalt, twoFactorEnabled, twoFactorSecret, createdAt, updatedAt
     FROM admin_account
     WHERE id = 1`
  );
}

async function findAccessByCode(db, code) {
  const normalized = sanitizeCode(code);
  if (!normalized) return null;

  const row = await db.get(
    `SELECT sc.id, sc.code, sc.scope, sc.videoId, sc.customerId, sc.expiresAt, sc.isActive,
            c.name AS customerName
     FROM share_codes sc
     LEFT JOIN customers c ON c.id = sc.customerId
     WHERE sc.code = ?`,
    [normalized]
  );

  if (!row || !row.isActive || isCodeExpired(row.expiresAt)) return null;
  return row;
}

async function loadVideosForAccess(db, access) {
  if (access.scope === 'video' && access.videoId) {
    const video = await db.get(
      `SELECT v.id, v.title, v.description, v.sourceType, v.videoUrl, v.fileName, v.filePath, v.mimeType,
              v.sizeBytes, v.category, v.createdAt, v.customerId, c.name AS customerName
       FROM videos v
       LEFT JOIN customers c ON c.id = v.customerId
       WHERE v.id = ?`,
      [access.videoId]
    );
    return video ? [video] : [];
  }

  if (access.scope === 'customer' && access.customerId) {
    return db.all(
      `SELECT v.id, v.title, v.description, v.sourceType, v.videoUrl, v.fileName, v.filePath, v.mimeType,
              v.sizeBytes, v.category, v.createdAt, v.customerId, c.name AS customerName
       FROM videos v
       LEFT JOIN customers c ON c.id = v.customerId
       WHERE v.customerId = ?
       ORDER BY v.createdAt DESC`,
      [access.customerId]
    );
  }

  return [];
}

function sendVideoFile(req, res, absPath, mimeType) {
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Datei nicht gefunden.' });

  const stat = fs.statSync(absPath);
  const size = stat.size;
  const range = req.headers.range;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!range) {
    res.status(200);
    res.setHeader('Content-Type', mimeType || 'video/mp4');
    res.setHeader('Content-Length', size);
    fs.createReadStream(absPath).pipe(res);
    return;
  }

  const matches = /bytes=(\d*)-(\d*)/.exec(range);
  if (!matches) return res.status(416).send();

  const start = matches[1] ? Number(matches[1]) : 0;
  const end = matches[2] ? Number(matches[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return res.status(416).send();

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Content-Type', mimeType || 'video/mp4');
  fs.createReadStream(absPath, { start, end }).pipe(res);
}

function safeBaseName(fileName) {
  const parsed = path.parse(String(fileName || 'video'));
  return (parsed.name || 'video').replace(/[^\w.-]/g, '_');
}

function convertUploadToMp4(inputPath, originalName) {
  return new Promise((resolve, reject) => {
    const outName = `${Date.now()}-${safeBaseName(originalName)}.mp4`;
    const outPath = path.join(UPLOAD_DIR, outName);
    const args = [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      outPath,
    ];

    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg konnte nicht gestartet werden (${err.message}).`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
        reject(new Error(`Video-Konvertierung fehlgeschlagen (${code}). ${stderr}`.slice(0, 700)));
        return;
      }

      const stat = fs.statSync(outPath);
      resolve({
        filePath: outName,
        fileName: `${safeBaseName(originalName)}.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: stat.size,
      });
    });
  });
}

async function createApp() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      videoUrl TEXT,
      fileName TEXT,
      filePath TEXT,
      mimeType TEXT,
      sizeBytes INTEGER,
      category TEXT NOT NULL,
      customerId TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS share_codes (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'video',
      videoId TEXT,
      customerId TEXT,
      code TEXT NOT NULL UNIQUE,
      isActive INTEGER NOT NULL DEFAULT 1,
      expiresAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (videoId) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      createdAtIso TEXT NOT NULL,
      createdAtDe TEXT NOT NULL,
      ip TEXT NOT NULL,
      userAgent TEXT,
      eventType TEXT NOT NULL,
      code TEXT,
      videoId TEXT,
      videoTitle TEXT,
      customerId TEXT,
      customerName TEXT,
      success INTEGER NOT NULL,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      passwordSalt TEXT NOT NULL,
      twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
      twoFactorSecret TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_createdAtIso ON activity_logs(createdAtIso DESC);
  `);

  const videoColumns = await db.all('PRAGMA table_info(videos)');
  const videoColumnNames = new Set(videoColumns.map((col) => col.name));
  if (!videoColumnNames.has('customerId')) await db.exec('ALTER TABLE videos ADD COLUMN customerId TEXT');

  const codeColumns = await db.all('PRAGMA table_info(share_codes)');
  const codeColumnNames = new Set(codeColumns.map((col) => col.name));
  if (!codeColumnNames.has('scope')) await db.exec("ALTER TABLE share_codes ADD COLUMN scope TEXT DEFAULT 'video'");
  if (!codeColumnNames.has('customerId')) await db.exec('ALTER TABLE share_codes ADD COLUMN customerId TEXT');
  if (!codeColumnNames.has('isActive')) await db.exec('ALTER TABLE share_codes ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1');
  if (!codeColumnNames.has('expiresAt')) await db.exec('ALTER TABLE share_codes ADD COLUMN expiresAt TEXT');
  const videoIdMeta = codeColumns.find((col) => col.name === 'videoId');
  if (videoIdMeta && Number(videoIdMeta.notnull) === 1) {
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN TRANSACTION');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS share_codes_new (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'video',
        videoId TEXT,
        customerId TEXT,
        code TEXT NOT NULL UNIQUE,
        isActive INTEGER NOT NULL DEFAULT 1,
        expiresAt TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (videoId) REFERENCES videos(id) ON DELETE CASCADE,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
    `);
    await db.exec(`
      INSERT INTO share_codes_new (id, scope, videoId, customerId, code, isActive, expiresAt, createdAt)
      SELECT id, COALESCE(scope, 'video'), videoId, customerId, code, COALESCE(isActive, 1), expiresAt, createdAt
      FROM share_codes;
    `);
    await db.exec('DROP TABLE share_codes');
    await db.exec('ALTER TABLE share_codes_new RENAME TO share_codes');
    await db.exec('COMMIT');
    await db.exec('PRAGMA foreign_keys = ON');
  }

  const logColumns = await db.all('PRAGMA table_info(activity_logs)');
  const logColumnNames = new Set(logColumns.map((col) => col.name));
  if (!logColumnNames.has('customerId')) await db.exec('ALTER TABLE activity_logs ADD COLUMN customerId TEXT');
  if (!logColumnNames.has('customerName')) await db.exec('ALTER TABLE activity_logs ADD COLUMN customerName TEXT');

  const existingAdmin = await loadAdminAccount(db);
  if (!existingAdmin) {
    const salt = createPasswordSalt();
    const createdAt = nowIso();
    await db.run(
      `INSERT INTO admin_account (id, username, passwordHash, passwordSalt, twoFactorEnabled, twoFactorSecret, createdAt, updatedAt)
       VALUES (1, ?, ?, ?, 0, NULL, ?, ?)`,
      [ADMIN_DEFAULT_USER, hashPassword(ADMIN_DEFAULT_PASSWORD, salt), salt, createdAt, createdAt]
    );
  }

  await db.run("UPDATE share_codes SET scope = 'video' WHERE scope IS NULL OR scope = ''");
  await db.exec('CREATE INDEX IF NOT EXISTS idx_share_codes_videoId ON share_codes(videoId)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_share_codes_customerId ON share_codes(customerId)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_videos_customerId ON videos(customerId)');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Origin nicht erlaubt'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'videoplattform-api' });
  });

  app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const { username, password, otp } = req.body || {};
    const account = await loadAdminAccount(db);
    if (!account) return res.status(500).json({ error: 'Admin-Konto nicht verfügbar.' });

    const usernameOk = String(username || '') === account.username;
    const passwordOk = verifyPassword(String(password || ''), account.passwordSalt, account.passwordHash);
    const requiresTwoFactor = Boolean(account.twoFactorEnabled);
    const otpOk = !requiresTwoFactor || verifyTotp(account.twoFactorSecret, otp);
    const ok = usernameOk && passwordOk && otpOk;

    await logActivity(db, req, {
      eventType: 'admin_login',
      success: ok,
      detail: ok
        ? 'Admin Login erfolgreich'
        : usernameOk && passwordOk && requiresTwoFactor
          ? 'Admin Login fehlgeschlagen (2FA)'
          : 'Admin Login fehlgeschlagen',
    });

    if (!ok) {
      return res.status(401).json({
        error: usernameOk && passwordOk && requiresTwoFactor ? '2FA-Code ist erforderlich oder ungültig.' : 'Ungültige Zugangsdaten.',
        requiresTwoFactor: usernameOk && passwordOk && requiresTwoFactor,
      });
    }

    const token = uuidv4();
    adminTokens.set(token, {
      username: account.username,
      createdAtIso: nowIso(),
      expiresAtMs: Date.now() + ADMIN_TOKEN_TTL_MS,
    });

    return res.json({
      token,
      username: account.username,
      twoFactorEnabled: Number(account.twoFactorEnabled) === 1,
      expiresInSeconds: Math.floor(ADMIN_TOKEN_TTL_MS / 1000),
    });
  });

  app.post('/api/admin/logout', adminAuth, async (req, res) => {
    adminTokens.delete(req.adminToken);
    await logActivity(db, req, { eventType: 'admin_logout', success: true, detail: 'Admin abgemeldet' });
    res.status(204).send();
  });

  app.get('/api/admin/account', adminAuth, async (_req, res) => {
    try {
      const account = await loadAdminAccount(db);
      if (!account) return res.status(500).json({ error: 'Admin-Konto nicht gefunden.' });
      return res.json({
        username: account.username,
        twoFactorEnabled: Number(account.twoFactorEnabled) === 1,
      });
    } catch {
      return res.status(500).json({ error: 'Konto konnte nicht geladen werden.' });
    }
  });

  app.patch('/api/admin/account/username', adminAuth, async (req, res) => {
    const nextUsername = String(req.body?.username || '').trim();

    if (!nextUsername || nextUsername.length < 3 || nextUsername.length > 40) {
      return res.status(400).json({ error: 'Benutzername muss 3-40 Zeichen haben.' });
    }

    try {
      await db.run('UPDATE admin_account SET username = ?, updatedAt = ? WHERE id = 1', [nextUsername, nowIso()]);

      await logActivity(db, req, {
        eventType: 'admin_account_username_update',
        success: true,
        detail: 'Benutzername geändert',
      });

      return res.json({ username: nextUsername });
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Benutzername ist bereits vergeben.' });
      }
      return res.status(500).json({ error: 'Benutzername konnte nicht geändert werden.' });
    }
  });

  app.patch('/api/admin/account/password', adminAuth, async (req, res) => {
    const newPassword = String(req.body?.newPassword || '');

    if (newPassword.length < 10) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 10 Zeichen haben.' });
    }

    try {
      const account = await loadAdminAccount(db);
      if (!account) return res.status(500).json({ error: 'Admin-Konto nicht gefunden.' });

      if (verifyPassword(newPassword, account.passwordSalt, account.passwordHash)) {
        return res.status(400).json({ error: 'Neues Passwort darf nicht dem aktuellen Passwort entsprechen.' });
      }

      const salt = createPasswordSalt();
      const hash = hashPassword(newPassword, salt);
      await db.run('UPDATE admin_account SET passwordHash = ?, passwordSalt = ?, updatedAt = ? WHERE id = 1', [hash, salt, nowIso()]);

      await logActivity(db, req, {
        eventType: 'admin_account_password_update',
        success: true,
        detail: 'Passwort geändert',
      });

      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Passwort konnte nicht geändert werden.' });
    }
  });

  app.post('/api/admin/account/2fa/setup', adminAuth, async (req, res) => {
    const password = String(req.body?.password || '');

    try {
      const account = await loadAdminAccount(db);
      if (!account) return res.status(500).json({ error: 'Admin-Konto nicht gefunden.' });
      if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
        return res.status(401).json({ error: 'Passwort ist falsch.' });
      }

      const secret = generateTotpSecret();
      const uri = `otpauth://totp/${encodeURIComponent(`Webdesign Hammer (${account.username})`)}?secret=${secret}&issuer=${encodeURIComponent(
        'Webdesign Hammer'
      )}&algorithm=SHA1&digits=6&period=30`;

      await db.run('UPDATE admin_account SET twoFactorEnabled = 0, twoFactorSecret = ?, updatedAt = ? WHERE id = 1', [secret, nowIso()]);

      await logActivity(db, req, {
        eventType: 'admin_account_2fa_setup',
        success: true,
        detail: '2FA-Setup initialisiert',
      });

      return res.json({
        secret,
        secretFormatted: formatTotpSecret(secret),
        otpauthUrl: uri,
      });
    } catch {
      return res.status(500).json({ error: '2FA-Setup konnte nicht gestartet werden.' });
    }
  });

  app.post('/api/admin/account/2fa/enable', adminAuth, async (req, res) => {
    const password = String(req.body?.password || '');
    const otp = String(req.body?.otp || '');

    try {
      const account = await loadAdminAccount(db);
      if (!account) return res.status(500).json({ error: 'Admin-Konto nicht gefunden.' });
      if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
        return res.status(401).json({ error: 'Passwort ist falsch.' });
      }
      if (!account.twoFactorSecret) {
        return res.status(400).json({ error: 'Bitte zuerst 2FA-Setup starten.' });
      }
      if (!verifyTotp(account.twoFactorSecret, otp)) {
        return res.status(401).json({ error: '2FA-Code ist ungültig.' });
      }

      await db.run('UPDATE admin_account SET twoFactorEnabled = 1, updatedAt = ? WHERE id = 1', [nowIso()]);
      await logActivity(db, req, {
        eventType: 'admin_account_2fa_enable',
        success: true,
        detail: '2FA aktiviert',
      });

      adminTokens.clear();
      return res.json({ twoFactorEnabled: true, reLoginRequired: true });
    } catch {
      return res.status(500).json({ error: '2FA konnte nicht aktiviert werden.' });
    }
  });

  app.post('/api/admin/account/2fa/disable', adminAuth, async (req, res) => {
    const password = String(req.body?.password || '');
    const otp = String(req.body?.otp || '');

    try {
      const account = await loadAdminAccount(db);
      if (!account) return res.status(500).json({ error: 'Admin-Konto nicht gefunden.' });
      if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
        return res.status(401).json({ error: 'Passwort ist falsch.' });
      }
      if (Number(account.twoFactorEnabled) === 1 && !verifyTotp(account.twoFactorSecret, otp)) {
        return res.status(401).json({ error: '2FA-Code ist ungültig.' });
      }

      await db.run('UPDATE admin_account SET twoFactorEnabled = 0, twoFactorSecret = NULL, updatedAt = ? WHERE id = 1', [nowIso()]);
      await logActivity(db, req, {
        eventType: 'admin_account_2fa_disable',
        success: true,
        detail: '2FA deaktiviert',
      });

      adminTokens.clear();
      return res.json({ twoFactorEnabled: false, reLoginRequired: true });
    } catch {
      return res.status(500).json({ error: '2FA konnte nicht deaktiviert werden.' });
    }
  });

  app.get('/api/admin/customers', adminAuth, async (_req, res) => {
    try {
      const rows = await db.all(
        `SELECT c.id, c.name, c.createdAt,
                (SELECT COUNT(*) FROM videos v WHERE v.customerId = c.id) AS videoCount,
                (SELECT COUNT(*) FROM share_codes sc WHERE sc.customerId = c.id AND sc.scope = 'customer' AND sc.isActive = 1) AS activeCodeCount
         FROM customers c
         ORDER BY c.name COLLATE NOCASE ASC`
      );
      return res.json(rows);
    } catch {
      return res.status(500).json({ error: 'Kunden konnten nicht geladen werden.' });
    }
  });

  app.post('/api/admin/customers', adminAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Kundenname ist erforderlich.' });

    const customer = { id: uuidv4(), name, createdAt: nowIso() };
    try {
      await db.run('INSERT INTO customers (id, name, createdAt) VALUES (?, ?, ?)', [customer.id, customer.name, customer.createdAt]);
      await logActivity(db, req, {
        eventType: 'customer_create',
        success: true,
        customerId: customer.id,
        customerName: customer.name,
        detail: 'Kunde angelegt',
      });
      return res.status(201).json(customer);
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Kunde existiert bereits.' });
      }
      return res.status(500).json({ error: 'Kunde konnte nicht angelegt werden.' });
    }
  });

  app.patch('/api/admin/customers/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Kundenname ist erforderlich.' });

    try {
      const existing = await db.get('SELECT id, name FROM customers WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

      await db.run('UPDATE customers SET name = ? WHERE id = ?', [name, id]);

      await logActivity(db, req, {
        eventType: 'customer_update',
        success: true,
        customerId: id,
        customerName: name,
        detail: `Kunde umbenannt von "${existing.name}" zu "${name}"`,
      });

      const updated = await db.get(
        `SELECT c.id, c.name, c.createdAt,
                (SELECT COUNT(*) FROM videos v WHERE v.customerId = c.id) AS videoCount,
                (SELECT COUNT(*) FROM share_codes sc WHERE sc.customerId = c.id AND sc.scope = 'customer' AND sc.isActive = 1) AS activeCodeCount
         FROM customers c
         WHERE c.id = ?`,
        [id]
      );
      return res.json(updated);
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Kunde existiert bereits.' });
      }
      return res.status(500).json({ error: 'Kunde konnte nicht bearbeitet werden.' });
    }
  });

  app.delete('/api/admin/customers/:id', adminAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const existing = await db.get('SELECT id, name FROM customers WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

      await db.run('DELETE FROM customers WHERE id = ?', [id]);

      await logActivity(db, req, {
        eventType: 'customer_delete',
        success: true,
        customerId: id,
        customerName: existing.name,
        detail: 'Kunde gelöscht. Zugeordnete Videos bleiben erhalten ohne Kundenzuordnung.',
      });

      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Kunde konnte nicht gelöscht werden.' });
    }
  });

  app.get('/api/admin/videos', adminAuth, async (_req, res) => {
    try {
      const videos = await db.all(
        `SELECT v.id, v.title, v.description, v.sourceType, v.videoUrl, v.fileName, v.filePath, v.mimeType,
                v.sizeBytes, v.category, v.customerId, c.name AS customerName, v.createdAt,
                (SELECT COUNT(*) FROM share_codes sc WHERE sc.videoId = v.id AND sc.scope = 'video' AND sc.isActive = 1) AS activeCodeCount
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         ORDER BY v.createdAt DESC`
      );
      res.json(videos);
    } catch {
      res.status(500).json({ error: 'Videos konnten nicht geladen werden.' });
    }
  });

  app.get('/api/admin/videos/:id/stream', async (req, res) => {
    const token = String(req.query.token || '');
    const session = getAdminSessionFromToken(token);
    if (!session) return res.status(401).json({ error: 'Nicht autorisiert.' });

    const { id } = req.params;
    const video = await db.get('SELECT filePath, mimeType FROM videos WHERE id = ?', [id]);
    if (!video || !video.filePath) return res.status(404).json({ error: 'Video nicht gefunden.' });

    const absPath = path.join(UPLOAD_DIR, video.filePath);
    return sendVideoFile(req, res, absPath, video.mimeType || 'video/mp4');
  });

  app.get('/api/admin/activity', adminAuth, async (req, res) => {
    const limitRaw = Number(req.query.limit || 300);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 300));

    try {
      const rows = await db.all(
        `SELECT id, createdAtIso, createdAtDe, ip, userAgent, eventType, code, videoId, videoTitle,
                customerId, customerName, success, detail
         FROM activity_logs
         ORDER BY createdAtIso DESC
         LIMIT ?`,
        [limit]
      );
      return res.json(rows);
    } catch {
      return res.status(500).json({ error: 'Aktivitätslog konnte nicht geladen werden.' });
    }
  });

  app.post('/api/admin/videos/upload', adminAuth, upload.single('video'), async (req, res) => {
    const file = req.file;
    const { title, description = '', category = 'Allgemein', customerId = '' } = req.body || {};

    if (!file) return res.status(400).json({ error: 'Bitte Videodatei hochladen.' });
    if (!title || !String(title).trim()) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Titel ist erforderlich.' });
    }
    if (!customerId || !String(customerId).trim()) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Bitte einen Kunden auswählen.' });
    }

    const customer = await db.get('SELECT id, name FROM customers WHERE id = ?', [String(customerId)]);
    if (!customer) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Ausgewählter Kunde nicht gefunden.' });
    }

    let converted;
    try {
      converted = await convertUploadToMp4(file.path, file.originalname);
      if (fs.existsSync(file.path)) fs.unlink(file.path, () => {});
    } catch (error) {
      fs.unlink(file.path, () => {});
      return res.status(500).json({
        error: `Video konnte nicht konvertiert werden. ${String(error.message || '')}`.trim(),
      });
    }

    const video = {
      id: uuidv4(),
      title: String(title).trim(),
      description: String(description || '').trim(),
      sourceType: 'upload',
      videoUrl: '',
      fileName: converted.fileName,
      filePath: converted.filePath,
      mimeType: converted.mimeType,
      sizeBytes: converted.sizeBytes,
      category: String(category).trim() || 'Allgemein',
      customerId: customer.id,
      createdAt: nowIso(),
    };

    try {
      await db.run(
        `INSERT INTO videos (id, title, description, sourceType, videoUrl, fileName, filePath, mimeType, sizeBytes, category, customerId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          video.id,
          video.title,
          video.description,
          video.sourceType,
          video.videoUrl,
          video.fileName,
          video.filePath,
          video.mimeType,
          video.sizeBytes,
          video.category,
          video.customerId,
          video.createdAt,
        ]
      );

      await logActivity(db, req, {
        eventType: 'video_upload',
        success: true,
        videoId: video.id,
        videoTitle: video.title,
        customerId: customer.id,
        customerName: customer.name,
        detail: `Upload + Konvertierung ${video.fileName}`,
      });

      res.status(201).json({ ...video, customerName: customer.name });
    } catch {
      fs.unlink(file.path, () => {});
      res.status(500).json({ error: 'Video konnte nicht gespeichert werden.' });
    }
  });

  app.delete('/api/admin/videos/:id', adminAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const existing = await db.get(
        `SELECT v.sourceType, v.filePath, v.title, v.customerId, c.name AS customerName
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         WHERE v.id = ?`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Video nicht gefunden.' });

      await db.run("DELETE FROM share_codes WHERE videoId = ? AND scope = 'video'", [id]);
      await db.run('DELETE FROM videos WHERE id = ?', [id]);

      if (existing.sourceType === 'upload' && existing.filePath) {
        const absPath = path.join(UPLOAD_DIR, existing.filePath);
        if (fs.existsSync(absPath)) fs.unlink(absPath, () => {});
      }

      await logActivity(db, req, {
        eventType: 'video_delete',
        success: true,
        videoId: id,
        videoTitle: existing.title,
        customerId: existing.customerId,
        customerName: existing.customerName,
        detail: 'Video gelöscht',
      });

      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Video konnte nicht gelöscht werden.' });
    }
  });

  app.patch('/api/admin/videos/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description = '', category, customerId } = req.body || {};

    const cleanTitle = String(title || '').trim();
    const cleanCategory = String(category || '').trim();
    const cleanDescription = String(description || '').trim();
    const cleanCustomerId = String(customerId || '').trim();

    if (!cleanTitle) return res.status(400).json({ error: 'Titel ist erforderlich.' });
    if (!cleanCategory) return res.status(400).json({ error: 'Kategorie ist erforderlich.' });
    if (!cleanCustomerId) return res.status(400).json({ error: 'Kunde ist erforderlich.' });

    try {
      const existing = await db.get(
        `SELECT v.id, v.title, v.customerId, c.name AS customerName
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         WHERE v.id = ?`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Video nicht gefunden.' });

      const customer = await db.get('SELECT id, name FROM customers WHERE id = ?', [cleanCustomerId]);
      if (!customer) return res.status(400).json({ error: 'Ausgewählter Kunde nicht gefunden.' });

      const result = await db.run(
        `UPDATE videos
         SET title = ?, description = ?, category = ?, customerId = ?
         WHERE id = ?`,
        [cleanTitle, cleanDescription, cleanCategory, customer.id, id]
      );
      if (!result.changes) return res.status(404).json({ error: 'Video nicht gefunden.' });

      await logActivity(db, req, {
        eventType: 'video_update',
        success: true,
        videoId: id,
        videoTitle: cleanTitle,
        customerId: customer.id,
        customerName: customer.name,
        detail: 'Video-Metadaten bearbeitet',
      });

      const updated = await db.get(
        `SELECT v.id, v.title, v.description, v.sourceType, v.videoUrl, v.fileName, v.filePath, v.mimeType,
                v.sizeBytes, v.category, v.customerId, c.name AS customerName, v.createdAt,
                (SELECT COUNT(*) FROM share_codes sc WHERE sc.videoId = v.id AND sc.scope = 'video' AND sc.isActive = 1) AS activeCodeCount
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         WHERE v.id = ?`,
        [id]
      );

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Video konnte nicht aktualisiert werden.' });
    }
  });

  app.post('/api/admin/videos/:id/replace', adminAuth, upload.single('video'), async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    const { title, description = '', category, customerId } = req.body || {};

    const cleanTitle = String(title || '').trim();
    const cleanCategory = String(category || '').trim();
    const cleanDescription = String(description || '').trim();
    const cleanCustomerId = String(customerId || '').trim();

    if (!file) return res.status(400).json({ error: 'Bitte Videodatei auswählen.' });
    if (!cleanTitle) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Titel ist erforderlich.' });
    }
    if (!cleanCategory) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Kategorie ist erforderlich.' });
    }
    if (!cleanCustomerId) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: 'Kunde ist erforderlich.' });
    }

    try {
      const existing = await db.get(
        `SELECT v.id, v.title, v.sourceType, v.filePath, v.customerId, c.name AS customerName
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         WHERE v.id = ?`,
        [id]
      );
      if (!existing) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ error: 'Video nicht gefunden.' });
      }

      const customer = await db.get('SELECT id, name FROM customers WHERE id = ?', [cleanCustomerId]);
      if (!customer) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Ausgewählter Kunde nicht gefunden.' });
      }

      let converted;
      try {
        converted = await convertUploadToMp4(file.path, file.originalname);
        if (fs.existsSync(file.path)) fs.unlink(file.path, () => {});
      } catch (error) {
        fs.unlink(file.path, () => {});
        return res.status(500).json({
          error: `Video konnte nicht konvertiert werden. ${String(error.message || '')}`.trim(),
        });
      }

      try {
        const result = await db.run(
          `UPDATE videos
           SET title = ?, description = ?, category = ?, customerId = ?,
               sourceType = 'upload', videoUrl = '', fileName = ?, filePath = ?, mimeType = ?, sizeBytes = ?
           WHERE id = ?`,
          [
            cleanTitle,
            cleanDescription,
            cleanCategory,
            customer.id,
            converted.fileName,
            converted.filePath,
            converted.mimeType,
            converted.sizeBytes,
            id,
          ]
        );
        if (!result.changes) {
          const convertedPath = path.join(UPLOAD_DIR, converted.filePath);
          if (fs.existsSync(convertedPath)) fs.unlink(convertedPath, () => {});
          return res.status(404).json({ error: 'Video nicht gefunden.' });
        }
      } catch {
        const convertedPath = path.join(UPLOAD_DIR, converted.filePath);
        if (fs.existsSync(convertedPath)) fs.unlink(convertedPath, () => {});
        throw new Error('replace-db-failed');
      }

      if (existing.sourceType === 'upload' && existing.filePath) {
        const oldPath = path.join(UPLOAD_DIR, existing.filePath);
        if (oldPath !== path.join(UPLOAD_DIR, converted.filePath) && fs.existsSync(oldPath)) {
          fs.unlink(oldPath, () => {});
        }
      }

      await logActivity(db, req, {
        eventType: 'video_replace',
        success: true,
        videoId: id,
        videoTitle: cleanTitle,
        customerId: customer.id,
        customerName: customer.name,
        detail: `Videodatei ersetzt + konvertiert (${converted.fileName})`,
      });

      const updated = await db.get(
        `SELECT v.id, v.title, v.description, v.sourceType, v.videoUrl, v.fileName, v.filePath, v.mimeType,
                v.sizeBytes, v.category, v.customerId, c.name AS customerName, v.createdAt,
                (SELECT COUNT(*) FROM share_codes sc WHERE sc.videoId = v.id AND sc.scope = 'video' AND sc.isActive = 1) AS activeCodeCount
         FROM videos v
         LEFT JOIN customers c ON c.id = v.customerId
         WHERE v.id = ?`,
        [id]
      );

      return res.json(updated);
    } catch {
      fs.unlink(file.path, () => {});
      return res.status(500).json({ error: 'Videodatei konnte nicht ersetzt werden.' });
    }
  });

  app.get('/api/admin/videos/:id/codes', adminAuth, async (req, res) => {
    const { id } = req.params;
    try {
      const codes = await db.all(
        `SELECT id, code, isActive, expiresAt, createdAt
         FROM share_codes
         WHERE videoId = ? AND scope = 'video'
         ORDER BY createdAt DESC`,
        [id]
      );
      return res.json(codes);
    } catch {
      return res.status(500).json({ error: 'Codes konnten nicht geladen werden.' });
    }
  });

  app.post('/api/admin/videos/:id/codes', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { expiresAt = null, customCode = '' } = req.body || {};

    const video = await db.get(
      `SELECT v.id, v.title, v.customerId, c.name AS customerName
       FROM videos v LEFT JOIN customers c ON c.id = v.customerId
       WHERE v.id = ?`,
      [id]
    );
    if (!video) return res.status(404).json({ error: 'Video nicht gefunden.' });

    let code = sanitizeCode(customCode);
    if (!code) code = randomCode();
    if (!/^[A-Z0-9-]{6,24}$/.test(code)) {
      return res.status(400).json({ error: 'Code muss 6-24 Zeichen (A-Z, 0-9, -) haben.' });
    }

    try {
      const created = {
        id: uuidv4(),
        scope: 'video',
        videoId: id,
        customerId: video.customerId || null,
        code,
        isActive: 1,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        createdAt: nowIso(),
      };

      await db.run(
        `INSERT INTO share_codes (id, scope, videoId, customerId, code, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          created.id,
          created.scope,
          created.videoId,
          created.customerId,
          created.code,
          created.isActive,
          created.expiresAt,
          created.createdAt,
        ]
      );

      await logActivity(db, req, {
        eventType: 'code_create_video',
        success: true,
        code: created.code,
        videoId: video.id,
        videoTitle: video.title,
        customerId: video.customerId,
        customerName: video.customerName,
        detail: 'Video-Code erstellt',
      });

      return res.status(201).json(created);
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Code existiert bereits.' });
      }
      return res.status(500).json({ error: 'Code konnte nicht erstellt werden.' });
    }
  });

  app.get('/api/admin/customers/:id/codes', adminAuth, async (req, res) => {
    const { id } = req.params;
    try {
      const codes = await db.all(
        `SELECT id, code, isActive, expiresAt, createdAt
         FROM share_codes
         WHERE customerId = ? AND scope = 'customer'
         ORDER BY createdAt DESC`,
        [id]
      );
      return res.json(codes);
    } catch {
      return res.status(500).json({ error: 'Kundencodes konnten nicht geladen werden.' });
    }
  });

  app.post('/api/admin/customers/:id/codes', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { expiresAt = null, customCode = '' } = req.body || {};

    const customer = await db.get('SELECT id, name FROM customers WHERE id = ?', [id]);
    if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    let code = sanitizeCode(customCode);
    if (!code) code = randomCode();
    if (!/^[A-Z0-9-]{6,24}$/.test(code)) {
      return res.status(400).json({ error: 'Code muss 6-24 Zeichen (A-Z, 0-9, -) haben.' });
    }

    try {
      const created = {
        id: uuidv4(),
        scope: 'customer',
        videoId: null,
        customerId: customer.id,
        code,
        isActive: 1,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        createdAt: nowIso(),
      };

      await db.run(
        `INSERT INTO share_codes (id, scope, videoId, customerId, code, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          created.id,
          created.scope,
          created.videoId,
          created.customerId,
          created.code,
          created.isActive,
          created.expiresAt,
          created.createdAt,
        ]
      );

      await logActivity(db, req, {
        eventType: 'code_create_customer',
        success: true,
        code: created.code,
        customerId: customer.id,
        customerName: customer.name,
        detail: 'Kunden-Code erstellt',
      });

      return res.status(201).json(created);
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Code existiert bereits.' });
      }
      return res.status(500).json({ error: 'Code konnte nicht erstellt werden.' });
    }
  });

  app.patch('/api/admin/codes/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive muss true/false sein.' });

    try {
      const existing = await db.get(
        `SELECT sc.code, sc.scope, sc.videoId, sc.customerId,
                v.title AS videoTitle, c.name AS customerName
         FROM share_codes sc
         LEFT JOIN videos v ON v.id = sc.videoId
         LEFT JOIN customers c ON c.id = sc.customerId
         WHERE sc.id = ?`,
        [id]
      );
      if (!existing) return res.status(404).json({ error: 'Code nicht gefunden.' });

      const result = await db.run('UPDATE share_codes SET isActive = ? WHERE id = ?', [isActive ? 1 : 0, id]);
      if (!result.changes) return res.status(404).json({ error: 'Code nicht gefunden.' });

      await logActivity(db, req, {
        eventType: existing.scope === 'customer' ? 'code_toggle_customer' : 'code_toggle_video',
        success: true,
        code: existing.code,
        videoId: existing.videoId,
        videoTitle: existing.videoTitle,
        customerId: existing.customerId,
        customerName: existing.customerName,
        detail: isActive ? 'Code aktiviert' : 'Code deaktiviert',
      });

      return res.status(204).send();
    } catch {
      return res.status(500).json({ error: 'Code-Status konnte nicht aktualisiert werden.' });
    }
  });

  app.post('/api/access/by-code', codeLimiter, async (req, res) => {
    const inputCode = sanitizeCode(req.body?.code);
    const access = await findAccessByCode(db, inputCode);

    if (!access) {
      await logActivity(db, req, {
        eventType: 'code_enter',
        success: false,
        code: inputCode || null,
        detail: 'Code ungültig oder abgelaufen',
      });
      return res.status(404).json({ error: 'Freigabecode ungültig oder abgelaufen.' });
    }

    const videos = await loadVideosForAccess(db, access);
    if (!videos.length) {
      await logActivity(db, req, {
        eventType: 'code_enter',
        success: false,
        code: access.code,
        customerId: access.customerId,
        customerName: access.customerName,
        detail: 'Code gültig, aber keine Videos vorhanden',
      });
      return res.status(404).json({ error: 'Für diesen Code sind keine Videos freigegeben.' });
    }

    const mapped = videos.map((video) => ({
      id: video.id,
      title: video.title,
      description: video.description,
      category: video.category,
      mimeType: video.mimeType,
      createdAt: video.createdAt,
      sourceType: video.sourceType,
      customerId: video.customerId,
      customerName: video.customerName,
      streamUrl:
        video.sourceType === 'upload'
          ? `/api/public/videos/${video.id}/stream?code=${encodeURIComponent(access.code)}`
          : video.videoUrl,
    }));

    await logActivity(db, req, {
      eventType: 'code_enter',
      success: true,
      code: access.code,
      customerId: access.customerId,
      customerName: access.customerName,
      detail: `Code erfolgreich eingelöst (${access.scope})`,
    });

    return res.json({
      code: access.code,
      scope: access.scope,
      customerId: access.customerId,
      customerName: access.customerName,
      videos: mapped,
    });
  });

  app.get('/api/public/videos/:id/stream', streamLimiter, async (req, res) => {
    const { id } = req.params;
    const code = sanitizeCode(req.query.code);

    const access = await findAccessByCode(db, code);
    if (!access) {
      await logActivity(db, req, {
        eventType: 'video_stream',
        success: false,
        code,
        videoId: id,
        detail: 'Stream-Zugriff verweigert (Code)',
      });
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Video.' });
    }

    const video = await db.get(
      `SELECT v.id, v.title, v.filePath, v.mimeType, v.customerId, c.name AS customerName
       FROM videos v LEFT JOIN customers c ON c.id = v.customerId
       WHERE v.id = ?`,
      [id]
    );

    if (!video || !video.filePath) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const allowed =
      (access.scope === 'video' && access.videoId === video.id) ||
      (access.scope === 'customer' && access.customerId && access.customerId === video.customerId);

    if (!allowed) {
      await logActivity(db, req, {
        eventType: 'video_stream',
        success: false,
        code: access.code,
        videoId: video.id,
        videoTitle: video.title,
        customerId: video.customerId,
        customerName: video.customerName,
        detail: 'Stream-Zugriff verweigert (Scope)',
      });
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Video.' });
    }

    if (shouldLogStream(req.headers.range)) {
      await logActivity(db, req, {
        eventType: 'video_stream',
        success: true,
        code: access.code,
        videoId: video.id,
        videoTitle: video.title,
        customerId: video.customerId,
        customerName: video.customerName,
        detail: 'Video gestartet',
      });
    }

    const absPath = path.join(UPLOAD_DIR, video.filePath);
    return sendVideoFile(req, res, absPath, video.mimeType || 'video/mp4');
  });

  app.use(express.static(FRONTEND_DIR, { index: false }));

  app.get(['/admin', '/'], (_req, res) => {
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(503).json({ error: 'Frontend ist noch nicht bereitgestellt.' });
    }
    return res.sendFile(indexPath);
  });

  app.get(/^\/admin\/.*$/, (_req, res) => {
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(503).json({ error: 'Frontend ist noch nicht bereitgestellt.' });
    }
    return res.sendFile(indexPath);
  });

  app.use((err, _req, res, _next) => {
    if (String(err?.message || '').includes('Origin nicht erlaubt')) {
      return res.status(403).json({ error: 'CORS: Origin nicht erlaubt.' });
    }
    if (String(err?.message || '').includes('Nur Video-Dateien')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Interner Serverfehler.' });
  });

  return app;
}

createApp()
  .then((app) => {
    app.listen(PORT, () => {
      console.log(`Videoplattform API läuft auf http://localhost:${PORT}`);
      console.log(`CORS erlaubt für: ${CORS_ORIGINS.join(', ')}`);
    });
  })
  .catch((error) => {
    console.error('Fehler beim Starten des Servers:', error);
    process.exit(1);
  });
