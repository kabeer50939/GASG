const http = require('http');
const assert = require('assert');
const app = require('../server/index');

function request(server, method, path, body = null, headers = {}) {
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
        path,
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
    console.log('--- Running Sprint 2 & Sprint 3 Automated Tests ---');

    // 1. Health & Public Portal Data
    const health = await request(server, 'GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.status, 'ok');

    const pub = await request(server, 'GET', '/api/public/portal-data');
    assert.strictEqual(pub.status, 200);
    assert.strictEqual(pub.body.settings.registration_no, 'Bcra-114272');
    assert.strictEqual(pub.body.settings.header_title, 'AMBULANCE INSTITUTION');
    assert.strictEqual(pub.body.missionPoints.length, 5);
    assert.strictEqual(pub.body.services.length, 8);
    assert.strictEqual(pub.body.teamMembers.length, 12);
    assert.strictEqual(pub.body.medicalInventory.length, 63);
    console.log('[PASS] Public Portal API returns 100% authentic PPTX data');

    // 2. Unauthorized Access Protection on Admin API & Admin Route
    const unauthApi = await request(server, 'GET', '/api/admin/dashboard');
    assert.strictEqual(unauthApi.status, 401);

    const unauthPage = await request(server, 'GET', '/admin');
    assert.strictEqual(unauthPage.status, 302);
    assert.strictEqual(unauthPage.headers.location, '/admin/login');

    const unauthJs = await request(server, 'GET', '/admin/js/admin.js');
    assert.strictEqual(unauthJs.status, 401);
    console.log('[PASS] Unauthorized access to /api/admin/*, /admin, and /admin/js/admin.js is strictly blocked');

    // 3. Invalid Login Rejection
    const badLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'wrongpassword'
    });
    assert.strictEqual(badLogin.status, 401);
    console.log('[PASS] Invalid admin credentials rejected with 401');

    // 4. Valid Admin Login
    const goodLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'admin',
      password: process.env.ADMIN_PASSWORD || 'GasgAdmin@114272'
    });
    assert.strictEqual(goodLogin.status, 200);
    assert.ok(goodLogin.body.token);
    const authHeader = { Authorization: `Bearer ${goodLogin.body.token}` };
    console.log('[PASS] Valid admin authentication succeeded & JWT issued');

    // 5. Admin Dashboard Data Access
    const dash = await request(server, 'GET', '/api/admin/dashboard', null, authHeader);
    assert.strictEqual(dash.status, 200);
    assert.strictEqual(dash.body.services.length, 8);
    console.log('[PASS] Authenticated Admin Dashboard endpoint verified');

    // 6. Admin CRUD Test (Create, Update, Delete Service)
    const createSvc = await request(
      server,
      'POST',
      '/api/admin/services',
      {
        title: 'Test Emergency Unit',
        category: 'Emergency',
        description: 'Temporary test service for Sprint 3 verification',
        stats_badge: '24/7'
      },
      authHeader
    );
    assert.strictEqual(createSvc.status, 201);
    const newId = createSvc.body.id;

    const updateSvc = await request(
      server,
      'PUT',
      `/api/admin/services/${newId}`,
      {
        title: 'Updated Emergency Unit',
        category: 'Emergency',
        description: 'Updated description',
        stats_badge: '24/7 Active'
      },
      authHeader
    );
    assert.strictEqual(updateSvc.status, 200);

    const deleteSvc = await request(server, 'DELETE', `/api/admin/services/${newId}`, null, authHeader);
    assert.strictEqual(deleteSvc.status, 200);
    console.log('[PASS] Admin CRUD lifecycle (Create, Update, Delete) verified');

    // 7. Public Contact Inquiry & Admin Management
    const contactRes = await request(server, 'POST', '/api/public/contact', {
      sender_name: 'Gwadar Citizen',
      sender_phone: '03210000000',
      subject: 'Community First Aid Session Inquiry',
      message_type: 'Community Awareness',
      message: 'We would like to request an awareness session at our school.'
    });
    assert.strictEqual(contactRes.status, 201);
    const msgId = contactRes.body.id;

    const delMsg = await request(server, 'DELETE', `/api/admin/contact-messages/${msgId}`, null, authHeader);
    assert.strictEqual(delMsg.status, 200);
    console.log('[PASS] Public contact inquiry submission & Admin cleanup verified');

    console.log('=== ALL SPRINT 2 & SPRINT 3 TESTS PASSED ===');
  } finally {
    server.close();
  }
})();
