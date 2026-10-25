(function () {
'use strict';
let portalState = {
data: null,
selectedGalleryCategory: 'All',
selectedCamp: 'All',
inventoryQuery: '',
renderedSections: new Set(),
activeSection: 'home'
};
function ensureSectionRendered(sectionId) {
const data = portalState.data;
if (!data || portalState.renderedSections.has(sectionId)) return;
portalState.renderedSections.add(sectionId);
switch (sectionId) {
case 'home':
renderHeroSection(data);
break;
case 'about':
renderAboutSection(data);
break;
case 'services':
renderServicesSection(data);
break;
case 'ambulances':
renderAmbulancesSection(data);
break;
case 'team':
renderTeamSection(data);
break;
case 'gallery':
renderGallerySection(data);
break;
case 'facilities':
renderFacilitiesSection(data);
break;
case 'contact':
renderContactSection(data);
break;
}
}
function escapeHtml(str) {
return String(str ?? '')
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&#039;');
}
function formatNumber(n) {
const num = Number(n);
if (Number.isNaN(num)) return String(n ?? '');
return num.toLocaleString('en-US');
}
function setText(id, val) {
const el = document.getElementById(id);
const str = String(val ?? '');
if (el && el.textContent !== str) el.textContent = str;
}
async function loadPortalData() {
const loader = document.getElementById('portalLoader');
const main = document.getElementById('portalMain');
try {
let data = null;
const cacheBuster = `_t=${Date.now()}`;

// 1. Try Live Server API First (Network-first, bypasses browser & proxy cache)
try {
const res = await fetch(`/api/public/portal-data?${cacheBuster}`, {
cache: 'no-store',
headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
});
if (res.ok) {
const json = await res.json();
if (json && json.settings) {
data = json;
}
}
} catch (_) {}

// 2. Fallback to fresh portal_data.json (for static hosting or when API endpoint is unavailable)
if (!data) {
try {
const fallbackRes = await fetch(`/data/portal_data.json?${cacheBuster}`, {
cache: 'no-store',
headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
});
if (fallbackRes.ok) {
const json = await fallbackRes.json();
if (json && json.settings) {
data = json;
}
}
} catch (_) {}
}

// 3. Offline PWA Fallback: If both network requests failed (e.g. no internet connectivity)
if (!data) {
const localRaw = localStorage.getItem('gasg_master_db_v1');
if (localRaw) {
try {
data = JSON.parse(localRaw);
} catch (_) {}
}
} else {
// Update local cache with fresh data for future offline PWA support
try {
localStorage.setItem('gasg_master_db_v1', JSON.stringify(data));
} catch (_) {}
}

if (!data) throw new Error('Failed to load portal data');

portalState.data = data;
portalState.renderedSections.clear();
renderHeaderAndFooter(data);
ensureSectionRendered('home');
if (portalState.activeSection && portalState.activeSection !== 'home') {
ensureSectionRendered(portalState.activeSection);
}
if (loader) loader.classList.add('hidden');
if (main) main.classList.remove('hidden');
} catch (err) {
if (loader) loader.classList.add('hidden');
if (main) main.classList.remove('hidden');
}
}
function renderHeaderAndFooter(data) {
const s = data.settings || {};
setText('headerTitle', s.header_title || 'GWADAR AMBULANCE SERVICE, GWADAR');
setText(
'headerSubtitle',
s.header_subtitle || 'Bin Ahsaan Welfare Trust • Emergency Medical Services (Reg No: Bcra-114272)'
);
const isCustomLogo = s.logo_url && s.logo_url !== '/uploads/pptx/image5.png';
const headerLogo = document.getElementById('headerLogoImg');
if (headerLogo && isCustomLogo && headerLogo.getAttribute('src') !== s.logo_url) {
headerLogo.src = s.logo_url;
}
const activeLogoSrc = isCustomLogo ? s.logo_url : headerLogo ? headerLogo.src : s.logo_url;
['footerLogo', 'pwaBannerLogo', 'pwaGuideLogo'].forEach((id) => {
const el = document.getElementById(id);
if (el && activeLogoSrc && el.getAttribute('src') !== activeLogoSrc) {
el.src = activeLogoSrc;
}
});
if (isCustomLogo) {
const fav = document.getElementById('dynamicFavicon');
const appFav = document.getElementById('dynamicAppleIcon');
if (fav) fav.href = s.logo_url;
if (appFav) appFav.href = s.logo_url;
}
setText('footerOrgName', s.organization_name || 'Gwadar Ambulance Service, Gwadar');
setText('footerRegNo', s.registration_no ? `Registration No: ${s.registration_no}` : '');
setText('footerSlogan', s.slogan ? `“${s.slogan}”` : '');
setText('footerCoverage', s.service_areas || '');
setText('footerHours', s.operating_hours || '');
setText('footerCopyOrg', s.organization_name || 'Gwadar Ambulance Service, Gwadar');
setText('footerYear', new Date().getFullYear());
}
function renderHeroSection(data) {
const s = data.settings || {};
const stats = data.patientStats || [];
const backdrop = document.getElementById('heroBackdrop');
if (backdrop && s.hero_bg_url) {
if (String(s.hero_bg_url).startsWith('data:')) {
backdrop.style.backgroundImage = `url('${s.hero_bg_url}')`;
} else {
const loadHeroBg = () => {
backdrop.style.backgroundImage = `url('${encodeURI(s.hero_bg_url)}')`;
};
['scroll', 'pointermove', 'touchstart'].forEach((evt) =>
window.addEventListener(evt, loadHeroBg, { once: true, passive: true })
);
}
}
setText('heroHoursBadge', s.operating_hours || '24/7 Hours Service');
setText('heroRegBadge', s.registration_no ? `Registration No: ${s.registration_no}` : '');
setText('heroEstBadge', s.established_date ? `Established: ${s.established_date}` : '');
setText('heroOrgName', s.organization_name || '');
setText('heroSlogan', s.slogan ? `“${s.slogan}”` : '');
setText('heroVision', s.vision_text || '');
setText('heroShortName', s.short_name || 'G.A.S.G');
setText('heroDurationText', s.service_duration || '');
const isCustomLogo = s.logo_url && s.logo_url !== '/uploads/pptx/image5.png';
const headerLogo = document.getElementById('headerLogoImg');
const heroLogo = document.getElementById('heroLogoImg');
if (heroLogo) {
const targetSrc = isCustomLogo ? s.logo_url : headerLogo ? headerLogo.src : s.logo_url;
if (targetSrc && heroLogo.getAttribute('src') !== targetSrc) {
heroLogo.src = targetSrc;
}
}
const regional = stats.filter((x) => x.stat_group === 'regional');
const caseWise = stats.filter((x) => x.stat_group === 'case_wise');
const totalRegional = regional.reduce((acc, item) => acc + (Number(item.count_value) || 0), 0);
const totalPatients = totalRegional || Number(s.total_patients_served) || 0;
const metricItems = [
{
value: formatNumber(totalPatients),
label: 'Total Patients Served',
sub: 'Gwadar City, Surrounding Areas & District Kech'
}
];
for (const c of caseWise) {
metricItems.push({
value: formatNumber(c.count_value),
label: c.label,
sub: c.sub_details || 'Verified Case Record'
});
}
if (s.mortuary_total_bodies || s.ghusl_total_bodies) {
metricItems.push({
value: `${s.mortuary_total_bodies || 43} / ${s.ghusl_total_bodies || 26}`,
label: 'Mortuary & Ghusl Cases',
sub: '43 Mortuary Preserved • 26 Ritual Washings'
});
}
const strip = document.getElementById('heroMetricsStrip');
if (strip) {
const newStripHtml = metricItems
.map(
(m) => `<div class="metric-card"><div class="metric-value">${escapeHtml(m.value)}</div><div class="metric-label">${escapeHtml(m.label)}</div><div class="metric-sub">${escapeHtml(m.sub)}</div></div>`
)
.join('');
const expectedText = metricItems.map((m) => `${m.value}${m.label}${m.sub}`).join('').replace(/\s+/g, '');
if (strip.textContent.replace(/\s+/g, '') !== expectedText) {
strip.innerHTML = newStripHtml;
}
}
setText(
'homeIntroEyebrow',
`${s.registration_no ? `Reg No: ${s.registration_no} • ` : ''}${s.established_date ? `Established ${s.established_date}` : ''}`
);
setText('homeIntroTitle', s.organization_name || 'Gwadar Ambulance Service, Gwadar');
setText('homeIntroText', s.vision_text || '');
const dirGrid = document.getElementById('homeDirectoryGrid');
if (dirGrid) {
const directoryCards = [
{
nav: 'about',
meta: `Established ${s.established_date || '1st January, 2022'}`,
title: 'About Us, Vision & Mission',
desc: `Read our official history, vision, ${(data.missionPoints || []).length} mission commitments, proposed projects, and institutional demands.`,
cta: 'Open About Us →'
},
{
nav: 'services',
meta: `${formatNumber(totalPatients)} Total Patients Served`,
title: 'Emergency Services & Statistics',
desc: `Explore ${(data.services || []).length} emergency medical & humanitarian services, regional & case-wise patient statistics, and disaster rescue operations.`,
cta: 'Open Services →'
},
{
nav: 'ambulances',
meta: `${(data.ambulances || []).length} Ambulance Units`,
title: 'Our Ambulance Fleet',
desc: 'View our 24/7 operational emergency ambulances serving Gwadar, Kech, and adjoining areas, plus the proposed Jewni expansion.',
cta: 'Open Ambulances →'
},
{
nav: 'team',
meta: `${(data.teamMembers || []).length} Organogram Roles`,
title: 'Our Team & Organogram',
desc: 'Inspect the complete organizational hierarchy from Chairman and Executive Leadership to Medical Officer, Gosal, and 24/7 Drivers.',
cta: 'Open Our Team →'
},
{
nav: 'gallery',
meta: `${(data.gallery || []).length} Official Photographs`,
title: 'Photo Gallery & Field Media',
desc: 'Browse authentic photographs from emergency operations, ambulance fleet, mortuary facilities, flood rescues, and community meetings.',
cta: 'Open Gallery →'
},
{
nav: 'facilities',
meta: `${(data.facilities || []).length} Facilities • ${(data.medicalInventory || []).length} Medicine Items`,
title: 'Facilities, Mortuary & Medicine Stock',
desc: 'View refrigerated mortuary chambers, ritual washing (Ghusl) records, and Ethqaf & Gwadar Ijtema medicine inventories.',
cta: 'Open Facilities →'
},
{
nav: 'contact',
meta: s.operating_hours || '24/7 Hours Service',
title: 'Contact & Coordination',
desc: 'Reach out to Gwadar Ambulance Service Gwadar & Bin Ahsaan Welfare Trust for emergency coordination or community programs.',
cta: 'Open Contact Us →'
}
];
const expectedDirText = directoryCards.map((c) => `${c.meta}${c.title}${c.desc}${c.cta}`).join('').replace(/\s+/g, '');
if (dirGrid.textContent.replace(/\s+/g, '') !== expectedDirText) {
dirGrid.innerHTML = directoryCards
.map(
(c) => `<a href="#${escapeHtml(c.nav)}" class="home-dir-card" data-nav="${escapeHtml(c.nav)}"><div><div class="home-dir-meta">${escapeHtml(c.meta)}</div><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.desc)}</p></div><span class="home-dir-link">${escapeHtml(c.cta)}</span></a>`
)
.join('');
}
}
}
function renderAboutSection(data) {
const s = data.settings || {};
const missions = data.missionPoints || [];
const pd = data.projectsDemands || [];
setText('aboutSubtitle', `${s.organization_name || ''} — Registration No: ${s.registration_no || ''}`);
setText('historyTitle', s.history_title || 'History');
const historyContainer = document.getElementById('historyContent');
if (historyContainer) {
const paragraphs = String(s.history_text || '')
.split(/\n+/)
.map((p) => p.trim())
.filter(Boolean);
historyContainer.innerHTML = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}
setText('metaOrgName', s.organization_name || '');
setText('metaRegNo', s.registration_no || '');
setText('metaAreas', s.service_areas || '');
setText('aboutSlogan', s.slogan ? `“${s.slogan}”` : '');
setText('aboutVision', s.vision_text || '');
const missionList = document.getElementById('missionList');
if (missionList) {
missionList.innerHTML = missions
.map((m) => `<li>${escapeHtml(m.point_text)}</li>`)
.join('');
}
const projects = pd.filter((item) => item.item_type === 'project');
const demands = pd.filter((item) => item.item_type === 'demand');
const projEl = document.getElementById('proposedProjectsList');
if (projEl) {
projEl.innerHTML = projects
.map(
(p) => `
<div class="pd-card">
<h4>${escapeHtml(p.title)}</h4>
${p.subtitle ? `<div class="pd-subtitle">${escapeHtml(p.subtitle)}</div>` : ''}
<p>${escapeHtml(p.description)}</p>
</div>
`
)
.join('');
}
const demEl = document.getElementById('institutionalDemandsList');
if (demEl) {
demEl.innerHTML = demands
.map(
(d) => `
<div class="pd-card demand-card">
<h4>${escapeHtml(d.title)}</h4>
${d.subtitle ? `<div class="pd-subtitle">${escapeHtml(d.subtitle)}</div>` : ''}
<p>${escapeHtml(d.description)}</p>
</div>
`
)
.join('');
}
}
function renderServicesSection(data) {
const s = data.settings || {};
const services = data.services || [];
const stats = data.patientStats || [];
const disasters = data.disasters || [];
const grid = document.getElementById('servicesGrid');
if (grid) {
grid.innerHTML = services
.map(
(svc) => `
<article class="service-card">
<div class="service-card-media">
${
svc.image_url
? `<img src="${escapeHtml(svc.image_url)}" alt="${escapeHtml(svc.title)}" loading="lazy" />`
: ''
}
<span class="service-cat-tag">${escapeHtml(svc.category)}</span>
</div>
<div class="service-card-body">
<h3>${escapeHtml(svc.title)}</h3>
<p>${escapeHtml(svc.description)}</p>
${
svc.stats_badge
? `<span class="service-stat-pill">${escapeHtml(svc.stats_badge)}</span>`
: ''
}
</div>
</article>
`
)
.join('');
}
const mapImg = document.getElementById('serviceAreaMapImg');
if (mapImg && s.map_url) {
mapImg.src = s.map_url;
}
const regional = stats.filter((x) => x.stat_group === 'regional');
const caseWise = stats.filter((x) => x.stat_group === 'case_wise');
const regTotal = regional.reduce((a, b) => a + (Number(b.count_value) || 0), 0) || 1;
const caseTotal = caseWise.reduce((a, b) => a + (Number(b.count_value) || 0), 0) || 1;
setText('regionalTotalPill', `Total: ${formatNumber(regTotal)} Patients`);
setText('caseWiseTotalPill', `Total: ${formatNumber(caseTotal)} Patients`);
const regEl = document.getElementById('regionalStatsList');
if (regEl) {
regEl.innerHTML = regional
.map((item) => {
const pct = Math.min(100, Math.round(((Number(item.count_value) || 0) / regTotal) * 100));
return `
<div class="stat-bar-item">
<div class="stat-bar-top">
<span>${escapeHtml(item.label)}</span>
<span class="stat-bar-count">${formatNumber(item.count_value)} (${pct}%)</span>
</div>
<div class="stat-bar-track">
<div class="stat-bar-fill" style="width:${pct}%"></div>
</div>
${item.sub_details ? `<div class="stat-bar-sub">${escapeHtml(item.sub_details)}</div>` : ''}
</div>
`;
})
.join('');
}
const caseEl = document.getElementById('caseWiseStatsList');
if (caseEl) {
caseEl.innerHTML = caseWise
.map((item) => {
const pct = Math.min(100, Math.round(((Number(item.count_value) || 0) / caseTotal) * 100));
return `
<div class="stat-bar-item">
<div class="stat-bar-top">
<span>${escapeHtml(item.label)}</span>
<span class="stat-bar-count">${formatNumber(item.count_value)} (${pct}%)</span>
</div>
<div class="stat-bar-track">
<div class="stat-bar-fill" style="width:${pct}%"></div>
</div>
${item.sub_details ? `<div class="stat-bar-sub">${escapeHtml(item.sub_details)}</div>` : ''}
</div>
`;
})
.join('');
}
const disGrid = document.getElementById('disastersGrid');
if (disGrid) {
disGrid.innerHTML = disasters
.map(
(d) => `
<article class="disaster-card">
${
d.image_url
? `<div class="disaster-media"><img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.title)}" class="zoomable-img" loading="lazy" /></div>`
: ''
}
<div class="disaster-body">
<div class="disaster-meta">
<span>Date: ${escapeHtml(d.event_date)}</span>
<span>•</span>
<span>${escapeHtml(d.location)}</span>
</div>
<h4>${escapeHtml(d.title)}</h4>
<div class="disaster-impact">${escapeHtml(d.impact_summary)}</div>
<p>${escapeHtml(d.description)}</p>
</div>
</article>
`
)
.join('');
}
}
function renderAmbulancesSection(data) {
const ambulances = data.ambulances || [];
const grid = document.getElementById('ambulancesGrid');
if (!grid) return;
grid.innerHTML = ambulances
.map((a) => {
const isProposed = String(a.status).toLowerCase().includes('proposed');
return `
<article class="ambulance-card">
<div class="ambulance-img-wrap">
${
a.image_url
? `<img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.unit_name)}" class="zoomable-img" loading="lazy" />`
: ''
}
<span class="ambulance-status-badge ${isProposed ? 'proposed' : ''}">${escapeHtml(a.status)}</span>
</div>
<div class="ambulance-content">
<div class="ambulance-org-tag">${escapeHtml(a.organization_tag)}</div>
<div class="ambulance-title-row">
<h3>${escapeHtml(a.unit_name)}</h3>
${a.vehicle_code ? `<span class="vehicle-plate">${escapeHtml(a.vehicle_code)}</span>` : ''}
</div>
<p class="ambulance-desc">${escapeHtml(a.description)}</p>
<div class="ambulance-specs">
<div><strong>Coverage Area:</strong> ${escapeHtml(a.coverage_area)}</div>
<div><strong>Equipment &amp; Capabilities:</strong> ${escapeHtml(a.equipment_summary)}</div>
</div>
</div>
</article>
`;
})
.join('');
}
function renderTeamSection(data) {
const team = data.teamMembers || [];
const container = document.getElementById('teamProfileGrid');
if (!container) return;
if (!team.length) {
container.innerHTML = '<p class="empty-state" style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 2.5rem 1rem; font-size: 1.05rem;">No team members are currently listed.</p>';
return;
}
container.innerHTML = team
.map((m) => {
const displayName = m.member_name && m.member_name.trim() ? m.member_name.trim() : m.role_title;
const occupation = m.role_title || '';
return `
<article class="team-profile-box">
<div class="team-profile-photo">
${
m.photo_url
? `<img src="${escapeHtml(m.photo_url)}" alt="${escapeHtml(displayName)}" class="zoomable-img" loading="lazy" />`
: `
<svg class="team-placeholder-svg" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<circle cx="40" cy="28" r="14" stroke="currentColor" stroke-width="3.5"/>
<path d="M16 68C16 54.7452 26.7452 44 40 44C53.2548 44 64 54.7452 64 68" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
</svg>
`
}
</div>
<div class="team-profile-info">
<h3 class="team-profile-name">${escapeHtml(displayName)}</h3>
<p class="team-profile-occupation">${escapeHtml(occupation)}</p>
</div>
</article>
`;
})
.join('');
}
function renderGallerySection(data) {
const gallery = data.gallery || [];
const filtersEl = document.getElementById('galleryFilters');
const gridEl = document.getElementById('galleryGrid');
if (!filtersEl || !gridEl) return;
const categories = ['All', ...new Set(gallery.map((g) => g.category).filter(Boolean))];
filtersEl.innerHTML = categories
.map(
(cat) => `
<button type="button" class="filter-btn ${
portalState.selectedGalleryCategory === cat ? 'active' : ''
}" data-gallery-cat="${escapeHtml(cat)}">
${escapeHtml(cat)}
</button>
`
)
.join('');
const filtered =
portalState.selectedGalleryCategory === 'All'
? gallery
: gallery.filter((g) => g.category === portalState.selectedGalleryCategory);
gridEl.innerHTML = filtered
.map(
(g) => `
<div class="gallery-item" data-img="${escapeHtml(g.image_url)}" data-title="${escapeHtml(
g.title
)}" data-caption="${escapeHtml(g.caption)}">
<div class="gallery-thumb">
<img src="${escapeHtml(g.image_url)}" alt="${escapeHtml(g.title)}" loading="lazy" />
<span class="gallery-cat-badge">${escapeHtml(g.category)}</span>
</div>
<div class="gallery-caption">
<h4>${escapeHtml(g.title)}</h4>
<p>${escapeHtml(g.caption)}</p>
</div>
</div>
`
)
.join('');
}
function renderFacilitiesSection(data) {
const facilities = data.facilities || [];
const stats = data.patientStats || [];
const inventory = data.medicalInventory || [];
const facGrid = document.getElementById('facilitiesGrid');
if (facGrid) {
facGrid.innerHTML = facilities
.map(
(f) => `
<article class="facility-card">
${
f.image_url
? `<div class="facility-media"><img src="${escapeHtml(f.image_url)}" alt="${escapeHtml(f.title)}" class="zoomable-img" loading="lazy" /></div>`
: ''
}
<div class="facility-body">
${f.status_badge ? `<span class="facility-badge">${escapeHtml(f.status_badge)}</span>` : ''}
<h3>${escapeHtml(f.title)}</h3>
<p>${escapeHtml(f.description)}</p>
${
f.specifications
? `<div class="facility-specs">${escapeHtml(f.specifications)}</div>`
: ''
}
</div>
</article>
`
)
.join('');
}
const mortuaryStats = stats.filter((x) => x.stat_group === 'mortuary');
const mortRow = document.getElementById('mortuaryStatsRow');
if (mortRow) {
mortRow.innerHTML = mortuaryStats
.map(
(m) => `
<div class="mortuary-stat-box">
<strong>${formatNumber(m.count_value)}</strong>
<span>${escapeHtml(m.label)}</span>
<small>${escapeHtml(m.sub_details)}</small>
</div>
`
)
.join('');
}
renderMedicalInventoryTable(inventory);
}
function renderMedicalInventoryTable(inventory) {
const campTabsEl = document.getElementById('campTabs');
const tbody = document.getElementById('inventoryTableBody');
if (!campTabsEl || !tbody) return;
const camps = ['All', ...new Set(inventory.map((i) => i.camp_name).filter(Boolean))];
campTabsEl.innerHTML = camps
.map(
(c) => `
<button type="button" class="camp-tab-btn ${
portalState.selectedCamp === c ? 'active' : ''
}" data-camp="${escapeHtml(c)}">
${escapeHtml(c)}
</button>
`
)
.join('');
const q = portalState.inventoryQuery.trim().toLowerCase();
const filtered = inventory.filter((item) => {
const matchCamp = portalState.selectedCamp === 'All' || item.camp_name === portalState.selectedCamp;
const matchQuery =
!q ||
String(item.item_name).toLowerCase().includes(q) ||
String(item.camp_name).toLowerCase().includes(q) ||
String(item.quantity).toLowerCase().includes(q);
return matchCamp && matchQuery;
});
tbody.innerHTML = filtered
.map(
(item) => `
<tr>
<td><strong>${escapeHtml(item.serial_no)}</strong></td>
<td>${escapeHtml(item.camp_name)}</td>
<td>${escapeHtml(item.item_name)}</td>
<td><strong>${escapeHtml(item.quantity)}</strong></td>
<td>${escapeHtml(item.remarks || '—')}</td>
</tr>
`
)
.join('');
}
function renderContactSection(data) {
const s = data.settings || {};
const isCustomLogo = s.logo_url && s.logo_url !== '/uploads/pptx/image5.png';
const headerLogo = document.getElementById('headerLogoImg');
const contactLogo = document.getElementById('contactLogo');
if (contactLogo) {
contactLogo.src = isCustomLogo ? s.logo_url : headerLogo ? headerLogo.src : s.logo_url;
}
setText('contactOrgTitle', s.organization_name || 'Gwadar Ambulance Service, Gwadar');
setText('contactRegSubtitle', s.registration_no ? `Registration No: ${s.registration_no}` : '');
setText('contactNoticeText', s.contact_notice || '');
const details = [
{ label: 'Institution & Welfare Trust', value: s.organization_name },
{ label: 'Official Registration No.', value: s.registration_no },
{ label: 'Service Location & Base', value: s.contact_address || s.contact_location },
{ label: 'Service Coverage Areas', value: s.service_areas },
{ label: 'Operating Hours', value: s.operating_hours }
];
if (s.contact_phone && s.contact_phone.trim()) {
details.push({ label: 'Official Contact Number', value: s.contact_phone.trim() });
}
if (s.contact_email && s.contact_email.trim()) {
details.push({ label: 'Official Email Address', value: s.contact_email.trim() });
}
const listEl = document.getElementById('contactDetailsList');
if (listEl) {
listEl.innerHTML = details
.filter((d) => d.value)
.map(
(d) => `
<div class="contact-detail-item">
<span>${escapeHtml(d.label)}</span>
<strong>${escapeHtml(d.value)}</strong>
</div>
`
)
.join('');
}
}
function openLightbox(src, title, desc) {
const modal = document.getElementById('lightboxModal');
const img = document.getElementById('lightboxImg');
const titleEl = document.getElementById('lightboxTitle');
const descEl = document.getElementById('lightboxDesc');
if (!modal || !img) return;
img.src = src;
img.alt = title || 'Preview';
if (titleEl) titleEl.textContent = title || '';
if (descEl) descEl.textContent = desc || '';
modal.classList.remove('hidden');
}
function closeLightbox() {
const modal = document.getElementById('lightboxModal');
if (modal) modal.classList.add('hidden');
}
const VALID_SECTIONS = ['home', 'about', 'services', 'ambulances', 'team', 'gallery', 'facilities', 'contact'];
function activateSection(sectionId, updateHistory = true) {
const cleanId = VALID_SECTIONS.includes(sectionId) ? sectionId : 'home';
portalState.activeSection = cleanId;
ensureSectionRendered(cleanId);
document.querySelectorAll('.portal-section').forEach((sec) => {
sec.classList.toggle('active-section', sec.id === cleanId);
});
document.querySelectorAll('.nav-link').forEach((link) => {
link.classList.toggle('active', link.getAttribute('data-nav') === cleanId);
});
if (updateHistory) {
if (window.location.hash !== `#${cleanId}`) {
window.history.pushState(null, '', `#${cleanId}`);
}
window.scrollTo({ top: 0, behavior: 'smooth' });
}
}
function setupInteractions() {
const mobileBtn = document.getElementById('mobileMenuBtn');
const headerNav = document.getElementById('headerNav');
if (mobileBtn && headerNav) {
mobileBtn.addEventListener('click', () => {
const isOpen = headerNav.classList.toggle('open');
mobileBtn.setAttribute('aria-expanded', String(isOpen));
});
}
document.addEventListener('click', (e) => {
const navLink = e.target.closest('[data-nav]');
if (navLink) {
e.preventDefault();
const targetId = navLink.getAttribute('data-nav');
activateSection(targetId, true);
if (headerNav) headerNav.classList.remove('open');
if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'false');
}
const galBtn = e.target.closest('[data-gallery-cat]');
if (galBtn && portalState.data) {
portalState.selectedGalleryCategory = galBtn.getAttribute('data-gallery-cat');
renderGallerySection(portalState.data);
}
const campBtn = e.target.closest('[data-camp]');
if (campBtn && portalState.data) {
portalState.selectedCamp = campBtn.getAttribute('data-camp');
renderMedicalInventoryTable(portalState.data.medicalInventory || []);
}
const galItem = e.target.closest('.gallery-item');
if (galItem) {
openLightbox(
galItem.getAttribute('data-img'),
galItem.getAttribute('data-title'),
galItem.getAttribute('data-caption')
);
}
if (e.target.classList.contains('zoomable-img')) {
openLightbox(e.target.src, e.target.alt || 'Image View', '');
}
});
const searchInput = document.getElementById('inventorySearchInput');
if (searchInput) {
searchInput.addEventListener('input', (e) => {
portalState.inventoryQuery = e.target.value || '';
if (portalState.data) {
renderMedicalInventoryTable(portalState.data.medicalInventory || []);
}
});
}
const closeBtn = document.getElementById('lightboxCloseBtn');
const modal = document.getElementById('lightboxModal');
if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
if (modal) {
modal.addEventListener('click', (e) => {
if (e.target === modal) closeLightbox();
});
}
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape') closeLightbox();
});
const contactForm = document.getElementById('publicContactForm');
if (contactForm) {
contactForm.addEventListener('submit', async (e) => {
e.preventDefault();
const feedback = document.getElementById('contactFormFeedback');
const submitBtn = document.getElementById('contactSubmitBtn');
const payload = {
sender_name: document.getElementById('senderName').value.trim(),
sender_phone: document.getElementById('senderPhone').value.trim(),
sender_email: document.getElementById('senderEmail').value.trim(),
message_type: document.getElementById('messageType').value,
subject: document.getElementById('messageSubject').value.trim(),
message: document.getElementById('messageBody').value.trim()
};
if (!payload.sender_name || !payload.sender_phone || !payload.subject || !payload.message) {
feedback.textContent = 'Please complete all required fields (*).';
feedback.className = 'form-feedback error';
feedback.classList.remove('hidden');
return;
}
submitBtn.disabled = true;
submitBtn.textContent = 'Submitting...';
try {
const res = await fetch('/api/public/contact', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
if (res.status === 404 || res.status === 405) {
const localRaw = localStorage.getItem('gasg_master_db_v1');
const dbObj = localRaw ? JSON.parse(localRaw) : portalState.data || {};
if (!dbObj.contactMessages) dbObj.contactMessages = [];
dbObj.contactMessages.unshift({
id: Date.now(),
...payload,
status: 'unread',
created_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
});
localStorage.setItem('gasg_master_db_v1', JSON.stringify(dbObj));
feedback.textContent = 'Your message has been submitted to Gwadar Ambulance Service administration.';
feedback.className = 'form-feedback success';
feedback.classList.remove('hidden');
contactForm.reset();
return;
}
const result = await res.json();
if (!res.ok) throw new Error(result.error || 'Submission failed.');
feedback.textContent = result.message || 'Your message has been submitted.';
feedback.className = 'form-feedback success';
feedback.classList.remove('hidden');
contactForm.reset();
} catch (err) {
feedback.textContent = err.message || 'Could not send message.';
feedback.className = 'form-feedback error';
feedback.classList.remove('hidden');
} finally {
submitBtn.disabled = false;
submitBtn.textContent = 'Submit Message';
}
});
}
window.addEventListener('hashchange', () => {
const hashTarget = window.location.hash.replace(/^#/, '') || 'home';
activateSection(hashTarget, false);
});
window.addEventListener('storage', (e) => {
if (e.key === 'gasg_master_db_v1') loadPortalData();
});
setupPwaInstall();
}
function isStandalonePwa() {
return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function setupPwaInstall() {
if ('serviceWorker' in navigator) {
window.addEventListener('load', () => {
navigator.serviceWorker.register('/sw.js').then((reg) => {
reg.update().catch(() => {});
}).catch(() => {});
});
}
const banner = document.getElementById('pwaInstallBanner');
const headerBtn = document.getElementById('headerInstallAppBtn');
const installBtn = document.getElementById('pwaInstallNowBtn');
const dismissBtn = document.getElementById('pwaDismissBtn');
const guideModal = document.getElementById('pwaGuideModal');
const guideCloseBtn = document.getElementById('pwaGuideCloseBtn');
const guideGotItBtn = document.getElementById('pwaGuideGotItBtn');
const guideInstructions = document.getElementById('pwaGuideInstructions');
if (isStandalonePwa()) {
if (banner) banner.classList.add('hidden');
if (headerBtn) headerBtn.classList.add('hidden');
return;
}
if (headerBtn) headerBtn.classList.remove('hidden');
function showInstallBanner() {
if (isStandalonePwa()) return;
if (sessionStorage.getItem('gasg_pwa_dismissed') === '1') return;
if (banner) banner.classList.remove('hidden');
}
if (window.__gasgDeferredPrompt) {
showInstallBanner();
}
window.addEventListener('beforeinstallprompt', (e) => {
e.preventDefault();
window.__gasgDeferredPrompt = e;
showInstallBanner();
});
window.addEventListener('appinstalled', () => {
window.__gasgDeferredPrompt = null;
if (banner) banner.classList.add('hidden');
if (headerBtn) headerBtn.classList.add('hidden');
});
let interactionTriggered = false;
const triggerInstallBanner = () => {
if (interactionTriggered) return;
interactionTriggered = true;
showInstallBanner();
};
['scroll', 'pointermove', 'touchstart', 'keydown'].forEach((evt) => {
window.addEventListener(evt, triggerInstallBanner, { once: true, passive: true });
});
setTimeout(() => {
showInstallBanner();
}, 3000);
function openGuideModal() {
if (!guideModal) return;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);
let instructions = '';
if (isIos) {
instructions = `
<ol style="margin-left:1.25rem;line-height:1.7;font-size:0.92rem;color:#e2e8f0;">
  <li>Tap the <strong>Share</strong> button <span style="font-size:1.15rem;">⎋</span> at the bottom of Safari.</li>
  <li>Scroll down and tap <strong>Add to Home Screen ➕</strong>.</li>
  <li>Tap <strong>Add</strong> at top right to install G.A.S.G on your iPhone/iPad!</li>
</ol>`;
} else if (isAndroid) {
instructions = `
<ol style="margin-left:1.25rem;line-height:1.7;font-size:0.92rem;color:#e2e8f0;">
  <li>Tap the <strong>three dots menu ⋮</strong> at top right of your browser.</li>
  <li>Select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
  <li>Confirm <strong>Install</strong> to add G.A.S.G directly to your apps!</li>
</ol>`;
} else {
instructions = `
<ol style="margin-left:1.25rem;line-height:1.7;font-size:0.92rem;color:#e2e8f0;">
  <li>Look at the right side of your browser address bar and click the <strong>Install icon (⊕ or 🖥️)</strong>.</li>
  <li>Or click menu <strong>⋮ → Cast, save, and share → Install page as app</strong>.</li>
  <li>Click <strong>Install</strong> to pin G.A.S.G directly to your Windows Taskbar or Desktop!</li>
</ol>`;
}
if (guideInstructions) guideInstructions.innerHTML = instructions;
guideModal.classList.remove('hidden');
}
async function handleInstallAction() {
if (window.__gasgDeferredPrompt) {
try {
window.__gasgDeferredPrompt.prompt();
const choice = await window.__gasgDeferredPrompt.userChoice;
if (choice && choice.outcome === 'accepted') {
window.__gasgDeferredPrompt = null;
if (banner) banner.classList.add('hidden');
if (headerBtn) headerBtn.classList.add('hidden');
return;
}
} catch (_) {}
}
openGuideModal();
}
if (installBtn) installBtn.addEventListener('click', handleInstallAction);
if (headerBtn) headerBtn.addEventListener('click', handleInstallAction);
if (dismissBtn) {
dismissBtn.addEventListener('click', () => {
if (banner) banner.classList.add('hidden');
sessionStorage.setItem('gasg_pwa_dismissed', '1');
});
}
if (guideCloseBtn) {
guideCloseBtn.addEventListener('click', () => {
if (guideModal) guideModal.classList.add('hidden');
});
}
if (guideGotItBtn) {
guideGotItBtn.addEventListener('click', () => {
if (guideModal) guideModal.classList.add('hidden');
});
}
}
document.addEventListener('DOMContentLoaded', () => {
setupInteractions();
const initialSection = window.location.hash.replace(/^#/, '') || 'home';
activateSection(initialSection, false);
loadPortalData();
});
})();