/*
=========================================================
 NetPlus IPTV Player
 FRONTEND VERSION: 1.1.0
 File: app.js

 - Original NetPlus frontend restored
 - Gemini features safely integrated
 - Favorites
 - Hidden groups/channels
 - Netflix-style VOD
 - Watch history / Resume
 - Custom player controls
 - Keyboard shortcuts
 - Parental controls
 - HLS recovery
 - Server.js remains unchanged
=========================================================
*/

"use strict";

/* =====================================================
   STATE
===================================================== */

const state = {
  catalog: null,

  category: "all",
  query: "",

  selected: null,

  hls: null,

  mode: "live",

  parentalUnlocked: false,

  resumeTime: 0,

  playbackGeneration: 0,

  hiddenGroups: new Set(
    JSON.parse(localStorage.getItem("hiddenGroups") || "[]")
  ),

  hiddenChannels: new Set(
    JSON.parse(localStorage.getItem("hiddenChannels") || "[]")
  ),

  favoriteChannels: new Set(
    JSON.parse(localStorage.getItem("favoriteChannels") || "[]")
  ),

  watchHistory: JSON.parse(
    localStorage.getItem("watchHistory") || "{}"
  ),

  editingGroups: false,
  editingChannels: false,

  theme: localStorage.getItem("theme") || "dark",

  vod: {
    categories: [],
    items: new Map(),
    query: "",
    selected: null,
    loaded: false
  }
};


/* =====================================================
   ELEMENTS
===================================================== */

const elements = {
  topbar: document.querySelector("#topbar"),

  workspace: document.querySelector("#workspace"),

  setup: document.querySelector("#setup"),

  setupForm: document.querySelector("#setupForm"),

  setupError: document.querySelector("#setupError"),

  connectButton: document.querySelector("#connectButton"),

  serviceId: document.querySelector("#serviceId"),

  mac: document.querySelector("#mac"),

  parentalPin: document.querySelector("#parentalPin"),

  status: document.querySelector("#status"),

  categories: document.querySelector("#categories"),

  channels: document.querySelector("#channels"),

  groupCount: document.querySelector("#groupCount"),

  channelCount: document.querySelector("#channelCount"),

  search: document.querySelector("#search"),

  video: document.querySelector("#video"),

  placeholder: document.querySelector("#placeholder"),

  videoLoading: document.querySelector("#videoLoading"),

  notice: document.querySelector("#notice"),

  nowPlaying: document.querySelector("#nowPlaying"),

  playerModeBadge: document.querySelector("#playerModeBadge"),

  settingsButton: document.querySelector("#settingsButton"),

  modebar: document.querySelector("#modebar"),

  vodWorkspace: document.querySelector("#vodWorkspace"),

  vodRows: document.querySelector("#vodRows"),

  vodSearch: document.querySelector("#vodSearch"),

  vodModal: document.querySelector("#vodModal"),

  vodClose: document.querySelector("#vodClose"),

  vodModalPoster: document.querySelector("#vodModalPoster"),

  vodModalTitle: document.querySelector("#vodModalTitle"),

  vodModalMeta: document.querySelector("#vodModalMeta"),

  vodModalDescription: document.querySelector(
    "#vodModalDescription"
  ),

  vodPlayButton: document.querySelector("#vodPlayButton"),

  vodResumeButton: document.querySelector("#vodResumeButton"),

  editGroupsButton: document.querySelector("#editGroupsButton"),

  editChannelsButton: document.querySelector(
    "#editChannelsButton"
  ),

  settingsModal: document.querySelector("#settingsModal"),

  closeSettingsButton: document.querySelector(
    "#closeSettingsButton"
  ),

  themeSelect: document.querySelector("#themeSelect"),

  newParentalPin: document.querySelector(
    "#newParentalPin"
  ),

  updatePinButton: document.querySelector(
    "#updatePinButton"
  ),

  pinNotice: document.querySelector("#pinNotice"),

  resetPortalButton: document.querySelector(
    "#resetPortalButton"
  ),

  playerContainer: document.querySelector(
    "#playerContainer"
  ),

  customControls: document.querySelector(
    "#customControls"
  ),

  controlTitle: document.querySelector("#controlTitle"),

  controlEpg: document.querySelector("#controlEpg"),

  progressContainer: document.querySelector(
    "#progressContainer"
  ),

  progressBar: document.querySelector("#progressBar"),

  playPauseBtn: document.querySelector("#playPauseBtn"),

  muteBtn: document.querySelector("#muteBtn"),

  volumeSlider: document.querySelector("#volumeSlider"),

  timeDisplay: document.querySelector("#timeDisplay"),

  fullscreenBtn: document.querySelector("#fullscreenBtn")
};


/* =====================================================
   UTILITIES
===================================================== */

async function request(url, options) {
  const response = await fetch(url, options);

  const payload = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.error ||
      `Request failed (${response.status}).`
    );
  }

  return payload;
}


function setStatus(text, online = false) {
  const span = elements.status?.querySelector("span");

  if (span) {
    span.textContent = text;
  }

  elements.status?.classList.toggle(
    "online",
    online
  );
}


function showNotice(message = "") {
  if (!elements.notice) return;

  elements.notice.textContent = message;

  elements.notice.hidden = !message;
}


function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase() || "TV";
}


function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const total = Math.max(
    0,
    Math.floor(seconds)
  );

  const hours = Math.floor(total / 3600);

  const minutes = Math.floor(
    (total % 3600) / 60
  );

  const secs = total % 60;

  if (hours > 0) {
    return (
      `${hours}:` +
      `${String(minutes).padStart(2, "0")}:` +
      `${String(secs).padStart(2, "0")}`
    );
  }

  return (
    `${minutes}:` +
    `${String(secs).padStart(2, "0")}`
  );
}


function saveSet(key, set) {
  localStorage.setItem(
    key,
    JSON.stringify([...set])
  );
}


/* =====================================================
   THEME
===================================================== */

function applyTheme() {
  document.body.classList.remove(
    "theme-dark",
    "theme-light"
  );

  document.body.classList.add(
    `theme-${state.theme}`
  );

  if (elements.themeSelect) {
    elements.themeSelect.value = state.theme;
  }
}

applyTheme();


/* =====================================================
   SETUP / APP VISIBILITY
===================================================== */

function showSetup() {
  elements.setup.hidden = false;

  elements.workspace.hidden = true;

  elements.vodWorkspace.hidden = true;

  elements.modebar.hidden = true;

  elements.topbar.hidden = true;

  elements.setupError.hidden = true;

  setStatus("Setup required");
}


function showApplication() {
  elements.setup.hidden = true;

  elements.topbar.hidden = false;

  elements.modebar.hidden = false;
}


/* =====================================================
   MODE
===================================================== */

function setMode(mode) {
  state.mode = mode;

  elements.workspace.hidden =
    mode !== "live";

  elements.vodWorkspace.hidden =
    mode !== "vod";

  document
    .querySelectorAll(".mode-button")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });

  if (
    mode === "vod" &&
    !state.vod.loaded
  ) {
    loadVod();
  }
}


/* =====================================================
   PARENTAL CONTROL
===================================================== */

async function unlockParental() {
  if (state.parentalUnlocked) {
    return true;
  }

  const pin = window.prompt(
    "Enter your 4-digit parental PIN."
  );

  if (pin === null) {
    return false;
  }

  if (!/^\d{4}$/.test(pin)) {
    showNotice(
      "Enter a valid 4-digit parental PIN."
    );

    return false;
  }

  try {
    await request(
      "/api/parental/verify",
      {
        method: "POST",

        headers: {
          "content-type": "application/json"
        },

        body: JSON.stringify({ pin })
      }
    );

    state.parentalUnlocked = true;

    showNotice("");

    renderCategories();

    renderChannels();

    renderVod();

    return true;

  } catch (error) {
    showNotice(error.message);

    return false;
  }
}


/* =====================================================
   CATEGORIES
===================================================== */

function renderCategories() {
  if (!state.catalog) return;

  const portalCategories =
    state.catalog.categories.filter(category => {
      return (
        state.editingGroups ||
        !state.hiddenGroups.has(category.id)
      );
    });

  const categories = [
    {
      id: "favorites",
      title: "⭐ Favorites",
      locked: false
    },

    {
      id: "all",
      title: "All channels",
      locked: false
    },

    ...portalCategories
  ];


  const visiblePortalCount =
    portalCategories.length;

  elements.groupCount.textContent =
    `${visiblePortalCount} groups`;


  const buttons = categories.map(category => {
    const button =
      document.createElement("button");

    button.type = "button";

    button.className = "category-button";

    if (state.category === category.id) {
      button.classList.add("active");
    }

    if (
      state.hiddenGroups.has(category.id)
    ) {
      button.classList.add("hidden-item");
    }


    const title =
      category.locked &&
      !state.parentalUnlocked
        ? "🔒 Protected content"
        : category.title;


    const text =
      document.createElement("span");

    text.textContent = title;


    const arrow =
      document.createElement("em");

    arrow.textContent = "›";


    if (
      state.editingGroups &&
      !["all", "favorites"].includes(
        category.id
      )
    ) {
      const visibility =
        document.createElement("span");

      visibility.className =
        "visibility-toggle";

      visibility.textContent =
        state.hiddenGroups.has(category.id)
          ? "❌"
          : "👁";

      visibility.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          if (
            state.hiddenGroups.has(
              category.id
            )
          ) {
            state.hiddenGroups.delete(
              category.id
            );
          } else {
            state.hiddenGroups.add(
              category.id
            );
          }

          saveSet(
            "hiddenGroups",
            state.hiddenGroups
          );

          renderCategories();
        }
      );

      button.append(
        visibility,
        text,
        arrow
      );

    } else {
      button.append(text, arrow);
    }


    button.addEventListener(
      "click",
      async () => {
        if (state.editingGroups) {
          return;
        }

        if (
          category.locked &&
          !(await unlockParental())
        ) {
          return;
        }

        state.category = category.id;

        renderCategories();

        renderChannels();
      }
    );

    return button;
  });


  elements.categories.replaceChildren(
    ...buttons
  );
}


/* =====================================================
   CHANNEL FILTERING
===================================================== */

function filteredChannels() {
  if (!state.catalog) {
    return [];
  }

  const query =
    state.query.trim().toLowerCase();


  return state.catalog.channels.filter(
    channel => {

      const favoriteCategory =
        state.category === "favorites";


      const inCategory =
        favoriteCategory
          ? state.favoriteChannels.has(
              channel.id
            )
          : (
              state.category === "all" ||
              channel.genreId ===
                state.category
            );


      const matchesSearch =
        !query ||
        channel.name
          .toLowerCase()
          .includes(query);


      const visible =
        state.editingChannels ||
        !state.hiddenChannels.has(
          channel.id
        );


      return (
        inCategory &&
        matchesSearch &&
        visible
      );
    }
  );
}


/* =====================================================
   CHANNEL RENDERING
===================================================== */

function renderChannels() {
  const filtered =
    filteredChannels();

  elements.channelCount.textContent =
    `${filtered.length.toLocaleString()} channels`;


  const rows =
    filtered
      .slice(0, 300)
      .map(channel => {

        const button =
          document.createElement("button");

        button.type = "button";

        button.className =
          "channel-button";


        if (
          state.selected?.kind === "live" &&
          state.selected?.id === channel.id
        ) {
          button.classList.add("active");
        }


        if (
          state.hiddenChannels.has(
            channel.id
          )
        ) {
          button.classList.add(
            "hidden-item"
          );
        }


        /* Toggle */

        const toggle =
          document.createElement("span");


        if (state.editingChannels) {

          toggle.className =
            "visibility-toggle";

          toggle.textContent =
            state.hiddenChannels.has(
              channel.id
            )
              ? "❌"
              : "👁";

        } else {

          toggle.className =
            "favorite-toggle";

          if (
            state.favoriteChannels.has(
              channel.id
            )
          ) {
            toggle.classList.add(
              "is-favorite"
            );
          }

          toggle.textContent = "⭐";
        }


        toggle.addEventListener(
          "click",
          event => {
            event.stopPropagation();


            if (state.editingChannels) {

              if (
                state.hiddenChannels.has(
                  channel.id
                )
              ) {
                state.hiddenChannels.delete(
                  channel.id
                );
              } else {
                state.hiddenChannels.add(
                  channel.id
                );
              }

              saveSet(
                "hiddenChannels",
                state.hiddenChannels
              );

            } else {

              if (
                state.favoriteChannels.has(
                  channel.id
                )
              ) {
                state.favoriteChannels.delete(
                  channel.id
                );
              } else {
                state.favoriteChannels.add(
                  channel.id
                );
              }

              saveSet(
                "favoriteChannels",
                state.favoriteChannels
              );
            }


            renderChannels();
          }
        );


        /* Icon */

        const icon =
          document.createElement("span");

        icon.className =
          "channel-icon";

        icon.textContent =
          initials(channel.name);


        /* Text */

        const copy =
          document.createElement("span");

        copy.className =
          "channel-copy";


        const name =
          document.createElement("strong");

        name.textContent =
          channel.name;


        const meta =
          document.createElement("small");

        meta.textContent =
          `${
            channel.number
              ? `Channel ${channel.number}`
              : "Live"
          }${
            channel.hd
              ? " · HD"
              : ""
          }`;


        copy.append(name, meta);


        /* Play */

        const play =
          document.createElement("span");

        play.className =
          "channel-play";

        play.textContent = "▶";


        button.append(
          toggle,
          icon,
          copy,
          play
        );


        button.addEventListener(
          "click",
          () => {
            if (!state.editingChannels) {
              playLive(channel);
            }
          }
        );


        return button;
      });


  if (filtered.length > 300) {
    const note =
      document.createElement("p");

    note.className =
      "list-note";

    note.textContent =
      "Showing 300 results. Search to narrow the list.";

    rows.push(note);
  }


  if (!rows.length) {
    const note =
      document.createElement("p");

    note.className =
      "list-note";

    note.textContent =
      state.category === "favorites"
        ? "No favorite channels yet. Tap ⭐ beside a channel to add it."
        : "No channels found.";

    rows.push(note);
  }


  elements.channels.replaceChildren(
    ...rows
  );
}


/* =====================================================
   CATALOG
===================================================== */

async function loadCatalog() {
  showApplication();

  setMode("live");

  setStatus("Connecting");

  showNotice("");

  elements.channels.innerHTML =
    '<p class="list-note">Loading portal catalogue…</p>';


  try {

    state.catalog =
      await request("/api/catalog");


    setStatus(
      "Portal connected",
      true
    );


    renderCategories();

    renderChannels();


  } catch (error) {

    setStatus(
      "Connection failed"
    );

    showNotice(
      error.message
    );
  }
}


/* =====================================================
   PLAYER RESET
===================================================== */

function destroyHls() {
  if (state.hls) {
    try {
      state.hls.destroy();
    } catch {
      // Ignore cleanup errors.
    }

    state.hls = null;
  }
}


function resetPlayer() {
  destroyHls();

  try {
    elements.video.pause();
  } catch {
    // Ignore.
  }

  elements.video.removeAttribute("src");

  try {
    elements.video.load();
  } catch {
    // Ignore.
  }

  elements.customControls.hidden = true;

  elements.progressBar.style.width =
    "0%";
}


/* =====================================================
   HLS PLAYBACK
===================================================== */

function attachHls(
  stream,
  retry,
  generation
) {

  const hls =
    new window.Hls({

      enableWorker: true,

      lowLatencyMode: false,

      backBufferLength: 60,

      maxBufferLength: 30,

      maxMaxBufferLength: 60,

      manifestLoadingTimeOut: 30000,

      manifestLoadingMaxRetry: 2,

      levelLoadingTimeOut: 30000,

      levelLoadingMaxRetry: 2,

      fragLoadingTimeOut: 30000,

      fragLoadingMaxRetry: 3
    });


  state.hls = hls;


  hls.loadSource(stream);

  hls.attachMedia(elements.video);


  hls.on(
    window.Hls.Events.MANIFEST_PARSED,
    () => {

      if (
        generation !==
        state.playbackGeneration
      ) {
        return;
      }


      elements.videoLoading.hidden =
        true;

      elements.customControls.hidden =
        false;


      if (
        state.selected?.kind === "vod" &&
        state.resumeTime > 0
      ) {
        try {
          elements.video.currentTime =
            state.resumeTime;
        } catch {
          // Ignore seek failure.
        }
      }


      elements.video
        .play()
        .catch(() => {
          // User interaction may be required.
        });
    }
  );


  hls.on(
    window.Hls.Events.ERROR,
    (_event, data) => {

      if (
        generation !==
        state.playbackGeneration
      ) {
        return;
      }


      console.warn(
        "HLS:",
        data.type,
        data.details,
        data.fatal
      );


      /*
      -------------------------------------------
      Non-fatal errors:
      HLS.js normally recovers itself.
      -------------------------------------------
      */

      if (!data.fatal) {
        return;
      }


      /*
      -------------------------------------------
      LEVEL PARSING ERROR
      Gemini feature preserved.

      Invalid / blocked playlists should not
      freeze the whole app.
      -------------------------------------------
      */

      if (
        data.details ===
        window.Hls.ErrorDetails
          .LEVEL_PARSING_ERROR
      ) {

        if (retry.reload < 1) {

          retry.reload += 1;

          try {
            hls.destroy();
          } catch {
            // Ignore.
          }

          state.hls = null;


          setTimeout(() => {

            if (
              generation ===
              state.playbackGeneration
            ) {
              playSelected(true);
            }

          }, 700);

          return;
        }


        destroyHls();

        elements.videoLoading.hidden =
          true;


        showNotice(
          "This channel returned an invalid or blocked playlist. Select the channel again or try another channel."
        );

        return;
      }


      /*
      -------------------------------------------
      NETWORK ERROR
      -------------------------------------------
      */

      if (
        data.type ===
        window.Hls.ErrorTypes
          .NETWORK_ERROR
      ) {

        if (retry.network < 3) {

          retry.network += 1;

          try {
            hls.startLoad();
          } catch {
            // Fall through to reload.
          }

          return;
        }
      }


      /*
      -------------------------------------------
      MEDIA ERROR

      recoverMediaError()
      then swapAudioCodec() + recovery.

      This preserves Gemini's
      mediaSourceRequiresReset fix.
      -------------------------------------------
      */

      if (
        data.type ===
        window.Hls.ErrorTypes
          .MEDIA_ERROR
      ) {

        if (retry.media === 0) {

          retry.media += 1;

          try {
            hls.recoverMediaError();

            return;
          } catch {
            // Continue.
          }
        }


        if (retry.media === 1) {

          retry.media += 1;

          try {
            hls.swapAudioCodec();

            hls.recoverMediaError();

            return;
          } catch {
            // Continue.
          }
        }
      }


      /*
      -------------------------------------------
      FINAL STREAM RELOAD SAFETY NET
      -------------------------------------------
      */

      if (
        retry.reload < 2 &&
        state.selected
      ) {

        retry.reload += 1;


        try {
          hls.destroy();
        } catch {
          // Ignore.
        }


        state.hls = null;


        setTimeout(() => {

          if (
            generation ===
            state.playbackGeneration
          ) {
            playSelected(true);
          }

        }, 1000);


        return;
      }


      /*
      -------------------------------------------
      GIVE UP CLEANLY
      -------------------------------------------
      */

      destroyHls();

      elements.videoLoading.hidden =
        true;


      showNotice(
        `Playback stopped: ${
          data.details ||
          "stream error"
        }. Select the channel again or try another channel.`
      );
    }
  );
}


/* =====================================================
   PLAY SELECTED
===================================================== */

async function playSelected(
  preserveGeneration = false
) {

  if (!state.selected) {
    return;
  }


  if (!preserveGeneration) {
    state.playbackGeneration += 1;
  }


  const generation =
    state.playbackGeneration;


  resetPlayer();


  elements.videoLoading.hidden =
    false;

  showNotice("");


  try {

    const isVod =
      state.selected.kind === "vod";


    const endpoint =
      isVod
        ? "/api/vod/play"
        : "/api/play";


    const body =
      isVod
        ? {
            categoryId:
              state.selected.categoryId,

            itemId:
              state.selected.id
          }
        : {
            channelId:
              state.selected.id
          };


    const payload =
      await request(
        endpoint,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(body)
        }
      );


    if (
      generation !==
      state.playbackGeneration
    ) {
      return;
    }


    elements.controlTitle.textContent =
      state.selected.title ||
      state.selected.name ||
      "NetPlus";


    elements.controlEpg.textContent =
      isVod
        ? "On Demand"
        : "Live TV";


    elements.nowPlaying.textContent =
      state.selected.title ||
      state.selected.name ||
      "Now Playing";


    elements.playerModeBadge.textContent =
      isVod
        ? "VOD"
        : "LIVE";


    if (
      window.Hls &&
      window.Hls.isSupported()
    ) {

      attachHls(
        payload.stream,
        {
          network: 0,
          media: 0,
          reload: 0
        },
        generation
      );

      return;
    }


    /*
    -------------------------------------------
    Native HLS fallback
    -------------------------------------------
    */

    if (
      elements.video.canPlayType(
        "application/vnd.apple.mpegurl"
      )
    ) {

      elements.video.src =
        payload.stream;


      const metadataHandler = () => {

        if (
          isVod &&
          state.resumeTime > 0
        ) {
          try {
            elements.video.currentTime =
              state.resumeTime;
          } catch {
            // Ignore.
          }
        }
      };


      elements.video.addEventListener(
        "loadedmetadata",
        metadataHandler,
        { once: true }
      );


      await elements.video.play();


      elements.videoLoading.hidden =
        true;

      elements.customControls.hidden =
        false;

      return;
    }


    throw new Error(
      "This device does not support HLS playback."
    );


  } catch (error) {

    if (
      generation !==
      state.playbackGeneration
    ) {
      return;
    }


    elements.videoLoading.hidden =
      true;


    showNotice(
      error.message ||
      "Playback failed."
    );
  }
}


/* =====================================================
   BEGIN PLAYBACK
===================================================== */

function beginPlayback(
  item,
  resumeFrom = 0
) {

  state.selected = item;

  state.resumeTime =
    Number(resumeFrom) || 0;


  elements.nowPlaying.textContent =
    item.title ||
    item.name ||
    "Now Playing";


  elements.controlTitle.textContent =
    item.title ||
    item.name ||
    "NetPlus";


  elements.controlEpg.textContent =
    item.kind === "vod"
      ? "On Demand"
      : "Live TV";


  elements.playerModeBadge.textContent =
    item.kind === "vod"
      ? "VOD"
      : "LIVE";


  elements.placeholder.hidden = true;

  elements.videoLoading.hidden =
    false;


  showNotice("");


  renderChannels();


  playSelected();
}


/* =====================================================
   LIVE PLAYBACK
===================================================== */

async function playLive(channel) {

  const category =
    state.catalog?.categories.find(
      entry =>
        entry.id === channel.genreId
    );


  if (
    category?.locked &&
    !(await unlockParental())
  ) {
    return;
  }


  /*
   Always show Live workspace
   when playing live TV.
  */

  setMode("live");


  beginPlayback(
    {
      ...channel,
      kind: "live",
      title: channel.name
    },
    0
  );
}


/* =====================================================
   CUSTOM PLAYER CONTROLS
===================================================== */

let controlTimeout = null;


function showControlsTemporarily() {

  if (
    elements.customControls.hidden
  ) {
    return;
  }


  elements.customControls.classList.add(
    "active"
  );


  clearTimeout(controlTimeout);


  controlTimeout =
    setTimeout(() => {

      if (!elements.video.paused) {
        elements.customControls.classList.remove(
          "active"
        );
      }

    }, 3000);
}


elements.playerContainer.addEventListener(
  "mousemove",
  showControlsTemporarily
);


elements.playerContainer.addEventListener(
  "click",
  showControlsTemporarily
);


elements.playPauseBtn.addEventListener(
  "click",
  () => {

    if (elements.video.paused) {

      elements.video
        .play()
        .catch(() => {});

    } else {

      elements.video.pause();
    }
  }
);


elements.video.addEventListener(
  "play",
  () => {

    elements.playPauseBtn.textContent =
      "⏸";

    showControlsTemporarily();
  }
);


elements.video.addEventListener(
  "pause",
  () => {

    elements.playPauseBtn.textContent =
      "▶";

    elements.customControls.classList.add(
      "active"
    );
  }
);


/* =====================================================
   VOLUME
===================================================== */

elements.muteBtn.addEventListener(
  "click",
  () => {

    elements.video.muted =
      !elements.video.muted;


    elements.muteBtn.textContent =
      elements.video.muted
        ? "🔇"
        : "🔊";


    elements.volumeSlider.value =
      elements.video.muted
        ? "0"
        : String(elements.video.volume);
  }
);


elements.volumeSlider.addEventListener(
  "input",
  event => {

    const volume =
      Number(event.target.value);


    elements.video.volume =
      volume;


    elements.video.muted =
      volume === 0;


    elements.muteBtn.textContent =
      elements.video.muted
        ? "🔇"
        : "🔊";
  }
);


/* =====================================================
   FULLSCREEN
===================================================== */

async function toggleFullscreen() {

  try {

    if (!document.fullscreenElement) {

      await elements.playerContainer
        .requestFullscreen();

    } else {

      await document.exitFullscreen();
    }

  } catch (error) {

    console.warn(
      "Fullscreen error:",
      error
    );
  }
}


elements.fullscreenBtn.addEventListener(
  "click",
  toggleFullscreen
);


/* =====================================================
   TIME / WATCH HISTORY
===================================================== */

let lastHistorySecond = -1;


elements.video.addEventListener(
  "timeupdate",
  () => {

    const isVod =
      state.selected?.kind === "vod";


    if (
      !isVod ||
      !Number.isFinite(
        elements.video.duration
      ) ||
      elements.video.duration <= 0
    ) {

      elements.timeDisplay.textContent =
        "LIVE";

      elements.progressBar.style.width =
        "100%";

      return;
    }


    const current =
      elements.video.currentTime;

    const duration =
      elements.video.duration;


    const percent =
      Math.min(
        100,
        Math.max(
          0,
          (current / duration) * 100
        )
      );


    elements.progressBar.style.width =
      `${percent}%`;


    elements.timeDisplay.textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;


    /*
    Save roughly every five seconds.
    Avoid repeated writes during the same second.
    */

    const wholeSecond =
      Math.floor(current);


    if (
      wholeSecond !==
        lastHistorySecond &&
      wholeSecond > 0 &&
      wholeSecond % 5 === 0
    ) {

      lastHistorySecond =
        wholeSecond;


      state.watchHistory[
        state.selected.id
      ] = current;


      localStorage.setItem(
        "watchHistory",
        JSON.stringify(
          state.watchHistory
        )
      );
    }
  }
);


/* =====================================================
   VOD SEEKING
===================================================== */

elements.progressContainer.addEventListener(
  "click",
  event => {

    if (
      state.selected?.kind !== "vod"
    ) {
      return;
    }


    const duration =
      elements.video.duration;


    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }


    const rect =
      elements.progressContainer
        .getBoundingClientRect();


    const position =
      Math.min(
        1,
        Math.max(
          0,
          (event.clientX - rect.left) /
            rect.width
        )
      );


    elements.video.currentTime =
      position * duration;
  }
);


/* =====================================================
   KEYBOARD SHORTCUTS
===================================================== */

document.addEventListener(
  "keydown",
  event => {

    const activeTag =
      document.activeElement?.tagName;


    if (
      ["INPUT", "TEXTAREA", "SELECT"]
        .includes(activeTag)
    ) {
      return;
    }


    if (!state.selected) {
      return;
    }


    const key =
      event.key.toLowerCase();


    switch (key) {

      case " ":

        event.preventDefault();

        elements.playPauseBtn.click();

        break;


      case "f":

        event.preventDefault();

        toggleFullscreen();

        break;


      case "m":

        event.preventDefault();

        elements.muteBtn.click();

        break;


      case "arrowup":
      case "arrowdown": {

        if (
          state.selected.kind !== "live"
        ) {
          break;
        }


        event.preventDefault();


        const channels =
          filteredChannels();


        if (!channels.length) {
          return;
        }


        const index =
          channels.findIndex(
            channel =>
              channel.id ===
              state.selected.id
          );


        if (index < 0) {
          return;
        }


        let nextIndex =
          key === "arrowup"
            ? index - 1
            : index + 1;


        if (nextIndex < 0) {
          nextIndex =
            channels.length - 1;
        }


        if (
          nextIndex >=
          channels.length
        ) {
          nextIndex = 0;
        }


        playLive(
          channels[nextIndex]
        );

        break;
      }
    }
  }
);


/* =====================================================
   VOD POSTER
===================================================== */

function poster(element, item) {

  element.textContent =
    initials(item.title);


  if (item.poster) {

    element.style.backgroundImage =
      `linear-gradient(
        0deg,
        rgba(2,5,9,.72),
        transparent 70%
      ),
      url("${item.poster}")`;


    element.classList.add(
      "has-poster"
    );

  } else {

    element.style.backgroundImage =
      "";

    element.classList.remove(
      "has-poster"
    );
  }
}


/* =====================================================
   VOD RENDER
===================================================== */

function renderVod() {

  const query =
    state.vod.query
      .trim()
      .toLowerCase();


  const rows = [];


  for (
    const category of
    state.vod.categories
  ) {

    const allItems =
      state.vod.items.get(
        category.id
      ) || [];


    const items =
      allItems.filter(item => {

        if (!query) {
          return true;
        }


        const title =
          String(
            item.title || ""
          ).toLowerCase();


        const description =
          String(
            item.description || ""
          ).toLowerCase();


        return (
          title.includes(query) ||
          description.includes(query)
        );
      });


    if (
      query &&
      !items.length
    ) {
      continue;
    }


    const section =
      document.createElement(
        "section"
      );

    section.className =
      "vod-row";


    const heading =
      document.createElement("h2");


    heading.textContent =
      category.locked &&
      !state.parentalUnlocked
        ? "🔒 Protected content"
        : category.title;


    const rail =
      document.createElement("div");

    rail.className =
      "vod-rail";


    /*
    -------------------------------------------
    Locked category
    -------------------------------------------
    */

    if (
      category.locked &&
      !state.parentalUnlocked
    ) {

      const lock =
        document.createElement(
          "button"
        );

      lock.type = "button";

      lock.className =
        "locked-vod";

      lock.textContent =
        "🔒 Unlock protected content";


      lock.addEventListener(
        "click",
        async () => {

          if (
            await unlockParental()
          ) {
            renderVod();
          }
        }
      );


      rail.append(lock);


    } else if (!items.length) {

      const empty =
        document.createElement("p");

      empty.className =
        "list-note";

      empty.textContent =
        "No titles currently listed in this category.";

      rail.append(empty);


    } else {

      for (const item of items) {

        const card =
          document.createElement(
            "button"
          );

        card.type = "button";

        card.className =
          "movie-card";


        const image =
          document.createElement(
            "span"
          );

        image.className =
          "movie-poster";

        poster(image, item);


        const name =
          document.createElement(
            "strong"
          );

        name.textContent =
          item.title;


        const meta =
          document.createElement(
            "small"
          );


        meta.textContent =
          [
            item.year,

            item.rating
              ? `★ ${item.rating}`
              : ""
          ]
            .filter(Boolean)
            .join(" · ") ||
          "On demand";


        card.append(
          image,
          name,
          meta
        );


        card.addEventListener(
          "click",
          () => {

            openVodModal({
              ...item,

              kind: "vod",

              categoryId:
                category.id
            });
          }
        );


        rail.append(card);
      }
    }


    section.append(
      heading,
      rail
    );


    rows.push(section);
  }


  if (!rows.length) {

    const empty =
      document.createElement("p");

    empty.className =
      "list-note";

    empty.textContent =
      query
        ? "No movies or series matched your search."
        : "No on-demand titles are currently available.";

    rows.push(empty);
  }


  elements.vodRows.replaceChildren(
    ...rows
  );
}


/* =====================================================
   LOAD VOD
===================================================== */

async function loadVod() {

  elements.vodRows.innerHTML =
    '<p class="list-note">Loading on-demand library…</p>';


  try {

    const response =
      await request(
        "/api/vod/categories"
      );


    /*
    Do NOT use Gemini's .slice(0, 16).
    Load all available categories.
    */

    state.vod.categories =
      Array.isArray(
        response.categories
      )
        ? response.categories
        : [];


    /*
    Load category page 0.

    Existing server supports pages.
    We keep initial loading reasonable
    rather than hammering the portal
    with every page at startup.
    */

    await Promise.all(
      state.vod.categories.map(
        async category => {

          try {

            const result =
              await request(
                `/api/vod/items?categoryId=${
                  encodeURIComponent(
                    category.id
                  )
                }&page=0`
              );


            state.vod.items.set(
              category.id,
              Array.isArray(
                result.items
              )
                ? result.items
                : []
            );


          } catch (error) {

            console.warn(
              `VOD category failed: ${category.title}`,
              error
            );


            state.vod.items.set(
              category.id,
              []
            );
          }
        }
      )
    );


    state.vod.loaded = true;


    renderVod();


  } catch (error) {

    elements.vodRows.innerHTML = "";


    showNotice(
      `VOD could not load: ${error.message}`
    );
  }
}


/* =====================================================
   VOD MODAL
===================================================== */

function openVodModal(item) {

  state.vod.selected = item;


  elements.vodModalTitle.textContent =
    item.title;


  elements.vodModalMeta.textContent =
    [
      item.year,

      item.rating
        ? `★ ${item.rating}`
        : ""
    ]
      .filter(Boolean)
      .join(" · ") ||
    "On demand";


  elements.vodModalDescription.textContent =
    item.description ||
    "No description is available for this title.";


  poster(
    elements.vodModalPoster,
    item
  );


  const savedTime =
    Number(
      state.watchHistory[item.id]
    ) || 0;


  /*
  Resume only after 30 seconds.
  */

  if (savedTime > 30) {

    elements.vodResumeButton.hidden =
      false;


    elements.vodResumeButton.textContent =
      `↺ Resume from ${formatTime(savedTime)}`;


    elements.vodResumeButton.onclick =
      () => {

        elements.vodModal.hidden =
          true;


        /*
        Video player currently lives in
        Live workspace, therefore switch
        to player workspace when playback
        begins.
        */

        setMode("live");


        beginPlayback(
          state.vod.selected,
          savedTime
        );
      };


  } else {

    elements.vodResumeButton.hidden =
      true;

    elements.vodResumeButton.onclick =
      null;
  }


  elements.vodPlayButton.onclick =
    () => {

      elements.vodModal.hidden =
        true;


      setMode("live");


      beginPlayback(
        state.vod.selected,
        0
      );
    };


  elements.vodModal.hidden =
    false;
}


/* =====================================================
   SETUP SUBMIT
===================================================== */

elements.setupForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    const serviceId =
      elements.serviceId.value;


    const mac =
      elements.mac.value
        .trim()
        .toUpperCase();


    const parentalPin =
      elements.parentalPin.value
        .trim();


    if (!serviceId) {

      elements.setupError.textContent =
        "Choose your NetPlus service.";

      elements.setupError.hidden =
        false;

      return;
    }


    if (
      !/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/
        .test(mac)
    ) {

      elements.setupError.textContent =
        "Enter a valid MAC address such as 00:1A:79:12:34:56.";

      elements.setupError.hidden =
        false;

      return;
    }


    if (
      !/^\d{4}$/.test(
        parentalPin
      )
    ) {

      elements.setupError.textContent =
        "Set a 4-digit parental PIN.";

      elements.setupError.hidden =
        false;

      return;
    }


    elements.connectButton.disabled =
      true;


    elements.connectButton.textContent =
      "Saving…";


    elements.setupError.hidden =
      true;


    try {

      await request(
        "/api/config",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              serviceId,
              mac,
              parentalPin
            })
        }
      );


      /*
      Remember only service ID and MAC
      locally so the unchanged server API
      can receive them again when changing
      the parental PIN.

      The PIN itself is NOT stored here.
      */

      localStorage.setItem(
        "netplusServiceId",
        serviceId
      );


      localStorage.setItem(
        "netplusMac",
        mac
      );


      elements.parentalPin.value =
        "";


      await loadCatalog();


    } catch (error) {

      elements.setupError.textContent =
        error.message;


      elements.setupError.hidden =
        false;


    } finally {

      elements.connectButton.disabled =
        false;


      elements.connectButton.textContent =
        "Save & Connect";
    }
  }
);


/* =====================================================
   SEARCH
===================================================== */

elements.search.addEventListener(
  "input",
  () => {

    state.query =
      elements.search.value;

    renderChannels();
  }
);


elements.vodSearch.addEventListener(
  "input",
  () => {

    state.vod.query =
      elements.vodSearch.value;

    renderVod();
  }
);


/* =====================================================
   VOD CLOSE
===================================================== */

elements.vodClose.addEventListener(
  "click",
  () => {

    elements.vodModal.hidden =
      true;
  }
);


elements.vodModal.addEventListener(
  "click",
  event => {

    if (
      event.target ===
      elements.vodModal
    ) {
      elements.vodModal.hidden =
        true;
    }
  }
);


/* =====================================================
   MODE BUTTONS
===================================================== */

document
  .querySelectorAll(".mode-button")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        setMode(
          button.dataset.mode
        );
      }
    );
  });


/* =====================================================
   EDIT GROUPS
===================================================== */

elements.editGroupsButton.addEventListener(
  "click",
  () => {

    state.editingGroups =
      !state.editingGroups;


    elements.editGroupsButton
      .classList.toggle(
        "active",
        state.editingGroups
      );


    elements.editGroupsButton.textContent =
      state.editingGroups
        ? "Done"
        : "👁 Edit";


    renderCategories();
  }
);


/* =====================================================
   EDIT CHANNELS
===================================================== */

elements.editChannelsButton.addEventListener(
  "click",
  () => {

    state.editingChannels =
      !state.editingChannels;


    elements.editChannelsButton
      .classList.toggle(
        "active",
        state.editingChannels
      );


    elements.editChannelsButton.textContent =
      state.editingChannels
        ? "Done"
        : "👁 Edit";


    renderChannels();
  }
);


/* =====================================================
   SETTINGS OPEN / CLOSE
===================================================== */

elements.settingsButton.addEventListener(
  "click",
  () => {

    elements.settingsModal.hidden =
      false;
  }
);


elements.closeSettingsButton.addEventListener(
  "click",
  () => {

    elements.settingsModal.hidden =
      true;


    elements.pinNotice.hidden =
      true;


    elements.newParentalPin.value =
      "";
  }
);


elements.settingsModal.addEventListener(
  "click",
  event => {

    if (
      event.target ===
      elements.settingsModal
    ) {

      elements.settingsModal.hidden =
        true;
    }
  }
);


/* =====================================================
   THEME SETTING
===================================================== */

elements.themeSelect.addEventListener(
  "change",
  event => {

    state.theme =
      event.target.value;


    localStorage.setItem(
      "theme",
      state.theme
    );


    applyTheme();
  }
);


/* =====================================================
   CHANGE PARENTAL PIN
===================================================== */

elements.updatePinButton.addEventListener(
  "click",
  async () => {

    const newPin =
      elements.newParentalPin.value
        .trim();


    if (!/^\d{4}$/.test(newPin)) {

      elements.pinNotice.textContent =
        "PIN must be exactly 4 digits.";


      elements.pinNotice.style.color =
        "#ff9292";


      elements.pinNotice.hidden =
        false;


      return;
    }


    const serviceId =
      localStorage.getItem(
        "netplusServiceId"
      );


    const mac =
      localStorage.getItem(
        "netplusMac"
      );


    /*
    Existing server.js expects serviceId,
    MAC and PIN together.

    If this installation predates v1.1.0,
    localStorage may not yet contain the
    service/MAC. In that case we cannot
    safely update without changing server.
    */

    if (!serviceId || !mac) {

      elements.pinNotice.textContent =
        "To change the PIN on this existing installation, reset the portal once and reconnect. Your service and MAC will then be remembered for future PIN changes.";


      elements.pinNotice.style.color =
        "#ffb65c";


      elements.pinNotice.hidden =
        false;


      return;
    }


    elements.updatePinButton.disabled =
      true;


    try {

      await request(
        "/api/config",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              serviceId,
              mac,
              parentalPin:
                newPin
            })
        }
      );


      state.parentalUnlocked =
        false;


      elements.pinNotice.textContent =
        "Parental PIN updated successfully.";


      elements.pinNotice.style.color =
        "#35dbc5";


      elements.pinNotice.hidden =
        false;


      elements.newParentalPin.value =
        "";


    } catch (error) {

      elements.pinNotice.textContent =
        error.message ||
        "Failed to update PIN.";


      elements.pinNotice.style.color =
        "#ff9292";


      elements.pinNotice.hidden =
        false;


    } finally {

      elements.updatePinButton.disabled =
        false;
    }
  }
);


/* =====================================================
   RESET PORTAL
===================================================== */

elements.resetPortalButton.addEventListener(
  "click",
  () => {

    const confirmed =
      window.confirm(
        "Reset the local NetPlus player configuration and return to setup?"
      );


    if (!confirmed) {
      return;
    }


    /*
    Do not wipe every preference.

    Keep:
    - Favorites
    - hidden channels/groups
    - watch history
    - theme

    Remove only locally remembered
    portal helper values.
    */

    localStorage.removeItem(
      "netplusServiceId"
    );


    localStorage.removeItem(
      "netplusMac"
    );


    state.catalog = null;

    state.selected = null;

    state.parentalUnlocked =
      false;


    resetPlayer();


    elements.settingsModal.hidden =
      true;


    /*
    NOTE:
    Existing server.js does not expose a
    DELETE config endpoint.

    Therefore this button returns to the
    setup UI so a new configuration can
    overwrite the saved config.
    */

    showSetup();
  }
);


/* =====================================================
   ESCAPE KEY
===================================================== */

document.addEventListener(
  "keydown",
  event => {

    if (event.key !== "Escape") {
      return;
    }


    if (
      !elements.vodModal.hidden
    ) {

      elements.vodModal.hidden =
        true;

      return;
    }


    if (
      !elements.settingsModal.hidden
    ) {

      elements.settingsModal.hidden =
        true;
    }
  }
);


/* =====================================================
   BOOT
===================================================== */

async function boot() {

  try {

    const result =
      await request(
        "/api/config"
      );


    if (result.configured) {

      await loadCatalog();

    } else {

      showSetup();
    }


  } catch (error) {

    showSetup();


    elements.setupError.textContent =
      error.message;


    elements.setupError.hidden =
      false;
  }
}


boot();