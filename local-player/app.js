const state = { 
  catalog: null, category: "all", query: "", selected: null, hls: null, mode: "live", 
  parentalUnlocked: false, 
  vod: { categories: [], items: new Map(), query: "", selected: null },
  // Load saved preferences from local storage
  hiddenGroups: new Set(JSON.parse(localStorage.getItem('hiddenGroups') || '[]')),
  hiddenChannels: new Set(JSON.parse(localStorage.getItem('hiddenChannels') || '[]')),
  editingGroups: false,
  editingChannels: false,
  theme: localStorage.getItem('theme') || 'dark'
};

const elements = {
  workspace: document.querySelector("#workspace"), setup: document.querySelector("#setup"), setupForm: document.querySelector("#setupForm"), setupError: document.querySelector("#setupError"), connectButton: document.querySelector("#connectButton"), serviceId: document.querySelector("#serviceId"), mac: document.querySelector("#mac"), parentalPin: document.querySelector("#parentalPin"), status: document.querySelector("#status"), categories: document.querySelector("#categories"), channels: document.querySelector("#channels"), groupCount: document.querySelector("#groupCount"), channelCount: document.querySelector("#channelCount"), search: document.querySelector("#search"), video: document.querySelector("#video"), placeholder: document.querySelector("#placeholder"), videoLoading: document.querySelector("#videoLoading"), nowPlaying: document.querySelector("#nowPlaying"), notice: document.querySelector("#notice"), settingsButton: document.querySelector("#settingsButton"), modebar: document.querySelector("#modebar"), vodWorkspace: document.querySelector("#vodWorkspace"), vodRows: document.querySelector("#vodRows"), vodSearch: document.querySelector("#vodSearch"), vodModal: document.querySelector("#vodModal"), vodClose: document.querySelector("#vodClose"), vodModalPoster: document.querySelector("#vodModalPoster"), vodModalTitle: document.querySelector("#vodModalTitle"), vodModalMeta: document.querySelector("#vodModalMeta"), vodModalDescription: document.querySelector("#vodModalDescription"), vodPlayButton: document.querySelector("#vodPlayButton"),
  // New Elements
  editGroupsButton: document.querySelector("#editGroupsButton"), editChannelsButton: document.querySelector("#editChannelsButton"),
  settingsModal: document.querySelector("#settingsModal"), closeSettingsButton: document.querySelector("#closeSettingsButton"),
  themeSelect: document.querySelector("#themeSelect"), newParentalPin: document.querySelector("#newParentalPin"),
  updatePinButton: document.querySelector("#updatePinButton"), pinNotice: document.querySelector("#pinNotice"),
  resetPortalButton: document.querySelector("#resetPortalButton")
};

// Theme Init
function applyTheme() {
  document.body.className = `theme-${state.theme}`;
  elements.themeSelect.value = state.theme;
}
applyTheme();

async function request(url, options) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`); return payload; }
function setStatus(text, online = false) { elements.status.querySelector("span").textContent = text; elements.status.classList.toggle("online", online); }
function showNotice(message) { elements.notice.textContent = message; elements.notice.hidden = !message; }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TV"; }
function showSetup() { elements.setup.hidden = false; elements.workspace.hidden = true; elements.vodWorkspace.hidden = true; elements.modebar.hidden = true; elements.setupError.hidden = true; setStatus("Setup required"); }
async function unlockParental() { if (state.parentalUnlocked) return true; const pin = window.prompt("Enter your 4-digit parental PIN to unlock protected content."); if (pin === null) return false; try { await request("/api/parental/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) }); state.parentalUnlocked = true; renderCategories(); renderVod(); return true; } catch (error) { showNotice(error.message); return false; } }
function setMode(mode) { state.mode = mode; elements.workspace.hidden = mode !== "live"; elements.vodWorkspace.hidden = mode !== "vod"; document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode)); if (mode === "vod" && !state.vod.categories.length) loadVod(); }

function renderCategories() { 
  // Filter out hidden categories unless we are editing
  const visibleCategories = state.catalog.categories.filter(c => state.editingGroups || !state.hiddenGroups.has(c.id));
  const categories = [{ id: "all", title: "All channels" }, ...visibleCategories]; 
  
  elements.groupCount.textContent = `${categories.length} groups`; 
  elements.categories.replaceChildren(...categories.map((category) => { 
    const button = document.createElement("button"); 
    button.type = "button"; 
    button.className = `category-button${state.category === category.id ? " active" : ""}`; 
    if (state.hiddenGroups.has(category.id)) button.classList.add("hidden-item");

    let contentHtml = `<span>${category.locked && !state.parentalUnlocked ? "🔒 Protected content" : category.title}</span><em>›</em>`;
    
    // Inject visibility toggle if editing
    if (state.editingGroups && category.id !== "all") {
        const isHidden = state.hiddenGroups.has(category.id);
        contentHtml = `<span class="visibility-toggle group-toggle" data-id="${category.id}">${isHidden ? '❌' : '👁️'}</span>` + contentHtml;
    }
    
    button.innerHTML = contentHtml;

    if (state.editingGroups && category.id !== "all") {
        button.querySelector('.visibility-toggle').addEventListener('click', (e) => {
            e.stopPropagation(); // Stop from clicking the category itself
            if (state.hiddenGroups.has(category.id)) state.hiddenGroups.delete(category.id);
            else state.hiddenGroups.add(category.id);
            
            localStorage.setItem('hiddenGroups', JSON.stringify([...state.hiddenGroups]));
            renderCategories();
        });
    }

    button.addEventListener("click", async () => { 
      if (state.editingGroups) return; // Disable navigation while editing
      if (category.locked && !(await unlockParental())) return; 
      state.category = category.id; 
      renderCategories(); 
      renderChannels(); 
    }); 
    return button; 
  })); 
}

function filteredChannels() { 
  const query = state.query.trim().toLowerCase(); 
  return state.catalog.channels.filter((channel) => {
    const inCategory = state.category === "all" || channel.genreId === state.category;
    const matchesSearch = !query || channel.name.toLowerCase().includes(query);
    const isVisible = state.editingChannels || !state.hiddenChannels.has(channel.id);
    return inCategory && matchesSearch && isVisible;
  }); 
}

function renderChannels() { 
  const filtered = filteredChannels(); 
  elements.channelCount.textContent = `${filtered.length.toLocaleString()} channels`; 
  
  const rows = filtered.slice(0, 300).map((channel) => { 
    const button = document.createElement("button"); 
    button.type = "button"; 
    button.className = `channel-button${state.selected?.id === channel.id ? " active" : ""}`; 
    if (state.hiddenChannels.has(channel.id)) button.classList.add("hidden-item");

    let toggleHtml = "";
    if (state.editingChannels) {
        const isHidden = state.hiddenChannels.has(channel.id);
        toggleHtml = `<span class="visibility-toggle channel-toggle" data-id="${channel.id}">${isHidden ? '❌' : '👁️'}</span>`;
    }

    button.innerHTML = `${toggleHtml}<span class="channel-icon">${initials(channel.name)}</span><span class="channel-copy"><strong>${channel.name}</strong><small>${channel.number ? `Channel ${channel.number}` : "Live channel"}${channel.hd ? " · HD" : ""}</small></span><span class="channel-play">▶</span>`; 
    
    if (state.editingChannels) {
        button.querySelector('.visibility-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.hiddenChannels.has(channel.id)) state.hiddenChannels.delete(channel.id);
            else state.hiddenChannels.add(channel.id);
            
            localStorage.setItem('hiddenChannels', JSON.stringify([...state.hiddenChannels]));
            renderChannels();
        });
    }

    button.addEventListener("click", () => {
      if (state.editingChannels) return;
      playLive(channel);
    }); 
    return button; 
  }); 
  
  if (filtered.length > 300) { 
    const note = document.createElement("p"); 
    note.className = "list-note"; 
    note.textContent = "Showing first 300 results. Search to narrow the list."; 
    rows.push(note); 
  } 
  elements.channels.replaceChildren(...rows); 
}

async function loadCatalog() { elements.setup.hidden = true; elements.modebar.hidden = false; setMode("live"); setStatus("Connecting"); showNotice(""); elements.channels.innerHTML = '<p class="list-note">Loading portal catalogue…</p>'; try { state.catalog = await request("/api/catalog"); setStatus("Portal connected", true); renderCategories(); renderChannels(); } catch (error) { setStatus("Connection failed"); showNotice(error.message); } }
function resetPlayer() { state.hls?.destroy(); state.hls = null; elements.video.removeAttribute("src"); elements.video.load(); }

function attachHls(stream, retry) { 
  const hls = new window.Hls({ enableWorker: false, lowLatencyMode: false, backBufferLength: 60, maxBufferLength: 30, manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000, fragLoadingTimeOut: 30000 }); 
  state.hls = hls; hls.loadSource(stream); hls.attachMedia(elements.video); 
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => { elements.videoLoading.hidden = true; elements.video.play().catch(() => undefined); }); 
  hls.on(window.Hls.Events.ERROR, (_event, data) => { 
    if (!data.fatal) return; 
    if (data.details === window.Hls.ErrorDetails.LEVEL_PARSING_ERROR) { hls.destroy(); elements.videoLoading.hidden = true; showNotice("Stream error: The playlist is blocked or invalid. Try another channel."); return; }
    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && retry.network++ < 3) { hls.startLoad(); return; } 
    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) { if (retry.media === 0) { retry.media++; hls.recoverMediaError(); return; } else if (retry.media === 1) { retry.media++; hls.swapAudioCodec(); hls.recoverMediaError(); return; } } 
    if (retry.reload++ < 2 && state.selected) { hls.destroy(); state.hls = null; setTimeout(() => playSelected(), 1000); return; } 
    elements.videoLoading.hidden = true; showNotice(`Playback stopped: ${data.details}. Select the channel again or try another channel.`); 
  }); 
}

async function playSelected() { const selected = state.selected; if (!selected) return; resetPlayer(); try { const endpoint = selected.kind === "vod" ? "/api/vod/play" : "/api/play"; const body = selected.kind === "vod" ? { categoryId: selected.categoryId, itemId: selected.id } : { channelId: selected.id }; const payload = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (window.Hls?.isSupported()) attachHls(payload.stream, { network: 0, media: 0, reload: 0 }); else if (elements.video.canPlayType("application/vnd.apple.mpegurl")) { elements.video.src = payload.stream; await elements.video.play(); elements.videoLoading.hidden = true; } else throw new Error("This browser does not support HLS playback."); } catch (error) { elements.videoLoading.hidden = true; showNotice(error.message); } }
function beginPlayback(item) { state.selected = item; elements.nowPlaying.textContent = item.title || item.name; elements.placeholder.hidden = true; elements.videoLoading.hidden = false; showNotice(""); renderChannels(); playSelected(); }
async function playLive(channel) { const category = state.catalog.categories.find((entry) => entry.id === channel.genreId); if (category?.locked && !(await unlockParental())) return; beginPlayback({ ...channel, kind: "live", title: channel.name }); }

function poster(el, item) { el.textContent = initials(item.title); if (item.poster) { el.style.backgroundImage = `linear-gradient(0deg, rgba(2,5,9,.7), transparent 70%), url("${item.poster}")`; el.classList.add("has-poster"); } else { el.style.backgroundImage = ""; el.classList.remove("has-poster"); } }
function renderVod() { const query = state.vod.query.trim().toLowerCase(); const rows = state.vod.categories.map((category) => { const allItems = state.vod.items.get(category.id) || []; const items = allItems.filter((item) => !query || item.title.toLowerCase().includes(query)); if (!items.length && query) return null; const section = document.createElement("section"); section.className = "vod-row"; const heading = document.createElement("h2"); heading.textContent = category.locked && !state.parentalUnlocked ? "🔒 Protected content" : category.title; const rail = document.createElement("div"); rail.className = "vod-rail"; if (category.locked && !state.parentalUnlocked) { const lock = document.createElement("button"); lock.className = "locked-vod"; lock.textContent = "🔒 Unlock protected content"; lock.addEventListener("click", unlockParental); rail.append(lock); } else if (!items.length) rail.innerHTML = '<p class="list-note">No titles currently listed in this category.</p>'; else items.forEach((item) => { const card = document.createElement("button"); card.type = "button"; card.className = "movie-card"; const image = document.createElement("span"); image.className = "movie-poster"; poster(image, item); const name = document.createElement("strong"); name.textContent = item.title; const meta = document.createElement("small"); meta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand"; card.append(image, name, meta); card.addEventListener("click", () => openVodModal({ ...item, kind: "vod", categoryId: category.id })); rail.append(card); }); section.append(heading, rail); return section; }).filter(Boolean); elements.vodRows.replaceChildren(...rows); }
async function loadVod() { elements.vodRows.innerHTML = '<p class="list-note">Loading on-demand library…</p>'; try { const response = await request("/api/vod/categories"); state.vod.categories = response.categories.slice(0, 16); await Promise.all(state.vod.categories.map(async (category) => { const result = await request(`/api/vod/items?categoryId=${encodeURIComponent(category.id)}`); state.vod.items.set(category.id, result.items); })); renderVod(); } catch (error) { elements.vodRows.innerHTML = ""; showNotice(`VOD could not load: ${error.message}`); } }
function openVodModal(item) { state.vod.selected = item; elements.vodModalTitle.textContent = item.title; elements.vodModalMeta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand"; elements.vodModalDescription.textContent = item.description || "No description is available for this title."; poster(elements.vodModalPoster, item); elements.vodModal.hidden = false; }

// --- Event Listeners ---

// Setup Form
elements.setupForm.addEventListener("submit", async (event) => { event.preventDefault(); elements.connectButton.disabled = true; elements.connectButton.textContent = "Saving…"; elements.setupError.hidden = true; try { await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: elements.serviceId.value, mac: elements.mac.value, parentalPin: elements.parentalPin.value }) }); await loadCatalog(); } catch (error) { elements.setupError.textContent = error.message; elements.setupError.hidden = false; } finally { elements.connectButton.disabled = false; elements.connectButton.textContent = "Save & connect"; } });

// Searching
elements.search.addEventListener("input", () => { state.query = elements.search.value; renderChannels(); });
elements.vodSearch.addEventListener("input", () => { state.vod.query = elements.vodSearch.value; renderVod(); });

// Modals
elements.vodClose.addEventListener("click", () => { elements.vodModal.hidden = true; }); 
elements.vodPlayButton.addEventListener("click", () => { elements.vodModal.hidden = true; beginPlayback(state.vod.selected); setMode("live"); }); 
document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

// Visibility Toggle Editing
elements.editGroupsButton.addEventListener('click', () => {
    state.editingGroups = !state.editingGroups;
    elements.editGroupsButton.classList.toggle('active', state.editingGroups);
    elements.editGroupsButton.textContent = state.editingGroups ? 'Done' : '👁️ Edit';
    renderCategories();
});

elements.editChannelsButton.addEventListener('click', () => {
    state.editingChannels = !state.editingChannels;
    elements.editChannelsButton.classList.toggle('active', state.editingChannels);
    elements.editChannelsButton.textContent = state.editingChannels ? 'Done' : '👁️ Edit';
    renderChannels();
});

// Settings Modal
elements.settingsButton.addEventListener("click", () => { elements.settingsModal.hidden = false; });
elements.closeSettingsButton.addEventListener("click", () => { elements.settingsModal.hidden = true; elements.pinNotice.hidden = true; elements.newParentalPin.value = '';});

elements.themeSelect.addEventListener("change", (e) => {
    state.theme = e.target.value;
    localStorage.setItem('theme', state.theme);
    applyTheme();
});

elements.updatePinButton.addEventListener("click", async () => {
    const newPin = elements.newParentalPin.value;
    if (newPin.length !== 4) {
        elements.pinNotice.textContent = "PIN must be exactly 4 digits.";
        elements.pinNotice.style.color = "#ff4d4d";
        elements.pinNotice.hidden = false;
        return;
    }
    try {
        // Send new PIN to config API
        await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentalPin: newPin }) });
        elements.pinNotice.textContent = "PIN updated successfully!";
        elements.pinNotice.style.color = "#4CAF50";
        elements.pinNotice.hidden = false;
        elements.newParentalPin.value = "";
    } catch (error) {
        elements.pinNotice.textContent = "Failed to update PIN.";
        elements.pinNotice.style.color = "#ff4d4d";
        elements.pinNotice.hidden = false;
    }
});

elements.resetPortalButton.addEventListener("click", () => {
    if (confirm("Are you sure you want to log out and clear your configuration?")) {
        localStorage.clear(); // Wipe hidden settings and themes
        state.catalog = null;
        elements.settingsModal.hidden = true;
        showSetup();
    }
});

// Boot check
request("/api/config").then((result) => (result.configured ? loadCatalog() : showSetup())).catch((error) => { showSetup(); elements.setupError.textContent = error.message; elements.setupError.hidden = false; });
