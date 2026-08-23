/*
=========================================================
 NetPlus IPTV Player
 VERSION: 1.4.1 Diagnostic
 File: app.js
=========================================================
*/

const APP_VERSION = "1.4.1-diagnostic";

const state = {
  catalog: null,
  category: "all",
  query: "",
  selected: null,
  hls: null,
  liveRetryToken: 0,
  liveScrollTop: 0,

  parentalUnlocked: false,
  pendingUnlockAction: null,

  hiddenGroups: new Set(JSON.parse(localStorage.getItem("hiddenGroups") || "[]")),
  hiddenChannels: new Set(JSON.parse(localStorage.getItem("hiddenChannels") || "[]")),
  favoriteChannels: new Set(JSON.parse(localStorage.getItem("favoriteChannels") || "[]")),
  favoriteMedia: new Set(JSON.parse(localStorage.getItem("favoriteMedia") || "[]")),
  watchHistory: JSON.parse(localStorage.getItem("watchHistory") || "{}"),
  watchMeta: JSON.parse(localStorage.getItem("watchMeta") || "{}"),

  editingGroups: false,
  editingChannels: false,
  theme: localStorage.getItem("theme") || "dark",

  vod: {
    categories: [],
    categoryId: null,
    query: "",
    items: [],
    itemIds: new Set(),
    selected: null,
    page: 0,
    total: 0,
    loading: false,
    ended: false,
    loadToken: 0,
    hls: null,
    retryToken: 0,
    categoryScrollTop: 0,
  },

  contentType: "vod",
  series: {
    categories: [], categoryId: null, query: "", items: [], itemIds: new Set(),
    selected: null, page: 0, total: 0, loading: false, ended: false, loadToken: 0,
    hls: null,
  },
  liveWatchdogTimer: null,
  liveLastFragmentAt: 0,
  liveRecoveryInFlight: false,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  topbar: $("#topbar"),
  modebar: $("#modebar"),

  setup: $("#setup"),
  setupForm: $("#setupForm"),
  setupError: $("#setupError"),
  connectButton: $("#connectButton"),
  serviceId: $("#serviceId"),
  mac: $("#mac"),
  parentalPin: $("#parentalPin"),

  status: $("#status"),
  settingsButton: $("#settingsButton"),

  workspace: $("#workspace"),
  categories: $("#categories"),
  channels: $("#channels"),
  groupCount: $("#groupCount"),
  channelCount: $("#channelCount"),
  search: $("#search"),
  editGroupsButton: $("#editGroupsButton"),
  editChannelsButton: $("#editChannelsButton"),

  playerContainer: $("#playerContainer"),
  video: $("#video"),
  placeholder: $("#placeholder"),
  videoLoading: $("#videoLoading"),
  customControls: $("#customControls"),
  controlTitle: $("#controlTitle"),
  controlEpg: $("#controlEpg"),
  progressContainer: $("#progressContainer"),
  progressBar: $("#progressBar"),
  playPauseBtn: $("#playPauseBtn"),
  muteBtn: $("#muteBtn"),
  volumeSlider: $("#volumeSlider"),
  timeDisplay: $("#timeDisplay"),
  fullscreenBtn: $("#fullscreenBtn"),
  playerModeBadge: $("#playerModeBadge"),
  nowPlaying: $("#nowPlaying"),
  notice: $("#notice"),

  vodWorkspace: $("#vodWorkspace"),
  dashboardWorkspace: $("#dashboardWorkspace"),
  favoritesWorkspace: $("#favoritesWorkspace"),
  continueWatching: $("#continueWatching"),
  favoriteChannelsGrid: $("#favoriteChannelsGrid"),
  favoriteMediaGrid: $("#favoriteMediaGrid"),
  vodSearch: $("#vodSearch"),
  vodCategories: $("#vodCategories"),
  vodCategoryTitle: $("#vodCategoryTitle"),
  vodCategoryMeta: $("#vodCategoryMeta"),
  vodGrid: $("#vodGrid"),
  vodLoadMore: $("#vodLoadMore"),
  vodLoadSpinner: $("#vodLoadSpinner"),
  vodEndMessage: $("#vodEndMessage"),

  vodPlayerSection: $("#vodPlayerSection"),
  vodPlayerContainer: $("#vodPlayerContainer"),
  vodVideo: $("#vodVideo"),
  vodVideoLoading: $("#vodVideoLoading"),
  vodPlayerControls: $("#vodPlayerControls"),
  vodControlTitle: $("#vodControlTitle"),
  vodProgressContainer: $("#vodProgressContainer"),
  vodProgressBar: $("#vodProgressBar"),
  vodPlayPauseBtn: $("#vodPlayPauseBtn"),
  vodMuteBtn: $("#vodMuteBtn"),
  vodVolumeSlider: $("#vodVolumeSlider"),
  vodTimeDisplay: $("#vodTimeDisplay"),
  closeVodPlayerButton: $("#closeVodPlayerButton"),
  vodFullscreenBtn: $("#vodFullscreenBtn"),

  vodModal: $("#vodModal"),
  vodClose: $("#vodClose"),
  vodModalPoster: $("#vodModalPoster"),
  vodModalTitle: $("#vodModalTitle"),
  vodModalMeta: $("#vodModalMeta"),
  vodModalDescription: $("#vodModalDescription"),
  vodPlayButton: $("#vodPlayButton"),
  vodResumeButton: $("#vodResumeButton"),
  vodFavoriteButton: $("#vodFavoriteButton"),

  seriesWorkspace: $("#seriesWorkspace"),
  seriesSearch: $("#seriesSearch"),
  seriesCategories: $("#seriesCategories"),
  seriesCategoryTitle: $("#seriesCategoryTitle"),
  seriesCategoryMeta: $("#seriesCategoryMeta"),
  seriesGrid: $("#seriesGrid"),
  seriesLoadMore: $("#seriesLoadMore"),
  seriesLoadSpinner: $("#seriesLoadSpinner"),
  seriesEndMessage: $("#seriesEndMessage"),
  seriesPlayerSection: $("#seriesPlayerSection"),
  seriesVideo: $("#seriesVideo"),
  seriesVideoLoading: $("#seriesVideoLoading"),
  closeSeriesPlayerButton: $("#closeSeriesPlayerButton"),
  seriesModal: $("#seriesModal"),
  seriesClose: $("#seriesClose"),
  seriesModalPoster: $("#seriesModalPoster"),
  seriesModalTitle: $("#seriesModalTitle"),
  seriesModalMeta: $("#seriesModalMeta"),
  seriesModalDescription: $("#seriesModalDescription"),
  seriesSeasonSelect: $("#seriesSeasonSelect"),
  seriesEpisodes: $("#seriesEpisodes"),
  seriesFavoriteButton: $("#seriesFavoriteButton"),

  pinModal: $("#pinModal"),
  closePinModal: $("#closePinModal"),
  pinUnlockForm: $("#pinUnlockForm"),
  unlockPin: $("#unlockPin"),
  unlockPinError: $("#unlockPinError"),
  unlockPinButton: $("#unlockPinButton"),

  settingsModal: $("#settingsModal"),
  closeSettingsButton: $("#closeSettingsButton"),
  themeSelect: $("#themeSelect"),
  newParentalPin: $("#newParentalPin"),
  updatePinButton: $("#updatePinButton"),
  pinNotice: $("#pinNotice"),
  resetDiagnosticButton: $("#resetDiagnosticButton"),
  downloadDiagnosticButton: $("#downloadDiagnosticButton"),
  diagnosticNotice: $("#diagnosticNotice"),
  resetPortalButton: $("#resetPortalButton"),
};

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

/* v1.4.1 Diagnostic: browser/HLS events are sent without any portal URL,
   MAC, token, cookie, or user-entered credentials. */
function recordClientDiagnostic(event, details = {}) {
  fetch("/api/diagnostics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, details }),
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}

function hlsDiagnosticDetails(data) {
  return {
    type: String(data?.type || ""),
    details: String(data?.details || ""),
    fatal: Boolean(data?.fatal),
    reason: String(data?.reason || ""),
    responseCode: Number(data?.response?.code || 0) || undefined,
    frag: data?.frag
      ? {
          sn: data.frag.sn,
          level: data.frag.level,
          duration: data.frag.duration,
        }
      : undefined,
  };
}

function setStatus(text, online = false) {
  const span = elements.status?.querySelector("span");
  if (span) span.textContent = text;
  elements.status?.classList.toggle("online", online);
}

function showNotice(message = "") {
  if (!elements.notice) return;
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
}

function initials(name) {
  return String(name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join("").toUpperCase() || "TV";
}

function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function applyTheme() {
  document.body.className = `theme-${state.theme}`;
  if (elements.themeSelect) elements.themeSelect.value = state.theme;
}

function persistSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function saveWatchHistory() {
  localStorage.setItem("watchHistory", JSON.stringify(state.watchHistory));
  localStorage.setItem("watchMeta", JSON.stringify(state.watchMeta));
}

function categoryById(id) {
  return state.catalog?.categories?.find((category) => category.id === id);
}

function vodCategoryById(id) {
  return state.vod.categories.find((category) => category.id === id);
}

function stopMedia(video) {
  if (!video) return;
  try { video.pause(); } catch {}
  video.removeAttribute("src");
  try { video.load(); } catch {}
}

function destroyHls(key) {
  const hls = key === "live" ? state.hls : state.vod.hls;
  if (hls) {
    try { hls.destroy(); } catch {}
  }
  if (key === "live") state.hls = null;
  else state.vod.hls = null;
}

function stopLivePlayback(clearSelection = false) {
  state.liveRetryToken += 1;
  clearInterval(state.liveWatchdogTimer);
  state.liveWatchdogTimer = null;
  state.liveRecoveryInFlight = false;
  destroyHls("live");
  stopMedia(elements.video);
  if (elements.videoLoading) elements.videoLoading.hidden = true;
  if (elements.customControls) elements.customControls.hidden = true;
  if (clearSelection) state.selected = null;
}

function stopVodPlayback() {
  state.vod.retryToken += 1;
  destroyHls("vod");
  stopMedia(elements.vodVideo);
  if (elements.vodVideoLoading) elements.vodVideoLoading.hidden = true;
  if (elements.vodPlayerControls) elements.vodPlayerControls.hidden = true;
}

function showSetup() {
  stopLivePlayback(true);
  stopVodPlayback();
  elements.setup.hidden = false;
  elements.topbar.hidden = true;
  elements.modebar.hidden = true;
  elements.workspace.hidden = true;
  elements.vodWorkspace.hidden = true;
  elements.seriesWorkspace.hidden = true;
  elements.dashboardWorkspace.hidden = true;
  elements.favoritesWorkspace.hidden = true;
  elements.settingsModal.hidden = true;
  elements.vodModal.hidden = true;
  elements.pinModal.hidden = true;
  elements.setupError.hidden = true;
  setStatus("Setup required");
}

/* =====================================================
   MODE
===================================================== */

function setMode(mode) {
  const isLive = mode === "live";
  const isContent = mode === "content";
  const isDashboard = mode === "dashboard";
  const isFavorites = mode === "favorites";

  if (isLive) stopVodPlayback();
  else stopLivePlayback(false);

  if (!isContent) stopVodPlayback();
  elements.workspace.hidden = !isLive;
  elements.dashboardWorkspace.hidden = !isDashboard;
  elements.favoritesWorkspace.hidden = !isFavorites;
  elements.vodWorkspace.hidden = !isContent || state.contentType !== "vod";
  elements.seriesWorkspace.hidden = !isContent || state.contentType !== "series";

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (mode === "settings") {
    elements.settingsModal.hidden = false;
    return;
  }
  if (isDashboard) renderDashboard();
  if (isFavorites) renderFavorites();
  if (isContent && state.contentType === "vod" && !state.vod.categories.length) loadVodCategories();
  if (isContent && state.contentType === "series" && !state.series.categories.length) loadSeriesCategories();
}

function setContentType(type) {
  state.contentType = type === "series" ? "series" : "vod";
  document.querySelectorAll(".content-type-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.contentType === state.contentType);
  });
  setMode("content");
}

/* =====================================================
   MAC / PIN INPUT
   No forced 00:1A:79 prefix.
   001A79123456 => 00:1A:79:12:34:56
===================================================== */

function formatMacValue(raw) {
  const hex = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 12);

  return (hex.match(/.{1,2}/g) || []).join(":");
}

function keepCaretAtEnd(input) {
  requestAnimationFrame(() => {
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {}
  });
}

if (elements.mac) {
  elements.mac.removeAttribute("readonly");
  elements.mac.removeAttribute("disabled");
  elements.mac.value = formatMacValue(elements.mac.value);

  elements.mac.addEventListener("input", () => {
    elements.mac.value = formatMacValue(elements.mac.value);
    keepCaretAtEnd(elements.mac);
  });

  elements.mac.addEventListener("paste", (event) => {
    const value = event.clipboardData?.getData("text");
    if (!value) return;
    event.preventDefault();
    elements.mac.value = formatMacValue(value);
    keepCaretAtEnd(elements.mac);
  });
}

for (const input of [elements.parentalPin, elements.unlockPin, elements.newParentalPin]) {
  if (!input) continue;
  input.removeAttribute("readonly");
  input.removeAttribute("disabled");
  input.setAttribute("inputmode", "numeric");
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 4);
  });
}

/* =====================================================
   PARENTAL UNLOCK
===================================================== */

function closePinModal(cancelPending = true) {
  elements.pinModal.hidden = true;
  elements.unlockPin.value = "";
  elements.unlockPinError.hidden = true;
  if (cancelPending) state.pendingUnlockAction = null;
}

function requestParentalUnlock(action) {
  if (state.parentalUnlocked) {
    action?.();
    return;
  }
  state.pendingUnlockAction = action || null;
  elements.unlockPin.value = "";
  elements.unlockPinError.hidden = true;
  elements.pinModal.hidden = false;
  setTimeout(() => elements.unlockPin.focus(), 50);
}

elements.pinUnlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = elements.unlockPin.value.trim();

  if (!/^\d{4}$/.test(pin)) {
    elements.unlockPinError.textContent = "Enter your 4-digit parental PIN.";
    elements.unlockPinError.hidden = false;
    return;
  }

  elements.unlockPinButton.disabled = true;
  elements.unlockPinButton.textContent = "Unlocking...";

  try {
    await request("/api/parental/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    state.parentalUnlocked = true;
    const action = state.pendingUnlockAction;
    state.pendingUnlockAction = null;
    closePinModal(false);
    renderCategories();
    renderChannels();
    renderVodCategories();
    action?.();
  } catch (error) {
    elements.unlockPinError.textContent = error.message;
    elements.unlockPinError.hidden = false;
  } finally {
    elements.unlockPinButton.disabled = false;
    elements.unlockPinButton.textContent = "Unlock";
  }
});

elements.closePinModal.addEventListener("click", () => closePinModal(true));

elements.pinModal.addEventListener("click", (event) => {
  if (event.target === elements.pinModal) closePinModal(true);
});

/* =====================================================
   LIVE CATALOG
===================================================== */

function renderCategories() {
  if (!state.catalog) return;

  const scrollTop = elements.categories.scrollTop;

  const visiblePortalCategories = state.catalog.categories.filter(
    (category) => state.editingGroups || !state.hiddenGroups.has(category.id)
  );

  const categories = [
    { id: "favorites", title: "Favorites", locked: false },
    { id: "all", title: "All channels", locked: false },
    ...visiblePortalCategories,
  ];

  elements.groupCount.textContent = `${visiblePortalCategories.length.toLocaleString()} groups`;

  const nodes = categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === category.id ? " active" : ""}`;

    if (state.hiddenGroups.has(category.id)) button.classList.add("hidden-item");

    const title = document.createElement("span");
    title.textContent =
      category.locked && !state.parentalUnlocked ? `[PIN] ${category.title}` : category.title;

    if (state.editingGroups && !["all", "favorites"].includes(category.id)) {
      const visibility = document.createElement("span");
      visibility.className = "visibility-toggle";
      visibility.textContent = state.hiddenGroups.has(category.id) ? "X" : "Show";
      visibility.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.hiddenGroups.has(category.id)) state.hiddenGroups.delete(category.id);
        else state.hiddenGroups.add(category.id);
        persistSet("hiddenGroups", state.hiddenGroups);
        renderCategories();
      });
      button.append(visibility);
    }

    const arrow = document.createElement("em");
    arrow.textContent = ">";
    button.append(title, arrow);

    button.addEventListener("click", () => {
      if (state.editingGroups) return;

      const choose = () => {
        state.category = category.id;
        renderCategories();
        renderChannels();
      };

      if (category.locked && !state.parentalUnlocked) {
        requestParentalUnlock(choose);
        return;
      }

      choose();
    });

    return button;
  });

  elements.categories.replaceChildren(...nodes);
  elements.categories.scrollTop = scrollTop;
}

function filteredChannels() {
  if (!state.catalog) return [];
  const query = state.query.trim().toLowerCase();

  return state.catalog.channels.filter((channel) => {
    const category = categoryById(channel.genreId);
    if (category?.locked && !state.parentalUnlocked) return false;

    const inCategory =
      state.category === "favorites"
        ? state.favoriteChannels.has(channel.id)
        : state.category === "all" || channel.genreId === state.category;

    return (
      inCategory &&
      (!query || channel.name.toLowerCase().includes(query)) &&
      (state.editingChannels || !state.hiddenChannels.has(channel.id))
    );
  });
}

function renderChannels() {
  if (!state.catalog) return;

  const scrollTop = elements.channels.scrollTop;
  const filtered = filteredChannels();

  elements.channelCount.textContent = `${filtered.length.toLocaleString()} channels`;

  const rows = filtered.slice(0, 400).map((channel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel-button${state.selected?.id === channel.id ? " active" : ""}`;

    if (state.hiddenChannels.has(channel.id)) button.classList.add("hidden-item");

    const toggle = document.createElement("span");

    if (state.editingChannels) {
      toggle.className = "visibility-toggle";
      toggle.textContent = state.hiddenChannels.has(channel.id) ? "X" : "Show";
    } else {
      toggle.className =
        `favorite-toggle${state.favoriteChannels.has(channel.id) ? " is-favorite" : ""}`;
      toggle.textContent = "★";
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();

      if (state.editingChannels) {
        if (state.hiddenChannels.has(channel.id)) state.hiddenChannels.delete(channel.id);
        else state.hiddenChannels.add(channel.id);
        persistSet("hiddenChannels", state.hiddenChannels);
      } else {
        if (state.favoriteChannels.has(channel.id)) state.favoriteChannels.delete(channel.id);
        else state.favoriteChannels.add(channel.id);
        persistSet("favoriteChannels", state.favoriteChannels);
      }

      renderChannels();
    });

    const icon = document.createElement("span");
    icon.className = "channel-icon";
    icon.textContent = initials(channel.name);

    const copy = document.createElement("span");
    copy.className = "channel-copy";

    const name = document.createElement("strong");
    name.textContent = channel.name;

    const meta = document.createElement("small");
    meta.textContent =
      `${channel.number ? `Channel ${channel.number}` : "Live"}${channel.hd ? " · HD" : ""}`;

    copy.append(name, meta);

    const play = document.createElement("span");
    play.className = "channel-play";
    play.textContent = "Play";

    button.append(toggle, icon, copy, play);

    button.addEventListener("click", () => {
      if (!state.editingChannels) playLive(channel);
    });

    return button;
  });

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "list-note";
    empty.textContent =
      state.category === "favorites"
        ? "No favorite channels yet. Tap ★ beside a channel to add it."
        : "No channels found.";
    rows.push(empty);
  } else if (filtered.length > 400) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = "Showing the first 400 matches. Search to narrow the list.";
    rows.push(note);
  }

  elements.channels.replaceChildren(...rows);

  /* v1.4: selecting a channel must not jump list back to top. */
  requestAnimationFrame(() => {
    elements.channels.scrollTop = scrollTop;
  });
}

async function loadCatalog() {
  elements.setup.hidden = true;
  elements.topbar.hidden = false;
  elements.modebar.hidden = false;
  elements.workspace.hidden = false;

  setMode("live");
  setStatus("Connecting");
  showNotice("");

  elements.channels.innerHTML = '<p class="list-note">Loading portal catalogue...</p>';

  try {
    state.catalog = await request("/api/catalog");
    setStatus("Portal connected", true);

    if (
      state.category !== "all" &&
      state.category !== "favorites" &&
      !categoryById(state.category)
    ) {
      state.category = "all";
    }

    renderCategories();
    renderChannels();
    setMode("dashboard");
  } catch (error) {
    setStatus("Connection failed");
    showNotice(error.message);
  }
}

/* =====================================================
   LIVE PLAYBACK
===================================================== */

function resetLivePlayer() {
  stopLivePlayback(false);
  elements.progressBar.style.width = "100%";
  elements.timeDisplay.textContent = "LIVE";
}

function livePlaybackFailed(message) {
  elements.videoLoading.hidden = true;
  showNotice(message);
}

function attachLiveHls(stream, token) {
  const hls = new window.Hls({
    enableWorker: false,
    lowLatencyMode: false,
    backBufferLength: 60,
    maxBufferLength: 90,
    maxMaxBufferLength: 180,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 8,
    levelLoadingMaxRetry: 8,
    fragLoadingMaxRetry: 12,
    fragLoadingRetryDelay: 750,
    fragLoadingMaxRetryTimeout: 16000,
  });

  state.hls = hls;

  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let freshLinkRecoveries = 0;

  const freshLink = () => {
    if (token !== state.liveRetryToken || !state.selected) return;
    if (state.liveRecoveryInFlight) return;
    state.liveRecoveryInFlight = true;

    if (freshLinkRecoveries >= 4) {
      livePlaybackFailed(
        "Playback stopped because the stream could not recover. Select the channel again or try another channel."
      );
      return;
    }

    freshLinkRecoveries += 1;
    const selectedId = state.selected.id;

    try { hls.destroy(); } catch {}
    if (state.hls === hls) state.hls = null;

    setTimeout(() => {
      if (state.selected?.id === selectedId && token === state.liveRetryToken) {
        state.liveRecoveryInFlight = false;
        playSelectedLive(true);
      } else {
        state.liveRecoveryInFlight = false;
      }
    }, 700);
  };

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.liveRetryToken) return;
    recordClientDiagnostic("client.live_manifest_parsed", {
      channelId: state.selected?.id || "",
      title: state.selected?.name || "",
    });
    elements.videoLoading.hidden = true;
    elements.customControls.hidden = false;
    elements.video.play().catch(() => {});
  });

  hls.on(window.Hls.Events.FRAG_LOADED, () => {
    networkRecoveries = 0;
    state.liveLastFragmentAt = Date.now();
    state.liveRecoveryInFlight = false;
    recordClientDiagnostic("client.live_fragment_loaded", {
      channelId: state.selected?.id || "",
    });
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.liveRetryToken) return;

    recordClientDiagnostic("client.live_hls_error", {
      channelId: state.selected?.id || "",
      ...hlsDiagnosticDetails(data),
    });

    const isResetError = /levelParsingError|mediaSourceRequiresReset/i.test(String(data.details || data.reason || ""));
    if (!data.fatal && !isResetError) return;

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < 4) {
        networkRecoveries += 1;
        setTimeout(() => {
          if (token !== state.liveRetryToken) return;
          try { hls.startLoad(-1); } catch { freshLink(); }
        }, Math.min(600 * networkRecoveries, 2400));
        return;
      }

      /* Important for short-lived IPTV create_link URLs. */
      freshLink();
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      if (mediaRecoveries < 2) {
        mediaRecoveries += 1;
        try {
          if (mediaRecoveries === 2 && typeof hls.swapAudioCodec === "function") {
            hls.swapAudioCodec();
          }
          hls.recoverMediaError();
          return;
        } catch {}
      }

      freshLink();
      return;
    }

    freshLink();
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.video);
  state.liveLastFragmentAt = Date.now();
  clearInterval(state.liveWatchdogTimer);
  state.liveWatchdogTimer = setInterval(() => {
    if (token !== state.liveRetryToken || !state.selected || elements.video.paused) return;
    if (Date.now() - state.liveLastFragmentAt > 15_000) freshLink();
  }, 5_000);
}

async function playSelectedLive(isRecovery = false) {
  if (!state.selected || state.selected.kind !== "live") return;

  const selected = state.selected;

  if (!isRecovery) {
    resetLivePlayer();
  } else {
    destroyHls("live");
    stopMedia(elements.video);
  }

  const token = ++state.liveRetryToken;

  elements.placeholder.hidden = true;
  elements.videoLoading.hidden = false;
  showNotice("");

  elements.controlTitle.textContent = selected.name;
  elements.controlEpg.textContent = "Live TV";
  elements.playerModeBadge.textContent = "LIVE";
  elements.nowPlaying.textContent = selected.name;

  try {
    const payload = await request("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: selected.id }),
    });

    if (token !== state.liveRetryToken || state.selected?.id !== selected.id) return;

    if (window.Hls?.isSupported()) {
      attachLiveHls(payload.stream, token);
      return;
    }

    if (elements.video.canPlayType("application/vnd.apple.mpegurl")) {
      elements.video.src = payload.stream;
      elements.video.addEventListener("loadedmetadata", () => {
        if (token !== state.liveRetryToken) return;
        elements.videoLoading.hidden = true;
        elements.customControls.hidden = false;
        elements.video.play().catch(() => {});
      }, { once: true });
      return;
    }

    throw new Error("This device does not support HLS playback.");
  } catch (error) {
    if (token === state.liveRetryToken) livePlaybackFailed(error.message);
  }
}

function playLive(channel) {
  const category = categoryById(channel.genreId);

  const start = () => {
    state.selected = { ...channel, kind: "live" };
    renderChannels();
    playSelectedLive(false);
  };

  if (category?.locked && !state.parentalUnlocked) {
    requestParentalUnlock(start);
    return;
  }

  start();
}

/* =====================================================
   LIVE CONTROLS
===================================================== */

let liveControlTimeout;

function revealLiveControls() {
  if (elements.customControls.hidden) return;
  elements.customControls.classList.add("active");
  clearTimeout(liveControlTimeout);
  liveControlTimeout = setTimeout(() => {
    if (!elements.video.paused) elements.customControls.classList.remove("active");
  }, 3000);
}

elements.playerContainer.addEventListener("mousemove", revealLiveControls);
elements.playerContainer.addEventListener("click", revealLiveControls);

elements.playPauseBtn.addEventListener("click", () => {
  if (elements.video.paused) elements.video.play().catch(() => {});
  else elements.video.pause();
});

elements.video.addEventListener("play", () => {
  elements.playPauseBtn.textContent = "Pause";
});

elements.video.addEventListener("pause", () => {
  elements.playPauseBtn.textContent = "Play";
  elements.customControls.classList.add("active");
});

elements.muteBtn.addEventListener("click", () => {
  elements.video.muted = !elements.video.muted;
  elements.muteBtn.textContent = elements.video.muted ? "Muted" : "Vol";
  elements.volumeSlider.value = elements.video.muted ? "0" : String(elements.video.volume);
});

elements.volumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.video.volume = volume;
  elements.video.muted = volume === 0;
  elements.muteBtn.textContent = volume === 0 ? "Muted" : "Vol";
});

elements.fullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.playerContainer);
});

/* =====================================================
   VOD CATEGORIES / GRID
===================================================== */

function renderVodCategories() {
  const scrollTop = elements.vodCategories.scrollTop;

  const rows = state.vod.categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `vod-category-button${state.vod.categoryId === category.id ? " active" : ""}`;

    const title = document.createElement("span");
    title.textContent = category.title;
    button.append(title);

    if (category.locked && !state.parentalUnlocked) {
      const lock = document.createElement("span");
      lock.className = "vod-lock";
      lock.textContent = "PIN";
      button.append(lock);
    }

    button.addEventListener("click", () => {
      const choose = () => selectVodCategory(category.id);

      if (category.locked && !state.parentalUnlocked) {
        requestParentalUnlock(choose);
        return;
      }

      choose();
    });

    return button;
  });

  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = "No VOD categories are available.";
    rows.push(note);
  }

  elements.vodCategories.replaceChildren(...rows);

  requestAnimationFrame(() => {
    elements.vodCategories.scrollTop = scrollTop;
  });
}

function setPoster(element, item) {
  element.textContent = initials(item.title);
  element.style.backgroundImage = "";

  const url = String(item.poster || "").trim();
  if (!url) return;

  const image = new Image();

  image.onload = () => {
    element.textContent = "";
    element.style.backgroundImage =
      `linear-gradient(0deg, rgba(2,5,9,.62), transparent 60%), url("${url.replace(/"/g, "%22")}")`;
  };

  image.onerror = () => {
    element.style.backgroundImage = "";
    element.textContent = initials(item.title);
  };

  image.src = url;
}

function filteredVodItems() {
  const query = state.vod.query.trim().toLowerCase();
  if (!query) return state.vod.items;

  return state.vod.items.filter((item) =>
    [item.title, item.description, item.year, item.rating]
      .filter(Boolean).join(" ").toLowerCase().includes(query)
  );
}

function renderVodGrid() {
  const items = filteredVodItems();

  const cards = items.map((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "vod-movie-card";

    const poster = document.createElement("span");
    poster.className = "vod-movie-poster";
    setPoster(poster, item);

    const play = document.createElement("span");
    play.className = "vod-card-play";
    play.textContent = "Play";

    const title = document.createElement("strong");
    title.textContent = item.title;

    const meta = document.createElement("small");
    meta.textContent =
      [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand";

    card.append(poster, play, title, meta);
    card.addEventListener("click", () => openVodModal(item));
    return card;
  });

  if (!cards.length) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = state.vod.query
      ? "No loaded titles match your search."
      : "No titles were returned for this category.";
    cards.push(note);
  }

  elements.vodGrid.replaceChildren(...cards);

  const category = vodCategoryById(state.vod.categoryId);
  elements.vodCategoryTitle.textContent = category?.title || "Movies & Series";

  elements.vodCategoryMeta.textContent =
    state.vod.total > 0
      ? `${state.vod.items.length.toLocaleString()} loaded · ${state.vod.total.toLocaleString()} available`
      : `${state.vod.items.length.toLocaleString()} titles loaded`;
}

async function loadVodCategories() {
  elements.vodCategories.innerHTML = '<p class="list-note">Loading categories...</p>';

  try {
    const response = await request("/api/vod/categories");
    state.vod.categories = Array.isArray(response.categories) ? response.categories : [];
    renderVodCategories();

    const firstUnlocked =
      state.vod.categories.find((category) => !category.locked) ||
      state.vod.categories[0];

    if (firstUnlocked && !state.vod.categoryId) {
      if (firstUnlocked.locked && !state.parentalUnlocked) {
        elements.vodCategoryTitle.textContent = "Movies & Series";
        elements.vodCategoryMeta.textContent = "Choose a category from the left.";
      } else {
        selectVodCategory(firstUnlocked.id);
      }
    }
  } catch (error) {
    elements.vodCategories.textContent = error.message;
  }
}

async function selectVodCategory(categoryId) {
  const category = vodCategoryById(categoryId);
  if (!category) return;

  if (category.locked && !state.parentalUnlocked) {
    requestParentalUnlock(() => selectVodCategory(categoryId));
    return;
  }

  state.vod.loadToken += 1;
  state.vod.categoryId = categoryId;
  state.vod.page = 0;
  state.vod.total = 0;
  state.vod.items = [];
  state.vod.itemIds = new Set();
  state.vod.ended = false;
  state.vod.loading = false;
  state.vod.query = elements.vodSearch.value.trim();

  elements.vodEndMessage.hidden = true;
  elements.vodGrid.innerHTML = '<p class="list-note">Loading titles...</p>';

  renderVodCategories();
  await loadNextVodPage(true);
}

async function loadNextVodPage(reset = false) {
  if (state.vod.loading || state.vod.ended || !state.vod.categoryId) return;

  const category = vodCategoryById(state.vod.categoryId);
  if (!category || (category.locked && !state.parentalUnlocked)) return;

  const token = state.vod.loadToken;
  const page = reset ? 0 : state.vod.page;

  state.vod.loading = true;
  elements.vodLoadSpinner.hidden = false;
  elements.vodEndMessage.hidden = true;

  try {
    const result = await request(
      `/api/vod/items?categoryId=${encodeURIComponent(state.vod.categoryId)}&page=${page}`
    );

    if (token !== state.vod.loadToken) return;

    const incoming = Array.isArray(result.items) ? result.items : [];
    let added = 0;

    for (const rawItem of incoming) {
      if (!rawItem?.id || state.vod.itemIds.has(rawItem.id)) continue;

      state.vod.itemIds.add(rawItem.id);
      state.vod.items.push({
        ...rawItem,
        kind: rawItem.kind || "vod",
        categoryId: state.vod.categoryId,
      });
      added += 1;
    }

    state.vod.total = Number(result.total) || state.vod.items.length;
    state.vod.page = page + 1;

    if (
      incoming.length === 0 ||
      added === 0 ||
      (state.vod.total > 0 && state.vod.items.length >= state.vod.total)
    ) {
      state.vod.ended = true;
    }

    renderVodGrid();
  } catch (error) {
    if (token === state.vod.loadToken) {
      if (!state.vod.items.length) elements.vodGrid.textContent = error.message;
      state.vod.ended = true;
    }
  } finally {
    if (token === state.vod.loadToken) {
      state.vod.loading = false;
      elements.vodLoadSpinner.hidden = true;
      elements.vodEndMessage.hidden = !state.vod.ended;
    }
  }
}

const vodObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadNextVodPage(false);
  },
  { root: null, rootMargin: "500px 0px", threshold: 0.01 }
);

vodObserver.observe(elements.vodLoadMore);

/* =====================================================
   VOD MODAL / PLAYBACK
===================================================== */

function openVodModal(item) {
  state.vod.selected = item;
  state.watchMeta[item.id] = { ...item, mediaType: "vod" };
  saveWatchHistory();

  elements.vodModalTitle.textContent = item.title;
  elements.vodModalMeta.textContent =
    [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand";
  elements.vodModalDescription.textContent =
    item.description || "No description is available for this title.";

  setPoster(elements.vodModalPoster, item);

  const savedTime = Number(state.watchHistory[item.id]) || 0;

  if (savedTime > 30) {
    elements.vodResumeButton.hidden = false;
      elements.vodResumeButton.textContent = `Resume from ${formatTime(savedTime)}`;
  } else {
    elements.vodResumeButton.hidden = true;
  }

  elements.vodFavoriteButton.textContent = state.favoriteMedia.has(item.id) ? "Remove favourite" : "Add to favourites";

  elements.vodModal.hidden = false;
}

function closeVodModal() {
  elements.vodModal.hidden = true;
}

elements.vodClose.addEventListener("click", closeVodModal);

elements.vodModal.addEventListener("click", (event) => {
  if (event.target === elements.vodModal) closeVodModal();
});

elements.vodPlayButton.addEventListener("click", () => {
  if (!state.vod.selected) return;
  const item = state.vod.selected;
  closeVodModal();
  playVod(item, 0);
});

elements.vodResumeButton.addEventListener("click", () => {
  if (!state.vod.selected) return;
  const item = state.vod.selected;
  const resume = Number(state.watchHistory[item.id]) || 0;
  closeVodModal();
  playVod(item, resume);
});

elements.vodFavoriteButton.addEventListener("click", () => {
  const item = state.vod.selected;
  if (!item) return;
  if (state.favoriteMedia.has(item.id)) state.favoriteMedia.delete(item.id);
  else state.favoriteMedia.add(item.id);
  persistSet("favoriteMedia", state.favoriteMedia);
  elements.vodFavoriteButton.textContent = state.favoriteMedia.has(item.id) ? "Remove favourite" : "Add to favourites";
});

function resetVodPlayer() {
  stopVodPlayback();
  elements.vodProgressBar.style.width = "0%";
  elements.vodTimeDisplay.textContent = "0:00 / 0:00";
}

function attachVodHls(stream, item, resumeFrom, token) {
  const hls = new window.Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 60,
    maxBufferLength: 90,
    maxMaxBufferLength: 180,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 8,
    levelLoadingMaxRetry: 8,
    fragLoadingMaxRetry: 12,
  });

  state.vod.hls = hls;

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.vod.retryToken) return;

    recordClientDiagnostic("client.vod_manifest_parsed", {
      itemId: item.id,
      title: item.title,
    });

    elements.vodVideoLoading.hidden = true;
    elements.vodPlayerControls.hidden = false;

    const seek = () => {
      if (
        resumeFrom > 0 &&
        Number.isFinite(elements.vodVideo.duration) &&
        resumeFrom < elements.vodVideo.duration - 2
      ) {
        elements.vodVideo.currentTime = resumeFrom;
      }
    };

    if (elements.vodVideo.readyState >= 1) seek();
    else elements.vodVideo.addEventListener("loadedmetadata", seek, { once: true });

    elements.vodVideo.play().catch(() => {});
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.vod.retryToken) return;

    recordClientDiagnostic("client.vod_hls_error", {
      itemId: item.id,
      title: item.title,
      ...hlsDiagnosticDetails(data),
    });

    if (!data.fatal) return;

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      try { hls.startLoad(-1); } catch {}
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      try { hls.recoverMediaError(); } catch {}
      return;
    }

    showNotice("Movie playback stopped because the stream could not recover.");
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.vodVideo);
}

async function playVod(item, resumeFrom = 0) {
  if (!item) return;

  const category = vodCategoryById(item.categoryId);

  if (category?.locked && !state.parentalUnlocked) {
    requestParentalUnlock(() => playVod(item, resumeFrom));
    return;
  }

  resetVodPlayer();
  state.vod.selected = item;

  const token = ++state.vod.retryToken;

  elements.vodPlayerSection.hidden = false;
  elements.vodVideoLoading.hidden = false;
  elements.vodPlayerControls.hidden = true;
  elements.vodControlTitle.textContent = item.title;

  showNotice("");

  try {
    const payload = await request("/api/vod/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: item.categoryId,
        itemId: item.id,
      }),
    });

    if (token !== state.vod.retryToken || state.vod.selected?.id !== item.id) return;

    /*
      Relay paths do not expose the original extension.
      Try HLS.js first only when server explicitly marks HLS.
      Otherwise native <video> handles MP4/TS/etc.
    */
    if (payload.hls === true && window.Hls?.isSupported()) {
      attachVodHls(payload.stream, item, resumeFrom, token);
      return;
    }

    elements.vodVideo.src = payload.stream;

    elements.vodVideo.addEventListener("loadedmetadata", () => {
      if (token !== state.vod.retryToken) return;

      if (
        resumeFrom > 0 &&
        Number.isFinite(elements.vodVideo.duration) &&
        resumeFrom < elements.vodVideo.duration - 2
      ) {
        elements.vodVideo.currentTime = resumeFrom;
      }

      elements.vodVideoLoading.hidden = true;
      elements.vodPlayerControls.hidden = false;
      elements.vodVideo.play().catch(() => {});
    }, { once: true });

  } catch (error) {
    if (token === state.vod.retryToken) {
      elements.vodVideoLoading.hidden = true;
      showNotice(`Movie could not play: ${error.message}`);
    }
  }
}

elements.closeVodPlayerButton.addEventListener("click", () => {
  const item = state.vod.selected;

  if (item && elements.vodVideo.currentTime > 0) {
    state.watchHistory[item.id] = elements.vodVideo.currentTime;
    saveWatchHistory();
  }

  resetVodPlayer();
  elements.vodPlayerSection.hidden = true;
});

let vodControlTimeout;

function revealVodControls() {
  if (elements.vodPlayerControls.hidden) return;

  elements.vodPlayerControls.classList.add("active");
  clearTimeout(vodControlTimeout);

  vodControlTimeout = setTimeout(() => {
    if (!elements.vodVideo.paused) {
      elements.vodPlayerControls.classList.remove("active");
    }
  }, 3000);
}

elements.vodPlayerContainer.addEventListener("mousemove", revealVodControls);
elements.vodPlayerContainer.addEventListener("click", revealVodControls);

elements.vodPlayPauseBtn.addEventListener("click", () => {
  if (elements.vodVideo.paused) elements.vodVideo.play().catch(() => {});
  else elements.vodVideo.pause();
});

elements.vodVideo.addEventListener("play", () => {
  elements.vodPlayPauseBtn.textContent = "Pause";
});

elements.vodVideo.addEventListener("pause", () => {
  elements.vodPlayPauseBtn.textContent = "Play";
  elements.vodPlayerControls.classList.add("active");
});

elements.vodMuteBtn.addEventListener("click", () => {
  elements.vodVideo.muted = !elements.vodVideo.muted;
  elements.vodMuteBtn.textContent = elements.vodVideo.muted ? "Muted" : "Vol";
  elements.vodVolumeSlider.value =
    elements.vodVideo.muted ? "0" : String(elements.vodVideo.volume);
});

elements.vodVolumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.vodVideo.volume = volume;
  elements.vodVideo.muted = volume === 0;
  elements.vodMuteBtn.textContent = volume === 0 ? "Muted" : "Vol";
});

elements.vodVideo.addEventListener("timeupdate", () => {
  const current = Number(elements.vodVideo.currentTime) || 0;
  const duration = Number(elements.vodVideo.duration) || 0;

  if (duration > 0 && Number.isFinite(duration)) {
    elements.vodProgressBar.style.width =
      `${Math.min(100, Math.max(0, current / duration * 100))}%`;
    elements.vodTimeDisplay.textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;
  } else {
    elements.vodTimeDisplay.textContent = formatTime(current);
  }

  const item = state.vod.selected;
  if (item && current > 0) {
    const rounded = Math.floor(current);
    if (!state.vod._lastSavedSecond || rounded - state.vod._lastSavedSecond >= 5) {
      state.vod._lastSavedSecond = rounded;
      state.watchHistory[item.id] = current;
      saveWatchHistory();
    }
  }
});

elements.vodVideo.addEventListener("ended", () => {
  const item = state.vod.selected;
  if (!item) return;
  delete state.watchHistory[item.id];
  saveWatchHistory();
});

elements.vodProgressContainer.addEventListener("click", (event) => {
  const duration = elements.vodVideo.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const rect = elements.vodProgressContainer.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  elements.vodVideo.currentTime = ratio * duration;
});

elements.vodFullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.vodPlayerContainer);
});

/* =====================================================
   SERIES + DASHBOARD + FAVOURITES
===================================================== */

function seriesCategoryById(id) { return state.series.categories.find((category) => category.id === id); }

function renderSeriesCategories() {
  if (!elements.seriesCategories) return;
  const rows = state.series.categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vod-category-button${state.series.categoryId === category.id ? " active" : ""}`;
    const title = document.createElement("span");
    title.textContent = category.title;
    button.append(title);
    if (category.locked && !state.parentalUnlocked) {
      const lock = document.createElement("span"); lock.className = "vod-lock"; lock.textContent = "LOCK"; button.append(lock);
    }
    button.addEventListener("click", () => {
      const choose = () => selectSeriesCategory(category.id);
      if (category.locked && !state.parentalUnlocked) requestParentalUnlock(choose); else choose();
    });
    return button;
  });
  if (!rows.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = "No series categories are available."; rows.push(note); }
  elements.seriesCategories.replaceChildren(...rows);
}

function renderSeriesGrid() {
  const query = state.series.query.trim().toLowerCase();
  const items = state.series.items.filter((item) => !query || [item.title, item.description, item.year, item.rating].filter(Boolean).join(" ").toLowerCase().includes(query));
  const cards = items.map((item) => {
    const card = document.createElement("button"); card.type = "button"; card.className = "series-card";
    const poster = document.createElement("span"); poster.className = "series-poster"; setPoster(poster, item);
    const play = document.createElement("span"); play.className = "series-card-play"; play.textContent = "PLAY";
    const title = document.createElement("strong"); title.textContent = item.title;
    const meta = document.createElement("small"); meta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "Series";
    card.append(poster, play, title, meta);
    card.addEventListener("click", () => openSeriesModal(item));
    return card;
  });
  if (!cards.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = query ? "No loaded series match your search." : "No series were returned for this category."; cards.push(note); }
  elements.seriesGrid.replaceChildren(...cards);
  const category = seriesCategoryById(state.series.categoryId);
  elements.seriesCategoryTitle.textContent = category?.title || "Series";
  elements.seriesCategoryMeta.textContent = `${state.series.items.length.toLocaleString()} series loaded`;
}

async function loadSeriesCategories() {
  if (!elements.seriesCategories) return;
  elements.seriesCategories.innerHTML = '<p class="list-note">Loading series categories...</p>';
  try {
    const result = await request("/api/series/categories");
    state.series.categories = Array.isArray(result.categories) ? result.categories : [];
    renderSeriesCategories();
    const first = state.series.categories.find((category) => !category.locked) || state.series.categories[0];
    if (first && !state.series.categoryId) selectSeriesCategory(first.id);
  } catch (error) { elements.seriesCategories.textContent = error.message; }
}

async function selectSeriesCategory(categoryId) {
  const category = seriesCategoryById(categoryId); if (!category) return;
  if (category.locked && !state.parentalUnlocked) { requestParentalUnlock(() => selectSeriesCategory(categoryId)); return; }
  state.series.categoryId = categoryId; state.series.page = 0; state.series.items = []; state.series.itemIds = new Set(); state.series.ended = false; state.series.loadToken += 1; state.series.query = elements.seriesSearch.value.trim();
  elements.seriesGrid.innerHTML = '<p class="list-note">Loading series...</p>'; renderSeriesCategories();
  await loadNextSeriesPage(true);
}

async function loadNextSeriesPage(reset = false) {
  if (state.series.loading || state.series.ended || !state.series.categoryId) return;
  const token = state.series.loadToken; const page = reset ? 0 : state.series.page; state.series.loading = true;
  if (elements.seriesLoadSpinner) elements.seriesLoadSpinner.hidden = false;
  try {
    const result = await request(`/api/series/items?categoryId=${encodeURIComponent(state.series.categoryId)}&page=${page}`);
    if (token !== state.series.loadToken) return;
    const incoming = Array.isArray(result.items) ? result.items : []; let added = 0;
    for (const raw of incoming) { if (!raw?.id || state.series.itemIds.has(raw.id)) continue; state.series.itemIds.add(raw.id); state.series.items.push({ ...raw, kind: "series", categoryId: state.series.categoryId }); added += 1; }
    state.series.total = Number(result.total) || state.series.items.length; state.series.page = page + 1;
    if (!incoming.length || !added || (state.series.total && state.series.items.length >= state.series.total)) state.series.ended = true;
    renderSeriesGrid();
  } catch (error) { if (token === state.series.loadToken && !state.series.items.length) elements.seriesGrid.textContent = error.message; state.series.ended = true; }
  finally { if (token === state.series.loadToken) { state.series.loading = false; if (elements.seriesLoadSpinner) elements.seriesLoadSpinner.hidden = true; if (elements.seriesEndMessage) elements.seriesEndMessage.hidden = !state.series.ended; } }
}

function openSeriesModal(item) {
  state.series.selected = item; state.watchMeta[item.id] = { ...item, mediaType: "series" }; saveWatchHistory();
  elements.seriesFavoriteButton.textContent = state.favoriteMedia.has(item.id) ? "Remove favourite" : "Add to favourites";
  elements.seriesModalTitle.textContent = item.title; elements.seriesModalMeta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "Series";
  elements.seriesModalDescription.textContent = item.description || "No description is available for this series."; setPoster(elements.seriesModalPoster, item);
  elements.seriesSeasonSelect.replaceChildren(new Option("Loading seasons...", "")); elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading seasons...</p>'; elements.seriesModal.hidden = false;
  request(`/api/series/seasons?seriesId=${encodeURIComponent(item.id)}`).then((result) => {
    const seasons = Array.isArray(result.seasons) ? result.seasons : [];
    elements.seriesSeasonSelect.replaceChildren(new Option("Select season", ""), ...seasons.map((season) => new Option(season.title || `Season ${season.number}`, String(season.number))));
    if (seasons[0]) { elements.seriesSeasonSelect.value = String(seasons[0].number); loadSeriesEpisodes(seasons[0].number); } else elements.seriesEpisodes.innerHTML = '<p class="list-note">No seasons were returned.</p>';
  }).catch((error) => { elements.seriesEpisodes.textContent = error.message; });
}

async function loadSeriesEpisodes(season) {
  if (!state.series.selected) return; elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading episodes...</p>';
  try {
    const result = await request(`/api/series/episodes?seriesId=${encodeURIComponent(state.series.selected.id)}&season=${encodeURIComponent(season)}`);
    const episodes = Array.isArray(result.episodes) ? result.episodes : [];
    const list = episodes.map((episode, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "series-episode-button"; button.textContent = `Episode ${episode.episode || index + 1} · ${episode.title}`; button.addEventListener("click", () => playSeriesEpisode(state.series.selected, season, episode)); return button; });
    if (!list.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = "No episodes were returned for this season."; list.push(note); }
    elements.seriesEpisodes.replaceChildren(...list);
  } catch (error) { elements.seriesEpisodes.textContent = error.message; }
}

async function playSeriesEpisode(series, season, episode) {
  if (!series || !episode) return;
  elements.seriesModal.hidden = true; elements.seriesPlayerSection.hidden = false; elements.seriesVideoLoading.hidden = false; state.watchMeta[series.id] = { ...series, mediaType: "series", episodeTitle: episode.title, season, episode: episode.episode }; saveWatchHistory();
  if (state.series.hls) { try { state.series.hls.destroy(); } catch {} state.series.hls = null; }
  stopMedia(elements.seriesVideo);
  try {
    const payload = await request("/api/series/play", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seriesId: series.id, season, episodeId: episode.id }) });
    if (payload.hls === true && window.Hls?.isSupported()) {
      const hls = new window.Hls({ enableWorker: false, lowLatencyMode: false });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        recordClientDiagnostic("client.series_manifest_parsed", { seriesId: series.id, season, episodeId: episode.id });
        elements.seriesVideoLoading.hidden = true;
        elements.seriesVideo.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        recordClientDiagnostic("client.series_hls_error", {
          seriesId: series.id,
          season,
          episodeId: episode.id,
          ...hlsDiagnosticDetails(data),
        });
      });
      hls.loadSource(payload.stream);
      hls.attachMedia(elements.seriesVideo);
      state.series.hls = hls;
    }
    else { elements.seriesVideo.src = payload.stream; elements.seriesVideo.addEventListener("loadedmetadata", () => { elements.seriesVideoLoading.hidden = true; elements.seriesVideo.play().catch(() => {}); }, { once: true }); }
  } catch (error) { elements.seriesVideoLoading.hidden = true; showNotice(`Episode could not play: ${error.message}`); }
}

function renderDashboard() {
  if (!elements.continueWatching) return;
  const entries = Object.entries(state.watchHistory).filter(([, time]) => Number(time) > 0).map(([id, time]) => ({ ...(state.watchMeta[id] || { id, title: "Saved title" }), time: Number(time) })).slice(0, 12);
  const cards = entries.map((entry) => { const card = document.createElement("button"); card.type = "button"; card.className = "dashboard-card"; card.textContent = `${entry.title} · Resume ${formatTime(entry.time)}`; card.addEventListener("click", () => { setContentType(entry.mediaType === "series" ? "series" : "vod"); }); return card; });
  if (!cards.length) { const note = document.createElement("div"); note.className = "dashboard-empty"; note.textContent = "Your in-progress movies and episodes will appear here."; cards.push(note); }
  elements.continueWatching.replaceChildren(...cards);
}

function renderFavorites() {
  if (!state.catalog) return;
  const channels = state.catalog.channels.filter((channel) => state.favoriteChannels.has(channel.id));
  const channelNodes = channels.map((channel) => { const button = document.createElement("button"); button.type = "button"; button.className = "favorite-channel-card"; button.textContent = channel.name; button.addEventListener("click", () => { setMode("live"); playLive(channel); }); return button; });
  if (!channelNodes.length) { const note = document.createElement("div"); note.className = "dashboard-empty"; note.textContent = "No favourite channels yet."; channelNodes.push(note); }
  elements.favoriteChannelsGrid.replaceChildren(...channelNodes);
  const media = Object.values(state.watchMeta).filter((item) => state.favoriteMedia.has(item.id));
  const mediaNodes = media.map((item) => { const button = document.createElement("button"); button.type = "button"; button.className = "dashboard-card"; button.textContent = item.title; button.addEventListener("click", () => setContentType(item.mediaType === "series" ? "series" : "vod")); return button; });
  if (!mediaNodes.length) { const note = document.createElement("div"); note.className = "dashboard-empty"; note.textContent = "No favourite movies or series yet."; mediaNodes.push(note); }
  elements.favoriteMediaGrid.replaceChildren(...mediaNodes);
}

elements.seriesSeasonSelect?.addEventListener("change", (event) => { if (event.target.value) loadSeriesEpisodes(event.target.value); });
elements.seriesClose?.addEventListener("click", () => { elements.seriesModal.hidden = true; });
elements.seriesFavoriteButton?.addEventListener("click", () => { const item = state.series.selected; if (!item) return; if (state.favoriteMedia.has(item.id)) state.favoriteMedia.delete(item.id); else state.favoriteMedia.add(item.id); persistSet("favoriteMedia", state.favoriteMedia); elements.seriesFavoriteButton.textContent = state.favoriteMedia.has(item.id) ? "Remove favourite" : "Add to favourites"; });
elements.seriesModal?.addEventListener("click", (event) => { if (event.target === elements.seriesModal) elements.seriesModal.hidden = true; });
elements.closeSeriesPlayerButton?.addEventListener("click", () => { if (state.series.hls) { try { state.series.hls.destroy(); } catch {} state.series.hls = null; } stopMedia(elements.seriesVideo); elements.seriesPlayerSection.hidden = true; });
document.querySelectorAll(".content-type-button").forEach((button) => button.addEventListener("click", () => setContentType(button.dataset.contentType)));
elements.seriesSearch?.addEventListener("input", () => { state.series.query = elements.seriesSearch.value; renderSeriesGrid(); });
if (elements.seriesLoadMore) new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadNextSeriesPage(false); }, { rootMargin: "500px 0px" }).observe(elements.seriesLoadMore);

/* =====================================================
   FULLSCREEN / SEARCH / EDIT
===================================================== */

async function toggleFullscreen(container) {
  try {
    if (!document.fullscreenElement) await container.requestFullscreen();
    else await document.exitFullscreen();
  } catch {}
}

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  renderChannels();
});

elements.vodSearch.addEventListener("input", () => {
  state.vod.query = elements.vodSearch.value;
  renderVodGrid();
});

elements.editGroupsButton.addEventListener("click", () => {
  state.editingGroups = !state.editingGroups;
  elements.editGroupsButton.classList.toggle("active", state.editingGroups);
  elements.editGroupsButton.textContent = state.editingGroups ? "Done" : "Show / edit";
  renderCategories();
});

elements.editChannelsButton.addEventListener("click", () => {
  state.editingChannels = !state.editingChannels;
  elements.editChannelsButton.classList.toggle("active", state.editingChannels);
  elements.editChannelsButton.textContent = state.editingChannels ? "Done" : "Show / edit";
  renderChannels();
});

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

/* =====================================================
   SETTINGS
===================================================== */

elements.settingsButton.addEventListener("click", () => {
  elements.settingsModal.hidden = false;
});

elements.closeSettingsButton.addEventListener("click", () => {
  elements.settingsModal.hidden = true;
  elements.pinNotice.hidden = true;
  elements.newParentalPin.value = "";
});

elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) elements.settingsModal.hidden = true;
});

elements.themeSelect.addEventListener("change", (event) => {
  state.theme = event.target.value;
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

elements.updatePinButton.addEventListener("click", async () => {
  const newPin = elements.newParentalPin.value.trim();

  if (!/^\d{4}$/.test(newPin)) {
    elements.pinNotice.textContent = "PIN must be exactly 4 digits.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
    return;
  }

  elements.updatePinButton.disabled = true;
  elements.updatePinButton.textContent = "Updating...";

  try {
    const serviceId =
      elements.serviceId.value ||
      localStorage.getItem("netplusServiceId") ||
      "";

    const mac =
      formatMacValue(elements.mac.value || localStorage.getItem("netplusMac") || "");

    if (!serviceId || !mac) {
      throw new Error("Reconfigure the portal once before changing the PIN.");
    }

    await request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId, mac, parentalPin: newPin }),
    });

    state.parentalUnlocked = false;
    elements.pinNotice.textContent = "PIN updated successfully.";
    elements.pinNotice.style.color = "#35dbc5";
    elements.pinNotice.hidden = false;
    elements.newParentalPin.value = "";
  } catch (error) {
    elements.pinNotice.textContent = error.message || "Failed to update PIN.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
  } finally {
    elements.updatePinButton.disabled = false;
    elements.updatePinButton.textContent = "Update PIN";
  }
});

elements.resetDiagnosticButton?.addEventListener("click", async () => {
  elements.resetDiagnosticButton.disabled = true;
  elements.resetDiagnosticButton.textContent = "Starting...";

  try {
    await request("/api/diagnostics/reset", { method: "POST" });
    elements.diagnosticNotice.textContent = "Fresh test started. Now play 1 live channel for 45 seconds, 1 movie, then open 1 series.";
    elements.diagnosticNotice.style.color = "#35dbc5";
    elements.diagnosticNotice.hidden = false;
  } catch (error) {
    elements.diagnosticNotice.textContent = error.message || "Could not reset the diagnostic report.";
    elements.diagnosticNotice.style.color = "#ff9292";
    elements.diagnosticNotice.hidden = false;
  } finally {
    elements.resetDiagnosticButton.disabled = false;
    elements.resetDiagnosticButton.textContent = "Start fresh test";
  }
});

elements.downloadDiagnosticButton?.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = `/api/diagnostics/download?ts=${Date.now()}`;
  link.download = "netplus-diagnostics-v1.4.1.json";
  document.body.append(link);
  link.click();
  link.remove();

  elements.diagnosticNotice.textContent = "Report download started. Send the netplus-diagnostics-v1.4.1.json file here.";
  elements.diagnosticNotice.style.color = "#35dbc5";
  elements.diagnosticNotice.hidden = false;
});

elements.resetPortalButton.addEventListener("click", () => {
  if (!window.confirm("Return to setup so you can change the service or MAC address?")) return;

  elements.settingsModal.hidden = true;
  elements.serviceId.value = localStorage.getItem("netplusServiceId") || "";
  elements.mac.value = formatMacValue(localStorage.getItem("netplusMac") || "");
  elements.parentalPin.value = "";
  showSetup();
});

/* =====================================================
   SETUP
===================================================== */

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const serviceId = elements.serviceId.value.trim();
  const mac = formatMacValue(elements.mac.value);
  const parentalPin = elements.parentalPin.value.trim();

  if (!serviceId) {
    elements.setupError.textContent = "Choose a NetPlus service.";
    elements.setupError.hidden = false;
    return;
  }

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    elements.setupError.textContent =
      "Enter all 12 MAC digits. Colons are added automatically.";
    elements.setupError.hidden = false;
    elements.mac.focus();
    return;
  }

  if (!/^\d{4}$/.test(parentalPin)) {
    elements.setupError.textContent = "Set a 4-digit parental PIN.";
    elements.setupError.hidden = false;
    elements.parentalPin.focus();
    return;
  }

  elements.mac.value = mac;
  elements.setupError.hidden = true;
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Saving...";

  try {
    await request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId, mac, parentalPin }),
    });

    localStorage.setItem("netplusServiceId", serviceId);
    localStorage.setItem("netplusMac", mac);

    state.parentalUnlocked = false;
    elements.parentalPin.value = "";

    await loadCatalog();
  } catch (error) {
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Save & Connect";
  }
});

/* =====================================================
   KEYBOARD
===================================================== */

document.addEventListener("keydown", (event) => {
  const activeTag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;

  if (event.key === "Escape") {
    if (!elements.pinModal.hidden) return closePinModal(true);
    if (!elements.vodModal.hidden) return closeVodModal();
    if (!elements.settingsModal.hidden) {
      elements.settingsModal.hidden = true;
      return;
    }
  }

  const vodPlaying = !elements.vodPlayerSection.hidden && !!state.vod.selected;

  if (vodPlaying) {
    switch (event.key.toLowerCase()) {
      case " ":
        event.preventDefault();
        elements.vodVideo.paused
          ? elements.vodVideo.play().catch(() => {})
          : elements.vodVideo.pause();
        return;
      case "f":
        event.preventDefault();
        toggleFullscreen(elements.vodPlayerContainer);
        return;
      case "m":
        event.preventDefault();
        elements.vodMuteBtn.click();
        return;
      case "arrowleft":
        event.preventDefault();
        elements.vodVideo.currentTime = Math.max(0, elements.vodVideo.currentTime - 10);
        return;
      case "arrowright":
        event.preventDefault();
        if (Number.isFinite(elements.vodVideo.duration)) {
          elements.vodVideo.currentTime =
            Math.min(elements.vodVideo.duration, elements.vodVideo.currentTime + 10);
        }
        return;
    }
  }

  if (!state.selected || state.selected.kind !== "live") return;

  switch (event.key.toLowerCase()) {
    case " ":
      event.preventDefault();
      elements.video.paused
        ? elements.video.play().catch(() => {})
        : elements.video.pause();
      break;
    case "f":
      event.preventDefault();
      toggleFullscreen(elements.playerContainer);
      break;
    case "m":
      event.preventDefault();
      elements.muteBtn.click();
      break;
    case "arrowup":
    case "arrowdown": {
      event.preventDefault();
      const channels = filteredChannels();
      const index = channels.findIndex((channel) => channel.id === state.selected.id);
      if (index < 0 || !channels.length) return;

      let nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (nextIndex < 0) nextIndex = channels.length - 1;
      if (nextIndex >= channels.length) nextIndex = 0;

      playLive(channels[nextIndex]);
      break;
    }
  }
});

/* =====================================================
   BOOT
===================================================== */

async function boot() {
  applyTheme();

  elements.mac.value =
    formatMacValue(localStorage.getItem("netplusMac") || elements.mac.value || "");

  elements.serviceId.value =
    localStorage.getItem("netplusServiceId") || "";

  try {
    const result = await request("/api/config");

    if (result.configured) {
      await loadCatalog();
    } else {
      showSetup();
    }
  } catch (error) {
    showSetup();
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  }
}

boot();
