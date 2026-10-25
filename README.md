---
title: Gwadar Ambulance Service Gwadar
emoji: 🚑
colorFrom: red
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Gwadar Ambulance Service, Gwadar (G.A.S.G) — Official Website Portal & Secure Admin Panel

Complete full-stack web portal for **Gwadar Ambulance Service Gwadar & Bin Ahsaan Welfare Trust** (`Registration No: Bcra-114272`), built using the **Iterative Software Development Model** across 6 structured sprints.

---

## Key Features & Requirements Fulfilled

1. **Exact Header Design Implementation**:
   - Top row featuring the red Heart-ECG pulse emblem, **`AMBULANCE INSTITUTION`** title, and **`Emergency Medical Services`** subtitle.
   - Subtle horizontal divider separating the branding row from the 8 primary navigation items:
     `Home` | `About Us` | `Services` | `Ambulances` | `Our Team` | `Gallery` | `Facilities` | `Contact Us`
   - Fully responsive mobile hamburger drawer for smartphones and tablets.
2. **Strict Separation of Public Portal & Secure Admin Panel**:
   - The **Public Portal (`/`)** contains zero links, buttons, or scripts referencing the Admin Panel.
   - The **Admin Panel (`/admin`)** and its scripts (`/admin/js/admin.js`) and APIs (`/api/admin/*`) are strictly protected on the backend by JWT (`HttpOnly`, `SameSite=Strict` cookies), `bcryptjs` password hashing, `helmet` security headers, and `express-rate-limit` brute-force protection.
3. **Zero Fictional or Sample Data — 100% Admin-Controlled Content**:
   - All content on the public website is dynamically fetched from the SQLite database (`data/gasg_portal.sqlite`) managed exclusively through the Admin Panel.
   - Pre-initialized exclusively with the authentic facts, patient statistics (`4,225` total patients across Gwadar City `3,553`, Gwadar Surrounding Area `518`, District Kech `154`), case-wise distribution (`2,669` Emergency Medical, `601` Brought Dead, `532` Obstetric Deliveries, `423` Road Traffic Accidents), Mortuary (`43` bodies: `41` male, `2` female) & Ritual Washing/Shrouding (`26` bodies), Organogram (`12` tiers/roles), Ethqaf (`18` items) & Gwadar Ijtema (`45` items) medicine inventories, Disaster Rescue records, Proposed Projects, Institutional Demands, and extracted photographs from `GASG PPT 131026.pptx`.

---

## Running the Project

```bash
# Install dependencies
npm install

# Run automated integration & security test suite
npm test

# Start the production server (default http://localhost:3000)
npm start
```

### Portal URLs & Default Administrator Credentials
- **Public Website Portal**: `http://localhost:3000/`
- **Secure Admin Login**: `http://localhost:3000/admin/login`
- **Secure Admin Dashboard**: `http://localhost:3000/admin`
- **Default Admin Username**: `admin`
- **Default Admin Password**: `GasgAdmin@114272` *(can be changed anytime inside the Admin Panel under **Admin Security & Logs**)*
