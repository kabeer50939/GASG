const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { seedAuthenticData } = require('./db');
const { verifyTokenAndUser, registerAuthRoutes } = require('./auth');
const { registerApiRoutes } = require('./routes');

// Initialize schema and seed authentic PPTX data if DB is empty
seedAuthenticData(false);

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"]
      }
    }
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Register Auth & API Routes
registerAuthRoutes(app);
registerApiRoutes(app);

// ============================================================================
// STRICT ISOLATION OF ADMIN PANEL ROUTES
// Unauthenticated users cannot access the Admin Dashboard HTML or Admin JS
// ============================================================================
const adminDir = path.join(__dirname, '..', 'admin');
const publicDir = path.join(__dirname, '..', 'public');

app.get('/admin/login', (req, res) => {
  const admin = verifyTokenAndUser(req);
  if (admin) {
    return res.redirect('/admin');
  }
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(adminDir, 'login.html'));
});

app.get('/admin/css/admin.css', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.sendFile(path.join(adminDir, 'css', 'admin.css'), { etag: false, lastModified: false });
});

app.get('/admin/js/login.js', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.sendFile(path.join(adminDir, 'js', 'login.js'), { etag: false, lastModified: false });
});

app.get('/admin/js/admin.js', (req, res) => {
  const admin = verifyTokenAndUser(req);
  if (!admin) {
    return res.status(401).type('application/javascript').send('// Unauthorized');
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.sendFile(path.join(adminDir, 'js', 'admin.js'), { etag: false, lastModified: false });
});

app.get(['/admin', '/admin/'], (req, res) => {
  const admin = verifyTokenAndUser(req);
  if (!admin) {
    return res.redirect('/admin/login');
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.sendFile(path.join(adminDir, 'index.html'), { etag: false, lastModified: false });
});

// Block any other direct path under /admin/*
app.use('/admin', (req, res) => {
  const admin = verifyTokenAndUser(req);
  if (!admin) {
    return res.redirect('/admin/login');
  }
  return res.redirect('/admin');
});

// ============================================================================
// PUBLIC PORTAL ROUTES
// ============================================================================
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Catch-all for unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Fallback for SPA navigation on Public Portal
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Gwadar Ambulance Service Portal running on http://localhost:${PORT}`);
    console.log(`Public Portal: http://localhost:${PORT}/`);
    console.log(`Secure Admin Panel: http://localhost:${PORT}/admin`);
  });
}

module.exports = app;
