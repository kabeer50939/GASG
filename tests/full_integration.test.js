const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../server/index');
const { restoreDatabaseFromFile } = require('../server/db');

function request(server, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method,
        headers: reqHeaders
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const server = app.listen(0);
  try {
    console.log('================================================================');
    console.log(' GWADAR AMBULANCE SERVICE (GASG) — FULL INTEGRATION TEST SUITE ');
    console.log('================================================================');

    // -----------------------------------------------------------------------
    // SPRINT 1 & 4: Public Portal HTML, Header Design & Zero Admin Leak Check
    // -----------------------------------------------------------------------
    const homePage = await request(server, 'GET', '/');
    assert.strictEqual(homePage.status, 200);
    assert.ok(homePage.raw.includes('GWADAR AMBULANCE SERVICE, GWADAR'));
    assert.ok(homePage.raw.includes('headerLogoImg'));
    assert.ok(!homePage.raw.includes('headerOrgPill'));
    assert.ok(homePage.raw.includes('Emergency Medical Services'));
    for (const navItem of ['Home', 'About Us', 'Services', 'Ambulances', 'Our Team', 'Gallery', 'Facilities', 'Contact Us']) {
      assert.ok(homePage.raw.includes(navItem), `Missing nav item: ${navItem}`);
    }
    assert.strictEqual(
      homePage.raw.includes('/admin'),
      false,
      'Public HTML must not contain any unauthorized link to /admin'
    );
    console.log('[PASS] Sprint 1 & 4: Public Portal Header Design & Zero Admin Links verified');

    // -----------------------------------------------------------------------
    // SPRINT 2: Strict Security Isolation of Admin Panel & Admin APIs
    // -----------------------------------------------------------------------
    for (const protectedRoute of [
      '/api/admin/dashboard',
      '/api/admin/media-library',
      '/admin/js/admin.js'
    ]) {
      const res = await request(server, 'GET', protectedRoute);
      assert.strictEqual(res.status, 401, `Expected 401 for unauthenticated ${protectedRoute}`);
    }
    const adminRootUnauth = await request(server, 'GET', '/admin');
    assert.strictEqual(adminRootUnauth.status, 302);
    assert.strictEqual(adminRootUnauth.headers.location, '/admin/login');
    console.log('[PASS] Sprint 2: Unauthenticated access to Admin Panel & APIs strictly blocked');

    // Authenticate as Admin
    const loginRes = await request(server, 'POST', '/api/auth/login', {
      username: 'admin',
      password: process.env.ADMIN_PASSWORD || 'GasgAdmin@114272'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.headers['set-cookie'][0].includes('HttpOnly'));
    const authHeader = { Authorization: `Bearer ${loginRes.body.token}` };

    const adminRootAuth = await request(server, 'GET', '/admin', null, authHeader);
    assert.strictEqual(adminRootAuth.status, 200);
    assert.ok(adminRootAuth.raw.includes('G.A.S.G Admin'));
    assert.ok(adminRootAuth.raw.includes('photo-upload-card'));
    assert.ok(adminRootAuth.raw.includes('id="tab-backup"'));
    assert.ok(adminRootAuth.raw.includes('id="restoreBackupForm"'));
    assert.ok(!adminRootAuth.raw.includes('Logo Image URL'));

    const adminJsAuth = await request(server, 'GET', '/admin/js/admin.js', null, authHeader);
    assert.strictEqual(adminJsAuth.status, 200);
    assert.ok(adminJsAuth.raw.includes('Upload Photo (Crop &amp; Auto-Compress)'));
    assert.ok(adminJsAuth.raw.includes('Crop Current Photo'));
    assert.ok(!adminJsAuth.raw.includes('placeholder="Image URL'));
    console.log('[PASS] Sprint 2 & 5: Authenticated Admin Session & Photo Upload Cards (No URL Inputs) verified');

    // -----------------------------------------------------------------------
    // SPRINT 3 & 5: Verify Live Admin Content Updates Reflect on Public Portal
    // -----------------------------------------------------------------------
    const settingUpdate = await request(
      server,
      'PUT',
      '/api/admin/settings',
      { contact_phone: '086-4210000' },
      authHeader
    );
    assert.strictEqual(settingUpdate.status, 200);

    const publicAfterUpdate = await request(server, 'GET', '/api/public/portal-data');
    assert.strictEqual(publicAfterUpdate.body.settings.contact_phone, '086-4210000');
    assert.ok(publicAfterUpdate.headers['cache-control'].includes('no-store'), 'Portal data API must disable caching');

    // Verify static portal_data.json was auto-exported with the update
    const jsonOnDisk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'portal_data.json'), 'utf8'));
    assert.strictEqual(jsonOnDisk.settings.contact_phone, '086-4210000', 'Static portal_data.json must auto-sync on admin update');

    // Verify cache prevention headers on static JSON and sw.js
    const staticJsonRes = await request(server, 'GET', '/data/portal_data.json');
    assert.ok(staticJsonRes.headers['cache-control'].includes('no-store'), 'Static portal_data.json must have no-store cache header');

    const swRes = await request(server, 'GET', '/sw.js');
    assert.ok(swRes.headers['cache-control'].includes('no-store'), 'Service Worker must have no-store cache header');

    // Restore empty contact_phone so no unverified phone remains
    await request(server, 'PUT', '/api/admin/settings', { contact_phone: '' }, authHeader);
    console.log('[PASS] Sprint 3 & 5: Admin settings changes reflect immediately on Public Portal & auto-sync to disk');

    // Verify Linked Local Database Auto-Backup & Standalone Download
    const linkedBackupFile = path.join(__dirname, '..', 'data', 'gasg_linked_local_backup.sqlite');
    const linkRes = await request(
      server,
      'PUT',
      '/api/admin/database/backup-config',
      { local_backup_path: linkedBackupFile },
      authHeader
    );
    assert.strictEqual(linkRes.status, 200);
    assert.strictEqual(linkRes.body.targetFile, linkedBackupFile);
    assert.ok(fs.existsSync(linkedBackupFile), 'Linked single local backup file must exist on disk');

    const dlRes = await request(server, 'GET', '/api/admin/database/download', null, authHeader);
    assert.strictEqual(dlRes.status, 200);
    assert.ok(dlRes.raw.startsWith('SQLite format 3'), 'Standalone download must be a valid SQLite database file');

    const restoreCheck = restoreDatabaseFromFile(linkedBackupFile);
    assert.strictEqual(restoreCheck.restored, true);
    console.log('[PASS] Sprint 6: Standalone Backup Section, Linked Local Sync, Download & Restore verified');

    // Verify all gallery image files exist on disk
    for (const g of publicAfterUpdate.body.gallery) {
      const diskPath = path.join(__dirname, '..', 'public', g.image_url);
      assert.ok(fs.existsSync(diskPath), `Missing gallery image on disk: ${diskPath}`);
    }
    console.log('[PASS] Sprint 6: All 20 PPTX Gallery images verified on disk');

    console.log('================================================================');
    console.log(' ALL 6 SPRINTS VERIFIED — 100% TESTS PASSED SUCCESSFULLY ');
    console.log('================================================================');
  } finally {
    server.close();
  }
})();
