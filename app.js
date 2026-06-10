const SESSION_KEY = "house-hunt-session-v1";
const statuses = ["in the running", "applied", "touring", "locked in", "removed", "archive"];

let session = null;
let listings = [];
let unsubscribe = null;
let state = { tab: "catalog", status: "all", query: "", sort: "pinned", selectedId: null, editing: false, isNew: false };

// ── Session (localStorage — device only, just tracks which group you're in) ──

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

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ── Firestore ─────────────────────────────────────────────────────────────────

function groupRef(code) {
  return db.collection("groups").doc(code);
}

function saveListings() {
  if (!session) return;
  groupRef(session.code).set(
    { listings, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(err => console.error("Save failed:", err));
}

function subscribeToGroup(code) {
  if (unsubscribe) unsubscribe();
  unsubscribe = groupRef(code).onSnapshot(snap => {
    if (!snap.exists) {
      // First time this group is accessed — seed sf-roomies, blank for others
      const seed = code === "sf-roomies" ? structuredClone(window.SEED_LISTINGS) : [];
      groupRef(code).set({
        listings: seed,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return; // next snapshot delivers the seeded data
    }
    listings = snap.data().listings || [];
    if (!state.editing) render();
  }, err => {
    console.error("Firestore listener error:", err);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  session = getStoredSession();
  if (session) {
    showLoading();
    subscribeToGroup(session.code);
  } else {
    renderLanding();
  }
}

// ── Loading screen ────────────────────────────────────────────────────────────

function showLoading() {
  document.querySelector("#app").innerHTML = `
    <div class="loading-screen">
      <div class="loading-brand">SF House Hunt</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>`;
}

// ── Landing page ──────────────────────────────────────────────────────────────

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

  // "sf-roomies" always works (seeds on first use). All other codes must exist in Firestore.
  if (code !== "sf-roomies") {
    showLoading();
    try {
      const doc = await groupRef(code).get();
      if (!doc.exists) {
        renderLanding(`No group found for "${escapeHtml(trimmed)}". Double-check the code.`);
        return;
      }
    } catch {
      renderLanding("Couldn't connect. Check your internet and try again.");
      return;
    }
  }

  storeSession(trimmed);
  session = getStoredSession();
  showLoading();
  subscribeToGroup(code);
}

async function attemptCreate() {
  const adjs = ["swift", "cozy", "bold", "sunny", "fresh", "warm", "bright", "grand", "calm", "neat"];
  const nouns = ["crew", "squad", "team", "pack", "posse", "house", "base", "hub"];
  const code = `${adjs[Math.floor(Math.random()*adjs.length)]}-${nouns[Math.floor(Math.random()*nouns.length)]}-${Math.floor(100+Math.random()*900)}`;
  showLoading();
  try {
    await groupRef(code).set({
      listings: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch {
    renderLanding("Couldn't create group. Check your internet and try again.");
    return;
  }
  storeSession(code);
  session = getStoredSession();
  subscribeToGroup(code);
}

function logout() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  clearSession();
  session = null;
  listings = [];
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
  const app = document.querySelector("#app");
  const active = activeListings();
  const allTours = listings.filter(i => i.hasTour && i.tourDate && i.status !== "archive");
  const selected = state.selectedId ? listings.find(i => i.id === state.selectedId) : null;

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
          </nav>
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
          </div>
        </aside>
        <section class="content-area${selected ? " has-selection" : ""}">
          <div class="list-col">${listContent()}</div>
          ${selected ? `<div class="detail-col">${detailPanel(selected)}</div>` : ""}
        </section>
      </div>
    </div>`;
  bind();
}

function tabBtn(tab, label, count) {
  return `<button class="tab${state.tab === tab ? " active" : ""}" data-tab="${tab}"><span>${label}</span><strong>${count}</strong></button>`;
}

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
    return `<div class="cal-list">${archivedListings().length ? archivedListings().map(archiveRow).join("") : `<div class="empty">No archived listings.</div>`}</div>`;
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
  return `<div class="cal-row" data-select="${item.id}">
    <div>
      <strong>${escapeHtml(item.title)}</strong>
      ${item.neighborhood ? `<span class="muted"> · ${escapeHtml(item.neighborhood)}</span>` : ""}
    </div>
    <div class="arch-meta">
      ${item.rentPerPerson ? `<span class="arch-price">$${Number(item.rentPerPerson).toLocaleString()}<span class="per-person">/pp</span></span>` : ""}
      ${item.beds || item.baths ? `<span class="muted">${bedsBaths(item)}</span>` : ""}
      <button class="btn-secondary" data-restore="${item.id}">Restore</button>
    </div>
  </div>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function detailPanel(item) {
  return state.editing ? editForm(item) : readView(item);
}

function readView(item) {
  const locked = item.status === "locked in";
  return `<div class="detail-panel">
    <div class="detail-head">
      <div>
        ${locked ? `<div class="locked-banner">LOCKED IN — TOP CHOICE</div>` : ""}
        <h2>${escapeHtml(item.title)}</h2>
        <div class="detail-address">${escapeHtml(item.address)}${item.neighborhood ? ` · ${escapeHtml(item.neighborhood)}` : ""}</div>
      </div>
      <div class="detail-head-actions">
        <button class="btn-primary" data-action="edit">Edit</button>
        <button class="btn-ghost" data-deselect>Close</button>
      </div>
    </div>
    <div class="detail-body">
      <div class="info-grid">
        <div class="info-block highlight">
          <div class="info-label">Per person</div>
          <div class="info-value big">${item.rentPerPerson ? `$${Number(item.rentPerPerson).toLocaleString()}/mo` : "TBD"}</div>
        </div>
        <div class="info-block">
          <div class="info-label">Total rent</div>
          <div class="info-value">${money(item.rent)}/mo</div>
        </div>
        <div class="info-block">
          <div class="info-label">Beds / baths</div>
          <div class="info-value">${bedsBaths(item)}</div>
        </div>
        <div class="info-block">
          <div class="info-label">Status</div>
          <div class="info-value"><span class="status-chip status-${item.status.replace(/\s+/g, "-")}">${item.status}</span></div>
        </div>
        <div class="info-block">
          <div class="info-label">Tour</div>
          <div class="info-value">${item.hasTour && item.tourDate ? dateLabel(item.tourDate) : "Not scheduled"}</div>
        </div>
        <div class="info-block">
          <div class="info-label">Shuttle</div>
          <div class="info-value">${item.minutesToShuttle != null ? `${item.minutesToShuttle} min` : "?"}</div>
        </div>
        ${item.leaseStart ? `<div class="info-block"><div class="info-label">Lease start</div><div class="info-value">${item.leaseStart}</div></div>` : ""}
        ${item.leaseEnd ? `<div class="info-block"><div class="info-label">Lease end</div><div class="info-value">${item.leaseEnd}</div></div>` : ""}
      </div>
      ${item.announcements && item.announcements.length ? `<div class="announcements">${item.announcements.map(a => `<div class="announcement">${escapeHtml(a)}</div>`).join("")}</div>` : ""}
      ${item.commuteNotes ? `<div class="detail-section"><div class="section-label">Commute</div><div class="section-text">${escapeHtml(item.commuteNotes)}</div></div>` : ""}
      ${item.notes ? `<div class="detail-section"><div class="section-label">Notes</div><div class="section-text">${escapeHtml(item.notes)}</div></div>` : ""}
      ${item.afterTourNotes ? `<div class="detail-section after-tour"><div class="section-label">After tour</div><div class="section-text">${escapeHtml(item.afterTourNotes)}</div></div>` : ""}
      <div class="detail-links">
        <a class="btn-primary" href="${escapeAttr(item.link)}" target="_blank" rel="noreferrer">Open listing ↗</a>
        ${item.videoTour ? `<a class="btn-secondary" href="${escapeAttr(item.videoTour)}" target="_blank" rel="noreferrer">Video tour ↗</a>` : ""}
      </div>
      ${item.photos && item.photos.length ? `<div class="gallery">${item.photos.map((src, i) => `<div class="gallery-item"><img src="${src}" alt="Photo"><button type="button" class="btn-danger photo-del" data-photo-idx="${i}">×</button></div>`).join("")}</div>` : ""}
      <div class="detail-danger">
        <button class="btn-top-choice${item.topChoice ? " active" : ""}" data-top-choice="${item.id}">${item.topChoice ? "★ Top choice" : "Mark as top choice"}</button>
        <button class="btn-ghost" data-pin="${item.id}">${item.pinned ? "Unpin" : "Pin listing"}</button>
        <button class="btn-danger" data-remove="${item.id}">Remove listing</button>
      </div>
    </div>
  </div>`;
}

function editForm(item) {
  return `<div class="detail-panel">
    <div class="detail-head">
      <h2>Edit: ${escapeHtml(item.title || "New listing")}</h2>
      <div class="detail-head-actions">
        <button class="btn-primary" id="saveBtn">Save</button>
        <button class="btn-ghost" data-action="cancelEdit">Cancel</button>
      </div>
    </div>
    <div class="detail-body">
      <form id="listingForm">
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
        <label class="file-label">Add photos<input type="file" id="photos" multiple accept="image/*"></label>
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

// ── Event binding ─────────────────────────────────────────────────────────────

function bind() {
  document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); }));
  document.querySelector("#query").addEventListener("input", e => { state.query = e.target.value; render(); });
  document.querySelector("#status").addEventListener("change", e => { state.status = e.target.value; render(); });
  document.querySelector("#sort").addEventListener("change", e => { state.sort = e.target.value; render(); });

  document.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", () => {
      const a = el.dataset.action;
      if (a === "new") addNew();
      if (a === "edit") { state.editing = true; render(); }
      if (a === "cancelEdit") cancelEdit();
      if (a === "reset") {
        if (confirm("Reset to seed data? This overwrites all changes for this group.")) {
          listings = structuredClone(window.SEED_LISTINGS);
          saveListings();
          state.selectedId = null;
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
    render();
  }));

  const deselect = document.querySelector("[data-deselect]");
  if (deselect) deselect.addEventListener("click", () => { state.selectedId = null; state.editing = false; state.isNew = false; render(); });

  const saveBtn = document.querySelector("#saveBtn");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const item = listings.find(i => i.id === state.selectedId);
    if (item) {
      await saveFromForm(item);
      saveListings();
      state.editing = false;
      state.isNew = false;
      render();
    }
  });

  document.querySelectorAll("[data-top-choice]").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === btn.dataset.topChoice);
    if (item) { item.topChoice = !item.topChoice; saveListings(); render(); }
  }));

  document.querySelectorAll("[data-pin]").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === btn.dataset.pin);
    if (item) { item.pinned = !item.pinned; saveListings(); render(); }
  }));

  document.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => removeListing(btn.dataset.remove)));

  document.querySelectorAll("[data-restore]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    const item = listings.find(i => i.id === btn.dataset.restore);
    if (item) { item.status = "in the running"; item.dateRemoved = ""; item.removalReason = ""; saveListings(); render(); }
  }));

  document.querySelectorAll(".photo-del").forEach(btn => btn.addEventListener("click", () => {
    const item = listings.find(i => i.id === state.selectedId);
    if (item) { item.photos.splice(Number(btn.dataset.photoIdx), 1); saveListings(); render(); }
  }));
}

// ── Listing actions ───────────────────────────────────────────────────────────

function addNew() {
  const item = {
    id: crypto.randomUUID(), title: "", address: "", neighborhood: "", source: "Manual", link: "",
    rent: null, rentPerPerson: null, beds: null, baths: null, status: "in the running",
    topChoice: false, applied: false, pinned: false,
    dateFound: new Date().toISOString().slice(0, 10),
    dateRemoved: "", removalReason: "", tourDate: "", hasTour: false,
    leaseStart: "", leaseEnd: "", minutesToShuttle: null, minutesToTransit: null,
    commuteNotes: "", videoTour: "", notes: "", afterTourNotes: "", photos: [], announcements: []
  };
  listings.unshift(item);
  state.selectedId = item.id;
  state.editing = true;
  state.isNew = true;
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
  const fileInput = document.querySelector("#photos");
  if (fileInput && fileInput.files.length) {
    const images = await Promise.all([...fileInput.files].map(fileToDataUrl));
    item.photos = [...(item.photos || []), ...images];
  }
}

function removeListing(id) {
  const item = listings.find(i => i.id === id);
  const reason = prompt("Why remove this listing?");
  if (reason === null) return;
  item.status = "archive";
  item.dateRemoved = new Date().toISOString().slice(0, 10);
  item.removalReason = reason || "Removed";
  state.selectedId = null;
  state.editing = false;
  state.isNew = false;
  saveListings();
  render();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function num(v) { return v === "" || v == null ? null : Number(v); }
function fileToDataUrl(file) { return new Promise(r => { const reader = new FileReader(); reader.onload = () => r(reader.result); reader.readAsDataURL(file); }); }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(v) { return escapeHtml(v).replace(/'/g, "&#39;"); }

init();
