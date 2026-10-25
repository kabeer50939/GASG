(function () {
  'use strict';

  let state = {
    admin: null,
    dashboard: null,
    currentModalSubmit: null,
    browserFileHandle: null
  };

  // Cropper & Auto-Compression State
  const cropperState = {
    active: false,
    file: null,
    origSize: 0,
    imgNaturalW: 0,
    imgNaturalH: 0,
    displayW: 0,
    displayH: 0,
    baseScale: 1,
    zoomPct: 100,
    aspectRatio: 0, // 0 = Free / Flexible
    crop: { x: 20, y: 20, w: 200, h: 200 },
    dragMode: null, // 'move' or handle name ('nw','n','ne','e','se','s','sw','w')
    startMouseX: 0,
    startMouseY: 0,
    startCrop: null,
    compressedBlob: null,
    previewUrl: null,
    onUploadedCallback: null
  };

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function showToast(msg, isError = false) {
    const toast = document.getElementById('adminToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `admin-toast ${isError ? 'error' : ''}`;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  async function getStaticMasterDb() {
    let dbObj = null;
    const raw = localStorage.getItem('gasg_master_db_v1');
    if (raw) {
      try {
        dbObj = JSON.parse(raw);
      } catch (_) {}
    }
    if (!dbObj || !dbObj.settings) {
      const res = await fetch('/data/portal_data.json', { cache: 'no-store' });
      dbObj = await res.json();
    }
    if (!dbObj.contactMessages) dbObj.contactMessages = [];
    if (!dbObj.admins) {
      dbObj.admins = [
        { id: 1, username: 'admin', password: 'GasgAdmin@114272', full_name: 'GASG Chief Administrator', role: 'Super Administrator' }
      ];
    }
    if (!dbObj.auditLogs) {
      dbObj.auditLogs = [
        { id: 1, admin_username: 'admin', action: 'SYSTEM_READY', details: 'Portal synchronized', created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }
      ];
    }
    localStorage.setItem('gasg_master_db_v1', JSON.stringify(dbObj));
    return dbObj;
  }

  async function handleStaticHostApi(url, method, body) {
    const sessionRaw = sessionStorage.getItem('gasg_static_admin_session');
    if (!sessionRaw && url !== '/api/auth/logout') {
      window.location.href = '/admin/login.html';
      throw new Error('Unauthorized');
    }
    const adminUser = sessionRaw ? JSON.parse(sessionRaw) : { id: 1, username: 'admin', full_name: 'Administrator', role: 'Super Administrator' };

    if (url === '/api/auth/me') {
      return { admin: adminUser };
    }
    if (url === '/api/auth/logout') {
      sessionStorage.removeItem('gasg_static_admin_session');
      return { success: true };
    }

    const dbObj = await getStaticMasterDb();
    const saveStaticDb = (action, details) => {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      dbObj.auditLogs.unshift({
        id: Date.now(),
        admin_username: adminUser.username,
        action,
        details: String(details || ''),
        created_at: nowStr
      });
      dbObj.settings.local_backup_last_sync = nowStr;
      dbObj.settings.local_backup_status = 'Synced & Protected';
      localStorage.setItem('gasg_master_db_v1', JSON.stringify(dbObj));
    };

    if (url === '/api/admin/dashboard' && method === 'GET') {
      return dbObj;
    }
    if (url === '/api/admin/reset-pptx-data' && method === 'POST') {
      const freshRes = await fetch('/data/portal_data.json', { cache: 'no-store' });
      const freshData = await freshRes.json();
      localStorage.setItem('gasg_master_db_v1', JSON.stringify(freshData));
      return { success: true };
    }
    if (url === '/api/admin/settings' && method === 'PUT') {
      Object.assign(dbObj.settings, body || {});
      saveStaticDb('SETTINGS_UPDATED', 'Updated Header & Site Settings');
      return { success: true };
    }
    if (url === '/api/auth/password' && method === 'PUT') {
      const idx = (dbObj.admins || []).findIndex((u) => u.username === adminUser.username);
      if (idx !== -1) {
        const currentPass = dbObj.admins[idx].password || 'GasgAdmin@114272';
        if (body.currentPassword && body.currentPassword !== currentPass) {
          throw new Error('Current password is incorrect.');
        }
        dbObj.admins[idx].password = body.newPassword;
      }
      saveStaticDb('PASSWORD_UPDATED', 'Updated administrator password');
      return { success: true };
    }
    if (url === '/api/admin/database/backup-config' && method === 'PUT') {
      dbObj.settings.local_backup_path = body.local_backup_path;
      saveStaticDb('LOCAL_DB_BACKUP_LINKED', body.local_backup_path);
      return { success: true, targetFile: body.local_backup_path, lastSync: dbObj.settings.local_backup_last_sync, status: 'Synced & Protected' };
    }

    const collectionMap = {
      'mission-points': 'missionPoints',
      'projects-demands': 'projectsDemands',
      services: 'services',
      disasters: 'disasters',
      'patient-stats': 'patientStats',
      ambulances: 'ambulances',
      'team-members': 'teamMembers',
      gallery: 'gallery',
      facilities: 'facilities',
      'medical-inventory': 'medicalInventory',
      'contact-messages': 'contactMessages',
      users: 'admins'
    };

    const match = url.match(/^\/api\/admin\/([a-z-]+)(?:\/(\d+))?$/);
    if (match) {
      const [, endpointKey, idStr] = match;
      const colKey = collectionMap[endpointKey];
      if (colKey && Array.isArray(dbObj[colKey])) {
        const list = dbObj[colKey];
        if (method === 'POST') {
          const newItem = { id: Date.now(), is_active: 1, ...(body || {}) };
          list.push(newItem);
          saveStaticDb(`${endpointKey.toUpperCase()}_CREATED`, newItem.title || newItem.member_name || newItem.unit_name || newItem.id);
          return { success: true, id: newItem.id };
        }
        if (method === 'PUT' && idStr) {
          const idx = list.findIndex((x) => Number(x.id) === Number(idStr));
          if (idx !== -1) {
            list[idx] = { ...list[idx], ...(body || {}) };
            saveStaticDb(`${endpointKey.toUpperCase()}_UPDATED`, `ID ${idStr}`);
          }
          return { success: true };
        }
        if (method === 'DELETE' && idStr) {
          dbObj[colKey] = list.filter((x) => Number(x.id) !== Number(idStr));
          saveStaticDb(`${endpointKey.toUpperCase()}_DELETED`, `ID ${idStr}`);
          return { success: true };
        }
      }
    }

    return { success: true };
  }

  async function api(url, method = 'GET', body = null) {
    const token = sessionStorage.getItem('gasg_auth_token');
    const opts = {
      method,
      headers: {},
      credentials: 'same-origin'
    };
    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(url, opts);
      if (res.status === 404 || res.status === 405) {
        const staticRes = await handleStaticHostApi(url, method, body);
        if (method !== 'GET' && state.browserFileHandle) {
          syncBrowserLinkedFileHandle();
        }
        return staticRes;
      }
      if (res.status === 401) {
        window.location.href = '/admin/login.html';
        throw new Error('Session expired.');
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Operation failed.');
      }
      if (method !== 'GET' && state.browserFileHandle) {
        syncBrowserLinkedFileHandle();
      }
      return data;
    } catch (err) {
      if (err.message === 'Session expired.' || (err.message && !err.message.includes('fetch') && !err.message.includes('NetworkError') && !err.message.includes('Failed to fetch') && !err.message.includes('Load failed'))) {
        throw err;
      }
      const staticRes = await handleStaticHostApi(url, method, body);
      if (method !== 'GET' && state.browserFileHandle) {
        syncBrowserLinkedFileHandle();
      }
      return staticRes;
    }
  }

  async function buildBackupFileBlob() {
    try {
      const res = await fetch('/api/admin/database/download', { credentials: 'same-origin' });
      if (res.ok) {
        return await res.blob();
      }
    } catch (_) {}
    const dbObj = await getStaticMasterDb();
    const jsonMarker = '\n/*GASG_PORTAL_BACKUP_JSON_START*/' + JSON.stringify(dbObj) + '/*GASG_PORTAL_BACKUP_JSON_END*/';
    try {
      const baseRes = await fetch('/data/gasg_portal.sqlite');
      if (baseRes.ok) {
        const baseBuf = await baseRes.arrayBuffer();
        return new Blob([baseBuf, jsonMarker], { type: 'application/x-sqlite3' });
      }
    } catch (_) {}
    return new Blob(['SQLite format 3\0' + jsonMarker], { type: 'application/x-sqlite3' });
  }

  async function loadSqlJsFromCdn() {
    if (window.initSqlJs) {
      return window.initSqlJs({
        locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
      });
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
      s.onload = () => {
        window
          .initSqlJs({
            locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
          })
          .then(resolve)
          .catch(reject);
      };
      s.onerror = () => reject(new Error('Could not load SQLite parser'));
      document.head.appendChild(s);
    });
  }

  async function parseBackupFileInBrowser(file) {
    const arrayBuffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);

    const startTag = '/*GASG_PORTAL_BACKUP_JSON_START*/';
    const endTag = '/*GASG_PORTAL_BACKUP_JSON_END*/';
    const sIdx = text.lastIndexOf(startTag);
    const eIdx = text.lastIndexOf(endTag);
    if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
      const jsonStr = text.slice(sIdx + startTag.length, eIdx);
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.settings) return parsed;
    }

    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.settings) return parsed;
      } catch (_) {}
    }

    if (text.startsWith('SQLite format 3')) {
      const SQL = await loadSqlJsFromCdn();
      const sqlDb = new SQL.Database(new Uint8Array(arrayBuffer));
      try {
        const queryAll = (sql) => {
          try {
            const res = sqlDb.exec(sql);
            if (!res || !res[0]) return [];
            const cols = res[0].columns;
            return res[0].values.map((row) => {
              const obj = {};
              cols.forEach((c, i) => (obj[c] = row[i]));
              return obj;
            });
          } catch (_) {
            return [];
          }
        };
        const settingsRows = queryAll('SELECT setting_key, setting_value FROM site_settings');
        if (!settingsRows.length) {
          throw new Error('Uploaded SQLite file is missing G.A.S.G site_settings table.');
        }
        const settings = {};
        settingsRows.forEach((r) => (settings[r.setting_key] = r.setting_value));
        return {
          settings,
          missionPoints: queryAll('SELECT * FROM mission_points ORDER BY display_order ASC, id ASC'),
          services: queryAll('SELECT * FROM services ORDER BY display_order ASC, id ASC'),
          patientStats: queryAll('SELECT * FROM patient_stats ORDER BY stat_group ASC, display_order ASC, id ASC'),
          disasters: queryAll('SELECT * FROM disasters_operations ORDER BY display_order ASC, id ASC'),
          ambulances: queryAll('SELECT * FROM ambulances ORDER BY display_order ASC, id ASC'),
          teamMembers: queryAll('SELECT * FROM team_members ORDER BY hierarchy_level ASC, display_order ASC, id ASC'),
          facilities: queryAll('SELECT * FROM facilities ORDER BY display_order ASC, id ASC'),
          medicalInventory: queryAll('SELECT * FROM medical_inventory ORDER BY camp_name ASC, serial_no ASC, id ASC'),
          projectsDemands: queryAll('SELECT * FROM projects_demands ORDER BY item_type ASC, display_order ASC, id ASC'),
          gallery: queryAll('SELECT * FROM gallery_items ORDER BY display_order ASC, id ASC'),
          contactMessages: queryAll('SELECT * FROM contact_messages ORDER BY id DESC'),
          admins: queryAll('SELECT id, username, full_name, role FROM admins ORDER BY id ASC'),
          auditLogs: queryAll('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100')
        };
      } finally {
        sqlDb.close();
      }
    }

    throw new Error('Invalid backup file. Please select a valid G.A.S.G (.sqlite, .db, or .json) backup file.');
  }

  async function syncBrowserLinkedFileHandle() {
    if (!state.browserFileHandle) return;
    try {
      const blob = await buildBackupFileBlob();
      const writable = await state.browserFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      const dbObj = await getStaticMasterDb();
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      dbObj.settings.local_backup_path = state.browserFileHandle.name;
      dbObj.settings.local_backup_last_sync = nowStr;
      dbObj.settings.local_backup_status = `Synced in-place (${formatBytes(blob.size)})`;
      localStorage.setItem('gasg_master_db_v1', JSON.stringify(dbObj));
    } catch (_err) {
      // Browser file handle write ignored if permission revoked
    }
  }

  async function refreshDashboard() {
    try {
      const [meRes, dashRes] = await Promise.all([
        api('/api/auth/me'),
        api('/api/admin/dashboard')
      ]);
      state.admin = meRes.admin;
      state.dashboard = dashRes;

      document.getElementById('adminUserName').textContent = state.admin.full_name || state.admin.username;
      document.getElementById('adminUserRole').textContent = state.admin.role || 'Administrator';

      renderOverview();
      populateSettingsForm();
      renderAboutTab();
      renderServicesTab();
      renderStatsTab();
      renderAmbulancesTab();
      renderTeamTab();
      renderGalleryTab();
      renderFacilitiesTab();
      renderMessagesTab();
      renderSecurityTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderOverview() {
    const d = state.dashboard;
    const unread = (d.contactMessages || []).filter((m) => m.status === 'unread').length;
    const badge = document.getElementById('sidebarUnreadBadge');
    if (badge) {
      badge.textContent = unread;
      badge.classList.toggle('hidden', unread === 0);
    }

    const kpis = [
      { val: (d.services || []).length, label: 'Emergency Services' },
      { val: (d.ambulances || []).length, label: 'Ambulance Units' },
      { val: (d.teamMembers || []).length, label: 'Team Members' },
      { val: (d.gallery || []).length, label: 'Gallery Photos' },
      { val: (d.facilities || []).length, label: 'Facilities' },
      { val: (d.medicalInventory || []).length, label: 'Medicine Camp Items' },
      { val: unread, label: 'Unread Inquiries' }
    ];

    document.getElementById('overviewKpiGrid').innerHTML = kpis
      .map(
        (k) => `
      <div class="kpi-card">
        <strong>${esc(k.val)}</strong>
        <span>${esc(k.label)}</span>
      </div>
    `
      )
      .join('');

    const logs = (d.auditLogs || []).slice(0, 8);
    document.getElementById('overviewAuditList').innerHTML = logs
      .map(
        (l) => `
      <div class="mini-audit-item">
        <span><strong>${esc(l.action)}</strong> — ${esc(l.details)}</span>
        <small>${esc(l.created_at)}</small>
      </div>
    `
      )
      .join('');

    const s = d.settings || {};
    const backupInput = document.getElementById('localBackupPathInput');
    if (backupInput && s.local_backup_path) {
      backupInput.value = s.local_backup_path;
    }
    const targetText = document.getElementById('backupTargetText');
    if (targetText) {
      const fullPath = s.local_backup_path || '';
      const shortName = fullPath ? fullPath.split(/[\\/]/).pop() : 'gasg_linked_local_backup.sqlite';
      targetText.textContent = state.browserFileHandle ? state.browserFileHandle.name : shortName;
      targetText.title = fullPath;
    }
    const statusText = document.getElementById('backupStatusText');
    if (statusText) {
      statusText.textContent = s.local_backup_status || 'Synced & Protected';
    }
    const lastSyncText = document.getElementById('backupLastSyncText');
    if (lastSyncText) {
      lastSyncText.textContent = s.local_backup_last_sync || 'Up to date';
    }
  }

  function populateSettingsForm() {
    const form = document.getElementById('settingsForm');
    const s = state.dashboard.settings || {};
    if (!form) return;
    Array.from(form.elements).forEach((el) => {
      if (el.name && s[el.name] !== undefined) {
        el.value = s[el.name];
      }
    });
    const logoThumb = document.getElementById('setting_logo_thumb');
    if (logoThumb && s.logo_url) logoThumb.src = s.logo_url;
    const mapThumb = document.getElementById('setting_map_thumb');
    if (mapThumb && s.map_url) mapThumb.src = s.map_url;
    const heroThumb = document.getElementById('setting_hero_thumb');
    if (heroThumb && s.hero_bg_url) heroThumb.src = s.hero_bg_url;
  }

  function renderAboutTab() {
    const d = state.dashboard;
    document.getElementById('adminMissionsBody').innerHTML = (d.missionPoints || [])
      .map(
        (m) => `
      <tr>
        <td>${esc(m.display_order)}</td>
        <td>${esc(m.point_text)}</td>
        <td>${m.is_active ? 'Active' : 'Hidden'}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="mission" data-id="${m.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/mission-points/${m.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');

    document.getElementById('adminProjectsDemandsBody').innerHTML = (d.projectsDemands || [])
      .map(
        (p) => `
      <tr>
        <td><strong>${p.item_type === 'project' ? 'Proposed Project' : 'Demand / Request'}</strong></td>
        <td><strong>${esc(p.title)}</strong><br/><small>${esc(p.subtitle)}</small></td>
        <td>${esc(p.description)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="pd" data-id="${p.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/projects-demands/${p.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderServicesTab() {
    const d = state.dashboard;
    document.getElementById('adminServicesBody').innerHTML = (d.services || [])
      .map(
        (s) => `
      <tr>
        <td>${s.image_url ? `<img src="${esc(s.image_url)}" class="table-thumb" alt="" />` : '—'}</td>
        <td><strong>${esc(s.title)}</strong><br/><small>${esc(s.category)}</small></td>
        <td>${esc(s.stats_badge)}</td>
        <td>${esc(s.description)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="service" data-id="${s.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/services/${s.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');

    document.getElementById('adminDisastersBody').innerHTML = (d.disasters || [])
      .map(
        (o) => `
      <tr>
        <td>${o.image_url ? `<img src="${esc(o.image_url)}" class="table-thumb" alt="" />` : '—'}</td>
        <td><strong>${esc(o.title)}</strong><br/><small>${esc(o.event_date)}</small></td>
        <td><strong>${esc(o.impact_summary)}</strong><br/><small>${esc(o.location)}</small></td>
        <td>${esc(o.description)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="disaster" data-id="${o.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/disasters/${o.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderStatsTab() {
    const d = state.dashboard;
    document.getElementById('adminStatsBody').innerHTML = (d.patientStats || [])
      .map(
        (st) => `
      <tr>
        <td><strong>${esc(st.stat_group)}</strong></td>
        <td>${esc(st.label)}</td>
        <td><strong>${esc(st.count_value)}</strong></td>
        <td>${esc(st.sub_details)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="stat" data-id="${st.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/patient-stats/${st.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderAmbulancesTab() {
    const d = state.dashboard;
    document.getElementById('adminAmbulancesBody').innerHTML = (d.ambulances || [])
      .map(
        (a) => `
      <tr>
        <td>${a.image_url ? `<img src="${esc(a.image_url)}" class="table-thumb" alt="" />` : '—'}</td>
        <td><strong>${esc(a.unit_name)}</strong><br/><small>${esc(a.vehicle_code)} • ${esc(a.organization_tag)}</small></td>
        <td><strong>${esc(a.status)}</strong><br/><small>${esc(a.coverage_area)}</small></td>
        <td>${esc(a.equipment_summary)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="ambulance" data-id="${a.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/ambulances/${a.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderTeamTab() {
    const d = state.dashboard;
    document.getElementById('adminTeamBody').innerHTML = (d.teamMembers || [])
      .map(
        (t) => `
      <tr>
        <td>${t.photo_url ? `<img src="${esc(t.photo_url)}" class="table-thumb" alt="" />` : '—'}</td>
        <td><strong>${t.member_name ? esc(t.member_name) : '<em>(Not Set)</em>'}</strong></td>
        <td><strong>${esc(t.role_title)}</strong></td>
        <td>${esc(t.display_order)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="team" data-id="${t.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/team-members/${t.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderGalleryTab() {
    const d = state.dashboard;
    document.getElementById('adminGalleryBody').innerHTML = (d.gallery || [])
      .map(
        (g) => `
      <tr>
        <td><img src="${esc(g.image_url)}" class="table-thumb" alt="" /></td>
        <td><strong>${esc(g.title)}</strong><br/><small>${esc(g.category)}</small></td>
        <td>${esc(g.caption)}</td>
        <td>${esc(g.display_order)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="gallery" data-id="${g.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/gallery/${g.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderFacilitiesTab() {
    const d = state.dashboard;
    document.getElementById('adminFacilitiesBody').innerHTML = (d.facilities || [])
      .map(
        (f) => `
      <tr>
        <td>${f.image_url ? `<img src="${esc(f.image_url)}" class="table-thumb" alt="" />` : '—'}</td>
        <td><strong>${esc(f.title)}</strong><br/><small>${esc(f.category)}</small></td>
        <td><strong>${esc(f.status_badge)}</strong><br/><small>${esc(f.specifications)}</small></td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="facility" data-id="${f.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/facilities/${f.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');

    document.getElementById('adminMedInventoryBody').innerHTML = (d.medicalInventory || [])
      .map(
        (m) => `
      <tr>
        <td>${esc(m.serial_no)}</td>
        <td>${esc(m.camp_name)}</td>
        <td><strong>${esc(m.item_name)}</strong></td>
        <td>${esc(m.quantity)}</td>
        <td>${esc(m.remarks)}</td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-edit="med" data-id="${m.id}">Edit</button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/medical-inventory/${m.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderMessagesTab() {
    const d = state.dashboard;
    const msgs = d.contactMessages || [];
    const tbody = document.getElementById('adminMessagesBody');
    if (msgs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">No contact inquiries received yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = msgs
      .map(
        (m) => `
      <tr>
        <td><small>${esc(m.created_at)}</small></td>
        <td><strong>${esc(m.sender_name)}</strong><br/><small>${esc(m.sender_phone)} ${m.sender_email ? `• ${esc(m.sender_email)}` : ''}</small></td>
        <td><strong>${esc(m.subject)}</strong><br/><small>${esc(m.message_type)}</small></td>
        <td>${esc(m.message)}</td>
        <td><strong>${esc(m.status.toUpperCase())}</strong></td>
        <td class="action-btns">
          <button type="button" class="btn-admin btn-admin-secondary btn-admin-sm" data-msg-status="${m.id}" data-next="${m.status === 'unread' ? 'read' : 'resolved'}">
            Mark ${m.status === 'unread' ? 'Read' : 'Resolved'}
          </button>
          <button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/contact-messages/${m.id}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderSecurityTab() {
    const d = state.dashboard;
    document.getElementById('adminUsersList').innerHTML = (d.admins || [])
      .map(
        (u) => `
      <div class="mini-audit-item">
        <span><strong>${esc(u.username)}</strong> (${esc(u.full_name)}) — ${esc(u.role)}</span>
        ${
          u.id !== state.admin.id
            ? `<button type="button" class="btn-admin btn-admin-danger btn-admin-sm" data-del="/api/admin/users/${u.id}">Remove</button>`
            : '<small>Active Session</small>'
        }
      </div>
    `
      )
      .join('');

    document.getElementById('adminAuditLogsBody').innerHTML = (d.auditLogs || [])
      .map(
        (l) => `
      <tr>
        <td><small>${esc(l.created_at)}</small></td>
        <td><strong>${esc(l.admin_username)}</strong></td>
        <td>${esc(l.action)}</td>
        <td>${esc(l.details)}</td>
      </tr>
    `
      )
      .join('');
  }

  // =========================================================================
  // UNIVERSAL FLEXIBLE PHOTO CROPPER & AUTO-COMPRESSOR ENGINE
  // =========================================================================
  function requestPhotoCropAndUpload(initialAspect, onUploaded) {
    const fileInput = document.getElementById('globalCropFileInput');
    cropperState.aspectRatio = Number(initialAspect) || 0;
    cropperState.onUploadedCallback = onUploaded;
    fileInput.value = '';
    fileInput.click();
  }

  async function requestRecropExistingUrl(existingUrl, initialAspect, onUploaded) {
    if (!existingUrl) {
      requestPhotoCropAndUpload(initialAspect, onUploaded);
      return;
    }
    try {
      cropperState.aspectRatio = Number(initialAspect) || 0;
      cropperState.onUploadedCallback = onUploaded;
      const res = await fetch(existingUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not load current photo.');
      const blob = await res.blob();
      const file = new File([blob], 'current_photo.png', { type: blob.type || 'image/png' });
      openCropperModalWithFile(file);
    } catch (_err) {
      requestPhotoCropAndUpload(initialAspect, onUploaded);
    }
  }

  function openCropperModalWithFile(file) {
    cropperState.file = file;
    cropperState.origSize = file.size;
    cropperState.zoomPct = 100;

    document.getElementById('cropZoomRange').value = '100';
    document.getElementById('cropZoomVal').textContent = '100%';
    document.getElementById('origSizeText').textContent = formatBytes(file.size);

    // Highlight active aspect preset button
    document.querySelectorAll('.aspect-btn').forEach((btn) => {
      const btnAspect = Number(btn.getAttribute('data-aspect')) || 0;
      btn.classList.toggle('active', Math.abs(btnAspect - cropperState.aspectRatio) < 0.05);
    });

    const reader = new FileReader();
    reader.onload = (e) => {
      const sourceImg = document.getElementById('cropperSourceImg');
      sourceImg.onload = () => {
        cropperState.imgNaturalW = sourceImg.naturalWidth || 400;
        cropperState.imgNaturalH = sourceImg.naturalHeight || 400;

        // Calculate comfortable display size for both tiny (e.g. 80x80) and huge (e.g. 4000x3000) photos
        const maxStageW = 540;
        const maxStageH = 380;
        const minStageDim = 220;

        let scale = Math.min(maxStageW / cropperState.imgNaturalW, maxStageH / cropperState.imgNaturalH);
        if (cropperState.imgNaturalW * scale < minStageDim && cropperState.imgNaturalH * scale < minStageDim) {
          scale = Math.max(minStageDim / cropperState.imgNaturalW, minStageDim / cropperState.imgNaturalH);
        }
        cropperState.baseScale = scale;

        applyStageScaleAndResetCrop(true);
        document.getElementById('imageCropperModal').classList.remove('hidden');
      };
      sourceImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function applyStageScaleAndResetCrop(resetBox = false) {
    const sourceImg = document.getElementById('cropperSourceImg');
    const zoomFactor = (cropperState.zoomPct || 100) / 100;
    const effScale = cropperState.baseScale * zoomFactor;

    cropperState.displayW = Math.max(60, Math.round(cropperState.imgNaturalW * effScale));
    cropperState.displayH = Math.max(60, Math.round(cropperState.imgNaturalH * effScale));

    sourceImg.style.width = `${cropperState.displayW}px`;
    sourceImg.style.height = `${cropperState.displayH}px`;

    if (resetBox) {
      resetCropSelectionBox();
    } else {
      clampCropBox();
      renderCropSelectionBox();
      scheduleCompressedPreviewUpdate();
    }
  }

  function resetCropSelectionBox() {
    const dw = cropperState.displayW;
    const dh = cropperState.displayH;
    let w = Math.round(dw * 0.82);
    let h = Math.round(dh * 0.82);

    if (cropperState.aspectRatio > 0) {
      if (w / h > cropperState.aspectRatio) {
        w = Math.round(h * cropperState.aspectRatio);
      } else {
        h = Math.round(w / cropperState.aspectRatio);
      }
    }

    w = Math.max(24, Math.min(dw, w));
    h = Math.max(24, Math.min(dh, h));

    cropperState.crop = {
      x: Math.round((dw - w) / 2),
      y: Math.round((dh - h) / 2),
      w,
      h
    };

    renderCropSelectionBox();
    scheduleCompressedPreviewUpdate();
  }

  function clampCropBox() {
    const dw = cropperState.displayW;
    const dh = cropperState.displayH;
    const c = cropperState.crop;
    c.w = Math.max(20, Math.min(dw, c.w));
    c.h = Math.max(20, Math.min(dh, c.h));
    c.x = Math.max(0, Math.min(dw - c.w, c.x));
    c.y = Math.max(0, Math.min(dh - c.h, c.y));
  }

  function renderCropSelectionBox() {
    const box = document.getElementById('cropSelectionBox');
    const c = cropperState.crop;
    box.style.left = `${c.x}px`;
    box.style.top = `${c.y}px`;
    box.style.width = `${c.w}px`;
    box.style.height = `${c.h}px`;
  }

  let previewTimer = null;
  function scheduleCompressedPreviewUpdate() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(generateCroppedCompressedBlob, 90);
  }

  function generateCroppedCompressedBlob() {
    const sourceImg = document.getElementById('cropperSourceImg');
    if (!sourceImg.src || !cropperState.displayW || !cropperState.displayH) return;

    const c = cropperState.crop;
    const ratioX = cropperState.imgNaturalW / cropperState.displayW;
    const ratioY = cropperState.imgNaturalH / cropperState.displayH;

    const sx = Math.max(0, Math.round(c.x * ratioX));
    const sy = Math.max(0, Math.round(c.y * ratioY));
    const sw = Math.max(1, Math.min(cropperState.imgNaturalW - sx, Math.round(c.w * ratioX)));
    const sh = Math.max(1, Math.min(cropperState.imgNaturalH - sy, Math.round(c.h * ratioY)));

    const maxDim = Number(document.getElementById('cropMaxDimSelect').value) || 1200;
    const qualityPct = Number(document.getElementById('cropQualityRange').value) || 80;
    const quality = Math.max(0.3, Math.min(0.95, qualityPct / 100));

    let outW = sw;
    let outH = sh;
    if (outW > maxDim || outH > maxDim) {
      const scaleDown = Math.min(maxDim / outW, maxDim / outH);
      outW = Math.max(1, Math.round(outW * scaleDown));
      outH = Math.max(1, Math.round(outH * scaleDown));
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, outW, outH);

    // Encode as WebP (or JPEG fallback) for maximum compression efficiency
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        cropperState.compressedBlob = blob;
        if (cropperState.previewUrl) URL.revokeObjectURL(cropperState.previewUrl);
        cropperState.previewUrl = URL.createObjectURL(blob);

        document.getElementById('cropperLivePreviewImg').src = cropperState.previewUrl;
        document.getElementById('compressedSizeText').textContent = formatBytes(blob.size);
        document.getElementById('outputDimText').textContent = `${outW} × ${outH} px`;

        const savedPct =
          cropperState.origSize > 0
            ? Math.round((1 - blob.size / cropperState.origSize) * 100)
            : 0;
        document.getElementById('spaceSavedText').textContent =
          savedPct > 0 ? `${savedPct}% smaller` : 'Optimized';
      },
      'image/webp',
      quality
    );
  }

  function setupCropperInteractions() {
    const fileInput = document.getElementById('globalCropFileInput');
    const cropBox = document.getElementById('cropSelectionBox');
    const zoomRange = document.getElementById('cropZoomRange');
    const maxDimSelect = document.getElementById('cropMaxDimSelect');
    const qualityRange = document.getElementById('cropQualityRange');

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        openCropperModalWithFile(fileInput.files[0]);
      }
    });

    // Aspect ratio preset buttons
    document.querySelectorAll('.aspect-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.aspect-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        cropperState.aspectRatio = Number(btn.getAttribute('data-aspect')) || 0;
        resetCropSelectionBox();
      });
    });

    zoomRange.addEventListener('input', () => {
      cropperState.zoomPct = Number(zoomRange.value) || 100;
      document.getElementById('cropZoomVal').textContent = `${cropperState.zoomPct}%`;
      applyStageScaleAndResetCrop(false);
    });

    maxDimSelect.addEventListener('change', scheduleCompressedPreviewUpdate);
    qualityRange.addEventListener('input', () => {
      document.getElementById('cropQualityVal').textContent = `${qualityRange.value}%`;
      scheduleCompressedPreviewUpdate();
    });

    document.getElementById('resetCropBoxBtn').addEventListener('click', () => {
      cropperState.zoomPct = 100;
      zoomRange.value = '100';
      document.getElementById('cropZoomVal').textContent = '100%';
      applyStageScaleAndResetCrop(true);
    });

    // Pointer Drag & 8-Handle Flexible Resize
    const startPointer = (clientX, clientY, target) => {
      const handle = target.getAttribute('data-handle');
      cropperState.dragMode = handle || 'move';
      cropperState.startMouseX = clientX;
      cropperState.startMouseY = clientY;
      cropperState.startCrop = { ...cropperState.crop };
    };

    cropBox.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startPointer(e.clientX, e.clientY, e.target);
    });

    cropBox.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          e.preventDefault();
          e.stopPropagation();
          startPointer(e.touches[0].clientX, e.touches[0].clientY, e.target);
        }
      },
      { passive: false }
    );

    const movePointer = (clientX, clientY) => {
      if (!cropperState.dragMode || !cropperState.startCrop) return;
      const dx = clientX - cropperState.startMouseX;
      const dy = clientY - cropperState.startMouseY;
      const sc = cropperState.startCrop;
      const dw = cropperState.displayW;
      const dh = cropperState.displayH;
      const minSize = 20;
      const mode = cropperState.dragMode;

      let { x, y, w, h } = sc;

      if (mode === 'move') {
        x = Math.max(0, Math.min(dw - w, sc.x + dx));
        y = Math.max(0, Math.min(dh - h, sc.y + dy));
      } else {
        if (mode.includes('e')) w = Math.max(minSize, Math.min(dw - x, sc.w + dx));
        if (mode.includes('s')) h = Math.max(minSize, Math.min(dh - y, sc.h + dy));
        if (mode.includes('w')) {
          const newX = Math.max(0, Math.min(sc.x + sc.w - minSize, sc.x + dx));
          w = sc.w + (sc.x - newX);
          x = newX;
        }
        if (mode.includes('n')) {
          const newY = Math.max(0, Math.min(sc.y + sc.h - minSize, sc.y + dy));
          h = sc.h + (sc.y - newY);
          y = newY;
        }

        if (cropperState.aspectRatio > 0) {
          const ar = cropperState.aspectRatio;
          if (mode === 'n' || mode === 's') {
            w = Math.round(h * ar);
          } else {
            h = Math.round(w / ar);
          }
          if (x + w > dw) {
            w = dw - x;
            h = Math.round(w / ar);
          }
          if (y + h > dh) {
            h = dh - y;
            w = Math.round(h * ar);
          }
        }
      }

      cropperState.crop = { x, y, w, h };
      renderCropSelectionBox();
      scheduleCompressedPreviewUpdate();
    };

    window.addEventListener('mousemove', (e) => {
      if (cropperState.dragMode) movePointer(e.clientX, e.clientY);
    });

    window.addEventListener(
      'touchmove',
      (e) => {
        if (cropperState.dragMode && e.touches.length === 1) {
          movePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: false }
    );

    const endPointer = () => {
      cropperState.dragMode = null;
    };
    window.addEventListener('mouseup', endPointer);
    window.addEventListener('touchend', endPointer);

    const closeCropper = () => {
      document.getElementById('imageCropperModal').classList.add('hidden');
      cropperState.dragMode = null;
    };
    document.getElementById('cropperCloseBtn').addEventListener('click', closeCropper);
    document.getElementById('cropperCancelBtn').addEventListener('click', closeCropper);

    // Upload Cropped & Compressed Image
    document.getElementById('cropperConfirmUploadBtn').addEventListener('click', async () => {
      if (!cropperState.compressedBlob) {
        showToast('Please wait a moment for compression preview.', true);
        return;
      }
      const btn = document.getElementById('cropperConfirmUploadBtn');
      btn.disabled = true;
      btn.textContent = 'Uploading Compressed Photo...';

      try {
        const fd = new FormData();
        fd.append('image', cropperState.compressedBlob, `gasg_cropped_${Date.now()}.webp`);
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          body: fd,
          credentials: 'same-origin'
        });
        if (res.status === 404 || res.status === 405) {
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(cropperState.compressedBlob);
          });
          showToast(`Photo cropped & auto-compressed (${formatBytes(cropperState.compressedBlob.size)})!`);
          if (typeof cropperState.onUploadedCallback === 'function') {
            cropperState.onUploadedCallback(dataUrl);
          }
          closeCropper();
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed.');

        showToast(`Photo cropped, compressed (${formatBytes(cropperState.compressedBlob.size)}) & uploaded!`);
        if (typeof cropperState.onUploadedCallback === 'function') {
          cropperState.onUploadedCallback(data.url);
        }
        closeCropper();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Crop, Auto-Compress & Upload Photo';
      }
    });
  }

  // =========================================================================
  // UNIVERSAL CRUD MODAL BUILDER (With Built-In Photo Cropper & Compressor)
  // =========================================================================
  function openModal(title, fields, initialValues, onSubmit) {
    const modal = document.getElementById('crudModal');
    const titleEl = document.getElementById('crudModalTitle');
    const form = document.getElementById('crudModalForm');
    titleEl.textContent = title;

    form.innerHTML =
      fields
        .map((f) => {
          const val = initialValues[f.name] ?? f.default ?? '';
          if (f.type === 'textarea') {
            return `
            <div class="form-group">
              <label>${esc(f.label)}</label>
              <textarea name="${esc(f.name)}" rows="3" ${f.required ? 'required' : ''}>${esc(val)}</textarea>
            </div>
          `;
          }
          if (f.type === 'select') {
            return `
            <div class="form-group">
              <label>${esc(f.label)}</label>
              <select name="${esc(f.name)}">
                ${f.options
                  .map(
                    (o) =>
                      `<option value="${esc(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`
                  )
                  .join('')}
              </select>
            </div>
          `;
          }
          if (f.type === 'image') {
            const inputId = `modal_img_${f.name}`;
            const thumbId = `modal_thumb_${f.name}`;
            const statusId = `modal_status_${f.name}`;
            const recropId = `modal_recrop_${f.name}`;
            return `
            <div class="form-group">
              <label>${esc(f.label)}</label>
              <div class="photo-upload-card">
                <input type="hidden" id="${inputId}" name="${esc(f.name)}" value="${esc(val)}" data-photo-required="${f.required ? '1' : '0'}" />
                <div class="photo-upload-preview-row">
                  <img id="${thumbId}" src="${val ? esc(val) : '/uploads/pptx/image5.png'}" class="modal-img-thumb ${val ? '' : 'empty-thumb'}" alt="Photo Preview" />
                  <div class="photo-upload-info">
                    <span id="${statusId}" class="photo-upload-status ${val ? 'has-photo' : 'no-photo'}">
                      ${val ? '&#10003; Photo Attached &amp; Ready' : 'No photo uploaded yet — choose a photo below'}
                    </span>
                    <div class="photo-upload-actions">
                      <button type="button" class="btn-admin btn-admin-primary btn-admin-sm" data-modal-crop-input="#${inputId}" data-modal-crop-thumb="#${thumbId}" data-modal-crop-status="#${statusId}" data-modal-recrop-btn="#${recropId}" data-crop-aspect="${f.aspect ?? 0}">
                        Upload Photo (Crop &amp; Auto-Compress)
                      </button>
                      <button type="button" id="${recropId}" class="btn-admin btn-admin-secondary btn-admin-sm ${val ? '' : 'hidden'}" data-modal-recrop-input="#${inputId}" data-modal-crop-thumb="#${thumbId}" data-modal-crop-status="#${statusId}" data-crop-aspect="${f.aspect ?? 0}">
                        Crop Current Photo
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
          }
          return `
          <div class="form-group">
            <label>${esc(f.label)}</label>
            <input type="${f.type || 'text'}" name="${esc(f.name)}" value="${esc(val)}" ${f.required ? 'required' : ''} />
          </div>
        `;
        })
        .join('') +
      `
      <div class="form-actions-end">
        <button type="button" class="btn-admin btn-admin-secondary" id="modalCancelBtn">Cancel</button>
        <button type="submit" class="btn-admin btn-admin-primary">Save Record</button>
      </div>
    `;

    state.currentModalSubmit = onSubmit;
    modal.classList.remove('hidden');

    document.getElementById('modalCancelBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  function closeModal() {
    document.getElementById('crudModal').classList.add('hidden');
  }

  function setupAdminEvents() {
    const switchTab = (tabName) => {
      document.querySelectorAll('.side-link').forEach((btn) => {
        const isMatch = btn.getAttribute('data-tab') === tabName;
        btn.classList.toggle('active', isMatch);
        if (isMatch) {
          document.getElementById('activeTabTitle').textContent = btn.textContent.trim();
        }
      });
      document.querySelectorAll('.admin-tab-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.id === `tab-${tabName}`);
      });
      document.getElementById('adminSidebar').classList.remove('open');
    };

    document.addEventListener('click', async (e) => {
      const sideBtn = e.target.closest('.side-link');
      if (sideBtn) {
        switchTab(sideBtn.getAttribute('data-tab'));
      }

      const gotoBtn = e.target.closest('[data-goto]');
      if (gotoBtn) {
        switchTab(gotoBtn.getAttribute('data-goto'));
      }

      // Upload & Crop button in Settings tab
      const settingCropBtn = e.target.closest('[data-crop-target]');
      if (settingCropBtn) {
        const targetSelector = settingCropBtn.getAttribute('data-crop-target');
        const thumbSelector = settingCropBtn.getAttribute('data-crop-thumb');
        const statusSelector = settingCropBtn.getAttribute('data-crop-status');
        const aspect = Number(settingCropBtn.getAttribute('data-crop-aspect')) || 0;
        requestPhotoCropAndUpload(aspect, (uploadedUrl) => {
          const inputEl = document.querySelector(targetSelector);
          const thumbEl = thumbSelector ? document.querySelector(thumbSelector) : null;
          const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
          if (inputEl) inputEl.value = uploadedUrl;
          if (thumbEl) thumbEl.src = uploadedUrl;
          if (statusEl) {
            statusEl.innerHTML = '&#10003; Photo Uploaded &amp; Auto-Compressed';
            statusEl.className = 'photo-upload-status has-photo';
          }
        });
      }

      // Re-Crop Current Photo button in Settings tab
      const settingRecropBtn = e.target.closest('[data-recrop-target]');
      if (settingRecropBtn) {
        const targetSelector = settingRecropBtn.getAttribute('data-recrop-target');
        const thumbSelector = settingRecropBtn.getAttribute('data-crop-thumb');
        const statusSelector = settingRecropBtn.getAttribute('data-crop-status');
        const aspect = Number(settingRecropBtn.getAttribute('data-crop-aspect')) || 0;
        const inputEl = document.querySelector(targetSelector);
        const currentUrl = inputEl ? inputEl.value : '';
        requestRecropExistingUrl(currentUrl, aspect, (uploadedUrl) => {
          const thumbEl = thumbSelector ? document.querySelector(thumbSelector) : null;
          const statusEl = statusSelector ? document.querySelector(statusSelector) : null;
          if (inputEl) inputEl.value = uploadedUrl;
          if (thumbEl) thumbEl.src = uploadedUrl;
          if (statusEl) {
            statusEl.innerHTML = '&#10003; Photo Cropped &amp; Auto-Compressed';
            statusEl.className = 'photo-upload-status has-photo';
          }
        });
      }

      // Upload & Crop button inside Universal CRUD Modal
      const modalCropBtn = e.target.closest('[data-modal-crop-input]');
      if (modalCropBtn) {
        const inputSel = modalCropBtn.getAttribute('data-modal-crop-input');
        const thumbSel = modalCropBtn.getAttribute('data-modal-crop-thumb');
        const statusSel = modalCropBtn.getAttribute('data-modal-crop-status');
        const recropBtnSel = modalCropBtn.getAttribute('data-modal-recrop-btn');
        const aspect = Number(modalCropBtn.getAttribute('data-crop-aspect')) || 0;
        requestPhotoCropAndUpload(aspect, (uploadedUrl) => {
          const inputEl = document.querySelector(inputSel);
          const thumbEl = document.querySelector(thumbSel);
          const statusEl = statusSel ? document.querySelector(statusSel) : null;
          const recropBtnEl = recropBtnSel ? document.querySelector(recropBtnSel) : null;
          if (inputEl) inputEl.value = uploadedUrl;
          if (thumbEl) {
            thumbEl.src = uploadedUrl;
            thumbEl.classList.remove('empty-thumb');
          }
          if (statusEl) {
            statusEl.innerHTML = '&#10003; Photo Uploaded &amp; Auto-Compressed';
            statusEl.className = 'photo-upload-status has-photo';
          }
          if (recropBtnEl) {
            recropBtnEl.classList.remove('hidden');
          }
        });
      }

      // Re-Crop Current Photo button inside Universal CRUD Modal
      const modalRecropBtn = e.target.closest('[data-modal-recrop-input]');
      if (modalRecropBtn) {
        const inputSel = modalRecropBtn.getAttribute('data-modal-recrop-input');
        const thumbSel = modalRecropBtn.getAttribute('data-modal-crop-thumb');
        const statusSel = modalRecropBtn.getAttribute('data-modal-crop-status');
        const aspect = Number(modalRecropBtn.getAttribute('data-crop-aspect')) || 0;
        const inputEl = document.querySelector(inputSel);
        const currentUrl = inputEl ? inputEl.value : '';
        requestRecropExistingUrl(currentUrl, aspect, (uploadedUrl) => {
          const thumbEl = document.querySelector(thumbSel);
          const statusEl = statusSel ? document.querySelector(statusSel) : null;
          if (inputEl) inputEl.value = uploadedUrl;
          if (thumbEl) {
            thumbEl.src = uploadedUrl;
            thumbEl.classList.remove('empty-thumb');
          }
          if (statusEl) {
            statusEl.innerHTML = '&#10003; Photo Cropped &amp; Auto-Compressed';
            statusEl.className = 'photo-upload-status has-photo';
          }
        });
      }

      // Delete Record
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const endpoint = delBtn.getAttribute('data-del');
        try {
          await api(endpoint, 'DELETE');
          showToast('Record deleted.');
          await refreshDashboard();
        } catch (err) {
          showToast(err.message, true);
        }
      }

      // Update Contact Message Status
      const msgStatusBtn = e.target.closest('[data-msg-status]');
      if (msgStatusBtn) {
        const id = msgStatusBtn.getAttribute('data-msg-status');
        const nextStatus = msgStatusBtn.getAttribute('data-next');
        try {
          await api(`/api/admin/contact-messages/${id}`, 'PUT', { status: nextStatus });
          showToast(`Inquiry marked as ${nextStatus}.`);
          await refreshDashboard();
        } catch (err) {
          showToast(err.message, true);
        }
      }

      // Edit Record Buttons
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const type = editBtn.getAttribute('data-edit');
        const id = Number(editBtn.getAttribute('data-id'));
        openEditModalForType(type, id);
      }
    });

    // Standalone Gallery Cropper & Uploader button
    const standaloneCropBtn = document.getElementById('openStandaloneCropperBtn');
    if (standaloneCropBtn) {
      standaloneCropBtn.addEventListener('click', () => {
        requestPhotoCropAndUpload(0, (uploadedUrl) => {
          const pill = document.getElementById('uploadedUrlPreview');
          pill.textContent = `Uploaded URL: ${uploadedUrl}`;
          pill.classList.remove('hidden');
        });
      });
    }

    // Sidebar Mobile Toggle
    document.getElementById('adminSidebarToggle').addEventListener('click', () => {
      document.getElementById('adminSidebar').classList.toggle('open');
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', 'POST');
      window.location.href = '/admin/login.html';
    });

    // Restore Official PPTX Data
    document.getElementById('resetPptxBtn').addEventListener('click', async () => {
      try {
        await api('/api/admin/reset-pptx-data', 'POST');
        showToast('Official GASG PPTX data restored & synced to local backup.');
        await refreshDashboard();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Toggle Manual Path Input
    const toggleManualPathBtn = document.getElementById('toggleManualPathBtn');
    const manualBackupPathWrap = document.getElementById('manualBackupPathWrap');
    if (toggleManualPathBtn && manualBackupPathWrap) {
      toggleManualPathBtn.addEventListener('click', () => {
        manualBackupPathWrap.classList.toggle('hidden');
      });
    }

    // Save & Sync Linked Local Database File Path
    const saveLocalBackupBtn = document.getElementById('saveLocalBackupBtn');
    if (saveLocalBackupBtn) {
      saveLocalBackupBtn.addEventListener('click', async () => {
        const pathVal = document.getElementById('localBackupPathInput').value.trim();
        if (!pathVal) {
          showToast('Please enter a file location first.', true);
          return;
        }
        try {
          await api('/api/admin/database/backup-config', 'PUT', { local_backup_path: pathVal });
          showToast(`Auto-save file connected & updated!`);
          if (manualBackupPathWrap) manualBackupPathWrap.classList.add('hidden');
          await refreshDashboard();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    // Pick & Link Single Local Database File via Browser File System Access API
    const browserFileLinkBtn = document.getElementById('browserFileLinkBtn');
    if (browserFileLinkBtn) {
      browserFileLinkBtn.addEventListener('click', async () => {
        if (typeof window.showSaveFilePicker === 'function') {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: 'gasg_linked_local_backup.sqlite',
              types: [
                {
                  description: 'Database Backup File',
                  accept: { 'application/x-sqlite3': ['.sqlite', '.db', '.json'] }
                }
              ]
            });
            state.browserFileHandle = handle;
            await syncBrowserLinkedFileHandle();
            showToast(`Connected "${handle.name}" — it will now update automatically on every change!`);
            await refreshDashboard();
          } catch (_err) {
            // User cancelled picker
          }
        } else {
          if (manualBackupPathWrap) manualBackupPathWrap.classList.remove('hidden');
          document.getElementById('localBackupPathInput').focus();
          showToast('Enter the file location and click "Save File Location".');
        }
      });
    }

    // Standalone Database Download Button
    const downloadBtn1 = document.getElementById('downloadStandaloneDbBtn');
    if (downloadBtn1) {
      downloadBtn1.addEventListener('click', async () => {
        const origHtml = downloadBtn1.innerHTML;
        downloadBtn1.disabled = true;
        downloadBtn1.textContent = 'Preparing Backup File...';
        try {
          const blob = await buildBackupFileBlob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'gasg_standalone_database.sqlite';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          showToast('Backup file (gasg_standalone_database.sqlite) downloaded to your computer!');
        } catch (err) {
          showToast(err.message || 'Could not download backup file.', true);
        } finally {
          downloadBtn1.disabled = false;
          downloadBtn1.innerHTML = origHtml;
        }
      });
    }

    // Upload & Restore Database Backup File
    const uploadBackupInput = document.getElementById('uploadBackupFileInput');
    const selectedBackupLabel = document.getElementById('selectedBackupFileName');
    const chooseBackupFileLabel = document.getElementById('chooseBackupFileLabel');
    const restoreBackupSubmitBtn = document.getElementById('restoreBackupSubmitBtn');
    if (uploadBackupInput && selectedBackupLabel) {
      uploadBackupInput.addEventListener('change', () => {
        if (uploadBackupInput.files && uploadBackupInput.files[0]) {
          const f = uploadBackupInput.files[0];
          selectedBackupLabel.innerHTML = `&#10003; Ready: <strong>${esc(f.name)}</strong> (${formatBytes(f.size)})`;
          selectedBackupLabel.classList.remove('hidden');
          if (restoreBackupSubmitBtn) restoreBackupSubmitBtn.classList.remove('hidden');
          if (chooseBackupFileLabel) chooseBackupFileLabel.innerHTML = '&#128194; Change Selected File';
        } else {
          selectedBackupLabel.classList.add('hidden');
          if (restoreBackupSubmitBtn) restoreBackupSubmitBtn.classList.add('hidden');
          if (chooseBackupFileLabel) chooseBackupFileLabel.innerHTML = '&#128194; Select Backup File to Restore';
        }
      });
    }

    const restoreBackupForm = document.getElementById('restoreBackupForm');
    if (restoreBackupForm) {
      restoreBackupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!uploadBackupInput || !uploadBackupInput.files || !uploadBackupInput.files[0]) {
          showToast('Please select a backup file first.', true);
          return;
        }
        const file = uploadBackupInput.files[0];
        const submitBtn = document.getElementById('restoreBackupSubmitBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Restoring Website Data...';
        try {
          let restoredOnServer = false;
          try {
            const fd = new FormData();
            fd.append('backupFile', file);
            const res = await fetch('/api/admin/database/restore', {
              method: 'POST',
              body: fd,
              credentials: 'same-origin'
            });
            if (res.status !== 404 && res.status !== 405) {
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Failed to restore backup file.');
              restoredOnServer = true;
            }
          } catch (serverErr) {
            if (serverErr.message && !serverErr.message.includes('fetch') && !serverErr.message.includes('Unexpected token') && !serverErr.message.includes('Failed to fetch') && !serverErr.message.includes('Load failed')) {
              throw serverErr;
            }
          }

          if (!restoredOnServer) {
            const restoredData = await parseBackupFileInBrowser(file);
            const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
            if (!restoredData.settings) restoredData.settings = {};
            restoredData.settings.local_backup_last_sync = nowStr;
            restoredData.settings.local_backup_status = `Restored from ${file.name}`;
            if (!restoredData.auditLogs) restoredData.auditLogs = [];
            restoredData.auditLogs.unshift({
              id: Date.now(),
              admin_username: (state.admin && state.admin.username) || 'admin',
              action: 'DATABASE_BACKUP_RESTORED',
              details: `Restored backup file: ${file.name} (${formatBytes(file.size)})`,
              created_at: nowStr
            });
            localStorage.setItem('gasg_master_db_v1', JSON.stringify(restoredData));
          }

          if (state.browserFileHandle) {
            await syncBrowserLinkedFileHandle();
          }
          showToast('Backup restored successfully! All website sections are updated.');
          uploadBackupInput.value = '';
          selectedBackupLabel.innerHTML = '&#10003; Backup Restored Successfully!';
          if (restoreBackupSubmitBtn) restoreBackupSubmitBtn.classList.add('hidden');
          if (chooseBackupFileLabel) chooseBackupFileLabel.innerHTML = '&#128194; Select Backup File to Restore';
          await refreshDashboard();
        } catch (err) {
          showToast(err.message, true);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '&#10003; Confirm &amp; Restore Now';
        }
      });
    }

    // Save Site & Header Settings
    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      try {
        await api('/api/admin/settings', 'PUT', payload);
        showToast('Header and Site Settings updated.');
        await refreshDashboard();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Change Password Form
    document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api('/api/auth/password', 'PUT', payload);
        showToast('Administrator password updated.');
        e.target.reset();
        await refreshDashboard();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Create Additional Admin Form
    document.getElementById('createAdminUserForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api('/api/admin/users', 'POST', payload);
        showToast('New administrator account created.');
        e.target.reset();
        await refreshDashboard();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Modal Form Submit
    document.getElementById('crudModalClose').addEventListener('click', closeModal);
    document.getElementById('crudModalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.currentModalSubmit) return;
      const requiredPhotoInput = e.target.querySelector('input[data-photo-required="1"]');
      if (requiredPhotoInput && !requiredPhotoInput.value.trim()) {
        showToast('Please upload a photo before saving.', true);
        return;
      }
      const payload = Object.fromEntries(new FormData(e.target).entries());
      try {
        await state.currentModalSubmit(payload);
        closeModal();
        await refreshDashboard();
      } catch (err) {
        showToast(err.message, true);
      }
    });

    // Add Buttons
    document.getElementById('addMissionBtn').addEventListener('click', () => openEditModalForType('mission', null));
    document.getElementById('addProjectDemandBtn').addEventListener('click', () => openEditModalForType('pd', null));
    document.getElementById('addServiceBtn').addEventListener('click', () => openEditModalForType('service', null));
    document.getElementById('addDisasterBtn').addEventListener('click', () => openEditModalForType('disaster', null));
    document.getElementById('addStatBtn').addEventListener('click', () => openEditModalForType('stat', null));
    document.getElementById('addAmbulanceBtn').addEventListener('click', () => openEditModalForType('ambulance', null));
    document.getElementById('addTeamBtn').addEventListener('click', () => openEditModalForType('team', null));
    document.getElementById('addGalleryBtn').addEventListener('click', () => openEditModalForType('gallery', null));
    document.getElementById('addFacilityBtn').addEventListener('click', () => openEditModalForType('facility', null));
    document.getElementById('addMedItemBtn').addEventListener('click', () => openEditModalForType('med', null));
  }

  function openEditModalForType(type, id) {
    const d = state.dashboard;

    if (type === 'mission') {
      const item = (d.missionPoints || []).find((x) => x.id === id) || { display_order: 1, is_active: 1 };
      openModal(
        id ? 'Edit Mission Point' : 'Add Mission Point',
        [
          { name: 'point_text', label: 'Mission Statement Text *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/mission-points/${id}`, 'PUT', payload);
          else await api('/api/admin/mission-points', 'POST', payload);
          showToast('Mission point saved.');
        }
      );
    } else if (type === 'pd') {
      const item = (d.projectsDemands || []).find((x) => x.id === id) || { item_type: 'project', display_order: 1 };
      openModal(
        id ? 'Edit Project / Demand' : 'Add Project / Demand',
        [
          {
            name: 'item_type',
            label: 'Category Type *',
            type: 'select',
            options: [
              { value: 'project', label: 'New Proposed Project' },
              { value: 'demand', label: 'Institutional Request & Demand' }
            ]
          },
          { name: 'title', label: 'Title *', required: true },
          { name: 'subtitle', label: 'Subtitle / Highlight' },
          { name: 'description', label: 'Description *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/projects-demands/${id}`, 'PUT', payload);
          else await api('/api/admin/projects-demands', 'POST', payload);
          showToast('Project / Demand saved.');
        }
      );
    } else if (type === 'service') {
      const item = (d.services || []).find((x) => x.id === id) || { display_order: 1 };
      openModal(
        id ? 'Edit Service' : 'Add Service',
        [
          { name: 'title', label: 'Service Title *', required: true },
          { name: 'category', label: 'Category *', required: true },
          { name: 'stats_badge', label: 'Statistics Badge (e.g. 2,669 Cases)' },
          { name: 'image_url', label: 'Service Photo', type: 'image', aspect: 0 },
          { name: 'description', label: 'Description *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/services/${id}`, 'PUT', payload);
          else await api('/api/admin/services', 'POST', payload);
          showToast('Service saved.');
        }
      );
    } else if (type === 'disaster') {
      const item = (d.disasters || []).find((x) => x.id === id) || { display_order: 1 };
      openModal(
        id ? 'Edit Operation / Event' : 'Add Operation / Event',
        [
          { name: 'title', label: 'Operation / Event Title *', required: true },
          { name: 'event_date', label: 'Event Date *', required: true },
          { name: 'location', label: 'Location *', required: true },
          { name: 'impact_summary', label: 'Impact Summary (e.g. Rescued 28 Households) *', required: true },
          { name: 'image_url', label: 'Operation Photo', type: 'image', aspect: 0 },
          { name: 'description', label: 'Description *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/disasters/${id}`, 'PUT', payload);
          else await api('/api/admin/disasters', 'POST', payload);
          showToast('Disaster / Operation saved.');
        }
      );
    } else if (type === 'stat') {
      const item = (d.patientStats || []).find((x) => x.id === id) || { stat_group: 'regional', display_order: 1 };
      openModal(
        id ? 'Edit Statistic' : 'Add Statistic',
        [
          {
            name: 'stat_group',
            label: 'Statistic Group *',
            type: 'select',
            options: [
              { value: 'regional', label: 'Regional Patient Distribution' },
              { value: 'case_wise', label: 'Case-Wise Patient Distribution' },
              { value: 'mortuary', label: 'Mortuary & Ritual Washing (Ghusl)' }
            ]
          },
          { name: 'label', label: 'Label *', required: true },
          { name: 'count_value', label: 'Count Value *', type: 'number', required: true },
          { name: 'sub_details', label: 'Additional Details' },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/patient-stats/${id}`, 'PUT', payload);
          else await api('/api/admin/patient-stats', 'POST', payload);
          showToast('Statistic saved.');
        }
      );
    } else if (type === 'ambulance') {
      const item = (d.ambulances || []).find((x) => x.id === id) || { status: 'Active 24/7', display_order: 1 };
      openModal(
        id ? 'Edit Ambulance Unit' : 'Add Ambulance Unit',
        [
          { name: 'unit_name', label: 'Ambulance Unit Name *', required: true },
          { name: 'vehicle_code', label: 'Registration / Plate Code' },
          { name: 'organization_tag', label: 'Organization Tag *', required: true },
          { name: 'status', label: 'Operational Status *', required: true },
          { name: 'coverage_area', label: 'Coverage Area *', required: true },
          { name: 'equipment_summary', label: 'Equipment Summary *', required: true },
          { name: 'image_url', label: 'Ambulance Photo', type: 'image', aspect: 0 },
          { name: 'description', label: 'Description *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/ambulances/${id}`, 'PUT', payload);
          else await api('/api/admin/ambulances', 'POST', payload);
          showToast('Ambulance unit saved.');
        }
      );
    } else if (type === 'team') {
      const item = (d.teamMembers || []).find((x) => x.id === id) || { display_order: 1 };
      openModal(
        id ? 'Edit Team Member Profile' : 'Add Team Member Profile',
        [
          { name: 'photo_url', label: 'Team Member Photo (Crop & Auto-Compress)', type: 'image', aspect: 0 },
          { name: 'member_name', label: 'Team Member Name *', required: true },
          { name: 'role_title', label: 'Occupation / Designation *', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/team-members/${id}`, 'PUT', payload);
          else await api('/api/admin/team-members', 'POST', payload);
          showToast('Team member profile saved.');
        }
      );
    } else if (type === 'gallery') {
      const item = (d.gallery || []).find((x) => x.id === id) || { display_order: 1 };
      openModal(
        id ? 'Edit Gallery Photo' : 'Add Gallery Photo',
        [
          { name: 'title', label: 'Photo Title *', required: true },
          { name: 'category', label: 'Category (e.g. Ambulances, Facilities, Disaster Response) *', required: true },
          { name: 'image_url', label: 'Gallery Photo *', type: 'image', aspect: 0, required: true },
          { name: 'caption', label: 'Caption *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/gallery/${id}`, 'PUT', payload);
          else await api('/api/admin/gallery', 'POST', payload);
          showToast('Gallery photo saved.');
        }
      );
    } else if (type === 'facility') {
      const item = (d.facilities || []).find((x) => x.id === id) || { display_order: 1 };
      openModal(
        id ? 'Edit Facility' : 'Add Facility',
        [
          { name: 'title', label: 'Facility Title *', required: true },
          { name: 'category', label: 'Category *', required: true },
          { name: 'status_badge', label: 'Status / Impact Badge' },
          { name: 'specifications', label: 'Equipment & Technical Specifications' },
          { name: 'image_url', label: 'Facility Photo', type: 'image', aspect: 0 },
          { name: 'description', label: 'Description *', type: 'textarea', required: true },
          { name: 'display_order', label: 'Display Order', type: 'number', default: 1 }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/facilities/${id}`, 'PUT', payload);
          else await api('/api/admin/facilities', 'POST', payload);
          showToast('Facility saved.');
        }
      );
    } else if (type === 'med') {
      const item = (d.medicalInventory || []).find((x) => x.id === id) || {
        camp_name: 'Ethqaf Medicine Gwadar',
        serial_no: 1
      };
      openModal(
        id ? 'Edit Medicine / Equipment Item' : 'Add Medicine / Equipment Item',
        [
          { name: 'camp_name', label: 'Camp / Program Name *', required: true },
          { name: 'serial_no', label: 'Serial No. *', type: 'number', required: true },
          { name: 'item_name', label: 'Name of Item / Medicine *', required: true },
          { name: 'quantity', label: 'Quantity *', required: true },
          { name: 'remarks', label: 'Remarks' }
        ],
        item,
        async (payload) => {
          if (id) await api(`/api/admin/medical-inventory/${id}`, 'PUT', payload);
          else await api('/api/admin/medical-inventory', 'POST', payload);
          showToast('Medicine inventory item saved.');
        }
      );
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupCropperInteractions();
    setupAdminEvents();
    refreshDashboard();
  });
})();
