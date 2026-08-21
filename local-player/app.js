/*
=========================================================
 NetPlus IPTV Player
 VERSION: 1.2.0
 File: app.js
=========================================================
*/

const APP_VERSION = "1.2.0";

const state = {
  catalog: null,
  category: "all",
  query: "",
  selected: null,
  hls: null,
  liveRetryToken: 0,

  parentalUnlocked: false,
  pendingUnlockAction: null,

  hiddenGroups: new Set(JSON.parse(localStorage.getItem("hiddenGroups") || "[]")),
  hiddenChannels: new Set(JSON.parse(localStorage.getItem("hiddenChannels") || "[]")),
  favoriteChannels: new Set(JSON.parse(localStorage.getItem("favoriteChannels") || "[]")),
  watchHistory: JSON.parse(localStorage.getItem("watchHistory") || "{}"),

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
  },
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
  resetPortalButton: $("#resetPortalButton"),
};


/* =====================================================
   HELPERS
===================================================== */

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }

  return payload;
}

function setStatus(text, online = false) {
  elements.status.querySelector("span").textContent = text;
  elements.status.classList.toggle("online", online);
}

function showNotice(message = "") {
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "TV";
}

function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function applyTheme() {
  document.body.className = `theme-${state.theme}`;
  elements.themeSelect.value = state.theme;
}

function persistSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function saveWatchHistory() {
  localStorage.setItem("watchHistory", JSON.stringify(state.watchHistory));
}

function categoryById(id) {
  return state.catalog?.categories?.find((category) => category.id === id);
}

function vodCategoryById(id) {
  return state.vod.categories.find((category) => category.id === id);
}

function stopMedia(video) {
  try {
    video.pause();
  } catch {
    // Ignore.
  }
  video.removeAttribute("src");
  video.load();
}

function destroyHls(key) {
  const hls = key === "live" ? state.hls : state.vod.hls;
  if (hls) {
    try {
      hls.destroy();
    } catch {
      // Ignore.
    }
  }

  if (key === "live") state.hls = null;
  else state.vod.hls = null;
}

function showSetup() {
  destroyHls("live");
  destroyHls("vod");
  stopMedia(elements.video);
  stopMedia(elements.vodVideo);

  elements.setup.hidden = false;
  elements.topbar.hidden = true;
  elements.modebar.hidden = true;
  elements.workspace.hidden = true;
  elements.vodWorkspace.hidden = true;
  elements.settingsModal.hidden = true;
  elements.vodModal.hidden = true;
  elements.pinModal.hidden = true;

  elements.setupError.hidden = true;
  setStatus("Setup required");
}

function setMode(mode) {
  const isVod = mode === "vod";

  elements.workspace.hidden = isVod;
  elements.vodWorkspace.hidden = !isVod;

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (isVod && !state.vod.categories.length) {
    loadVodCategories();
  }
}


/* =====================================================
   MAC INPUT
===================================================== */

const MAC_PREFIX = "00:1A:79";

function formatMacValue(raw) {
  let hex = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");

  // Keep the NetPlus MAG prefix fixed while still allowing
  // users to paste a complete MAC address.
  if (!hex.startsWith("001A79")) {
    const suffix = hex.slice(-6);
    hex = `001A79${suffix}`;
  }

  hex = hex.slice(0, 12);

  const groups = [];
  for (let i = 0; i < hex.length; i += 2) {
    groups.push(hex.slice(i, i + 2));
  }

  let value = groups.join(":");

  if (hex.length <= 6) {
    value = MAC_PREFIX + ":";
  }

  return value.slice(0, 17);
}

function keepMacCaretAtEnd() {
  requestAnimationFrame(() => {
    const end = elements.mac.value.length;
    try {
      elements.mac.setSelectionRange(end, end);
    } catch {
      // Some environments do not expose selection APIs.
    }
  });
}

elements.mac.addEventListener("focus", () => {
  if (!elements.mac.value || elements.mac.value.length < 9) {
    elements.mac.value = `${MAC_PREFIX}:`;
  }
  keepMacCaretAtEnd();
});

elements.mac.addEventListener("input", () => {
  elements.mac.value = formatMacValue(elements.mac.value);
  keepMacCaretAtEnd();
});

elements.mac.addEventListener("keydown", (event) => {
  const prefixLength = `${MAC_PREFIX}:`.length;

  if (
    (event.key === "Backspace" || event.key === "Delete") &&
    (elements.mac.selectionStart ?? prefixLength) <= prefixLength
  ) {
    event.preventDefault();
  }
});

elements.mac.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text");
  if (!text) return;

  event.preventDefault();
  elements.mac.value = formatMacValue(text);
  keepMacCaretAtEnd();
});


/* =====================================================
   PARENTAL UNLOCK
===================================================== */

function closePinModal(cancelPending = true) {
  elements.pinModal.hidden = true;
  elements.unlockPin.value = "";
  elements.unlockPinError.hidden = true;

  if (cancelPending) {
    state.pendingUnlockAction = null;
  }
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
  elements.unlockPinButton.textContent = "Unlockingâ¦";
  elements.unlockPinError.hidden = true;

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

    if (action) action();
  } catch (error) {
    elements.unlockPinError.textContent = error.message;
    elements.unlockPinError.hidden = false;
    elements.unlockPin.select();
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

  const visiblePortalCategories = state.catalog.categories.filter((category) => {
    return state.editingGroups || !state.hiddenGroups.has(category.id);
  });

  const categories = [
    { id: "favorites", title: "â­ Favorites", locked: false },
    { id: "all", title: "All channels", locked: false },
    ...visiblePortalCategories,
  ];

  elements.groupCount.textContent =
    `${visiblePortalCategories.length.toLocaleString()} groups`;

  const nodes = categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `category-button${state.category === category.id ? " active" : ""}`;

    if (state.hiddenGroups.has(category.id)) {
      button.classList.add("hidden-item");
    }

    const title = document.createElement("span");

    if (category.locked && !state.parentalUnlocked) {
      title.textContent = `ð ${category.title}`;
    } else {
      title.textContent = category.title;
    }

    if (
      state.editingGroups &&
      !["all", "favorites"].includes(category.id)
    ) {
      const visibility = document.createElement("span");
      visibility.className = "visibility-toggle";
      visibility.textContent =
        state.hiddenGroups.has(category.id) ? "â" : "ð";

      visibility.addEventListener("click", (event) => {
        event.stopPropagation();

        if (state.hiddenGroups.has(category.id)) {
          state.hiddenGroups.delete(category.id);
        } else {
          state.hiddenGroups.add(category.id);
        }

        persistSet("hiddenGroups", state.hiddenGroups);
        renderCategories();
      });

      button.append(visibility);
    }

    const arrow = document.createElement("em");
    arrow.textContent = "âº";

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
}

function filteredChannels() {
  if (!state.catalog) return [];

  const query = state.query.trim().toLowerCase();

  return state.catalog.channels.filter((channel) => {
    const category = categoryById(channel.genreId);

    // Adult/protected channels never become visible just because
    // "All channels" is selected. Unlocking is required first.
    if (category?.locked && !state.parentalUnlocked) return false;

    const inCategory =
      state.category === "favorites"
        ? state.favoriteChannels.has(channel.id)
        : state.category === "all" || channel.genreId === state.category;

    const matchesSearch =
      !query || channel.name.toLowerCase().includes(query);

    const visible =
      state.editingChannels || !state.hiddenChannels.has(channel.id);

    return inCategory && matchesSearch && visible;
  });
}

function renderChannels() {
  if (!state.catalog) return;

  const filtered = filteredChannels();

  elements.channelCount.textContent =
    `${filtered.length.toLocaleString()} channels`;

  const rows = filtered.slice(0, 400).map((channel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `channel-button${state.selected?.id === channel.id ? " active" : ""}`;

    if (state.hiddenChannels.has(channel.id)) {
      button.classList.add("hidden-item");
    }

    const toggle = document.createElement("span");

    if (state.editingChannels) {
      toggle.className = "visibility-toggle";
      toggle.textContent =
        state.hiddenChannels.has(channel.id) ? "â" : "ð";
    } else {
      toggle.className =
        `favorite-toggle${state.favoriteChannels.has(channel.id) ? " is-favorite" : ""}`;
      toggle.textContent = "â­";
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();

      if (state.editingChannels) {
        if (state.hiddenChannels.has(channel.id)) {
          state.hiddenChannels.delete(channel.id);
        } else {
          state.hiddenChannels.add(channel.id);
        }

        persistSet("hiddenChannels", state.hiddenChannels);
      } else {
        if (state.favoriteChannels.has(channel.id)) {
          state.favoriteChannels.delete(channel.id);
        } else {
          state.favoriteChannels.add(channel.id);
        }

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
      `${channel.number ? `Channel ${channel.number}` : "Live"}${channel.hd ? " Â· HD" : ""}`;

    copy.append(name, meta);

    const play = document.createElement("span");
    play.className = "channel-play";
    play.textContent = "â¶";

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
        ? "No favorite channels yet. Tap â­ beside a channel to add it."
        : "No channels found.";
    rows.push(empty);
  } else if (filtered.length > 400) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent =
      "Showing the first 400 matches. Search to narrow the list.";
    rows.push(note);
  }

  elements.channels.replaceChildren(...rows);
}

async function loadCatalog() {
  elements.setup.hidden = true;
  elements.topbar.hidden = false;
  elements.modebar.hidden = false;
  elements.workspace.hidden = false;

  setMode("live");
  setStatus("Connecting");
  showNotice("");

  elements.channels.innerHTML =
    '<p class="list-note">Loading portal catalogueâ¦</p>';

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
  } catch (error) {
    setStatus("Connection failed");
    showNotice(error.message);
  }
}


/* =====================================================
   LIVE PLAYBACK
===================================================== */

function resetLivePlayer() {
  state.liveRetryToken += 1;
  destroyHls("live");

  try {
    elements.video.pause();
  } catch {
    // Ignore.
  }

  elements.video.removeAttribute("src");
  elements.video.load();

  elements.videoLoading.hidden = true;
  elements.customControls.hidden = true;
  elements.progressBar.style.width = "100%";
  elements.timeDisplay.textContent = "LIVE";
}

function livePlaybackFailed(message) {
  elements.videoLoading.hidden = true;
  showNotice(message);
}

function attachLiveHls(stream, token) {
  const hls = new window.Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 12000,
  });

  state.hls = hls;

  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let sourceReloads = 0;
  let lastRecovery = 0;

  const reloadCurrentChannel = () => {
    if (token !== state.liveRetryToken || !state.selected) return;

    if (sourceReloads >= 2) {
      livePlaybackFailed(
        "Playback stopped because the stream could not recover. Select the channel again or try another channel."
      );
      return;
    }

    sourceReloads += 1;
    const selectedId = state.selected.id;

    try {
      hls.destroy();
    } catch {
      // Ignore.
    }

    state.hls = null;

    setTimeout(() => {
      if (
        token === state.liveRetryToken &&
        state.selected?.id === selectedId
      ) {
        playSelectedLive(true);
      }
    }, 1200);
  };

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.liveRetryToken) return;

    elements.videoLoading.hidden = true;
    elements.customControls.hidden = false;

    elements.video.play().catch(() => {
      // Browser may require a click before autoplay.
    });
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.liveRetryToken) return;

    // Ignore non-fatal HLS warnings. Many IPTV streams emit them
    // while continuing to play correctly.
    if (!data.fatal) return;

    const now = Date.now();

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < 5) {
        networkRecoveries += 1;

        setTimeout(() => {
          if (token !== state.liveRetryToken) return;

          try {
            hls.startLoad(-1);
          } catch {
            reloadCurrentChannel();
          }
        }, Math.min(1000 * networkRecoveries, 5000));

        return;
      }

      reloadCurrentChannel();
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      // Prevent recovery loops from firing repeatedly in a few ms.
      if (now - lastRecovery < 700) return;
      lastRecovery = now;

      if (mediaRecoveries === 0) {
        mediaRecoveries += 1;

        try {
          hls.recoverMediaError();
          return;
        } catch {
          reloadCurrentChannel();
          return;
        }
      }

      if (mediaRecoveries === 1) {
        mediaRecoveries += 1;

        try {
          // This is the important recovery path for streams that
          // trigger mediaSourceRequiresReset / codec transitions.
          hls.swapAudioCodec();
          hls.recoverMediaError();
          return;
        } catch {
          reloadCurrentChannel();
          return;
        }
      }

      reloadCurrentChannel();
      return;
    }

    if (
      data.details === window.Hls.ErrorDetails.LEVEL_PARSING_ERROR ||
      String(data.details || "").toLowerCase().includes("levelparsing")
    ) {
      reloadCurrentChannel();
      return;
    }

    reloadCurrentChannel();
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.video);
}

async function playSelectedLive(isRecovery = false) {
  if (!state.selected || state.selected.kind !== "live") return;

  const selected = state.selected;

  if (!isRecovery) {
    resetLivePlayer();
  } else {
    destroyHls("live");
    try {
      elements.video.pause();
    } catch {
      // Ignore.
    }
    elements.video.removeAttribute("src");
    elements.video.load();
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

    if (
      token !== state.liveRetryToken ||
      state.selected?.id !== selected.id
    ) {
      return;
    }

    if (window.Hls?.isSupported()) {
      attachLiveHls(payload.stream, token);
      return;
    }

    if (elements.video.canPlayType("application/vnd.apple.mpegurl")) {
      elements.video.src = payload.stream;

      elements.video.addEventListener(
        "loadedmetadata",
        () => {
          if (token !== state.liveRetryToken) return;
          elements.videoLoading.hidden = true;
          elements.customControls.hidden = false;
          elements.video.play().catch(() => {});
        },
        { once: true }
      );

      return;
    }

    throw new Error("This device does not support HLS playback.");
  } catch (error) {
    if (token === state.liveRetryToken) {
      livePlaybackFailed(error.message);
    }
  }
}

function playLive(channel) {
  const category = categoryById(channel.genreId);

  const start = () => {
    state.selected = {
      ...channel,
      kind: "live",
    };

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
   LIVE PLAYER CONTROLS
===================================================== */

let liveControlTimeout;

function revealLiveControls() {
  if (elements.customControls.hidden) return;

  elements.customControls.classList.add("active");
  clearTimeout(liveControlTimeout);

  liveControlTimeout = setTimeout(() => {
    if (!elements.video.paused) {
      elements.customControls.classList.remove("active");
    }
  }, 3000);
}

elements.playerContainer.addEventListener("mousemove", revealLiveControls);
elements.playerContainer.addEventListener("click", revealLiveControls);

elements.playPauseBtn.addEventListener("click", () => {
  if (elements.video.paused) elements.video.play().catch(() => {});
  else elements.video.pause();
});

elements.video.addEventListener("play", () => {
  elements.playPauseBtn.textContent = "â¸";
});

elements.video.addEventListener("pause", () => {
  elements.playPauseBtn.textContent = "â¶";
  elements.customControls.classList.add("active");
});

elements.muteBtn.addEventListener("click", () => {
  elements.video.muted = !elements.video.muted;
  elements.muteBtn.textContent = elements.video.muted ? "ð" : "ð";
  elements.volumeSlider.value =
    elements.video.muted ? "0" : String(elements.video.volume);
});

elements.volumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.video.volume = volume;
  elements.video.muted = volume === 0;
  elements.muteBtn.textContent = volume === 0 ? "ð" : "ð";
});

elements.fullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.playerContainer);
});


/* =====================================================
   VOD CATEGORIES / GRID
===================================================== */

function renderVodCategories() {
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
      lock.textContent = "ð";
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
}

function setPoster(element, item) {
  element.textContent = initials(item.title);
  element.style.backgroundImage = "";
  element.classList.remove("has-poster");

  const url = String(item.poster || "").trim();
  if (!url) return;

  const image = new Image();

  image.onload = () => {
    element.textContent = "";
    element.style.backgroundImage =
      `linear-gradient(0deg, rgba(2,5,9,.62), transparent 60%), url("${url.replace(/"/g, "%22")}")`;
    element.classList.add("has-poster");
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

  return state.vod.items.filter((item) => {
    const haystack = [
      item.title,
      item.description,
      item.year,
      item.rating,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
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
    play.textContent = "â¶";

    const title = document.createElement("strong");
    title.textContent = item.title;

    const meta = document.createElement("small");
    meta.textContent =
      [item.year, item.rating && `â ${item.rating}`]
        .filter(Boolean)
        .join(" Â· ") || "On demand";

    card.append(poster, play, title, meta);

    card.addEventListener("click", () => {
      openVodModal(item);
    });

    return card;
  });

  if (!cards.length) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = state.vod.query
      ? "No loaded movies match your search."
      : "No movies were returned for this category.";
    cards.push(note);
  }

  elements.vodGrid.replaceChildren(...cards);

  const category = vodCategoryById(state.vod.categoryId);
  elements.vodCategoryTitle.textContent =
    category?.title || "Movies & Series";

  const loaded = state.vod.items.length;
  const total = state.vod.total;

  elements.vodCategoryMeta.textContent =
    total > 0
      ? `${loaded.toLocaleString()} loaded Â· ${total.toLocaleString()} available`
      : `${loaded.toLocaleString()} titles loaded`;
}

async function loadVodCategories() {
  elements.vodCategories.innerHTML =
    '<p class="list-note">Loading categoriesâ¦</p>';

  try {
    const response = await request("/api/vod/categories");
    state.vod.categories = Array.isArray(response.categories)
      ? response.categories
      : [];

    renderVodCategories();

    const firstUnlocked =
      state.vod.categories.find((category) => !category.locked) ||
      state.vod.categories[0];

    if (firstUnlocked && !state.vod.categoryId) {
      if (firstUnlocked.locked && !state.parentalUnlocked) {
        elements.vodCategoryTitle.textContent = "Movies & Series";
        elements.vodCategoryMeta.textContent =
          "Choose a category from the left.";
      } else {
        selectVodCategory(firstUnlocked.id);
      }
    }
  } catch (error) {
    elements.vodCategories.innerHTML =
      `<p class="list-note">${escapeHtml(error.message)}</p>`;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  elements.vodGrid.innerHTML =
    '<p class="list-note">Loading moviesâ¦</p>';

  renderVodCategories();
  await loadNextVodPage(true);
}

async function loadNextVodPage(reset = false) {
  if (
    state.vod.loading ||
    state.vod.ended ||
    !state.vod.categoryId
  ) {
    return;
  }

  const category = vodCategoryById(state.vod.categoryId);
  if (!category) return;

  if (category.locked && !state.parentalUnlocked) return;

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
        kind: "vod",
        categoryId: state.vod.categoryId,
      });

      added += 1;
    }

    state.vod.total =
      Number(result.total) || state.vod.items.length;

    state.vod.page = page + 1;

    // The portal controls its page size. We append every returned
    // page and request another one as the user scrolls.
    if (
      incoming.length === 0 ||
      added === 0 ||
      (
        state.vod.total > 0 &&
        state.vod.items.length >= state.vod.total
      )
    ) {
      state.vod.ended = true;
    }

    renderVodGrid();
  } catch (error) {
    if (token === state.vod.loadToken) {
      if (!state.vod.items.length) {
        elements.vodGrid.innerHTML =
          `<p class="list-note">${escapeHtml(error.message)}</p>`;
      }
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
    if (entries.some((entry) => entry.isIntersecting)) {
      loadNextVodPage(false);
    }
  },
  {
    root: null,
    rootMargin: "500px 0px",
    threshold: 0.01,
  }
);

vodObserver.observe(elements.vodLoadMore);


/* =====================================================
   VOD MODAL
===================================================== */

function openVodModal(item) {
  state.vod.selected = item;

  elements.vodModalTitle.textContent = item.title;
  elements.vodModalMeta.textContent =
    [item.year, item.rating && `â ${item.rating}`]
      .filter(Boolean)
      .join(" Â· ") || "On demand";

  elements.vodModalDescription.textContent =
    item.description ||
    "No description is available for this title.";

  setPoster(elements.vodModalPoster, item);

  const savedTime =
    Number(state.watchHistory[item.id]) || 0;

  if (savedTime > 30) {
    elements.vodResumeButton.hidden = false;
    elements.vodResumeButton.textContent =
      `âº Resume from ${formatTime(savedTime)}`;
  } else {
    elements.vodResumeButton.hidden = true;
  }

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
  const resume =
    Number(state.watchHistory[item.id]) || 0;

  closeVodModal();
  playVod(item, resume);
});


/* =====================================================
   VOD PLAYBACK - STAYS ON VOD PAGE
===================================================== */

function resetVodPlayer() {
  state.vod.retryToken += 1;
  destroyHls("vod");

  try {
    elements.vodVideo.pause();
  } catch {
    // Ignore.
  }

  elements.vodVideo.removeAttribute("src");
  elements.vodVideo.load();

  elements.vodVideoLoading.hidden = true;
  elements.vodPlayerControls.hidden = true;
  elements.vodProgressBar.style.width = "0%";
  elements.vodTimeDisplay.textContent = "0:00 / 0:00";
}

function attachVodHls(stream, item, resumeFrom, token) {
  const hls = new window.Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 60,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 6,
  });

  state.vod.hls = hls;

  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let reloads = 0;

  const fail = (message) => {
    if (token !== state.vod.retryToken) return;
    elements.vodVideoLoading.hidden = true;
    showNotice(message);
  };

  const reload = () => {
    if (token !== state.vod.retryToken) return;

    if (reloads >= 2) {
      fail(
        "Movie playback stopped because the stream could not recover. Close the player and try again."
      );
      return;
    }

    reloads += 1;
    const currentTime =
      Number(elements.vodVideo.currentTime) || resumeFrom || 0;

    try {
      hls.destroy();
    } catch {
      // Ignore.
    }

    state.vod.hls = null;

    setTimeout(() => {
      if (
        token === state.vod.retryToken &&
        state.vod.selected?.id === item.id
      ) {
        playVod(item, currentTime, true);
      }
    }, 1200);
  };

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.vod.retryToken) return;

    elements.vodVideoLoading.hidden = true;
    elements.vodPlayerControls.hidden = false;

    if (
      resumeFrom > 0 &&
      Number.isFinite(elements.vodVideo.duration) &&
      resumeFrom < elements.vodVideo.duration - 5
    ) {
      elements.vodVideo.currentTime = resumeFrom;
    }

    elements.vodVideo.play().catch(() => {});
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.vod.retryToken || !data.fatal) return;

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < 5) {
        networkRecoveries += 1;

        setTimeout(() => {
          try {
            hls.startLoad(-1);
          } catch {
            reload();
          }
        }, Math.min(networkRecoveries * 1000, 5000));

        return;
      }

      reload();
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      if (mediaRecoveries === 0) {
        mediaRecoveries += 1;

        try {
          hls.recoverMediaError();
          return;
        } catch {
          reload();
          return;
        }
      }

      if (mediaRecoveries === 1) {
        mediaRecoveries += 1;

        try {
          hls.swapAudioCodec();
          hls.recoverMediaError();
          return;
        } catch {
          reload();
          return;
        }
      }

      reload();
      return;
    }

    reload();
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.vodVideo);
}

async function playVod(item, resumeFrom = 0, recovery = false) {
  if (!item) return;

  const category = vodCategoryById(item.categoryId);

  if (category?.locked && !state.parentalUnlocked) {
    requestParentalUnlock(() => playVod(item, resumeFrom, recovery));
    return;
  }

  if (!recovery) {
    resetVodPlayer();
  } else {
    destroyHls("vod");
    try {
      elements.vodVideo.pause();
    } catch {
      // Ignore.
    }
    elements.vodVideo.removeAttribute("src");
    elements.vodVideo.load();
  }

  state.vod.selected = item;

  const token = ++state.vod.retryToken;

  elements.vodPlayerSection.hidden = false;
  elements.vodVideoLoading.hidden = false;
  elements.vodPlayerControls.hidden = true;
  elements.vodControlTitle.textContent = item.title;

  showNotice("");

  elements.vodPlayerSection.scrollIntoView({
    behavior: recovery ? "auto" : "smooth",
    block: "start",
  });

  try {
    const payload = await request("/api/vod/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: item.categoryId,
        itemId: item.id,
      }),
    });

    if (
      token !== state.vod.retryToken ||
      state.vod.selected?.id !== item.id
    ) {
      return;
    }

    if (window.Hls?.isSupported()) {
      attachVodHls(payload.stream, item, resumeFrom, token);
      return;
    }

    if (
      elements.vodVideo.canPlayType("application/vnd.apple.mpegurl") ||
      /\.(mp4|mkv|avi|mov)(?:\?|$)/i.test(payload.stream)
    ) {
      elements.vodVideo.src = payload.stream;

      elements.vodVideo.addEventListener(
        "loadedmetadata",
        () => {
          if (token !== state.vod.retryToken) return;

          if (
            resumeFrom > 0 &&
            Number.isFinite(elements.vodVideo.duration) &&
            resumeFrom < elements.vodVideo.duration - 5
          ) {
            elements.vodVideo.currentTime = resumeFrom;
          }

          elements.vodVideoLoading.hidden = true;
          elements.vodPlayerControls.hidden = false;
          elements.vodVideo.play().catch(() => {});
        },
        { once: true }
      );

      return;
    }

    throw new Error("This device cannot play this movie stream.");
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
  if (elements.vodVideo.paused) {
    elements.vodVideo.play().catch(() => {});
  } else {
    elements.vodVideo.pause();
  }
});

elements.vodVideo.addEventListener("play", () => {
  elements.vodPlayPauseBtn.textContent = "â¸";
});

elements.vodVideo.addEventListener("pause", () => {
  elements.vodPlayPauseBtn.textContent = "â¶";
  elements.vodPlayerControls.classList.add("active");
});

elements.vodMuteBtn.addEventListener("click", () => {
  elements.vodVideo.muted = !elements.vodVideo.muted;
  elements.vodMuteBtn.textContent =
    elements.vodVideo.muted ? "ð" : "ð";
  elements.vodVolumeSlider.value =
    elements.vodVideo.muted
      ? "0"
      : String(elements.vodVideo.volume);
});

elements.vodVolumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.vodVideo.volume = volume;
  elements.vodVideo.muted = volume === 0;
  elements.vodMuteBtn.textContent =
    volume === 0 ? "ð" : "ð";
});

elements.vodVideo.addEventListener("timeupdate", () => {
  const current =
    Number(elements.vodVideo.currentTime) || 0;
  const duration =
    Number(elements.vodVideo.duration) || 0;

  if (duration > 0 && Number.isFinite(duration)) {
    const percent =
      Math.min(100, Math.max(0, current / duration * 100));

    elements.vodProgressBar.style.width =
      `${percent}%`;

    elements.vodTimeDisplay.textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;
  } else {
    elements.vodTimeDisplay.textContent =
      formatTime(current);
  }

  const item = state.vod.selected;

  if (item && current > 0) {
    const rounded = Math.floor(current);

    if (
      !state.vod._lastSavedSecond ||
      rounded - state.vod._lastSavedSecond >= 5
    ) {
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

  const rect =
    elements.vodProgressContainer.getBoundingClientRect();

  const ratio =
    Math.min(
      1,
      Math.max(
        0,
        (event.clientX - rect.left) / rect.width
      )
    );

  elements.vodVideo.currentTime =
    ratio * duration;
});

elements.vodFullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.vodPlayerContainer);
});


/* =====================================================
   FULLSCREEN
===================================================== */

async function toggleFullscreen(container) {
  try {
    if (!document.fullscreenElement) {
      await container.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    // Fullscreen may be blocked by the browser.
  }
}


/* =====================================================
   SEARCH / EDIT
===================================================== */

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

  elements.editGroupsButton.classList.toggle(
    "active",
    state.editingGroups
  );

  elements.editGroupsButton.textContent =
    state.editingGroups ? "Done" : "ð Edit";

  renderCategories();
});

elements.editChannelsButton.addEventListener("click", () => {
  state.editingChannels = !state.editingChannels;

  elements.editChannelsButton.classList.toggle(
    "active",
    state.editingChannels
  );

  elements.editChannelsButton.textContent =
    state.editingChannels ? "Done" : "ð Edit";

  renderChannels();
});


/* =====================================================
   MODE BUTTONS
===================================================== */

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
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
  if (event.target === elements.settingsModal) {
    elements.settingsModal.hidden = true;
  }
});

elements.themeSelect.addEventListener("change", (event) => {
  state.theme = event.target.value;
  localStorage.setItem("theme", state.theme);
  applyTheme();
});

elements.updatePinButton.addEventListener("click", async () => {
  const newPin =
    elements.newParentalPin.value.trim();

  if (!/^\d{4}$/.test(newPin)) {
    elements.pinNotice.textContent =
      "PIN must be exactly 4 digits.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
    return;
  }

  elements.updatePinButton.disabled = true;
  elements.updatePinButton.textContent = "Updatingâ¦";

  try {
    /*
      Current server.js requires serviceId + MAC when /api/config
      is saved. We obtain them from the setup fields when available.
      If the backend is later given a dedicated PIN endpoint, this
      frontend can be switched to it without changing the UI.
    */
    const config = await request("/api/config");

    const serviceId =
      elements.serviceId.value ||
      config.serviceId ||
      localStorage.getItem("netplusServiceId") ||
      "";

    const mac =
      elements.mac.value ||
      localStorage.getItem("netplusMac") ||
      "";

    if (!serviceId || !mac) {
      throw new Error(
        "Reconfigure the portal once before changing the PIN."
      );
    }

    await request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        mac,
        parentalPin: newPin,
      }),
    });

    state.parentalUnlocked = false;

    elements.pinNotice.textContent =
      "PIN updated successfully.";
    elements.pinNotice.style.color = "#35dbc5";
    elements.pinNotice.hidden = false;
    elements.newParentalPin.value = "";
  } catch (error) {
    elements.pinNotice.textContent =
      error.message || "Failed to update PIN.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
  } finally {
    elements.updatePinButton.disabled = false;
    elements.updatePinButton.textContent = "Update PIN";
  }
});

elements.resetPortalButton.addEventListener("click", () => {
  if (
    !window.confirm(
      "Return to setup so you can change the service or MAC address?"
    )
  ) {
    return;
  }

  elements.settingsModal.hidden = true;

  // Do not delete favorites/history just because the user wants
  // to reconfigure the portal.
  elements.serviceId.value =
    localStorage.getItem("netplusServiceId") || "";

  elements.mac.value =
    localStorage.getItem("netplusMac") || `${MAC_PREFIX}:`;

  elements.parentalPin.value = "";

  showSetup();
});


/* =====================================================
   SETUP SUBMIT
===================================================== */

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const serviceId =
    elements.serviceId.value.trim();

  const mac =
    formatMacValue(elements.mac.value);

  const parentalPin =
    elements.parentalPin.value.trim();

  if (!serviceId) {
    elements.setupError.textContent =
      "Choose a NetPlus service.";
    elements.setupError.hidden = false;
    return;
  }

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    elements.setupError.textContent =
      "Enter a complete MAC address, for example 00:1A:79:12:34:56.";
    elements.setupError.hidden = false;
    elements.mac.focus();
    return;
  }

  if (!/^\d{4}$/.test(parentalPin)) {
    elements.setupError.textContent =
      "Set a 4-digit parental PIN.";
    elements.setupError.hidden = false;
    elements.parentalPin.focus();
    return;
  }

  elements.mac.value = mac;
  elements.setupError.hidden = true;
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Savingâ¦";

  try {
    await request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        mac,
        parentalPin,
      }),
    });

    localStorage.setItem(
      "netplusServiceId",
      serviceId
    );

    localStorage.setItem(
      "netplusMac",
      mac
    );

    state.parentalUnlocked = false;
    elements.parentalPin.value = "";

    await loadCatalog();
  } catch (error) {
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent =
      "Save & Connect";
  }
});


/* =====================================================
   KEYBOARD SHORTCUTS
===================================================== */

document.addEventListener("keydown", (event) => {
  const activeTag =
    document.activeElement?.tagName;

  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)
  ) {
    return;
  }

  if (event.key === "Escape") {
    if (!elements.pinModal.hidden) {
      closePinModal(true);
      return;
    }

    if (!elements.vodModal.hidden) {
      closeVodModal();
      return;
    }

    if (!elements.settingsModal.hidden) {
      elements.settingsModal.hidden = true;
      return;
    }
  }

  const vodPlaying =
    !elements.vodPlayerSection.hidden &&
    !!state.vod.selected;

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
        elements.vodVideo.currentTime =
          Math.max(0, elements.vodVideo.currentTime - 10);
        return;

      case "arrowright":
        event.preventDefault();
        if (Number.isFinite(elements.vodVideo.duration)) {
          elements.vodVideo.currentTime =
            Math.min(
              elements.vodVideo.duration,
              elements.vodVideo.currentTime + 10
            );
        }
        return;
    }
  }

  if (!state.selected || state.selected.kind !== "live") {
    return;
  }

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
      const index =
        channels.findIndex(
          (channel) => channel.id === state.selected.id
        );

      if (index < 0 || !channels.length) return;

      let nextIndex =
        event.key === "ArrowUp"
          ? index - 1
          : index + 1;

      if (nextIndex < 0) {
        nextIndex = channels.length - 1;
      }

      if (nextIndex >= channels.length) {
        nextIndex = 0;
      }

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
    localStorage.getItem("netplusMac") ||
    elements.mac.value ||
    `${MAC_PREFIX}:`;

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