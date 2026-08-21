const state = { 
  catalog: null, category: "all", query: "", selected: null, hls: null, mode: "live", 
  parentalUnlocked: false, resumeTime: 0,
  vod: { categories: [], items: new Map(), query: "", selected: null },
  // Load saved preferences from local storage
  hiddenGroups: new Set(JSON.parse(localStorage.getItem('hiddenGroups') || '[]')),
  hiddenChannels: new Set(JSON.parse(localStorage.getItem('hiddenChannels') || '[]')),
  favoriteChannels: new Set(JSON.parse(localStorage.getItem('favoriteChannels') || '[]')),
  watchHistory: JSON.parse(localStorage.getItem('watchHistory') || '{}'),
  editingGroups: false,
  editingChannels: false,
  theme: localStorage.getItem('theme') || 'dark'
};

const elements = {
  workspace: document.querySelector("#workspace"), setup: document.querySelector("#setup"), setupForm: document.querySelector("#setupForm"), setupError: document.querySelector("#setupError"), connectButton: document.querySelector("#connectButton"), serviceId: document.querySelector("#serviceId"), mac: document.querySelector("#mac"), parentalPin: document.querySelector("#parentalPin"), status: document.querySelector("#status"), categories: document.querySelector("#categories"), channels: document.querySelector("#channels"), groupCount: document.querySelector("#groupCount"), channelCount: document.querySelector("#channelCount"), search: document.querySelector("#search"), video: document.querySelector("#video"), placeholder: document.querySelector("#placeholder"), videoLoading: document.querySelector("#videoLoading"), nowPlaying: document.querySelector("#nowPlaying"), notice: document.querySelector("#notice"), settingsButton: document.querySelector("#settingsButton"), modebar: document.querySelector("#modebar"), vodWorkspace: document.querySelector("#vodWorkspace"), vodRows: document.querySelector("#vodRows"), vodSearch: document.querySelector("#vodSearch"), vodModal: document.querySelector("#vodModal"), vodClose: document.querySelector("#vodClose"), vodModalPoster: document.querySelector("#vodModalPoster"), vodModalTitle: document.querySelector("#vodModalTitle"), vodModalMeta: document.querySelector("#vodModalMeta"), vodModalDescription: document.querySelector("#vodModalDescription"), vodPlayButton: document.querySelector("#vodPlayButton"), vodResumeButton: document.querySelector("#vodResumeButton"),
  editGroupsButton: document.querySelector("#editGroupsButton"), editChannelsButton: document.querySelector("#editChannelsButton"),
  settingsModal: document.querySelector("#settingsModal"), closeSettingsButton: document.querySelector("#closeSettingsButton"),
  themeSelect: document.querySelector("#themeSelect"), newParentalPin: document.querySelector("#newParentalPin"), updatePinButton: document.querySelector("#updatePinButton"), pinNotice: document.querySelector("#pinNotice"), resetPortalButton: document.querySelector("#resetPortalButton"),
  // Custom Player Elements
  playerContainer: document.querySelector("#playerContainer"), customControls: document.querySelector("#customControls"), controlTitle: document.querySelector("#controlTitle"), controlEpg: document.querySelector("#controlEpg"), progressContainer: document.querySelector("#progressContainer"), progressBar: document.querySelector("#progressBar"), playPauseBtn: document.querySelector("#playPauseBtn"), muteBtn: document.querySelector("#muteBtn"), volumeSlider: document.querySelector("#volumeSlider"), timeDisplay: document.querySelector("#timeDisplay"), fullscreenBtn: document.querySelector("#fullscreenBtn")
};

// --- Theme Management ---
function applyTheme() { document.body.className = `theme-${state.theme}`; elements.themeSelect.value = state.theme; }
applyTheme();

async function request(url, options) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`); return payload; }
function setStatus(text, online = false) { elements.status.querySelector("span").textContent = text; elements.status.classList.toggle("online", online); }
function showNotice(message) { elements.notice.textContent = message; elements.notice.hidden = !message; }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TV"; }
function showSetup() { elements.setup.hidden = false; elements.workspace.hidden = true; elements.vodWorkspace.hidden = true; elements.modebar.hidden = true; elements.setupError.hidden = true; setStatus("Setup required"); }
async function unlockParental() { if (state.parentalUnlocked) return true; const pin = window.prompt("Enter your 4-digit parental PIN to unlock protected content."); if (pin === null) return false; try { await request("/api/parental/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) }); state.parentalUnlocked = true; renderCategories(); renderVod(); return true; } catch (error) { showNotice(error.message); return false; } }
function setMode(mode) { state.mode = mode; elements.workspace.hidden = mode !== "live"; elements.vodWorkspace.hidden = mode !== "vod"; document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode)); if (mode === "vod" && !state.vod.categories.length) loadVod(); }

// --- UI Rendering ---
function renderCategories() { 
  const visibleCategories = state.catalog.categories.filter(c => state.editingGroups || !state.hiddenGroups.has(c.id));
  const categories = [{ id: "favorites", title: "⭐ Favorites" }, { id: "all", title: "All channels" }, ...visibleCategories]; 
  
  elements.groupCount.textContent = `${categories.length - 2} groups`; 
  elements.categories.replaceChildren(...categories.map((category) => { 
    const button = document.createElement("button"); 
    button.type = "button"; 
    button.className = `category-button${state.category === category.id ? " active" : ""}`; 
    if (state.hiddenGroups.has(category.id)) button.classList.add("hidden-item");

    let contentHtml = `<span>${category.locked && !state.parentalUnlocked ? "🔒 Protected content" : category.title}</span><em>›</em>`;
    if (state.editingGroups && !["all", "favorites"].includes(category.id)) {
        const isHidden = state.hiddenGroups.has(category.id);
        contentHtml = `<span class="visibility-toggle group-toggle" data-id="${category.id}">${isHidden ? '❌' : '👁️'}</span>` + contentHtml;
    }
    
    button.innerHTML = contentHtml;

    if (state.editingGroups && !["all", "favorites"].includes(category.id)) {
        button.querySelector('.visibility-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            state.hiddenGroups.has(category.id) ? state.hiddenGroups.delete(category.id) : state.hiddenGroups.add(category.id);
            localStorage.setItem('hiddenGroups', JSON.stringify([...state.hiddenGroups]));
            renderCategories();
        });
    }

    button.addEventListener("click", async () => { 
      if (state.editingGroups) return; 
      if (category.locked && !(await unlockParental())) return; 
      state.category = category.id; 
      renderCategories(); renderChannels(); 
    }); 
    return button; 
  })); 
}

function filteredChannels() { 
  const query = state.query.trim().toLowerCase(); 
  return state.catalog.channels.filter((channel) => {
    const isFavCat = state.category === "favorites";
    const inCategory = isFavCat ? state.favoriteChannels.has(channel.id) : (state.category === "all" || channel.genreId === state.category);
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
    button.className = `channel-button${state.selected?.id === channel.id ? " active" : ""}`; 
    if (state.hiddenChannels.has(channel.id)) button.classList.add("hidden-item");

    let toggleHtml = "";
    if (state.editingChannels) {
        const isHidden = state.hiddenChannels.has(channel.id);
        toggleHtml = `<span class="visibility-toggle" data-id="${channel.id}">${isHidden ? '❌' : '👁️'}</span>`;
    } else {
        const isFav = state.favoriteChannels.has(channel.id);
        toggleHtml = `<span class="favorite-toggle ${isFav ? 'is-favorite' : ''}" data-id="${channel.id}">⭐</span>`;
    }

    button.innerHTML = `${toggleHtml}<span class="channel-icon">${initials(channel.name)}</span><span class="channel-copy"><strong>${channel.name}</strong><small>${channel.number ? `Channel ${channel.number}` : "Live"}${channel.hd ? " · HD" : ""}</small></span><span class="channel-play">▶</span>`; 
    
    // Handle Edit/Favorite Click
    button.querySelector(state.editingChannels ? '.visibility-toggle' : '.favorite-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.editingChannels) {
            state.hiddenChannels.has(channel.id) ? state.hiddenChannels.delete(channel.id) : state.hiddenChannels.add(channel.id);
            localStorage.setItem('hiddenChannels', JSON.stringify([...state.hiddenChannels]));
        } else {
            state.favoriteChannels.has(channel.id) ? state.favoriteChannels.delete(channel.id) : state.favoriteChannels.add(channel.id);
            localStorage.setItem('favoriteChannels', JSON.stringify([...state.favoriteChannels]));
        }
        renderChannels();
    });

    button.addEventListener("click", () => { if (!state.editingChannels) playLive(channel); }); 
    return button; 
  }); 
  
  if (filtered.length > 300) rows.push(Object.assign(document.createElement("p"), { className: "list-note", textContent: "Showing 300 results. Search to narrow." })); 
  elements.channels.replaceChildren(...rows); 
}

async function loadCatalog() { elements.setup.hidden = true; elements.modebar.hidden = false; setMode("live"); setStatus("Connecting"); showNotice(""); elements.channels.innerHTML = '<p class="list-note">Loading portal catalogue…</p>'; try { state.catalog = await request("/api/catalog"); setStatus("Portal connected", true); renderCategories(); renderChannels(); } catch (error) { setStatus("Connection failed"); showNotice(error.message); } }
function resetPlayer() { state.hls?.destroy(); state.hls = null; elements.video.removeAttribute("src"); elements.video.load(); elements.customControls.hidden = true; }

// --- Advanced HLS & Player Logic ---
function attachHls(stream, retry) { 
  const hls = new window.Hls({ enableWorker: false, lowLatencyMode: false, backBufferLength: 60, maxBufferLength: 30, manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000, fragLoadingTimeOut: 30000 }); 
  state.hls = hls; hls.loadSource(stream); hls.attachMedia(elements.video); 
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => { 
    elements.videoLoading.hidden = true; 
    elements.customControls.hidden = false;
    if (state.resumeTime > 0) elements.video.currentTime = state.resumeTime;
    elements.video.play().catch(() => undefined); 
  }); 
  hls.on(window.Hls.Events.ERROR, (_event, data) => { 
    if (!data.fatal) return; 
    if (data.details === window.Hls.ErrorDetails.LEVEL_PARSING_ERROR) { hls.destroy(); elements.videoLoading.hidden = true; showNotice("Stream error: The playlist is blocked or invalid. Try another channel."); return; }
    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && retry.network++ < 3) { hls.startLoad(); return; } 
    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) { if (retry.media === 0) { retry.media++; hls.recoverMediaError(); return; } else if (retry.media === 1) { retry.media++; hls.swapAudioCodec(); hls.recoverMediaError(); return; } } 
    if (retry.reload++ < 2 && state.selected) { hls.destroy(); state.hls = null; setTimeout(() => playSelected(), 1000); return; } 
    elements.videoLoading.hidden = true; showNotice(`Playback stopped: ${data.details}. Select the channel again or try another channel.`); 
  }); 
}

async function playSelected() { 
    if (!state.selected) return; 
    resetPlayer(); 
    try { 
        const endpoint = state.selected.kind === "vod" ? "/api/vod/play" : "/api/play"; 
        const body = state.selected.kind === "vod" ? { categoryId: state.selected.categoryId, itemId: state.selected.id } : { channelId: state.selected.id }; 
        const payload = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); 
        
        elements.controlTitle.textContent = state.selected.title || state.selected.name;
        elements.controlEpg.textContent = state.selected.kind === "vod" ? "On Demand Movie" : "Live TV";

        if (window.Hls?.isSupported()) attachHls(payload.stream, { network: 0, media: 0, reload: 0 }); 
        else if (elements.video.canPlayType("application/vnd.apple.mpegurl")) { 
            elements.video.src = payload.stream; 
            elements.video.addEventListener('loadedmetadata', () => { if (state.resumeTime > 0) elements.video.currentTime = state.resumeTime; });
            await elements.video.play(); elements.videoLoading.hidden = true; elements.customControls.hidden = false;
        } else throw new Error("This browser does not support HLS playback."); 
    } catch (error) { elements.videoLoading.hidden = true; showNotice(error.message); } 
}

function beginPlayback(item, resumeFrom = 0) { state.selected = item; state.resumeTime = resumeFrom; elements.nowPlaying.textContent = item.title || item.name; elements.placeholder.hidden = true; elements.videoLoading.hidden = false; showNotice(""); renderChannels(); playSelected(); }
async function playLive(channel) { const category = state.catalog.categories.find((entry) => entry.id === channel.genreId); if (category?.locked && !(await unlockParental())) return; beginPlayback({ ...channel, kind: "live", title: channel.name }); }

// --- Custom Video Controls Logic ---
let controlTimeout;
elements.playerContainer.addEventListener("mousemove", () => {
    elements.customControls.classList.add("active");
    clearTimeout(controlTimeout);
    controlTimeout = setTimeout(() => elements.customControls.classList.remove("active"), 3000);
});

elements.playPauseBtn.addEventListener("click", () => { elements.video.paused ? elements.video.play() : elements.video.pause(); });
elements.video.addEventListener("play", () => { elements.playPauseBtn.textContent = "⏸️"; });
elements.video.addEventListener("pause", () => { elements.playPauseBtn.textContent = "▶️"; });

elements.muteBtn.addEventListener("click", () => { elements.video.muted = !elements.video.muted; elements.muteBtn.textContent = elements.video.muted ? "🔇" : "🔊"; elements.volumeSlider.value = elements.video.muted ? 0 : elements.video.volume; });
elements.volumeSlider.addEventListener("input", (e) => { elements.video.volume = e.target.value; elements.video.muted = e.target.value == 0; elements.muteBtn.textContent = elements.video.muted ? "🔇" : "🔊"; });

function toggleFullscreen() { if (!document.fullscreenElement) { elements.playerContainer.requestFullscreen().catch(err => console.log(err)); } else { document.exitFullscreen(); } }
elements.fullscreenBtn.addEventListener("click", toggleFullscreen);

function formatTime(seconds) { const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return `${m}:${s < 10 ? '0' : ''}${s}`; }

elements.video.addEventListener("timeupdate", () => {
    if (state.selected?.kind !== "vod" || !elements.video.duration) {
        elements.timeDisplay.textContent = "LIVE"; elements.progressBar.style.width = "100%"; return;
    }
    const percent = (elements.video.currentTime / elements.video.duration) * 100;
    elements.progressBar.style.width = percent + "%";
    elements.timeDisplay.textContent = `${formatTime(elements.video.currentTime)} / ${formatTime(elements.video.duration)}`;
    
    // Save Watch History every 5 seconds
    if (Math.floor(elements.video.currentTime) % 5 === 0) {
        state.watchHistory[state.selected.id] = elements.video.currentTime;
        localStorage.setItem('watchHistory', JSON.stringify(state.watchHistory));
    }
});

elements.progressContainer.addEventListener("click", (e) => {
    if (state.selected?.kind !== "vod") return;
    const rect = elements.progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    elements.video.currentTime = pos * elements.video.duration;
});

// --- Keyboard Shortcuts ---
document.addEventListener("keydown", (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (!state.selected || elements.workspace.hidden && elements.vodWorkspace.hidden) return; 

    switch(e.key.toLowerCase()) {
        case ' ': e.preventDefault(); elements.video.paused ? elements.video.play() : elements.video.pause(); break;
        case 'f': e.preventDefault(); toggleFullscreen(); break;
        case 'm': e.preventDefault(); elements.muteBtn.click(); break;
        case 'arrowup': 
        case 'arrowdown':
            if (state.selected.kind === "live") {
                e.preventDefault();
                const channels = filteredChannels();
                const idx = channels.findIndex(c => c.id === state.selected.id);
                if (idx > -1) {
                    let nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
                    if (nextIdx < 0) nextIdx = channels.length - 1;
                    if (nextIdx >= channels.length) nextIdx = 0;
                    playLive(channels[nextIdx]);
                }
            }
            break;
    }
});

// --- VOD logic ---
function poster(el, item) { el.textContent = initials(item.title); if (item.poster) { el.style.backgroundImage = `linear-gradient(0deg, rgba(2,5,9,.7), transparent 70%), url("${item.poster}")`; el.classList.add("has-poster"); } else { el.style.backgroundImage = ""; el.classList.remove("has-poster"); } }
function renderVod() { const query = state.vod.query.trim().toLowerCase(); const rows = state.vod.categories.map((category) => { const allItems = state.vod.items.get(category.id) || []; const items = allItems.filter((item) => !query || item.title.toLowerCase().includes(query)); if (!items.length && query) return null; const section = document.createElement("section"); section.className = "vod-row"; const heading = document.createElement("h2"); heading.textContent = category.locked && !state.parentalUnlocked ? "🔒 Protected content" : category.title; const rail = document.createElement("div"); rail.className = "vod-rail"; if (category.locked && !state.parentalUnlocked) { const lock = document.createElement("button"); lock.className = "locked-vod"; lock.textContent = "🔒 Unlock protected content"; lock.addEventListener("click", unlockParental); rail.append(lock); } else if (!items.length) rail.innerHTML = '<p class="list-note">No titles currently listed in this category.</p>'; else items.forEach((item) => { const card = document.createElement("button"); card.type = "button"; card.className = "movie-card"; const image = document.createElement("span"); image.className = "movie-poster"; poster(image, item); const name = document.createElement("strong"); name.textContent = item.title; const meta = document.createElement("small"); meta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand"; card.append(image, name, meta); card.addEventListener("click", () => openVodModal({ ...item, kind: "vod", categoryId: category.id })); rail.append(card); }); section.append(heading, rail); return section; }).filter(Boolean); elements.vodRows.replaceChildren(...rows); }
async function loadVod() { elements.vodRows.innerHTML = '<p class="list-note">Loading on-demand library…</p>'; try { const response = await request("/api/vod/categories"); state.vod.categories = response.categories.slice(0, 16); await Promise.all(state.vod.categories.map(async (category) => { const result = await request(`/api/vod/items?categoryId=${encodeURIComponent(category.id)}`); state.vod.items.set(category.id, result.items); })); renderVod(); } catch (error) { elements.vodRows.innerHTML = ""; showNotice(`VOD could not load: ${error.message}`); } }

function openVodModal(item) { 
    state.vod.selected = item; 
    elements.vodModalTitle.textContent = item.title; 
    elements.vodModalMeta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand"; 
    elements.vodModalDescription.textContent = item.description || "No description is available for this title."; 
    poster(elements.vodModalPoster, item); 
    
    // Check Watch History for Resume button
    const savedTime = state.watchHistory[item.id] || 0;
    if (savedTime > 30) { // Only resume if they watched more than 30 seconds
        elements.vodResumeButton.hidden = false;
        elements.vodResumeButton.textContent = `↺ Resume from ${formatTime(savedTime)}`;
        elements.vodResumeButton.onclick = () => { elements.vodModal.hidden = true; beginPlayback(state.vod.selected, savedTime); setMode("live"); };
    } else {
        elements.vodResumeButton.hidden = true;
    }
    
    elements.vodPlayButton.onclick = () => { elements.vodModal.hidden = true; beginPlayback(state.vod.selected, 0); setMode("live"); };
    elements.vodModal.hidden = false; 
}

// --- General Event Listeners ---
elements.setupForm.addEventListener("submit", async (event) => { event.preventDefault(); elements.connectButton.disabled = true; elements.connectButton.textContent = "Saving…"; elements.setupError.hidden = true; try { await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: elements.serviceId.value, mac: elements.mac.value, parentalPin: elements.parentalPin.value }) }); await loadCatalog(); } catch (error) { elements.setupError.textContent = error.message; elements.setupError.hidden = false; } finally { elements.connectButton.disabled = false; elements.connectButton.textContent = "Save & connect"; } });
elements.search.addEventListener("input", () => { state.query = elements.search.value; renderChannels(); });
elements.vodSearch.addEventListener("input", () => { state.vod.query = elements.vodSearch.value; renderVod(); });
elements.vodClose.addEventListener("click", () => { elements.vodModal.hidden = true; }); 
document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

// Edit Mode Listeners
elements.editGroupsButton.addEventListener('click', () => { state.editingGroups = !state.editingGroups; elements.editGroupsButton.classList.toggle('active', state.editingGroups); elements.editGroupsButton.textContent = state.editingGroups ? 'Done' : '👁️ Edit'; renderCategories(); });
elements.editChannelsButton.addEventListener('click', () => { state.editingChannels = !state.editingChannels; elements.editChannelsButton.classList.toggle('active', state.editingChannels); elements.editChannelsButton.textContent = state.editingChannels ? 'Done' : '👁️ Edit'; renderChannels(); });

// Settings
elements.settingsButton.addEventListener("click", () => { elements.settingsModal.hidden = false; });
elements.closeSettingsButton.addEventListener("click", () => { elements.settingsModal.hidden = true; elements.pinNotice.hidden = true; elements.newParentalPin.value = '';});
elements.themeSelect.addEventListener("change", (e) => { state.theme = e.target.value; localStorage.setItem('theme', state.theme); applyTheme(); });
elements.updatePinButton.addEventListener("click", async () => {
    const newPin = elements.newParentalPin.value;
    if (newPin.length !== 4) { elements.pinNotice.textContent = "PIN must be exactly 4 digits."; elements.pinNotice.style.color = "#ff4d4d"; elements.pinNotice.hidden = false; return; }
    try { await request("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentalPin: newPin }) }); elements.pinNotice.textContent = "PIN updated successfully!"; elements.pinNotice.style.color = "#4CAF50"; elements.pinNotice.hidden = false; elements.newParentalPin.value = ""; } 
    catch (error) { elements.pinNotice.textContent = "Failed to update PIN."; elements.pinNotice.style.color = "#ff4d4d"; elements.pinNotice.hidden = false; }
});
elements.resetPortalButton.addEventListener("click", () => { if (confirm("Are you sure you want to log out and clear your configuration?")) { localStorage.clear(); state.catalog = null; elements.settingsModal.hidden = true; showSetup(); } });

// Boot check
request("/api/config").then((result) => (result.configured ? loadCatalog() : showSetup())).catch((error) => { showSetup(); elements.setupError.textContent = error.message; elements.setupError.hidden = false; });
