const SESSION_KEY = "house-hunt-session-v1";
const statuses = ["in the running", "applied", "touring", "locked in", "removed", "archive"];
const NUM_FIELDS = ["rent", "rentPerPerson", "beds", "baths", "minutesToShuttle", "minutesToTransit"];

// Status colors for map pins
const STATUS_COLORS = {
  "in the running": "#9A8F87",
  "applied":        "#2B4C8C",
  "touring":        "#D4A017",
  "locked in":      "#2D6A4F",
};

// Custom location types
const LOC_TYPES = {
  shuttle: { color: "#E85D2F", emoji: "🚌", label: "Shuttle stop" },
  transit: { color: "#4267a8", emoji: "🚇", label: "Transit/BART" },
  work:    { color: "#7c3aed", emoji: "🏢", label: "Office/Work" },
  poi:     { color: "#9b9b9b", emoji: "📍", label: "Point of interest" },
};

let session = null;
let listings = [];
let customLocations = [];
let unsubscribe = null;
let groupMap = null;
const groupMapMarkers = {};  // id → { marker, lat, lng }
const groupCustomMarkers = {}; // id → marker
const geocodeCache = {};
let inlineEdit = { field: null };
let state = { tab: "catalog", status: "all", query: "", sort: "pinned", selectedId: null, editing: false, isNew: false };

// Popup bridge — Leaflet popup HTML can't use closures, so we expose this globally
window.__viewListing = (id) => {
  state.tab = "catalog";
  state.selectedId = id;
  inlineEdit.field = null;
  render();
};

// ── Session ────────────────────────────────────────────────────────────────────

function normalizeCode(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}
function getStoredSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return (s && s.loggedIn && s.code) ? s : null;
  } catch { return null; }
}
function storeSession(rawCode) {
  const code = normalizeCode(rawCode);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, code, displayName: rawCode.trim() }));
  return code;
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ── Firestore ─────────────────────────────────────────────────────────────────

function groupRef(code) {
  return db.collection("groups").doc(code);
}

function saveListings() {
  if (!session) return;
  groupRef(session.code).set(
    { listings, customLocations, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(err => console.error("Save failed:", err));
}

function subscribeToGroup(code) {
  if (unsubscribe) unsubscribe();
  unsubscribe = groupRef(code).onSnapshot(snap => {
    if (!snap.exists) {
      const seed = code === "sf-roomies" ? structuredClone(window.SEED_LISTINGS) : [];
      groupRef(code).set({ listings: seed, customLocations: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      return;
    }
    listings = snap.data().listings || [];
    customLocations = snap.data().customLocations || [];
    if (!state.editing && !inlineEdit.field) render();
  }, err => console.error("Firestore listener error:", err));
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  session = getStoredSession();
  if (session) { showLoading(); subscribeToGroup(session.code); }
  else renderLanding();
}

function showLoading() {
  document.querySelector("#app").innerHTML = `
    <div class="loading-screen">
      <div class="loading-brand">SF House Hunt</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>`;
}

// ── Landing ───────────────────────────────────────────────────────────────────

function renderLanding(errorMsg) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  document.querySelector("#app").innerHTML = `
    <div class="landing">
      <div class="landing-content">
        <div class="landing-brand">SF House Hunt</div>
        <h1 class="landing-title">Your crew's apartment<br>command center.</h1>
        <p class="landing-sub">Track listings, tours, notes, and vibes — all in one place for your whole crew.</p>
        <div class="landing-panels">
          <div class="landing-panel">
            <div class="landing-panel-label">Join a group</div>
            <p>Enter your group code to pick up where you left off.</p>
            <div class="code-input-row">
              <input id="codeInput" type="text" placeholder="e.g. sf roomies" autocomplete="off" spellcheck="false" />
              <button class="btn-primary" id="joinBtn">Join →</button>
            </div>
            ${errorMsg ? `<div class="code-error">${escapeHtml(errorMsg)}</div>` : ""}
          </div>
          <div class="landing-or">or</div>
          <div class="landing-panel">
            <div class="landing-panel-label">Start a new group</div>
            <p>Get a fresh code to share with your roommates.</p>
            <button class="btn-secondary" id="createBtn">Create group</button>
          </div>
        </div>
      </div>
    </div>`;
  const inp = document.querySelector("#codeInput");
  document.querySelector("#joinBtn").addEventListener("click", () => attemptJoin(inp.value));
  inp.addEventListener("keydown", e => { if (e.key === "Enter") attemptJoin(inp.value); });
  document.querySelector("#createBtn").addEventListener("click", attemptCreate);
  inp.focus();
}

async function attemptJoin(rawCode) {
  const trimmed = rawCode.trim();
  if (!trimmed) { renderLanding("Please enter a group code."); return; }
  const code = normalizeCode(trimmed);
  if (code !== "sf-roomies") {
    showLoading();
    try {
      const doc = await groupRef(code).get();
      if (!doc.exists) { renderLanding(`No group found for "${escapeHtml(trimmed)}". Double-check the code.`); return; }
    } catch { renderLanding("Couldn't connect. Check your internet and try again."); return; }
  }
  storeSession(trimmed);
  session = getStoredSession();
  showLoading();
  subscribeToGroup(code);
}

async function attemptCreate() {
  const adjs = ["swift","cozy","bold","sunny","fresh","warm","bright","grand","calm","neat"];
  const nouns = ["crew","squad","team","pack","posse","house","base","hub"];
  const code = `${adjs[Math.floor(Math.random()*adjs.length)]}-${nouns[Math.floor(Math.random()*nouns.length)]}-${Math.floor(100+Math.random()*900)}`;
  showLoading();
  try {
    await groupRef(code).set({ listings: [], customLocations: [], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch { renderLanding("Couldn't create group. Check your internet and try again."); return; }
  storeSession(code);
  session = getStoredSession();
  subscribeToGroup(code);
}

function logout() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (groupMap) { groupMap.remove(); groupMap = null; }
  clearSession();
  session = null;
  listings = [];
  customLocations = [];
  inlineEdit.field = null;
  resetState();
  renderLanding();
}

function resetState() {
  state = { tab: "catalog", status: "all", query: "", sort: "pinned", selectedId: null, editing: false, isNew: false };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(v) { return v ? `$${Number(v).toLocaleString()}` : "TBD"; }
function bedsBaths(item) { return [item.beds && `${item.beds} bd`, item.baths && `${item.baths} ba`].filter(Boolean).join(" · ") || "TBD"; }
function dateLabel(v) { return v ? new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No tour"; }
function activeListings() { return listings.filter(i => i.status !== "archive" && i.status !== "removed"); }
function archivedListings() { return listings.filter(i => i.status === "archive" || i.status === "removed"); }
function visibleListings() {
  const source = state.tab === "archive" ? archivedListings() : activeListings();
  return source
    .filter(i => state.status === "all" || i.status === state.status)
    .filter(i => `${i.title} ${i.address} ${i.notes} ${i.neighborhood || ""}`.toLowerCase().includes(state.query.toLowerCase()))
    .sort((a, b) => {
      if (!!a.topChoice !== !!b.topChoice) return a.topChoice ? -1 : 1;
      if ((a.status === "locked in") !== (b.status === "locked in")) return a.status === "locked in" ? -1 : 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (state.sort === "rent") return (a.rent || 999999) - (b.rent || 999999);
      if (state.sort === "rentPerPerson") return (a.rentPerPerson || 999999) - (b.rentPerPerson || 999999);
      if (state.sort === "status") return a.status.localeCompare(b.status);
      return (a.tourDate || "9999").localeCompare(b.tourDate || "9999");
    });
}

// ── App render ────────────────────────────────────────────────────────────────

function render() {
  // Tear down old map before replacing DOM
  if (groupMap) { groupMap.remove(); groupMap = null; }

  const app = document.querySelector("#app");
  const active = activeListings();
  const allTours = listings.filter(i => i.hasTour && i.tourDate && i.status !== "archive");
  const selected = state.selectedId ? listings.find(i => i.id === state.selectedId) : null;

  const isMap = state.tab === "map";

  app.innerHTML = `
    <div class="app-shell">
      <header class="top-bar">
        <div class="brand">SF House Hunt</div>
        <div class="top-actions">
          <span class="group-badge" title="Your group code">${escapeHtml(session.displayName)}</span>
          <button class="btn-primary" data-action="new">+ Add listing</button>
          ${session.code === "sf-roomies" ? `<button class="btn-ghost" data-action="reset">Reset data</button>` : ""}
          <button class="btn-ghost btn-logout" data-action="logout">Log out</button>
        </div>
      </header>
      <div class="main-layout">
        <aside class="sidebar">
          <nav class="tabs">
            ${tabBtn("catalog", "Catalog", active.length)}
            ${tabBtn("tours", "Tours", allTours.length)}
            ${tabBtn("archive", "Archive", archivedListings().length)}
            ${tabBtn("map", "Map")}
          </nav>
          ${!isMap ? `
          <div class="filters">
            <label>Search<input id="query" value="${escapeAttr(state.query)}" placeholder="Address, notes..." /></label>
            <label>Status<select id="status"><option value="all">All</option>${statuses.map(s => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
            <label>Sort<select id="sort">
              <option value="tourDate" ${state.sort === "tourDate" ? "selected" : ""}>Tour date</option>
              <option value="rentPerPerson" ${state.sort === "rentPerPerson" ? "selected" : ""}>Per person</option>
              <option value="rent" ${state.sort === "rent" ? "selected" : ""}>Total rent</option>
              <option value="status" ${state.sort === "status" ? "selected" : ""}>Status</option>
            </select></label>
          </div>
          <div class="mini-stats">
            <div class="mini-stat"><strong>${active.length}</strong><span>active</span></div>
            <div class="mini-stat"><strong>${allTours.length}</strong><span>tours</span></div>
            <div class="mini-stat"><strong>${listings.filter(i => i.status === "locked in").length}</strong><span>locked</span></div>
          </div>` : ""}
        </aside>
        ${isMap
          ? `<section class="content-area map-mode">${mapViewContent()}</section>`
          : `<section class="content-area${selected ? " has-selection" : ""}">
               <div class="list-col">${listContent()}</div>
               ${selected ? `<div class="detail-col">${detailPanel(selected)}</div>` : ""}
             </section>`
        }
      </div>
    </div>`;

  bind();
  if (isMap) initGroupMap();
}

function tabBtn(tab, label, count) {
  return `<button class="tab${state.tab === tab ? " active" : ""}" data-tab="${tab}">
    <span>${label}</span>${count !== undefined ? `<strong>${count}</strong>` : ""}
  </button>`;
}

// ── List views ────────────────────────────────────────────────────────────────

function listContent() {
  if (state.tab === "tours") {
    const now = new Date().toISOString();
    const all = listings.filter(i => i.hasTour && i.tourDate && i.status !== "archive");
    const upcoming = all.filter(i => i.tourDate >= now).sort((a, b) => a.tourDate.localeCompare(b.tourDate));
    const past = all.filter(i => i.tourDate < now).sort((a, b) => b.tourDate.localeCompare(a.tourDate));
    if (!all.length) return `<div class="empty">No tours yet.</div>`;
    return `<div class="cal-list">
      ${upcoming.length ? `<div class="tour-section-label">Upcoming</div>${upcoming.map(tourRow).join("")}` : ""}
      ${past.length ? `<div class="tour-section-label muted">Past</div>${past.map(tourRow).join("")}` : ""}
    </div>`;
  }
  if (state.tab === "archive") {
    return archivedListings().length
      ? `<div class="list-grid${state.selectedId ? " narrow" : " wide"}">${archivedListings().map(archiveRow).join("")}</div>`
      : `<div class="empty">No archived listings.</div>`;
  }
  const items = visibleListings();
  return `<div class="list-grid${state.selectedId ? " narrow" : " wide"}">${items.length ? items.map(card).join("") : `<div class="empty">
    <p>No listings yet.</p>
    <p class="muted">Share your group code <strong>${escapeHtml(session.displayName)}</strong> with your crew, then add your first listing.</p>
    <button class="btn-primary" data-action="new">Add listing</button>
  </div>`}</div>`;
}

function card(item) {
  const sel = state.selectedId === item.id;
  const locked = item.status === "locked in";
  return `<article class="card${sel ? " selected" : ""}${locked ? " locked" : ""}" data-select="${item.id}">
    ${item.mainPhoto ? `<div class="card-photo-wrap"><img class="card-photo" src="${escapeAttr(item.mainPhoto)}" alt=""></div>` : ""}
    <div class="card-inner">
      <div class="card-title-row">
        <div>
          <div class="card-title">${escapeHtml(item.title)}</div>
          ${item.neighborhood ? `<div class="card-hood">${escapeHtml(item.neighborhood)}</div>` : ""}
        </div>
        ${item.topChoice ? `<span class="top-choice-badge">★ Top choice</span>` : locked ? `<span class="lock-badge">LOCKED IN</span>` : item.pinned ? `<span class="pin-badge">Pinned</span>` : ""}
      </div>
      <div class="card-price-row">
        <span class="card-price">${item.rentPerPerson ? `$${Number(item.rentPerPerson).toLocaleString()}<span class="per-person">/person</span>` : money(item.rent)}</span>
        <span class="card-meta">${bedsBaths(item)}</span>
      </div>
    </div>
  </article>`;
}

function tourRow(item) {
  return `<div class="cal-row" data-select="${item.id}">
    <div class="cal-date">${dateLabel(item.tourDate)}</div>
    <div><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.neighborhood || item.address)}</span></div>
    <span class="status-chip status-${item.status.replace(/\s+/g, "-")}">${item.status}</span>
  </div>`;
}

function archiveRow(item) {
  const sel = state.selectedId === item.id;
  return `<article class="card arch-card${sel ? " selected" : ""}" data-select="${item.id}">
    ${item.mainPhoto ? `<div class="card-photo-wrap"><img class="card-photo" src="${escapeAttr(item.mainPhoto)}" alt=""></div>` : ""}
    <div class="card-inner">
      <div class="card-title-row">
        <div>
          <div class="card-title">${escapeHtml(item.title)}</div>
          ${item.neighborhood ? `<div class="card-hood">${escapeHtml(item.neighborhood)}</div>` : ""}
        </div>
        <button class="btn-secondary arch-restore-btn" data-restore="${item.id}">Restore</button>
      </div>
      ${item.removalReason ? `<div class="arch-reason-card">"${escapeHtml(item.removalReason)}"</div>` : ""}
      <div class="card-price-row">
        ${item.rentPerPerson ? `<span class="card-price">$${Number(item.rentPerPerson).toLocaleString()}<span class="per-person">/pp</span></span>` : item.rent ? `<span class="card-price">${money(item.rent)}</span>` : ""}
        ${item.beds || item.baths ? `<span class="card-meta">${bedsBaths(item)}</span>` : ""}
      </div>
    </div>
  </article>`;
}

// ── Map view ──────────────────────────────────────────────────────────────────

function mapViewContent() {
  const active = activeListings();
  return `<div class="map-layout">
    <div class="map-sidebar">

      <div class="map-legend">
        ${Object.entries(STATUS_COLORS).map(([s, c]) =>
          `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${s}</div>`
        ).join("")}
        <div class="legend-divider"></div>
        ${Object.values(LOC_TYPES).map(v =>
          `<div class="legend-item"><span class="legend-dot" style="background:${v.color}"></span>${v.emoji} ${v.label}</div>`
        ).join("")}
      </div>

      <div class="map-add-section">
        <button class="btn-ghost map-add-toggle" id="toggleAddLoc">+ Add location pin</button>
        <div class="map-add-form" id="addLocForm" style="display:none">
          <input id="locLabel" type="text" placeholder="Label (e.g. Caltrain Stop)" />
          <input id="locAddress" type="text" placeholder="Address or place name" />
          <select id="locType">
            ${Object.entries(LOC_TYPES).map(([k, v]) =>
              `<option value="${k}">${v.emoji} ${v.label}</option>`
            ).join("")}
          </select>
          <div class="map-add-actions">
            <button class="btn-primary" id="saveLocBtn">Add pin</button>
            <button class="btn-ghost" id="cancelLocBtn">Cancel</button>
          </div>
          <div id="locError" class="loc-error" style="display:none">Couldn't find that address. Try being more specific.</div>
        </div>
      </div>

      ${customLocations.length ? `
        <div class="map-section-label">SAVED LOCATIONS</div>
        <div class="map-custom-locs">
          ${customLocations.map(loc => {
            const t = LOC_TYPES[loc.type] || { color: "#9b9b9b", emoji: "📍" };
            return `<div class="custom-loc-row">
              <span class="loc-dot" style="background:${t.color}"></span>
              <div class="loc-info">
                <div class="loc-name">${escapeHtml(loc.label)}</div>
                ${loc.address ? `<div class="loc-addr">${escapeHtml(loc.address)}</div>` : ""}
              </div>
              <button class="loc-del-btn" data-loc-del="${loc.id}" title="Remove">×</button>
            </div>`;
          }).join("")}
        </div>` : ""}

      <div class="map-section-label">LISTINGS (${active.length})</div>
      <div class="map-cards">
        ${active.map(mapListingCard).join("")}
      </div>
    </div>

    <div id="group-map" class="group-map">
      <div class="map-geocoding-notice">Plotting listings on map…</div>
    </div>
  </div>`;
}

function mapListingCard(item) {
  const sc = "s-" + item.status.replace(/\s+/g, "-");
  const price = item.rentPerPerson ? `$${Number(item.rentPerPerson).toLocaleString()}/pp` : money(item.rent);
  return `<div class="map-card" data-map-select="${item.id}">
    ${item.mainPhoto ? `<img class="map-card-photo" src="${escapeAttr(item.mainPhoto)}" alt="">` : ""}
    <div class="map-card-body">
      <div class="map-card-title">${escapeHtml(item.title)}</div>
      <div class="map-card-meta">
        <span class="map-card-price">${price}</span>
        <span class="dv2-status-badge ${sc}">${escapeHtml(item.status)}</span>
      </div>
    </div>
  </div>`;
}

function mapPopupHTML(item) {
  const sc = "s-" + item.status.replace(/\s+/g, "-");
  const price = item.rentPerPerson
    ? `$${Number(item.rentPerPerson).toLocaleString()}/person`
    : item.rent ? `$${Number(item.rent).toLocaleString()}/mo` : "Price TBD";
  return `<div class="map-popup">
    ${item.mainPhoto ? `<img class="map-popup-photo" src="${escapeAttr(item.mainPhoto)}" alt="">` : ""}
    <div class="map-popup-inner">
      <div class="map-popup-title">${escapeHtml(item.title)}</div>
      <div class="map-popup-price">${escapeHtml(price)}</div>
      <div class="map-popup-row">
        <span class="dv2-status-badge ${sc}">${escapeHtml(item.status)}</span>
        <button class="map-popup-view" onclick="window.__viewListing('${item.id}')">View →</button>
      </div>
    </div>
  </div>`;
}

async function initGroupMap() {
  const el = document.getElementById("group-map");
  if (!el || typeof L === "undefined") return;

  groupMap = L.map("group-map", { scrollWheelZoom: true })
    .setView([37.7749, -122.4194], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© <a href='https://openstreetmap.org'>OpenStreetMap</a>"
  }).addTo(groupMap);

  // Custom location pins first (already have coords)
  for (const loc of customLocations) {
    if (loc.lat && loc.lng) addCustomMarkerToMap(loc);
  }

  // Listing pins — geocode addresses sequentially (respects Nominatim 1 req/sec)
  const active = activeListings();
  let bounds = [];
  for (const item of active) {
    if (!item.address) continue;
    const alreadyCached = !!geocodeCache[item.address];
    const coords = await geocodeAddress(item.address);
    if (!coords) continue;
    if (state.tab !== "map" || !groupMap) return; // user navigated away

    const color = STATUS_COLORS[item.status] || "#9b9b9b";
    const marker = L.circleMarker([coords.lat, coords.lng], {
      radius: 14, fillColor: color,
      color: "#fff", weight: 2.5, opacity: 1, fillOpacity: 0.9
    }).addTo(groupMap);

    marker.bindPopup(mapPopupHTML(item), { maxWidth: 240, className: "lf-popup" });
    groupMapMarkers[item.id] = { marker, lat: coords.lat, lng: coords.lng };
    bounds.push([coords.lat, coords.lng]);

    if (!alreadyCached) await new Promise(r => setTimeout(r, 1100)); // rate limit
  }

  // Fit map to show all listing pins
  if (bounds.length > 0) groupMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

  // Remove loading notice
  const notice = document.querySelector(".map-geocoding-notice");
  if (notice) notice.remove();
}

function addCustomMarkerToMap(loc) {
  if (!groupMap) return;
  const t = LOC_TYPES[loc.type] || { color: "#9b9b9b", emoji: "📍" };
  const marker = L.circleMarker([loc.lat, loc.lng], {
    radius: 9, fillColor: t.color,
    color: "#fff", weight: 2, fillOpacity: 0.95
  }).addTo(groupMap);
  marker.bindTooltip(`${t.emoji} ${loc.label}`, {
    permanent: true, direction: "top", offset: [0, -9], className: "loc-tooltip"
  }).openTooltip();
  groupCustomMarkers[loc.id] = marker;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function detailPanel(item) {
  return state.editing ? editForm(item) : readView(item);
}

// Partial re-render: updates header + left column only (avoids scroll position reset)
function rerenderLeft() {
  const selected = state.selectedId ? listings.find(i => i.id === state.selectedId) : null;
  if (!selected || state.editing) return;
  const header = document.querySelector(".dv2-header");
  if (header) header.outerHTML = dv2Header(selected);
  const left = document.querySelector(".dv2-left");
  if (left) left.innerHTML = dv2LeftContent(selected);
  bindDetail();
}

// ── Header zone ───────────────────────────────────────────────────────────────

function dv2Header(item) {
  const sc = "s-" + item.status.replace(/\s+/g, "-");
  return `<div class="dv2-header">
    <div class="dv2-header-top">
      <div class="dv2-badge-row">
        <span class="dv2-status-badge ${sc}">${escapeHtml(item.status)}</span>
        ${item.topChoice ? `<span class="dv2-top-badge">★ Top choice</span>` : ""}
        ${item.pinned ? `<span class="dv2-pin-badge">Pinned</span>` : ""}
      </div>
      <button class="dv2-close" data-deselect>✕</button>
    </div>
    <h1 class="dv2-title">${escapeHtml(item.title)}</h1>
    <div class="dv2-loc">${escapeHtml(item.address)}${item.neighborhood ? ` · <strong>${escapeHtml(item.neighborhood)}</strong>` : ""}</div>
    <div class="dv2-cta-row">
      ${item.link ? `<a class="dv2-open-btn" href="${escapeAttr(item.link)}" target="_blank" rel="noreferrer">↗&thinsp;Open listing</a>` : ""}
      ${item.videoTour ? `<a class="dv2-video-btn" href="${escapeAttr(item.videoTour)}" target="_blank" rel="noreferrer">▶ Video tour</a>` : ""}
      <button class="dv2-edit-btn" data-action="edit">Edit</button>
    </div>
  </div>`;
}

// ── Left column content (stats + notes + actions) ─────────────────────────────

function dv2LeftContent(item) {
  return `
    ${item.mainPhoto ? `<div class="dv2-hero"><img src="${escapeAttr(item.mainPhoto)}" alt="Main photo"></div>` : ""}

    <div class="dv2-stats-grid">
      ${statCard("PER PERSON",  "rentPerPerson",     item.rentPerPerson,    item.rentPerPerson    ? `$${Number(item.rentPerPerson).toLocaleString()}/mo` : "—",  "number")}
      ${statCard("TOTAL RENT",  "rent",              item.rent,             item.rent             ? `$${Number(item.rent).toLocaleString()}/mo`           : "—",  "number")}
      ${statCard("BEDS / BATHS", null,               null,                  bedsBaths(item),                                                                      null)}
      ${statCard("STATUS",      "status",            item.status,           item.status,                                                                           "select")}
      ${statCard("TOUR",        "tourDate",          item.tourDate || "",   item.tourDate         ? dateLabel(item.tourDate)                             : "Not set", "datetime-local")}
      ${statCard("SHUTTLE",     "minutesToShuttle",  item.minutesToShuttle, item.minutesToShuttle != null ? `${item.minutesToShuttle} min`              : "—",  "number")}
      ${statCard("LEASE START", "leaseStart",        item.leaseStart || "", item.leaseStart       || "—",                                                          "date")}
      ${statCard("LEASE END",   "leaseEnd",          item.leaseEnd   || "", item.leaseEnd         || "—",                                                          "date")}
    </div>

    ${item.announcements && item.announcements.length ? `
      <div class="dv2-banners">
        ${item.announcements.map(a => `<div class="dv2-banner">📌 ${escapeHtml(a)}</div>`).join("")}
      </div>` : ""}

    ${notesBlock("NOTES",      "notes",          item.notes,          false, true)}
    ${item.commuteNotes  || inlineEdit.field === "commuteNotes"  ? notesBlock("COMMUTE",    "commuteNotes",  item.commuteNotes,  false) : ""}
    ${item.afterTourNotes || inlineEdit.field === "afterTourNotes" ? notesBlock("AFTER TOUR", "afterTourNotes", item.afterTourNotes, true) : ""}

    ${item.photos && item.photos.length ? `
      <div class="gallery">
        ${item.photos.map((src, i) => `<div class="gallery-item"><img src="${src}" alt="Photo"><button type="button" class="btn-danger photo-del" data-photo-idx="${i}">×</button></div>`).join("")}
      </div>` : ""}

    <div class="dv2-actions">
      <div class="dv2-actions-left">
        <button class="btn-top-choice${item.topChoice ? " active" : ""}" data-top-choice="${item.id}">${item.topChoice ? "★ Top choice" : "Mark as top choice"}</button>
        <button class="btn-ghost" data-pin="${item.id}">${item.pinned ? "Unpin" : "Pin"}</button>
      </div>
      <button class="btn-danger" data-remove="${item.id}">Archive</button>
    </div>`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function statCard(label, field, rawValue, displayValue, type) {
  const isEditing = inlineEdit.field === field && field !== null;
  if (isEditing) {
    let inputEl;
    if (type === "select") {
      inputEl = `<select class="dv2-inline-select" data-field="${field}">
        ${statuses.map(s => `<option${rawValue === s ? " selected" : ""}>${s}</option>`).join("")}
      </select>`;
    } else {
      inputEl = `<input class="dv2-inline-input" type="${type}" value="${escapeAttr(String(rawValue ?? ""))}" data-field="${field}">`;
    }
    return `<div class="dv2-stat-card editing">
      <div class="dv2-stat-label">${label}</div>
      <div class="dv2-inline-row">
        ${inputEl}
        <button class="dv2-ok" data-inline-confirm="${field}">✓</button>
        <button class="dv2-x" data-inline-cancel>✕</button>
      </div>
    </div>`;
  }
  return `<div class="dv2-stat-card${field ? " editable" : ""}">
    <div class="dv2-stat-label">${label}</div>
    <div class="dv2-stat-val-row">
      <span class="dv2-stat-val">${escapeHtml(String(displayValue))}</span>
      ${field ? `<button class="dv2-pencil" data-inline-edit="${field}" title="Edit">✏</button>` : ""}
    </div>
  </div>`;
}

// ── Notes block ───────────────────────────────────────────────────────────────

function notesBlock(label, field, content, isAfterTour = false, alwaysShow = false) {
  const isEditing = inlineEdit.field === field;
  if (!content && !isEditing && !alwaysShow) return "";
  return `<div class="dv2-notes-block${isAfterTour ? " after-tour" : ""}">
    <div class="dv2-notes-head">
      <span class="dv2-section-label">${label}</span>
      ${!isEditing ? `<button class="dv2-pencil" data-inline-edit="${field}" title="Edit">✏</button>` : ""}
    </div>
    ${isEditing ? `
      <div class="dv2-ta-wrap">
        <textarea class="dv2-inline-textarea" data-field="${field}">${escapeHtml(content || "")}</textarea>
        <div class="dv2-ta-actions">
          <button class="dv2-ok" data-inline-confirm="${field}">✓ Save</button>
          <button class="dv2-x" data-inline-cancel>Cancel</button>
        </div>
      </div>
    ` : `<p class="dv2-notes-text">${content ? escapeHtml(content) : `<span class="dv2-empty-note">Click ✏ to add…</span>`}</p>`}
  </div>`;
}

// ── Read view (assembled) ─────────────────────────────────────────────────────

function readView(item) {
  return `<div class="detail-v2">
    ${dv2Header(item)}
    <div class="dv2-body">
      <div class="dv2-left">${dv2LeftContent(item)}</div>
    </div>
  </div>`;
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function editForm(item) {
  return `<div class="detail-panel">
    <div class="detail-head">
      <h2>${escapeHtml(item.title || "New listing")}</h2>
      <div class="detail-head-actions">
        <button class="btn-primary" id="saveBtn">Save</button>
        <button class="btn-ghost" data-action="cancelEdit">Cancel</button>
      </div>
    </div>
    <div class="detail-body">
      <form id="listingForm">
        <div class="main-photo-section">
          <div class="main-photo-label">Main listing photo</div>
          ${item.mainPhoto ? `<img class="main-photo-preview" src="${escapeAttr(item.mainPhoto)}" alt="Current main photo">` : ""}
          <div class="main-photo-inputs">
            <label class="file-label">Upload photo<input type="file" id="mainPhotoFile" accept="image/*"></label>
            <span class="edit-or">or paste a URL:</span>
            <input type="text" name="mainPhotoUrl" value="${escapeAttr(item.mainPhoto || "")}" placeholder="https://…" />
          </div>
        </div>
        <div class="edit-grid">
          ${field("title", "Title", item.title)}
          ${field("address", "Address", item.address)}
          ${field("neighborhood", "Neighborhood", item.neighborhood || "")}
          ${field("link", "Listing URL", item.link)}
          ${field("rent", "Total rent", item.rent, "number")}
          ${field("rentPerPerson", "Rent per person", item.rentPerPerson, "number")}
          ${field("beds", "Beds", item.beds, "number", "1")}
          ${field("baths", "Baths", item.baths, "number", "0.5")}
          ${selectField("status", "Status", item.status)}
          ${field("minutesToShuttle", "Shuttle (min)", item.minutesToShuttle, "number")}
          ${field("minutesToTransit", "BART/bus (min)", item.minutesToTransit, "number")}
          ${field("dateFound", "Date found", item.dateFound, "date")}
          ${field("tourDate", "Tour date/time", item.tourDate, "datetime-local")}
          ${field("leaseStart", "Lease start", item.leaseStart || "", "date")}
          ${field("leaseEnd", "Lease end", item.leaseEnd || "", "date")}
          ${field("videoTour", "Video tour URL", item.videoTour)}
          <label class="edit-full">Commute notes<textarea name="commuteNotes">${escapeHtml(item.commuteNotes || "")}</textarea></label>
          <label class="edit-full">Notes<textarea name="notes">${escapeHtml(item.notes || "")}</textarea></label>
          <label class="edit-full">After-tour notes<textarea name="afterTourNotes">${escapeHtml(item.afterTourNotes || "")}</textarea></label>
          <label class="edit-full">Announcements (one per line)<textarea name="announcements">${escapeHtml((item.announcements || []).join("\n"))}</textarea></label>
        </div>
        <div class="toggle-row">
          <label><input type="checkbox" name="applied" ${item.applied ? "checked" : ""}> Application sent</label>
          <label><input type="checkbox" name="hasTour" ${item.hasTour ? "checked" : ""}> Tour scheduled</label>
          <label><input type="checkbox" name="pinned" ${item.pinned ? "checked" : ""}> Pinned</label>
        </div>
        <label class="file-label">Add gallery photos<input type="file" id="photos" multiple accept="image/*"></label>
        ${item.photos && item.photos.length ? `<div class="gallery">${item.photos.map((src, i) => `<div class="gallery-item"><img src="${src}" alt="Photo"><button type="button" class="btn-danger photo-del" data-photo-idx="${i}">×</button></div>`).join("")}</div>` : ""}
      </form>
    </div>
  </div>`;
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function field(name, labelText, value = "", type = "text", step = "1") {
  return `<label>${labelText}<input name="${name}" type="${type}" step="${step}" value="${escapeAttr(value ?? "")}"></label>`;
}
function selectField(name, labelText, value) {
  return `<label>${labelText}<select name="${name}">${statuses.map(s => `<option ${value === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>`;
}

// ── Archive modal ─────────────────────────────────────────────────────────────

function showRemoveModal(id) {
  const item = listings.find(i => i.id === id);
  if (!item) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal">
    <div class="modal-title">Archive "${escapeHtml(item.title)}"?</div>
    <p class="modal-desc">Add a reason so your crew knows what happened. It'll show in the archive.</p>
    <textarea class="modal-textarea" id="removeReason" placeholder="e.g. Too expensive, application rejected, landlord unresponsive…"></textarea>
    <div class="modal-actions">
      <button class="btn-ghost" id="modalCancel">Cancel</button>
      <button class="btn-danger" id="modalConfirm">Archive listing</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector("#removeReason");
  textarea.focus();

  const close = () => overlay.remove();
  overlay.querySelector("#modalCancel").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector("#modalConfirm").addEventListener("click", () => {
    const reason = textarea.value.trim();
    close();
    item.status = "archive";
    item.dateRemoved = new Date().toISOString().slice(0, 10);
    item.removalReason = reason;
    state.selectedId = null;
    state.editing = false;
    state.isNew = false;
    inlineEdit.field = null;
    saveListings();
    render();
  });
  textarea.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) overlay.querySelector("#modalConfirm").click();
  });
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bind() {
  document.querySelectorAll("[data-tab]").forEach(btn =>
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); }));

  document.querySelector("#query")?.addEventListener("input", e => { state.query = e.target.value; render(); });
  document.querySelector("#status")?.addEventListener("change", e => { state.status = e.target.value; render(); });
  document.querySelector("#sort")?.addEventListener("change", e => { state.sort = e.target.value; render(); });

  document.querySelectorAll("[data-action='new'], [data-action='reset'], [data-action='logout']").forEach(el => {
    el.addEventListener("click", () => {
      const a = el.dataset.action;
      if (a === "new") addNew();
      if (a === "reset") {
        if (confirm("Reset to seed data? This overwrites all changes for this group.")) {
          listings = structuredClone(window.SEED_LISTINGS);
          customLocations = [];
          saveListings();
          state.selectedId = null;
          inlineEdit.field = null;
          render();
        }
      }
      if (a === "logout") {
        if (confirm("Log out? You'll need your group code to get back in.")) logout();
      }
    });
  });

  document.querySelectorAll("[data-select]").forEach(el => el.addEventListener("click", () => {
    if (state.isNew && state.selectedId !== el.dataset.select) {
      listings = listings.filter(i => i.id !== state.selectedId);
    }
    state.selectedId = el.dataset.select;
    state.editing = false;
    state.isNew = false;
    inlineEdit.field = null;
    render();
  }));

  document.querySelectorAll("[data-restore]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    const item = listings.find(i => i.id === btn.dataset.restore);
    if (item) { item.status = "in the running"; item.dateRemoved = ""; item.removalReason = ""; saveListings(); render(); }
  }));

  // Map view events
  document.querySelectorAll("[data-map-select]").forEach(el => el.addEventListener("click", () => {
    const id = el.dataset.mapSelect;
    const m = groupMapMarkers[id];
    if (m && groupMap) {
      groupMap.setView([m.lat, m.lng], 16);
      m.marker.openPopup();
    }
  }));

  document.querySelector("#toggleAddLoc")?.addEventListener("click", () => {
    const form = document.getElementById("addLocForm");
    if (form) form.style.display = form.style.display === "none" ? "grid" : "none";
  });

  document.querySelector("#cancelLocBtn")?.addEventListener("click", () => {
    const form = document.getElementById("addLocForm");
    if (form) form.style.display = "none";
  });

  document.querySelector("#saveLocBtn")?.addEventListener("click", async () => {
    const label = document.getElementById("locLabel")?.value.trim();
    const address = document.getElementById("locAddress")?.value.trim();
    const type = document.getElementById("locType")?.value;
    const errEl = document.getElementById("locError");
    if (errEl) errEl.style.display = "none";
    if (!label || !address) return;

    const btn = document.querySelector("#saveLocBtn");
    if (btn) { btn.textContent = "Finding…"; btn.disabled = true; }

    const coords = await geocodeAddress(address);

    if (btn) { btn.textContent = "Add pin"; btn.disabled = false; }

    if (!coords) {
      if (errEl) errEl.style.display = "block";
      return;
    }
    customLocations.push({ id: crypto.randomUUID(), label, address, type, lat: coords.lat, lng: coords.lng });
    saveListings();
    if (groupMap) addCustomMarkerToMap(customLocations[customLocations.length - 1]);
    render();
  });

  document.querySelectorAll("[data-loc-del]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.locDel;
    if (groupCustomMarkers[id]) { groupCustomMarkers[id].remove(); delete groupCustomMarkers[id]; }
    customLocations = customLocations.filter(l => l.id !== id);
    saveListings();
    render();
  }));

  bindDetail();
}

function bindDetail() {
  const col = document.querySelector(".detail-col");
  if (!col) return;
  const selected = state.selectedId ? listings.find(i => i.id === state.selectedId) : null;

  col.querySelector("[data-deselect]")?.addEventListener("click", () => {
    state.selectedId = null; state.editing = false; state.isNew = false;
    inlineEdit.field = null;
    render();
  });

  col.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", () => {
      const a = el.dataset.action;
      if (a === "edit") { inlineEdit.field = null; state.editing = true; render(); }
      if (a === "cancelEdit") { inlineEdit.field = null; cancelEdit(); }
    });
  });

  col.querySelector("#saveBtn")?.addEventListener("click", async () => {
    if (selected) {
      await saveFromForm(selected);
      saveListings();
      state.editing = false;
      state.isNew = false;
      render();
    }
  });

  col.querySelectorAll("[data-top-choice]").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === btn.dataset.topChoice);
    if (item) { item.topChoice = !item.topChoice; saveListings(); render(); }
  }));

  col.querySelectorAll("[data-pin]").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === btn.dataset.pin);
    if (item) { item.pinned = !item.pinned; saveListings(); render(); }
  }));

  col.querySelectorAll("[data-remove]").forEach(btn =>
    btn.addEventListener("click", () => showRemoveModal(btn.dataset.remove)));

  col.querySelectorAll(".photo-del").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === state.selectedId);
    if (item) { item.photos.splice(Number(btn.dataset.photoIdx), 1); saveListings(); render(); }
  }));

  // Inline field editing
  col.querySelectorAll("[data-inline-edit]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    inlineEdit.field = btn.dataset.inlineEdit;
    rerenderLeft();
  }));

  col.querySelectorAll("[data-inline-confirm]").forEach(btn => btn.addEventListener("click", () => {
    if (!selected) return;
    const fld = btn.dataset.inlineConfirm;
    const input = col.querySelector(`[data-field="${fld}"]`);
    if (input) {
      const raw = input.value;
      selected[fld] = NUM_FIELDS.includes(fld) ? num(raw) : (raw || null);
      if (fld === "tourDate") selected.hasTour = !!raw;
    }
    inlineEdit.field = null;
    saveListings();
    rerenderLeft();
  }));

  col.querySelectorAll("[data-inline-cancel]").forEach(btn => btn.addEventListener("click", () => {
    inlineEdit.field = null;
    rerenderLeft();
  }));

  col.querySelectorAll(".dv2-inline-input, .dv2-inline-select, .dv2-inline-textarea").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { inlineEdit.field = null; rerenderLeft(); }
      if (e.key === "Enter" && input.tagName !== "TEXTAREA") {
        e.preventDefault();
        col.querySelector(`[data-inline-confirm="${input.dataset.field}"]`)?.click();
      }
    });
    requestAnimationFrame(() => {
      input.focus();
      try { if (input.type === "text" || input.type === "number") input.select(); } catch {}
    });
  });
}

// ── Listing actions ───────────────────────────────────────────────────────────

function addNew() {
  const item = {
    id: crypto.randomUUID(), title: "", address: "", neighborhood: "", source: "Manual", link: "",
    rent: null, rentPerPerson: null, beds: null, baths: null, status: "in the running",
    topChoice: false, applied: false, pinned: false,
    mainPhoto: "",
    dateFound: new Date().toISOString().slice(0, 10),
    dateRemoved: "", removalReason: "", tourDate: "", hasTour: false,
    leaseStart: "", leaseEnd: "", minutesToShuttle: null, minutesToTransit: null,
    commuteNotes: "", videoTour: "", notes: "", afterTourNotes: "", photos: [], announcements: []
  };
  listings.unshift(item);
  state.selectedId = item.id;
  state.editing = true;
  state.isNew = true;
  inlineEdit.field = null;
  render();
}

function cancelEdit() {
  if (state.isNew) { listings = listings.filter(i => i.id !== state.selectedId); state.selectedId = null; }
  state.editing = false;
  state.isNew = false;
  render();
}

async function saveFromForm(item) {
  const form = new FormData(document.querySelector("#listingForm"));
  Object.assign(item, {
    title: form.get("title"), address: form.get("address"), neighborhood: form.get("neighborhood") || "",
    link: form.get("link"), status: form.get("status"),
    rent: num(form.get("rent")), rentPerPerson: num(form.get("rentPerPerson")),
    beds: num(form.get("beds")), baths: num(form.get("baths")),
    minutesToShuttle: num(form.get("minutesToShuttle")), minutesToTransit: num(form.get("minutesToTransit")),
    dateFound: form.get("dateFound"), tourDate: form.get("tourDate"),
    leaseStart: form.get("leaseStart") || "", leaseEnd: form.get("leaseEnd") || "",
    videoTour: form.get("videoTour"),
    commuteNotes: form.get("commuteNotes"), notes: form.get("notes"), afterTourNotes: form.get("afterTourNotes"),
    announcements: String(form.get("announcements") || "").split("\n").filter(Boolean),
    applied: form.get("applied") === "on", hasTour: form.get("hasTour") === "on", pinned: form.get("pinned") === "on"
  });

  // Main photo: file upload takes priority over URL field
  const mainPhotoFile = document.querySelector("#mainPhotoFile");
  if (mainPhotoFile && mainPhotoFile.files.length) {
    item.mainPhoto = await fileToDataUrl(mainPhotoFile.files[0]);
  } else {
    item.mainPhoto = form.get("mainPhotoUrl") || item.mainPhoto || "";
  }

  // Gallery photos
  const fileInput = document.querySelector("#photos");
  if (fileInput && fileInput.files.length) {
    const images = await Promise.all([...fileInput.files].map(fileToDataUrl));
    item.photos = [...(item.photos || []), ...images];
  }
}

function removeListing(id) { showRemoveModal(id); }

// ── Geocoding ─────────────────────────────────────────────────────────────────

async function geocodeAddress(addr) {
  if (geocodeCache[addr]) return geocodeCache[addr];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`,
      { headers: { "Accept-Language": "en-US,en" } }
    );
    const data = await res.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache[addr] = result;
      return result;
    }
  } catch {}
  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function num(v) { return v === "" || v == null ? null : Number(v); }
function fileToDataUrl(file) { return new Promise(r => { const reader = new FileReader(); reader.onload = () => r(reader.result); reader.readAsDataURL(file); }); }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(v) { return escapeHtml(v).replace(/'/g, "&#39;"); }

init();
