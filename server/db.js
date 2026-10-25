const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'gasg_portal.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Administrator',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mission_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_text TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      icon_name TEXT NOT NULL DEFAULT 'ambulance',
      stats_badge TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS patient_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stat_group TEXT NOT NULL,
      label TEXT NOT NULL,
      count_value INTEGER NOT NULL,
      sub_details TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS disasters_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      location TEXT NOT NULL,
      impact_summary TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ambulances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_name TEXT NOT NULL,
      vehicle_code TEXT DEFAULT '',
      organization_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Operational 24/7',
      coverage_area TEXT NOT NULL,
      equipment_summary TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_title TEXT NOT NULL,
      member_name TEXT DEFAULT '',
      department TEXT NOT NULL,
      hierarchy_level INTEGER NOT NULL DEFAULT 1,
      parent_role TEXT DEFAULT '',
      description TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status_badge TEXT DEFAULT '',
      description TEXT NOT NULL,
      specifications TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS medical_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camp_name TEXT NOT NULL,
      serial_no INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity TEXT NOT NULL,
      remarks TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS projects_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      description TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS gallery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      caption TEXT NOT NULL,
      image_url TEXT NOT NULL,
      slide_ref TEXT DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT NOT NULL,
      sender_phone TEXT NOT NULL,
      sender_email TEXT DEFAULT '',
      subject TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'General Inquiry',
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      admin_notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedAuthenticData(forceReset = false) {
  initSchema();

  // Ensure default admin exists
  const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get().cnt;
  if (adminCount === 0) {
    const defaultAdminUser = process.env.ADMIN_USERNAME || 'admin';
    const defaultAdminPass = process.env.ADMIN_PASSWORD || 'GasgAdmin@114272';
    const hash = bcrypt.hashSync(defaultAdminPass, 12);
    db.prepare(`
      INSERT INTO admin_users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(defaultAdminUser, hash, 'GASG Chief Administrator', 'Super Administrator');
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM site_settings').get().cnt;
  if (settingsCount > 0 && !forceReset) {
    // Migrate legacy placeholder header title if present
    const curTitle = db.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'header_title'").get();
    if (curTitle && curTitle.setting_value === 'AMBULANCE INSTITUTION') {
      db.prepare("UPDATE site_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'header_title'")
        .run('GWADAR AMBULANCE SERVICE, GWADAR');
      db.prepare("UPDATE site_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'header_subtitle'")
        .run('Bin Ahsaan Welfare Trust • Emergency Medical Services (Reg No: Bcra-114272)');
    }
    const curBackupPath = db.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'local_backup_path'").get();
    if (!curBackupPath) {
      const defaultBackupFile = path.join(dataDir, 'gasg_linked_local_backup.sqlite');
      db.prepare(`
        INSERT OR REPLACE INTO site_settings (setting_key, setting_value, updated_at)
        VALUES ('local_backup_path', ?, CURRENT_TIMESTAMP)
      `).run(defaultBackupFile);
      syncLocalBackup(defaultBackupFile);
    }
    return { seeded: false, message: 'Database already contains data.' };
  }

  if (forceReset) {
    db.exec(`
      DELETE FROM site_settings;
      DELETE FROM mission_points;
      DELETE FROM services;
      DELETE FROM patient_stats;
      DELETE FROM disasters_operations;
      DELETE FROM ambulances;
      DELETE FROM team_members;
      DELETE FROM facilities;
      DELETE FROM medical_inventory;
      DELETE FROM projects_demands;
      DELETE FROM gallery_items;
    `);
  }

  // 1. Authentic Site & Header Settings (from Header Design + Slides 1, 3, 4, 7, 18)
  const initialSettings = [
    ['header_title', 'GWADAR AMBULANCE SERVICE, GWADAR'],
    ['header_subtitle', 'Bin Ahsaan Welfare Trust • Emergency Medical Services (Reg No: Bcra-114272)'],
    ['organization_name', 'Gwadar Ambulance Service Gwadar & Bin Ahsaan Welfare Trust'],
    ['short_name', 'G.A.S.G'],
    ['registration_no', 'Bcra-114272'],
    ['slogan', 'Saving a life is protection of humanity'],
    ['established_date', '1st January, 2022'],
    ['service_duration', '4 Years and 5 Months of Free Service'],
    ['logo_url', '/uploads/pptx/image5.png'],
    ['map_url', '/uploads/pptx/image6.jpg'],
    ['hero_bg_url', '/uploads/pptx/image16.jpeg'],
    ['gwadar_aerial_url', '/uploads/pptx/image30.jpeg'],
    ['history_title', 'History of Gwadar Ambulance Service & Bin Ahsaan Welfare Trust'],
    [
      'history_text',
      'Bin Ahsaan Trust and Gwadar Ambulance Services commenced operations on 1st January, 2022 (Registration No: Bcra-114272). The purpose of this service is to provide facilities and emergency assistance to the needy who are in emergency conditions. We also transport deceased bodies from one place to another with two ambulances.\n\nThe mission of this trust is to provide help to the people of Gwadar, Kech, and other adjoining areas. We believe that 24/7 service helps the community cover casualties and medical emergencies promptly.'
    ],
    [
      'vision_text',
      'Provision of prompt and speedy ambulance service in emergency to all needy people at Gwadar.'
    ],
    ['total_patients_served', '4225'],
    ['total_ambulances', '2'],
    ['mortuary_total_bodies', '43'],
    ['ghusl_total_bodies', '26'],
    ['operating_hours', '24/7 Hours Service (Round the Clock)'],
    ['service_areas', 'Gwadar City, Gwadar Surrounding Area, District Kech & Adjoining Areas (Proposed Expansion to Jewni)'],
    ['contact_location', 'Gwadar, Balochistan'],
    ['contact_address', 'Gwadar Ambulance Service Station, Gwadar, Balochistan'],
    ['contact_phone', ''],
    ['contact_email', ''],
    ['contact_notice', 'All emergency ambulance, mortuary, and ritual washing (Ghusl) services are provided for the welfare of the people of Gwadar, Kech, and adjoining areas under Bin Ahsaan Welfare Trust (Reg No: Bcra-114272).'],
    ['local_backup_path', path.join(dataDir, 'gasg_linked_local_backup.sqlite')]
  ];

  const insertSetting = db.prepare(`
    INSERT OR REPLACE INTO site_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  for (const [k, v] of initialSettings) {
    insertSetting.run(k, v);
  }

  // 2. Mission Points (Slide 4)
  const missions = [
    'To save a life, to protect all humanity.',
    'To save a life by provision of emergency ambulance service round the clock.',
    'To assist ill and needy people at the time of emergency, assisting them to reach the nearest health services.',
    'To provide all sort of help to the poor and needy people of Gwadar.',
    'To be a partner in building a healthy, safe and secure environment.'
  ];
  const insertMission = db.prepare(`
    INSERT INTO mission_points (point_text, display_order, is_active) VALUES (?, ?, 1)
  `);
  missions.forEach((m, i) => insertMission.run(m, i + 1));

  // 3. Services (Slides 3, 4, 7, 8, 9, 10-12, 13, 19, 21)
  const servicesData = [
    {
      title: '24/7 Emergency Medical Cases Transport',
      category: 'Emergency Response',
      description: 'Round-the-clock prompt and speedy emergency ambulance service assisting critically ill and needy patients to reach the nearest health services across Gwadar City, Gwadar surrounding areas, and District Kech.',
      icon_name: 'heartbeat',
      stats_badge: '2,669 Emergency Medical Cases',
      image_url: '/uploads/pptx/image16.jpeg',
      order: 1
    },
    {
      title: 'Obstetric Deliveries Emergency Transport',
      category: 'Maternal Care Transport',
      description: 'Dedicated emergency transport for maternal and obstetric delivery cases, ensuring expectant mothers in Gwadar and adjoining areas reach medical facilities safely and without delay.',
      icon_name: 'baby',
      stats_badge: '532 Obstetric Deliveries',
      image_url: '/uploads/pptx/image12.jpeg',
      order: 2
    },
    {
      title: 'Road Traffic Accident (RTA) Rescue',
      category: 'Trauma & Highway Rescue',
      description: 'Immediate on-scene emergency response and casualty evacuation for road traffic accidents across Gwadar, Makran Coastal Highway, and connecting district routes.',
      icon_name: 'ambulance',
      stats_badge: '423 Road Traffic Accident Cases',
      image_url: '/uploads/pptx/image28.jpeg',
      order: 3
    },
    {
      title: 'Deceased Body Transport Service',
      category: 'Humanitarian Support',
      description: 'Dignified transportation of brought-dead cases and deceased bodies from one place to another using two dedicated ambulances serving Gwadar, Kech, and adjoining areas.',
      icon_name: 'shield',
      stats_badge: '601 Brought Dead Cases',
      image_url: '/uploads/pptx/image26.jpg',
      order: 4
    },
    {
      title: 'Mortuary Preservation Facility',
      category: 'Mortuary Services',
      description: 'Equipped mortuary preservation service maintaining health and preservation standards with dual-chamber stainless steel refrigerated units (41 male and 2 female deceased bodies preserved).',
      icon_name: 'building',
      stats_badge: '43 Total Bodies in Mortuary',
      image_url: '/uploads/pptx/image25.jpeg',
      order: 5
    },
    {
      title: 'Ritual Washing & Shrouding of the Deceased (Ghusl)',
      category: 'Deceased Welfare',
      description: 'Complete Islamic ritual washing (Ghusl) and shrouding of the deceased performed with dignity and care by dedicated Gosal staff.',
      icon_name: 'hands',
      stats_badge: '26 Ritual Washing & Shrouding Cases',
      image_url: '/uploads/pptx/image27.jpeg',
      order: 6
    },
    {
      title: 'Disaster & Flood Rescue Operations',
      category: 'Disaster Response',
      description: 'Active field rescue operations during natural disasters in Gwadar, including the Ganz Koh-e-Daran mountain collapse (23/10/2022) and Gwadar Flood rescues on 26/02/2024 (28 households) and 11/03/2024 (16 households).',
      icon_name: 'lifebuoy',
      stats_badge: '44 Households Rescued in Floods',
      image_url: '/uploads/pptx/image8.jpeg',
      order: 7
    },
    {
      title: 'Free Medicine Camps & Community Awareness',
      category: 'Community Welfare',
      description: 'Provision of essential emergency medicines and medical equipment during Ethqaf Gwadar and Gwadar Ijtema (15–17 Sep 2023), alongside youth awareness programs on health, hygiene, drug prevention, and first aid.',
      icon_name: 'medical-kit',
      stats_badge: '63 Medicine Items & 60+ Youth Trained',
      image_url: '/uploads/pptx/image10.png',
      order: 8
    }
  ];

  const insertService = db.prepare(`
    INSERT INTO services (title, category, description, icon_name, stats_badge, image_url, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const s of servicesData) {
    insertService.run(s.title, s.category, s.description, s.icon_name, s.stats_badge, s.image_url, s.order);
  }

  // 4. Patient & Mortuary Statistics (Slides 7, 8, 9)
  const statsData = [
    // Regional distribution (Total: 4,225)
    ['regional', 'Gwadar City', 3553, 'Primary urban coverage area in Gwadar City (84.1% of total patients)', 1],
    ['regional', 'Gwadar Surrounding Area', 518, 'Adjoining coastal and rural settlements of Gwadar (12.3% of total patients)', 2],
    ['regional', 'District Kech', 154, 'Inter-district patient transfers and emergency support in Kech (3.6% of total patients)', 3],
    // Case-wise distribution (Total: 4,225)
    ['case_wise', 'Emergency Medical Cases', 2669, 'Acute medical emergencies transported 24/7 to nearest health services (63.2%)', 1],
    ['case_wise', 'Brought Dead Cases', 601, 'Deceased bodies transported with dignity between locations (14.2%)', 2],
    ['case_wise', 'Obstetric Deliveries', 532, 'Maternal and obstetric delivery emergency transfers (12.6%)', 3],
    ['case_wise', 'Road Traffic Accident Cases', 423, 'Highway and urban road traffic accident casualties rescued (10.0%)', 4],
    // Mortuary & Ritual Washing (Slide 9)
    ['mortuary', 'Male Dead Bodies (Mortuary)', 41, 'Male deceased bodies preserved in the GASG Mortuary facility', 1],
    ['mortuary', 'Female Dead Bodies (Mortuary)', 2, 'Female deceased bodies preserved in the GASG Mortuary facility', 2],
    ['mortuary', 'Total Dead Bodies in Mortuary', 43, 'Combined total deceased bodies preserved in the Mortuary', 3],
    ['mortuary', 'Ritual Washing & Shrouding of the Deceased', 26, 'Total number of dead bodies provided full ritual washing (Ghusl) and shrouding', 4]
  ];
  const insertStat = db.prepare(`
    INSERT INTO patient_stats (stat_group, label, count_value, sub_details, display_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const st of statsData) {
    insertStat.run(st[0], st[1], st[2], st[3], st[4]);
  }

  // 5. Disasters, Rescue Operations & Community Events (Slides 13, 19, 20, 21)
  const disastersData = [
    {
      title: 'Ganz Koh-e-Daran Disaster Rescue Operation',
      event_date: '23/10/2022',
      location: 'Hawachk Koh Daran, Ganz (Gwadar District)',
      impact_summary: 'Multi-day Mountain Collapse Search & Rescue Operation',
      description: 'On Sunday evening (23 October 2022 at 4:00 PM), a group of picnickers from Bandari and Panwan were buried under rubble after a mountain collapsed at Hawachk Koh Daran (Ganz). Gwadar Ambulance Service deployed ambulances and rescue teams on-site across multi-day rescue operations.',
      image_url: '/uploads/pptx/image8.jpeg',
      order: 1
    },
    {
      title: 'Gwadar Flood Emergency Rescue (February 2024)',
      event_date: '26/02/2024',
      location: 'District Gwadar',
      impact_summary: 'Rescued in District Gwadar: 28 Households',
      description: 'During the severe flood emergency in Gwadar on 26 February 2024, Gwadar Ambulance Service conducted rapid relief and evacuation operations, successfully rescuing 28 affected households in District Gwadar.',
      image_url: '/uploads/pptx/image12.jpeg',
      order: 2
    },
    {
      title: 'Gwadar Flood Emergency Rescue (March 2024)',
      event_date: '11/03/2024',
      location: 'District Gwadar',
      impact_summary: 'Rescued in District Gwadar: 16 Households',
      description: 'Following recurring heavy rains and flooding on 11 March 2024, Gwadar Ambulance Service teams mobilized to rescue and assist 16 additional households in District Gwadar.',
      image_url: '/uploads/pptx/image16.jpeg',
      order: 3
    },
    {
      title: 'Youth Awareness Program at GBHS Jiwani',
      event_date: 'Community Initiative',
      location: 'Government Boys High School (GBHS), Jiwani',
      impact_summary: '60+ Students Actively Participated',
      description: 'A comprehensive Awareness Program was conducted at Government Boys High School (GBHS), Jiwani focusing on education importance, health and hygiene, drug prevention, youth responsibilities, and community development through interactive lectures, discussions, and Q&A sessions with local facilitators.',
      image_url: '/uploads/pptx/image10.png',
      order: 4
    },
    {
      title: 'Formal Coordination Meeting with Municipal Committee',
      event_date: 'Institutional Linkage',
      location: 'Municipal Committee, Gwadar',
      impact_summary: 'Formal Agreement & Institutional Partnership',
      description: 'The Chairman Municipal Committee conducted a formal coordination meeting with the Chairman of GASG (Gwadar Ambulance Service Gwadar) to discuss community welfare initiatives, establishing strong institutional linkage and formal agreement.',
      image_url: '/uploads/pptx/image11.png',
      order: 5
    }
  ];
  const insertDisaster = db.prepare(`
    INSERT INTO disasters_operations (title, event_date, location, impact_summary, description, image_url, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const d of disastersData) {
    insertDisaster.run(d.title, d.event_date, d.location, d.impact_summary, d.description, d.image_url, d.order);
  }

  // 6. Ambulances Fleet (Slides 3, 18, and PPTX vehicle photos)
  const ambulancesData = [
    {
      unit_name: 'GASG Ambulance Unit 01',
      vehicle_code: 'CZ-5362',
      organization_tag: 'Gwadar Ambulance Service & Bin Ahsaan Welfare Trust',
      status: 'Active 24/7',
      coverage_area: 'Gwadar City, Gwadar Surrounding Area & District Kech',
      equipment_summary: 'Collapsible Loading Stretcher, Oxygen Cylinder, Emergency Lightbar & Siren, Patient Bench & First Aid Kit',
      description: 'Primary 24/7 emergency response ambulance operated by Gwadar Ambulance Service and Bin Ahsaan Welfare Trust since 1st January 2022 for emergency medical cases, obstetric deliveries, road traffic accidents, and inter-city patient transport.',
      image_url: '/uploads/pptx/image16.jpeg',
      order: 1
    },
    {
      unit_name: 'GASG Ambulance Unit 02',
      vehicle_code: 'Unit-02 (Fleet)',
      organization_tag: 'Bin Ahsaan & Associates / Bin Ahsaan Welfare Trust',
      status: 'Active 24/7',
      coverage_area: 'Gwadar, Kech & Adjoining Areas',
      equipment_summary: 'Wheeled Stretcher Trolley, Oxygen Support System, Rear & Side Access Doors, Emergency Beacon',
      description: 'Second dedicated fleet ambulance supporting round-the-clock emergency medical response, disaster relief operations, and dignified transportation of deceased bodies from one place to another.',
      image_url: '/uploads/pptx/image12.jpeg',
      order: 2
    },
    {
      unit_name: 'Jewni (Jiwani) Expansion Ambulance Initiative',
      vehicle_code: 'Proposed Sub-Tehsil Unit',
      organization_tag: 'GASG Expansion Project — Sub-Tehsil Jewni',
      status: 'Proposed Expansion',
      coverage_area: 'Sub-Tehsil Jewni (Jiwani) & Underserved Coastal Areas',
      equipment_summary: 'Full 24/7 Emergency Medical Transport & First Responder Coverage',
      description: 'Following 4 years and 5 months of smooth free ambulance service in Gwadar, this proposed expansion extends dedicated ambulance coverage to the nearby underserved sub-Tehsil of Jewni so every resident of Gwadar district has timely access to emergency transport.',
      image_url: '/uploads/pptx/image13.jpeg',
      order: 3
    }
  ];
  const insertAmbulance = db.prepare(`
    INSERT INTO ambulances (unit_name, vehicle_code, organization_tag, status, coverage_area, equipment_summary, description, image_url, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const a of ambulancesData) {
    insertAmbulance.run(a.unit_name, a.vehicle_code, a.organization_tag, a.status, a.coverage_area, a.equipment_summary, a.description, a.image_url, a.order);
  }

  // 7. Our Team / Organogram (Slide 5 exact hierarchy)
  const organogramData = [
    { role: 'Chairman', dept: 'Executive Leadership', level: 1, parent: '', desc: 'Head of Gwadar Ambulance Service Gwadar & Bin Ahsaan Welfare Trust, overseeing strategic governance, institutional linkages, and community welfare initiatives.', order: 1 },
    { role: 'Adviser', dept: 'Advisory & Governance', level: 1, parent: 'Chairman', desc: 'Provides strategic guidance, community consultation, and institutional oversight to the Chairman and leadership board.', order: 2 },
    { role: 'President', dept: 'Executive Leadership', level: 2, parent: 'Chairman', desc: 'Leads organizational execution, welfare operations, and coordination across Gwadar and adjoining areas.', order: 3 },
    { role: 'General Secretary', dept: 'Administration & Secretariat', level: 2, parent: 'Chairman', desc: 'Manages official records, registration compliance (Bcra-114272), organizational correspondence, and administrative governance.', order: 4 },
    { role: 'Treasure', dept: 'Finance & Resource Management', level: 3, parent: 'Chairman', desc: 'Oversees financial stewardship, grant management, fuel and maintenance allocations, and welfare trust accounts.', order: 5 },
    { role: 'Operation Manager', dept: 'Field & Dispatch Operations', level: 3, parent: 'General Secretary', desc: 'Directs 24/7 ambulance dispatch, disaster rescue mobilization, mortuary operations, and field response across Gwadar and Kech.', order: 6 },
    { role: 'Information Secretary', dept: 'Communications & Public Outreach', level: 4, parent: 'President', desc: 'Coordinates public awareness campaigns, community engagement, patient data reporting, and media documentation.', order: 7 },
    { role: 'Staff Officer', dept: 'Personnel & Station Management', level: 4, parent: 'Operation Manager', desc: 'Supervises station personnel, shift schedules, and operational readiness at the ambulance station.', order: 8 },
    { role: 'Medical Officer', dept: 'Medical Care & Camp Supervision', level: 5, parent: 'Staff Officer', desc: 'Oversees emergency medical supplies, Ethqaf and Ijtema medicine camps, first-aid training, and patient care standards.', order: 9 },
    { role: 'Gosal', dept: 'Mortuary & Ritual Washing (Ghusl)', level: 5, parent: 'Information Secretary', desc: 'Performs dignified ritual washing (Ghusl) and shrouding of the deceased (26 cases completed) and assists with mortuary care.', order: 10 },
    { role: 'Driver', dept: '24/7 Ambulance Fleet Crew', level: 6, parent: 'Medical Officer', desc: 'Operates GASG ambulances round the clock for emergency medical cases, obstetric deliveries, road traffic accidents, and deceased transport.', order: 11 },
    { role: 'Office Boy/ Helper', dept: 'Station & Field Support', level: 7, parent: 'Driver', desc: 'Supports ambulance station maintenance, equipment handling, stretcher assistance, and daily welfare operations.', order: 12 }
  ];
  const insertTeam = db.prepare(`
    INSERT INTO team_members (role_title, member_name, department, hierarchy_level, parent_role, description, photo_url, display_order, is_active)
    VALUES (?, '', ?, ?, ?, ?, '', ?, 1)
  `);
  for (const t of organogramData) {
    insertTeam.run(t.role, t.dept, t.level, t.parent, t.desc, t.order);
  }

  // 8. Facilities (Slides 9, 10, 11, 12, 15, 24)
  const facilitiesData = [
    {
      title: 'Mortuary Cold Storage Facility (HEG Dual-Chamber Units)',
      category: 'Mortuary Facility',
      status_badge: '43 Deceased Bodies Preserved (41 Male, 2 Female)',
      description: 'Dedicated mortuary facility equipped with two stainless steel HEG dual-compartment refrigerated mortuary cabinets (Units A-1 & B-2) and preparation table to preserve deceased bodies with dignity.',
      specifications: '2x HEG Stainless Steel Dual-Deck Refrigerated Cabinets (4-body capacity) | Digital Temperature Control Panels | Mortuary Examination & Preparation Table',
      image_url: '/uploads/pptx/image25.jpeg',
      order: 1
    },
    {
      title: 'Ritual Washing & Shrouding (Ghusl) Center',
      category: 'Deceased Welfare Facility',
      status_badge: '26 Ritual Washings & Shroudings Completed',
      description: 'Specialized facility at Gwadar Ambulance Service for performing Islamic ritual washing (Ghusl) and shrouding (Kafan) of the deceased by dedicated Gosal staff.',
      specifications: 'Hygienic Washing Area | Shrouding & Coffin Preparation | Dedicated Gosal Team | 24/7 Availability',
      image_url: '/uploads/pptx/image27.jpeg',
      order: 2
    },
    {
      title: '24/7 Ambulance Dispatch & Emergency Station',
      category: 'Emergency Operations',
      status_badge: '4,225 Total Patients Served',
      description: 'Central operational hub in Gwadar coordinating two 24/7 ambulances across Gwadar City (3,553 patients), Gwadar Surrounding Area (518 patients), and District Kech (154 patients).',
      specifications: '2x Equipped Ambulances | Wheeled Collapsible Stretchers | Oxygen Cylinders | 24/7 Emergency Response Crew',
      image_url: '/uploads/pptx/image24.jpeg',
      order: 3
    },
    {
      title: 'Emergency Diagnostic & Field Medical Equipment',
      category: 'Medical Equipment',
      status_badge: 'Active Field & Camp Equipment',
      description: 'Essential diagnostic and respiratory support instruments maintained for ambulance response, Ethqaf Gwadar, and Gwadar Ijtema medical camps.',
      specifications: 'Oxygen Cylinders (2) | Nebulizer Machine with Masks & Items (6) | BP Operators (6) | Pulse Oximeters (5) | Digital Thermometers (5) | Blood Glucose Monitoring System (1)',
      image_url: '/uploads/pptx/image18.jpeg',
      order: 4
    }
  ];
  const insertFacility = db.prepare(`
    INSERT INTO facilities (title, category, status_badge, description, specifications, image_url, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const f of facilitiesData) {
    insertFacility.run(f.title, f.category, f.status_badge, f.description, f.specifications, f.image_url, f.order);
  }

  // 9. Authentic Medical Camp Inventories (Slide 10: Ethqaf Medicine Gwadar [18 items], Slides 11-12: Gwadar Ejthama Medicine 15-17 Sep 2023 [45 items])
  const ethqafItems = [
    [1, 'Inj/ Bofalgan', '50', ''],
    [2, 'R/L 500 ML', '70', ''],
    [3, 'N/S 500 ML', '70', ''],
    [4, 'N/S 100 ML', '80', ''],
    [5, 'Inj/ Onset 8 mg', '80', ''],
    [6, 'Inj/ Decadiron', '8 box', ''],
    [7, 'Inj/ Ceftaxone 1 mg', '80', ''],
    [8, 'Inj/ Risik 40 mg', '80', ''],
    [9, 'D/ Syrang 10 cc', '4 box', ''],
    [10, 'D/ Syrang 3 cc', '4 box', ''],
    [11, 'Inj/ Flgyl', '90', ''],
    [12, 'Inj/ Navidate', '60', ''],
    [13, 'Enfolor Sashe', '8 box', ''],
    [14, 'Inj/ Voren 75 mg', '80', ''],
    [15, 'Canoula', '6 box', ''],
    [16, 'BP Oprator', '5', ''],
    [17, 'Plus oxymeter', '5', ''],
    [18, 'Digital therma meter', '5', '']
  ];

  const ejthamaItems = [
    [1, 'Stacking', '02', ''],
    [2, 'Inj/ Granavat', '10', ''],
    [3, 'Inj/ Diclfenac Sodium', '35', ''],
    [4, 'Inj/ Dexamethasone', '60', ''],
    [5, 'Tab/ Froben 100 mg', '120', ''],
    [6, 'Tab/ Artifen 50mg', '40', ''],
    [7, 'Syring', '01 box', ''],
    [8, 'PaciLact RL', '4', ''],
    [9, 'Normal Sline(Gee- Sol) 500', '9', ''],
    [10, 'Tab/ Tenormin 50mg', '80', ''],
    [11, 'Tab/ Getryl 2mg', '30', ''],
    [12, 'Tab/ Nuberol Forte', '40', ''],
    [13, 'Nebulizer Machine with mask', '1', ''],
    [14, 'PB Operator with Stac', '1', ''],
    [15, 'Vintilon drop', '1', ''],
    [16, 'Cop/ Rulling 200 mg', '54', ''],
    [17, 'Inj/ Aval', '25', ''],
    [18, 'Tab/ Lowplat', '10', ''],
    [19, 'Tab/ Capoten', '30', ''],
    [20, 'Cap/Wilson 60 mg', '10', ''],
    [21, 'Tab/ Brufen 200 mg', '10', ''],
    [22, 'Risk sashe', '1 Box', ''],
    [23, 'Canoula', '20', ''],
    [24, 'Tab/ Derby', '10', ''],
    [25, 'Tab/ Amoxil 500mg', '50', ''],
    [26, 'Tab/ Arnil', '20', ''],
    [27, 'Tab/ Penadol', '220', ''],
    [28, 'Tab/ Imodium 2mg', '20', ''],
    [29, 'Tab/ Flagyl 400mg', '60', ''],
    [30, 'Tab/ Motilium 10mg', '60', ''],
    [31, 'Tab/ Metrozine 400mg', '20', ''],
    [32, 'Tab/ Angised', '30', ''],
    [33, 'Tab/ Arinac', '40', ''],
    [34, 'Tab/ Glucophage 500mg', '50', ''],
    [35, 'Tab/ Zyrtec 10mg', '15', ''],
    [36, 'Blood Glucose M System', '1', ''],
    [37, 'Nebulizing Items', '5', ''],
    [38, 'Tab/E-zoom', '15', ''],
    [39, 'Oxygen selender', '2', ''],
    [40, 'Tab/ Sitagly Met', '14', ''],
    [41, 'Tab/ Piriton', '20', ''],
    [42, 'Tab/ Rejex 10 md', '35', ''],
    [43, 'Tab/ Cyrocin', '10', ''],
    [44, 'Tab/ Stripcell', '8', ''],
    [45, 'Tab/ Entamizole 250mg', '20', '']
  ];

  const insertMed = db.prepare(`
    INSERT INTO medical_inventory (camp_name, serial_no, item_name, quantity, remarks)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of ethqafItems) {
    insertMed.run('Ethqaf Medicine Gwadar', item[0], item[1], item[2], item[3]);
  }
  for (const item of ejthamaItems) {
    insertMed.run('Gwadar Ejthama Medicine (15-17 Sep 2023)', item[0], item[1], item[2], item[3]);
  }

  // 10. Institutional Demands & Proposed Projects (Slides 15, 17, 18)
  const projectsDemandsData = [
    {
      item_type: 'project',
      title: 'Empowering Communities with Life-Saving Skills and Emergency Medical Support',
      subtitle: '24/7 Emergency Response + Weekly & Monthly First Aid Training',
      description: 'The purpose of this initiative is to save lives, strengthen emergency response, and build a culture of preparedness across Gwadar and its underserved remote communities. Beyond providing rapid and 24/7 ambulance services, the project places strong emphasis on community empowerment through structured awareness and training programs. Through regular weekly and monthly sessions on first aid, emergency response, and medical awareness, individuals will be equipped with the knowledge and confidence to act as first responders in critical situations. This dual approach—immediate emergency response combined with proactive community education—significantly reduces preventable deaths and creates a lifesaving community network.',
      order: 1
    },
    {
      item_type: 'project',
      title: 'Expansion of Ambulance Service to Jewni (Jiwani)',
      subtitle: 'Extending 4+ Years of Free Gwadar Ambulance Coverage to Sub-Tehsil Jewni',
      description: 'Having provided free ambulance services smoothly in Gwadar for 4 years and 5 months, Gwadar Ambulance Service proposes to extend ambulance coverage to the nearby underserved sub-Tehsil of Jewni. While Gwadar is served with reliable ambulance coverage, Jewni lacks such facilities. Our goal is to ensure every resident of the Gwadar district, including Jewni, has access to timely emergency ambulance service.',
      order: 2
    },
    {
      item_type: 'demand',
      title: 'Installation of a 15 kW Generator and 15 kW Solarization System for the Mortuary',
      subtitle: 'Uninterrupted Power & Lithium Battery Backup',
      description: 'To ensure an uninterrupted power supply and maintain required health and preservation standards, we request the installation of a 15 kW generator along with a 15 kW solarization system equipped with lithium battery backup at the mortuary. This will provide a reliable and sustainable energy source for the proper functioning of mortuary facilities.',
      order: 1
    },
    {
      item_type: 'demand',
      title: 'Provision of Fuel & Maintenance',
      subtitle: 'Continuous Ambulance & Mortuary Operations',
      description: 'Arrange a regular supply of fuel and maintenance support for ambulance vehicles and mortuary operations to enable timely emergency response and continuous public service delivery.',
      order: 2
    },
    {
      item_type: 'demand',
      title: 'Establishment of an Office at the Ambulance Station',
      subtitle: 'Administration, Coordination & Record Management',
      description: 'For improved administration, effective coordination, communication, and proper record management, a dedicated office should be established at the ambulance station.',
      order: 3
    },
    {
      item_type: 'demand',
      title: 'Approval of Annual Grant',
      subtitle: 'Sustainable Institutional Support',
      description: 'Approve a sufficient and sustainable annual grant to ensure the uninterrupted and efficient functioning of the Gwadar Ambulance Service and the Mortuary.',
      order: 4
    }
  ];
  const insertPD = db.prepare(`
    INSERT INTO projects_demands (item_type, title, subtitle, description, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  for (const pd of projectsDemandsData) {
    insertPD.run(pd.item_type, pd.title, pd.subtitle, pd.description, pd.order);
  }

  // 11. Authentic Gallery Items (from PPTX Media)
  const galleryData = [
    {
      title: 'GASG Ambulance Unit on Coastal Highway',
      category: 'Ambulances',
      caption: 'Gwadar Ambulance Service emergency vehicle operating on the coastal highway in Gwadar District.',
      image_url: '/uploads/pptx/image16.jpeg',
      slide_ref: 'Slide 22',
      order: 1
    },
    {
      title: 'GASG & Bin Ahsaan Welfare Trust Fleet',
      category: 'Ambulances',
      caption: 'Two ambulances of Gwadar Ambulance Service & Bin Ahsaan Welfare Trust serving patients and emergency calls.',
      image_url: '/uploads/pptx/image12.jpeg',
      slide_ref: 'Slide 22',
      order: 2
    },
    {
      title: 'Emergency Stretcher & Ambulance Readiness',
      category: 'Ambulances',
      caption: 'GASG staff preparing the wheeled ambulance stretcher for emergency patient transport.',
      image_url: '/uploads/pptx/image13.jpeg',
      slide_ref: 'Slide 22',
      order: 3
    },
    {
      title: 'Road Traffic Accident Emergency Response',
      category: 'Emergency Operations',
      caption: 'On-site emergency ambulance response to a road traffic accident in Gwadar District.',
      image_url: '/uploads/pptx/image28.jpeg',
      slide_ref: 'Slide 24',
      order: 4
    },
    {
      title: 'Mortuary Cold Storage Chambers (Closed View)',
      category: 'Facilities',
      caption: 'Dual HEG stainless steel refrigerated mortuary preservation units (A-1 / B-2) and preparation table.',
      image_url: '/uploads/pptx/image25.jpeg',
      slide_ref: 'Slide 24',
      order: 5
    },
    {
      title: 'Mortuary Refrigerated Trays (Interior View)',
      category: 'Facilities',
      caption: 'Interior view of the stainless steel mortuary cold storage chambers maintained by GASG.',
      image_url: '/uploads/pptx/image27.jpeg',
      slide_ref: 'Slide 24',
      order: 6
    },
    {
      title: 'Ambulance Stretchers & Cabin Equipment',
      category: 'Facilities',
      caption: 'Emergency stretchers and ambulance interior equipped with oxygen cylinder and patient support.',
      image_url: '/uploads/pptx/image24.jpeg',
      slide_ref: 'Slide 24',
      order: 7
    },
    {
      title: 'Map of Gwadar District Service Area',
      category: 'Service Area',
      caption: 'Map of Gwadar District showing Jiwani, Ganz, Gwadar, Pishukan, Surbandar, Pasni, Ormara, and adjoining Kech District.',
      image_url: '/uploads/pptx/image6.jpg',
      slide_ref: 'Slide 6',
      order: 8
    },
    {
      title: 'GBHS Jiwani Youth Awareness Program',
      category: 'Community & Awareness',
      caption: 'Comprehensive awareness session at Government Boys High School (GBHS), Jiwani with 60+ participating students.',
      image_url: '/uploads/pptx/image10.png',
      slide_ref: 'Slide 21',
      order: 9
    },
    {
      title: 'Coordination Meeting with Chairman Municipal Committee',
      category: 'Meetings & Governance',
      caption: 'Formal coordination meeting and agreement between Chairman Municipal Committee and Chairman of GASG.',
      image_url: '/uploads/pptx/image11.png',
      slide_ref: 'Slide 21',
      order: 10
    },
    {
      title: 'GASG Service Presentation & Briefing',
      category: 'Meetings & Governance',
      caption: 'Official presentation of the Gwadar Ambulance Service video and operational progress to community leaders.',
      image_url: '/uploads/pptx/image19.jpeg',
      slide_ref: 'Slide 23',
      order: 11
    },
    {
      title: 'Executive Consultation & Planning Session',
      category: 'Meetings & Governance',
      caption: 'GASG leadership and community representatives reviewing service operations and welfare proposals.',
      image_url: '/uploads/pptx/image20.jpg',
      slide_ref: 'Slide 23',
      order: 12
    },
    {
      title: 'Administrative Review & Documentation',
      category: 'Meetings & Governance',
      caption: 'Leadership team reviewing official agreements and operational records at the GASG office.',
      image_url: '/uploads/pptx/image18.jpeg',
      slide_ref: 'Slide 23',
      order: 13
    },
    {
      title: 'Projector Briefing & Institutional Identity',
      category: 'Meetings & Governance',
      caption: 'Briefing session and official badge of Gwadar Ambulance Service (G.A.S.G).',
      image_url: '/uploads/pptx/image17.jpeg',
      slide_ref: 'Slide 22',
      order: 14
    },
    {
      title: 'Community Elders & Trust Committee Meeting',
      category: 'Meetings & Governance',
      caption: 'Consultation meeting with community members and trust representatives in Gwadar.',
      image_url: '/uploads/pptx/image21.jpeg',
      slide_ref: 'Slide 23',
      order: 15
    },
    {
      title: 'Operational Coordination Meeting',
      category: 'Meetings & Governance',
      caption: 'Advisory and operational coordination session at Gwadar Ambulance Service.',
      image_url: '/uploads/pptx/image22.jpeg',
      slide_ref: 'Slide 23',
      order: 16
    },
    {
      title: 'Ganz Koh-e-Daran Disaster Rescue Site (23/10/2022)',
      category: 'Disaster Response',
      caption: 'Rescue vehicles and teams gathered at Hawachk Koh Daran (Ganz) following the mountain collapse incident on 23 October 2022.',
      image_url: '/uploads/pptx/image8.jpeg',
      slide_ref: 'Slide 20',
      order: 17
    },
    {
      title: 'GASG Ambulance Team at Koh-e-Daran Rescue',
      category: 'Disaster Response',
      caption: 'GASG ambulance and rescue personnel on standby during the Ganz Koh-e-Daran rescue operation.',
      image_url: '/uploads/pptx/image9.jpeg',
      slide_ref: 'Slide 20',
      order: 18
    },
    {
      title: 'Humanitarian Burial & Funeral Support',
      category: 'Humanitarian Support',
      caption: 'Bin Ahsaan Welfare Trust ambulance and volunteers assisting with dignified burial rites.',
      image_url: '/uploads/pptx/image23.jpeg',
      slide_ref: 'Slide 23',
      order: 19
    },
    {
      title: 'Gwadar Peninsula Panorama',
      category: 'Service Area',
      caption: 'Aerial twilight view of Gwadar city—home to Gwadar Ambulance Service (G.A.S.G).',
      image_url: '/uploads/pptx/image30.jpeg',
      slide_ref: 'Slide 25',
      order: 20
    }
  ];

  const insertGallery = db.prepare(`
    INSERT INTO gallery_items (title, category, caption, image_url, slide_ref, display_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  for (const g of galleryData) {
    insertGallery.run(g.title, g.category, g.caption, g.image_url, g.slide_ref, g.order);
  }

  syncLocalBackup();
  return { seeded: true, message: 'Authentic GASG PPTX data seeded successfully.' };
}

function syncLocalBackup(overridePath = null) {
  try {
    let rawPath = overridePath;
    if (!rawPath) {
      const row = db.prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'local_backup_path'").get();
      rawPath = row ? row.setting_value : '';
    }
    if (!rawPath || !String(rawPath).trim()) {
      return { synced: false, error: 'No local backup path configured.' };
    }

    let targetFile = path.resolve(String(rawPath).trim());
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, 'gasg_linked_local_backup.sqlite');
    }

    const parentDir = path.dirname(targetFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Flush all WAL transactions into the main database file so it is a complete standalone file
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

    // Update the single linked local database file in-place without creating extra files
    if (path.resolve(targetFile) !== path.resolve(dbPath)) {
      fs.copyFileSync(dbPath, targetFile);
    }

    const stats = fs.statSync(targetFile);
    const sizeKb = (stats.size / 1024).toFixed(1);
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO site_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    upsert.run('local_backup_path', targetFile);
    upsert.run('local_backup_last_sync', nowStr);
    upsert.run('local_backup_status', `Synced in-place (${sizeKb} KB)`);

    // Checkpoint again so the metadata update is also flushed into the linked file
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    if (path.resolve(targetFile) !== path.resolve(dbPath)) {
      fs.copyFileSync(dbPath, targetFile);
    }

    // Also export static JSON snapshot for Hugging Face Static Space compatibility
    try {
      const pubDataDir = path.join(__dirname, '..', 'public', 'data');
      if (!fs.existsSync(pubDataDir)) fs.mkdirSync(pubDataDir, { recursive: true });
      fs.writeFileSync(
        path.join(pubDataDir, 'portal_data.json'),
        JSON.stringify(getAllPublicPortalData(), null, 2),
        'utf8'
      );
    } catch (_) {}

    return {
      synced: true,
      targetFile,
      lastSync: nowStr,
      sizeBytes: stats.size,
      status: `Synced in-place (${sizeKb} KB)`
    };
  } catch (err) {
    return { synced: false, error: err.message };
  }
}

function getStandaloneDatabaseBuffer() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  return fs.readFileSync(dbPath);
}

function restoreDatabaseFromFile(tempFilePath) {
  if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    throw new Error('Uploaded backup file not found.');
  }

  const headerBuf = Buffer.alloc(16);
  const fd = fs.openSync(tempFilePath, 'r');
  try {
    fs.readSync(fd, headerBuf, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (!headerBuf.toString('utf8', 0, 15).startsWith('SQLite format 3')) {
    throw new Error('Invalid file: Only valid SQLite (.sqlite / .db) database backup files are allowed.');
  }

  // Validate integrity and schema before restoring
  const checkDb = new DatabaseSync(tempFilePath, { readOnly: true });
  try {
    const integrity = checkDb.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') {
      throw new Error('Uploaded SQLite backup file failed integrity check.');
    }
    const hasSettings = checkDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='site_settings'")
      .get();
    if (!hasSettings) {
      throw new Error('Uploaded SQLite file is not a valid G.A.S.G portal backup (missing site_settings table).');
    }
  } finally {
    checkDb.close();
  }

  const existingBackupRow = db
    .prepare("SELECT setting_value FROM site_settings WHERE setting_key = 'local_backup_path'")
    .get();
  const preservedBackupPath = existingBackupRow ? existingBackupRow.setting_value : '';

  const tablesToRestore = [
    'site_settings',
    'mission_points',
    'services',
    'patient_stats',
    'disasters_operations',
    'ambulances',
    'team_members',
    'facilities',
    'medical_inventory',
    'projects_demands',
    'gallery_items',
    'contact_messages'
  ];

  db.prepare('ATTACH DATABASE ? AS restore_src').run(tempFilePath);
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const tbl of tablesToRestore) {
        const existsInBackup = db
          .prepare("SELECT name FROM restore_src.sqlite_master WHERE type='table' AND name = ?")
          .get(tbl);
        if (existsInBackup) {
          db.exec(`DELETE FROM main.${tbl};`);
          db.exec(`INSERT INTO main.${tbl} SELECT * FROM restore_src.${tbl};`);
        }
      }
      if (preservedBackupPath) {
        db.prepare(`
          INSERT OR REPLACE INTO main.site_settings (setting_key, setting_value, updated_at)
          VALUES ('local_backup_path', ?, CURRENT_TIMESTAMP)
        `).run(preservedBackupPath);
      }
      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }
  } finally {
    try {
      db.exec('DETACH DATABASE restore_src;');
    } catch (_) {}
  }

  const syncRes = syncLocalBackup();
  return {
    restored: true,
    syncedLocal: syncRes.synced,
    targetFile: syncRes.targetFile || preservedBackupPath
  };
}

function logAudit(username, action, details = '') {
  try {
    db.prepare(`
      INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)
    `).run(username || 'system', action, typeof details === 'string' ? details : JSON.stringify(details));
    syncLocalBackup();
  } catch (_) {
    // ignore logging errors
  }
}

function getAllPublicPortalData() {
  const settingsRows = db.prepare('SELECT setting_key, setting_value FROM site_settings').all();
  const settings = {};
  const privateKeys = new Set(['local_backup_path', 'local_backup_last_sync', 'local_backup_status']);
  for (const r of settingsRows) {
    if (!privateKeys.has(r.setting_key)) {
      settings[r.setting_key] = r.setting_value;
    }
  }

  const missionPoints = db.prepare('SELECT * FROM mission_points WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();
  const services = db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();
  const patientStats = db.prepare('SELECT * FROM patient_stats ORDER BY stat_group ASC, display_order ASC, id ASC').all();
  const disasters = db.prepare('SELECT * FROM disasters_operations WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();
  const ambulances = db.prepare('SELECT * FROM ambulances WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();
  const teamMembers = db.prepare('SELECT * FROM team_members WHERE is_active = 1 ORDER BY hierarchy_level ASC, display_order ASC, id ASC').all();
  const facilities = db.prepare('SELECT * FROM facilities WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();
  const medicalInventory = db.prepare('SELECT * FROM medical_inventory ORDER BY camp_name ASC, serial_no ASC, id ASC').all();
  const projectsDemands = db.prepare('SELECT * FROM projects_demands WHERE is_active = 1 ORDER BY item_type ASC, display_order ASC, id ASC').all();
  const gallery = db.prepare('SELECT * FROM gallery_items WHERE is_active = 1 ORDER BY display_order ASC, id ASC').all();

  return {
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
    gallery
  };
}

module.exports = {
  db,
  dbPath,
  initSchema,
  seedAuthenticData,
  syncLocalBackup,
  getStandaloneDatabaseBuffer,
  restoreDatabaseFromFile,
  logAudit,
  getAllPublicPortalData
};
