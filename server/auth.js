const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, logAudit } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'gasg-secure-jwt-secret-bcra-114272-key-2026';
const COOKIE_NAME = 'gasg_admin_token';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  }
});

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function verifyTokenAndUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const admin = db.prepare(
      'SELECT id, username, full_name, role, created_at, last_login FROM admin_users WHERE id = ? AND username = ?'
    ).get(decoded.id, decoded.username);
    return admin || null;
  } catch (_) {
    return null;
  }
}

function requireAdminAuth(req, res, next) {
  const admin = verifyTokenAndUser(req);
  if (!admin) {
    return res.status(401).json({
      error: 'Unauthorized: Valid administrator authentication is required.'
    });
  }
  req.admin = admin;
  next();
}

function registerAuthRoutes(app) {
  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      logAudit(username.trim(), 'LOGIN_FAILED', 'Invalid credentials attempt');
      return res.status(401).json({ error: 'Invalid administrator username or password.' });
    }

    db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    logAudit(user.username, 'LOGIN_SUCCESS', 'Administrator signed in');

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/'
    });

    return res.json({
      authenticated: true,
      token,
      admin: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        last_login: new Date().toISOString()
      }
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const admin = verifyTokenAndUser(req);
    if (admin) {
      logAudit(admin.username, 'LOGOUT', 'Administrator signed out');
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ success: true, message: 'Logged out successfully.' });
  });

  app.get('/api/auth/me', requireAdminAuth, (req, res) => {
    return res.json({ authenticated: true, admin: req.admin });
  });

  app.put('/api/auth/password', requireAdminAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.id);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(newHash, req.admin.id);
    logAudit(req.admin.username, 'PASSWORD_CHANGED', 'Administrator updated password');

    return res.json({ success: true, message: 'Password updated successfully.' });
  });

  app.put('/api/auth/profile', requireAdminAuth, (req, res) => {
    const { full_name } = req.body || {};
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    db.prepare('UPDATE admin_users SET full_name = ? WHERE id = ?').run(String(full_name).trim(), req.admin.id);
    logAudit(req.admin.username, 'PROFILE_UPDATED', `Updated full_name to ${String(full_name).trim()}`);
    return res.json({ success: true, full_name: String(full_name).trim() });
  });
}

module.exports = {
  COOKIE_NAME,
  verifyTokenAndUser,
  requireAdminAuth,
  registerAuthRoutes
};
