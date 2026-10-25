const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const {
  db,
  seedAuthenticData,
  syncLocalBackup,
  exportPortalDataJson,
  getStandaloneDatabaseBuffer,
  restoreDatabaseFromFile,
  logAudit,
  getAllPublicPortalData
} = require('./db');
const { requireAdminAuth } = require('./auth');

const customUploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'custom');
if (!fs.existsSync(customUploadsDir)) {
  fs.mkdirSync(customUploadsDir, { recursive: true });
}

const tempBackupDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(tempBackupDir)) {
  fs.mkdirSync(tempBackupDir, { recursive: true });
}

const backupUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempBackupDir),
    filename: (_req, _file, cb) => cb(null, `temp_restore_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.sqlite`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, customUploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeName = `gasg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.toLowerCase());
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files (JPG, PNG, WEBP, GIF) are allowed.'));
  }
});

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please wait a few minutes before submitting again.' }
});

function registerApiRoutes(app) {
  // =========================================================================
  // PUBLIC PORTAL ENDPOINTS (Strictly Read-Only + Public Inquiry Form)
  // =========================================================================
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Gwadar Ambulance Service Portal', timestamp: new Date().toISOString() });
  });

  app.get('/api/public/portal-data', (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const data = getAllPublicPortalData();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load portal content.' });
    }
  });

  app.post('/api/public/contact', contactLimiter, (req, res) => {
    const { sender_name, sender_phone, sender_email, subject, message_type, message } = req.body || {};
    if (!sender_name || !sender_phone || !subject || !message) {
      return res.status(400).json({ error: 'Name, phone number, subject, and message are required.' });
    }
    if (String(message).trim().length < 5) {
      return res.status(400).json({ error: 'Please enter a valid message.' });
    }

    const result = db.prepare(`
      INSERT INTO contact_messages (sender_name, sender_phone, sender_email, subject, message_type, message, status)
      VALUES (?, ?, ?, ?, ?, ?, 'unread')
    `).run(
      String(sender_name).trim().slice(0, 120),
      String(sender_phone).trim().slice(0, 60),
      String(sender_email || '').trim().slice(0, 120),
      String(subject).trim().slice(0, 200),
      String(message_type || 'General Inquiry').trim().slice(0, 80),
      String(message).trim().slice(0, 4000)
    );

    return res.status(201).json({
      success: true,
      id: Number(result.lastInsertRowid),
      message: 'Your inquiry has been submitted to Gwadar Ambulance Service administration.'
    });
  });

  // =========================================================================
  // SECURE ADMIN PANEL ENDPOINTS (All protected by requireAdminAuth)
  // =========================================================================
  const adminRouter = express.Router();
  adminRouter.use(requireAdminAuth);

  // Auto-sync portal_data.json and linked backup after every admin mutation
  adminRouter.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            exportPortalDataJson();
            syncLocalBackup();
          } catch (_) {}
        }
        return originalJson(body);
      };
    }
    next();
  });

  // Full Admin Dashboard & Complete CMS Dataset
  adminRouter.get('/dashboard', (_req, res) => {
    const settingsRows = db.prepare('SELECT setting_key, setting_value FROM site_settings').all();
    const settings = {};
    for (const r of settingsRows) settings[r.setting_key] = r.setting_value;

    const missionPoints = db.prepare('SELECT * FROM mission_points ORDER BY display_order ASC, id ASC').all();
    const services = db.prepare('SELECT * FROM services ORDER BY display_order ASC, id ASC').all();
    const patientStats = db.prepare('SELECT * FROM patient_stats ORDER BY stat_group ASC, display_order ASC, id ASC').all();
    const disasters = db.prepare('SELECT * FROM disasters_operations ORDER BY display_order ASC, id ASC').all();
    const ambulances = db.prepare('SELECT * FROM ambulances ORDER BY display_order ASC, id ASC').all();
    const teamMembers = db.prepare('SELECT * FROM team_members ORDER BY hierarchy_level ASC, display_order ASC, id ASC').all();
    const facilities = db.prepare('SELECT * FROM facilities ORDER BY display_order ASC, id ASC').all();
    const medicalInventory = db.prepare('SELECT * FROM medical_inventory ORDER BY camp_name ASC, serial_no ASC, id ASC').all();
    const projectsDemands = db.prepare('SELECT * FROM projects_demands ORDER BY item_type ASC, display_order ASC, id ASC').all();
    const gallery = db.prepare('SELECT * FROM gallery_items ORDER BY display_order ASC, id ASC').all();
    const contactMessages = db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all();
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
    const admins = db.prepare('SELECT id, username, full_name, role, created_at, last_login FROM admin_users ORDER BY id ASC').all();

    res.json({
      settings,
      missionPoints,
      services,
      patientStats,
      disasters,
      ambulances,
      teamMembers,
      facilities,
      medicalInventory,
      projectsDemands,
      gallery,
      contactMessages,
      auditLogs,
      admins
    });
  });

  // Update Site & Header Settings
  adminRouter.put('/settings', (req, res) => {
    const updates = req.body || {};
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Invalid settings object.' });
    }
    const stmt = db.prepare(`
      INSERT INTO site_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = CURRENT_TIMESTAMP
    `);
    for (const [key, val] of Object.entries(updates)) {
      if (typeof key === 'string' && key.trim()) {
        stmt.run(key.trim(), String(val ?? ''));
      }
    }
    logAudit(req.admin.username, 'SETTINGS_UPDATED', Object.keys(updates).join(', '));
    res.json({ success: true, message: 'Site and Header settings saved.' });
  });

  // Upload Media File
  adminRouter.post('/upload', (req, res) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Image upload failed.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const fileUrl = `/uploads/custom/${req.file.filename}`;
      logAudit(req.admin.username, 'MEDIA_UPLOADED', fileUrl);
      return res.status(201).json({ success: true, url: fileUrl, filename: req.file.filename });
    });
  });

  // List available PPTX & Uploaded media files for easy selection in Admin Panel
  adminRouter.get('/media-library', (_req, res) => {
    const pptxDir = path.join(__dirname, '..', 'public', 'uploads', 'pptx');
    const files = [];
    if (fs.existsSync(pptxDir)) {
      for (const f of fs.readdirSync(pptxDir)) {
        if (/\.(jpe?g|png|webp|gif)$/i.test(f)) {
          files.push({ name: f, url: `/uploads/pptx/${f}`, source: 'Official PPTX' });
        }
      }
    }
    if (fs.existsSync(customUploadsDir)) {
      for (const f of fs.readdirSync(customUploadsDir)) {
        if (/\.(jpe?g|png|webp|gif)$/i.test(f)) {
          files.push({ name: f, url: `/uploads/custom/${f}`, source: 'Admin Upload' });
        }
      }
    }
    res.json({ files });
  });

  // Reset / Re-seed Official PPTX Data
  adminRouter.post('/reset-pptx-data', (req, res) => {
    const result = seedAuthenticData(true);
    logAudit(req.admin.username, 'RESET_TO_PPTX_DATA', result.message);
    res.json({ success: true, ...result });
  });

  // 1. Mission Points CRUD
  adminRouter.post('/mission-points', (req, res) => {
    const { point_text, display_order = 1, is_active = 1 } = req.body || {};
    if (!point_text || !String(point_text).trim()) {
      return res.status(400).json({ error: 'Mission point text is required.' });
    }
    const r = db.prepare(`
      INSERT INTO mission_points (point_text, display_order, is_active) VALUES (?, ?, ?)
    `).run(String(point_text).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'MISSION_CREATED', String(point_text).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/mission-points/:id', (req, res) => {
    const id = Number(req.params.id);
    const { point_text, display_order = 1, is_active = 1 } = req.body || {};
    if (!point_text || !String(point_text).trim()) {
      return res.status(400).json({ error: 'Mission point text is required.' });
    }
    db.prepare(`
      UPDATE mission_points SET point_text = ?, display_order = ?, is_active = ? WHERE id = ?
    `).run(String(point_text).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'MISSION_UPDATED', `ID ${id}`);
    res.json({ success: true });
  });

  adminRouter.delete('/mission-points/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM mission_points WHERE id = ?').run(id);
    logAudit(req.admin.username, 'MISSION_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 2. Services CRUD
  adminRouter.post('/services', (req, res) => {
    const { title, category, description, icon_name = 'ambulance', stats_badge = '', image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !description) {
      return res.status(400).json({ error: 'Title, category, and description are required.' });
    }
    const r = db.prepare(`
      INSERT INTO services (title, category, description, icon_name, stats_badge, image_url, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(title).trim(), String(category).trim(), String(description).trim(), String(icon_name).trim(), String(stats_badge).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'SERVICE_CREATED', String(title).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/services/:id', (req, res) => {
    const id = Number(req.params.id);
    const { title, category, description, icon_name = 'ambulance', stats_badge = '', image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !description) {
      return res.status(400).json({ error: 'Title, category, and description are required.' });
    }
    db.prepare(`
      UPDATE services
      SET title = ?, category = ?, description = ?, icon_name = ?, stats_badge = ?, image_url = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(title).trim(), String(category).trim(), String(description).trim(), String(icon_name).trim(), String(stats_badge).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'SERVICE_UPDATED', `ID ${id}: ${title}`);
    res.json({ success: true });
  });

  adminRouter.delete('/services/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    logAudit(req.admin.username, 'SERVICE_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 3. Patient & Mortuary Stats CRUD
  adminRouter.post('/patient-stats', (req, res) => {
    const { stat_group, label, count_value, sub_details = '', display_order = 1 } = req.body || {};
    if (!stat_group || !label || count_value === undefined) {
      return res.status(400).json({ error: 'Stat group, label, and count value are required.' });
    }
    const r = db.prepare(`
      INSERT INTO patient_stats (stat_group, label, count_value, sub_details, display_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(stat_group).trim(), String(label).trim(), Number(count_value) || 0, String(sub_details).trim(), Number(display_order) || 1);
    logAudit(req.admin.username, 'STAT_CREATED', `${stat_group}: ${label}=${count_value}`);
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/patient-stats/:id', (req, res) => {
    const id = Number(req.params.id);
    const { stat_group, label, count_value, sub_details = '', display_order = 1 } = req.body || {};
    if (!stat_group || !label || count_value === undefined) {
      return res.status(400).json({ error: 'Stat group, label, and count value are required.' });
    }
    db.prepare(`
      UPDATE patient_stats
      SET stat_group = ?, label = ?, count_value = ?, sub_details = ?, display_order = ?
      WHERE id = ?
    `).run(String(stat_group).trim(), String(label).trim(), Number(count_value) || 0, String(sub_details).trim(), Number(display_order) || 1, id);
    logAudit(req.admin.username, 'STAT_UPDATED', `ID ${id}: ${label}=${count_value}`);
    res.json({ success: true });
  });

  adminRouter.delete('/patient-stats/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM patient_stats WHERE id = ?').run(id);
    logAudit(req.admin.username, 'STAT_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 4. Disasters & Rescue Operations CRUD
  adminRouter.post('/disasters', (req, res) => {
    const { title, event_date, location, impact_summary, description, image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !event_date || !location || !impact_summary || !description) {
      return res.status(400).json({ error: 'Title, date, location, impact summary, and description are required.' });
    }
    const r = db.prepare(`
      INSERT INTO disasters_operations (title, event_date, location, impact_summary, description, image_url, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(title).trim(), String(event_date).trim(), String(location).trim(), String(impact_summary).trim(), String(description).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'DISASTER_CREATED', String(title).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/disasters/:id', (req, res) => {
    const id = Number(req.params.id);
    const { title, event_date, location, impact_summary, description, image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !event_date || !location || !impact_summary || !description) {
      return res.status(400).json({ error: 'Title, date, location, impact summary, and description are required.' });
    }
    db.prepare(`
      UPDATE disasters_operations
      SET title = ?, event_date = ?, location = ?, impact_summary = ?, description = ?, image_url = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(title).trim(), String(event_date).trim(), String(location).trim(), String(impact_summary).trim(), String(description).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'DISASTER_UPDATED', `ID ${id}: ${title}`);
    res.json({ success: true });
  });

  adminRouter.delete('/disasters/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM disasters_operations WHERE id = ?').run(id);
    logAudit(req.admin.username, 'DISASTER_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 5. Ambulances Fleet CRUD
  adminRouter.post('/ambulances', (req, res) => {
    const { unit_name, vehicle_code = '', organization_tag, status = 'Active 24/7', coverage_area, equipment_summary, description, image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!unit_name || !organization_tag || !coverage_area || !equipment_summary || !description) {
      return res.status(400).json({ error: 'Unit name, organization tag, coverage area, equipment summary, and description are required.' });
    }
    const r = db.prepare(`
      INSERT INTO ambulances (unit_name, vehicle_code, organization_tag, status, coverage_area, equipment_summary, description, image_url, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(unit_name).trim(), String(vehicle_code).trim(), String(organization_tag).trim(), String(status).trim(), String(coverage_area).trim(), String(equipment_summary).trim(), String(description).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'AMBULANCE_CREATED', String(unit_name).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/ambulances/:id', (req, res) => {
    const id = Number(req.params.id);
    const { unit_name, vehicle_code = '', organization_tag, status = 'Active 24/7', coverage_area, equipment_summary, description, image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!unit_name || !organization_tag || !coverage_area || !equipment_summary || !description) {
      return res.status(400).json({ error: 'Unit name, organization tag, coverage area, equipment summary, and description are required.' });
    }
    db.prepare(`
      UPDATE ambulances
      SET unit_name = ?, vehicle_code = ?, organization_tag = ?, status = ?, coverage_area = ?, equipment_summary = ?, description = ?, image_url = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(unit_name).trim(), String(vehicle_code).trim(), String(organization_tag).trim(), String(status).trim(), String(coverage_area).trim(), String(equipment_summary).trim(), String(description).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'AMBULANCE_UPDATED', `ID ${id}: ${unit_name}`);
    res.json({ success: true });
  });

  adminRouter.delete('/ambulances/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM ambulances WHERE id = ?').run(id);
    logAudit(req.admin.username, 'AMBULANCE_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 6. Our Team CRUD (Photo, Name & Occupation)
  adminRouter.post('/team-members', (req, res) => {
    const { role_title, member_name = '', department = '', hierarchy_level = 1, parent_role = '', description = '', photo_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!role_title) {
      return res.status(400).json({ error: 'Occupation / Role title is required.' });
    }
    const r = db.prepare(`
      INSERT INTO team_members (role_title, member_name, department, hierarchy_level, parent_role, description, photo_url, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(role_title).trim(), String(member_name).trim(), String(department).trim(), Number(hierarchy_level) || 1, String(parent_role).trim(), String(description).trim(), String(photo_url).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'TEAM_CREATED', `${member_name || ''} (${role_title})`.trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/team-members/:id', (req, res) => {
    const id = Number(req.params.id);
    const { role_title, member_name = '', department = '', hierarchy_level = 1, parent_role = '', description = '', photo_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!role_title) {
      return res.status(400).json({ error: 'Occupation / Role title is required.' });
    }
    db.prepare(`
      UPDATE team_members
      SET role_title = ?, member_name = ?, department = ?, hierarchy_level = ?, parent_role = ?, description = ?, photo_url = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(role_title).trim(), String(member_name).trim(), String(department).trim(), Number(hierarchy_level) || 1, String(parent_role).trim(), String(description).trim(), String(photo_url).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'TEAM_UPDATED', `ID ${id}: ${member_name || ''} (${role_title})`.trim());
    res.json({ success: true });
  });

  adminRouter.delete('/team-members/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM team_members WHERE id = ?').run(id);
    logAudit(req.admin.username, 'TEAM_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 7. Facilities CRUD
  adminRouter.post('/facilities', (req, res) => {
    const { title, category, status_badge = '', description, specifications = '', image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !description) {
      return res.status(400).json({ error: 'Title, category, and description are required.' });
    }
    const r = db.prepare(`
      INSERT INTO facilities (title, category, status_badge, description, specifications, image_url, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(title).trim(), String(category).trim(), String(status_badge).trim(), String(description).trim(), String(specifications).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'FACILITY_CREATED', String(title).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/facilities/:id', (req, res) => {
    const id = Number(req.params.id);
    const { title, category, status_badge = '', description, specifications = '', image_url = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !description) {
      return res.status(400).json({ error: 'Title, category, and description are required.' });
    }
    db.prepare(`
      UPDATE facilities
      SET title = ?, category = ?, status_badge = ?, description = ?, specifications = ?, image_url = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(title).trim(), String(category).trim(), String(status_badge).trim(), String(description).trim(), String(specifications).trim(), String(image_url).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'FACILITY_UPDATED', `ID ${id}: ${title}`);
    res.json({ success: true });
  });

  adminRouter.delete('/facilities/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM facilities WHERE id = ?').run(id);
    logAudit(req.admin.username, 'FACILITY_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 8. Medical Camp Inventory CRUD
  adminRouter.post('/medical-inventory', (req, res) => {
    const { camp_name, serial_no = 1, item_name, quantity, remarks = '' } = req.body || {};
    if (!camp_name || !item_name || !quantity) {
      return res.status(400).json({ error: 'Camp name, item name, and quantity are required.' });
    }
    const r = db.prepare(`
      INSERT INTO medical_inventory (camp_name, serial_no, item_name, quantity, remarks)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(camp_name).trim(), Number(serial_no) || 1, String(item_name).trim(), String(quantity).trim(), String(remarks).trim());
    logAudit(req.admin.username, 'MED_ITEM_CREATED', `${camp_name}: ${item_name}`);
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/medical-inventory/:id', (req, res) => {
    const id = Number(req.params.id);
    const { camp_name, serial_no = 1, item_name, quantity, remarks = '' } = req.body || {};
    if (!camp_name || !item_name || !quantity) {
      return res.status(400).json({ error: 'Camp name, item name, and quantity are required.' });
    }
    db.prepare(`
      UPDATE medical_inventory
      SET camp_name = ?, serial_no = ?, item_name = ?, quantity = ?, remarks = ?
      WHERE id = ?
    `).run(String(camp_name).trim(), Number(serial_no) || 1, String(item_name).trim(), String(quantity).trim(), String(remarks).trim(), id);
    logAudit(req.admin.username, 'MED_ITEM_UPDATED', `ID ${id}: ${item_name}`);
    res.json({ success: true });
  });

  adminRouter.delete('/medical-inventory/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM medical_inventory WHERE id = ?').run(id);
    logAudit(req.admin.username, 'MED_ITEM_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 9. Projects & Institutional Demands CRUD
  adminRouter.post('/projects-demands', (req, res) => {
    const { item_type, title, subtitle = '', description, display_order = 1, is_active = 1 } = req.body || {};
    if (!item_type || !title || !description) {
      return res.status(400).json({ error: 'Type, title, and description are required.' });
    }
    const r = db.prepare(`
      INSERT INTO projects_demands (item_type, title, subtitle, description, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(item_type).trim(), String(title).trim(), String(subtitle).trim(), String(description).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'PROJECT_DEMAND_CREATED', String(title).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/projects-demands/:id', (req, res) => {
    const id = Number(req.params.id);
    const { item_type, title, subtitle = '', description, display_order = 1, is_active = 1 } = req.body || {};
    if (!item_type || !title || !description) {
      return res.status(400).json({ error: 'Type, title, and description are required.' });
    }
    db.prepare(`
      UPDATE projects_demands
      SET item_type = ?, title = ?, subtitle = ?, description = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(item_type).trim(), String(title).trim(), String(subtitle).trim(), String(description).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'PROJECT_DEMAND_UPDATED', `ID ${id}: ${title}`);
    res.json({ success: true });
  });

  adminRouter.delete('/projects-demands/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM projects_demands WHERE id = ?').run(id);
    logAudit(req.admin.username, 'PROJECT_DEMAND_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 10. Gallery Items CRUD
  adminRouter.post('/gallery', (req, res) => {
    const { title, category, caption, image_url, slide_ref = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !caption || !image_url) {
      return res.status(400).json({ error: 'Title, category, caption, and image URL are required.' });
    }
    const r = db.prepare(`
      INSERT INTO gallery_items (title, category, caption, image_url, slide_ref, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(String(title).trim(), String(category).trim(), String(caption).trim(), String(image_url).trim(), String(slide_ref).trim(), Number(display_order) || 1, is_active ? 1 : 0);
    logAudit(req.admin.username, 'GALLERY_CREATED', String(title).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.put('/gallery/:id', (req, res) => {
    const id = Number(req.params.id);
    const { title, category, caption, image_url, slide_ref = '', display_order = 1, is_active = 1 } = req.body || {};
    if (!title || !category || !caption || !image_url) {
      return res.status(400).json({ error: 'Title, category, caption, and image URL are required.' });
    }
    db.prepare(`
      UPDATE gallery_items
      SET title = ?, category = ?, caption = ?, image_url = ?, slide_ref = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).run(String(title).trim(), String(category).trim(), String(caption).trim(), String(image_url).trim(), String(slide_ref).trim(), Number(display_order) || 1, is_active ? 1 : 0, id);
    logAudit(req.admin.username, 'GALLERY_UPDATED', `ID ${id}: ${title}`);
    res.json({ success: true });
  });

  adminRouter.delete('/gallery/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM gallery_items WHERE id = ?').run(id);
    logAudit(req.admin.username, 'GALLERY_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 11. Contact Messages Management
  adminRouter.put('/contact-messages/:id', (req, res) => {
    const id = Number(req.params.id);
    const { status = 'read', admin_notes = '' } = req.body || {};
    db.prepare(`
      UPDATE contact_messages SET status = ?, admin_notes = ? WHERE id = ?
    `).run(String(status).trim(), String(admin_notes).trim(), id);
    logAudit(req.admin.username, 'CONTACT_MESSAGE_UPDATED', `ID ${id} -> ${status}`);
    res.json({ success: true });
  });

  adminRouter.delete('/contact-messages/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM contact_messages WHERE id = ?').run(id);
    logAudit(req.admin.username, 'CONTACT_MESSAGE_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 12. Administrator Accounts Management
  adminRouter.post('/users', (req, res) => {
    const { username, password, full_name, role = 'Administrator' } = req.body || {};
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Username, password, and full name are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(String(username).trim());
    if (existing) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    const hash = bcrypt.hashSync(String(password), 12);
    const r = db.prepare(`
      INSERT INTO admin_users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(String(username).trim(), hash, String(full_name).trim(), String(role).trim());
    logAudit(req.admin.username, 'ADMIN_USER_CREATED', String(username).trim());
    res.status(201).json({ success: true, id: Number(r.lastInsertRowid) });
  });

  adminRouter.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.admin.id) {
      return res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
    }
    const totalAdmins = db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get().cnt;
    if (totalAdmins <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last remaining administrator.' });
    }
    db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
    logAudit(req.admin.username, 'ADMIN_USER_DELETED', `ID ${id}`);
    res.json({ success: true });
  });

  // 13. Linked Local Database Backup & Standalone Database Download
  adminRouter.put('/database/backup-config', (req, res) => {
    const { local_backup_path } = req.body || {};
    if (!local_backup_path || !String(local_backup_path).trim()) {
      return res.status(400).json({ error: 'Local backup file address is required.' });
    }
    const result = syncLocalBackup(String(local_backup_path).trim());
    if (!result.synced) {
      return res.status(400).json({ error: result.error || 'Failed to sync linked local database.' });
    }
    logAudit(req.admin.username, 'LOCAL_DB_BACKUP_LINKED', result.targetFile);
    res.json({
      success: true,
      targetFile: result.targetFile,
      lastSync: result.lastSync,
      status: result.status
    });
  });

  adminRouter.get('/database/download', (req, res) => {
    try {
      const buffer = getStandaloneDatabaseBuffer();
      res.set('Content-Type', 'application/x-sqlite3');
      res.set('Content-Disposition', 'attachment; filename="gasg_standalone_database.sqlite"');
      res.set('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate standalone database download.' });
    }
  });

  adminRouter.post('/database/restore', (req, res) => {
    backupUpload.single('backupFile')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Backup file upload failed.' });
      }
      if (!req.file || !req.file.path) {
        return res.status(400).json({ error: 'Please select a valid .sqlite or .db backup file to upload.' });
      }
      const tempPath = req.file.path;
      try {
        const result = restoreDatabaseFromFile(tempPath);
        logAudit(req.admin.username, 'DATABASE_BACKUP_RESTORED', req.file.originalname || 'Uploaded SQLite Backup');
        return res.json({
          success: true,
          message: 'Database backup uploaded and restored successfully.',
          targetFile: result.targetFile
        });
      } catch (restoreErr) {
        return res.status(400).json({ error: restoreErr.message || 'Failed to restore uploaded database backup.' });
      } finally {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {}
      }
    });
  });

  app.use('/api/admin', adminRouter);
}

module.exports = { registerApiRoutes };
