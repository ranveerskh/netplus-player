const state = {
  catalog: null,
  category: "all",
  query: "",
  selected: null,
  hls: null,
};

const elements = {
  workspace: document.querySelector("#workspace"),
  setup: document.querySelector("#setup"),
  setupForm: document.querySelector("#setupForm"),
  setupError: document.querySelector("#setupError"),
  connectButton: document.querySelector("#connectButton"),
  serviceId: document.querySelector("#serviceId"),
  mac: document.querySelector("#mac"),
  status: document.querySelector("#status"),
  categories: document.querySelector("#categories"),
  channels: document.querySelector("#channels"),
  groupCount: document.querySelector("#groupCount"),
  channelCount: document.querySelector("#channelCount"),
  search: document.querySelector("#search"),
  video: document.querySelector("#video"),
  placeholder: document.querySelector("#placeholder"),
  videoLoading: document.querySelector("#videoLoading"),
  nowPlaying: document.querySelector("#nowPlaying"),
  notice: document.querySelector("#notice"),
  settingsButton: document.querySelector("#settingsButton"),
};

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function setStatus(text, online = false) {
  elements.status.querySelector("span").textContent = text;
  elements.status.classList.toggle("online", online);
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
}

function showSetup() {
  elements.setup.hidden = false;
  elements.workspace.hidden = true;
  elements.setupError.hidden = true;
  setStatus("Setup required");
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "TV";
}

function renderCategories() {
  const categories = [{ id: "all", title: "All channels" }, ...state.catalog.categories];
  elements.groupCount.textContent = `${state.catalog.categories.length} groups`;
  elements.categories.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `category-button${state.category === category.id ? " active" : ""}`;
      const label = document.createElement("span");
      label.textContent = category.title;
      const arrow = document.createElement("em");
      arrow.textContent = "›";
      button.append(label, arrow);
      button.addEventListener("click", () => {
        state.category = category.id;
        renderCategories();
        renderChannels();
      });
      return button;
    }),
  );
}

function filteredChannels() {
  const query = state.query.trim().toLowerCase();
  return state.catalog.channels.filter((channel) => {
    const categoryMatches = state.category === "all" || channel.genreId === state.category;
    const queryMatches = !query || channel.name.toLowerCase().includes(query);
    return categoryMatches && queryMatches;
  });
}

function renderChannels() {
  const filtered = filteredChannels();
  elements.channelCount.textContent = `${filtered.length.toLocaleString()} channels`;
  const rows = filtered.slice(0, 300).map((channel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel-button${state.selected?.id === channel.id ? " active" : ""}`;
    const icon = document.createElement("span");
    icon.className = "channel-icon";
    icon.textContent = initials(channel.name);
    const copy = document.createElement("span");
    copy.className = "channel-copy";
    const name = document.createElement("strong");
    name.textContent = channel.name;
    const detail = document.createElement("small");
    detail.textContent = `${channel.number ? `Channel ${channel.number}` : "Live channel"}${channel.hd ? " · HD" : ""}`;
    copy.append(name, detail);
    const play = document.createElement("span");
    play.className = "channel-play";
    play.textContent = "▶";
    button.append(icon, copy, play);
    button.addEventListener("click", () => playChannel(channel));
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

async function loadCatalog() {
  elements.setup.hidden = true;
  elements.workspace.hidden = false;
  setStatus("Connecting");
  showNotice("");
  elements.channels.innerHTML = '<p class="list-note">Loading portal catalogue…</p>';
  try {
    state.catalog = await request("/api/catalog");
    setStatus("Portal connected", true);
    renderCategories();
    renderChannels();
  } catch (error) {
    setStatus("Connection failed");
    showNotice(error.message);
  }
}

async function playChannel(channel) {
  state.selected = channel;
  elements.nowPlaying.textContent = channel.name;
  elements.placeholder.hidden = true;
  elements.videoLoading.hidden = false;
  showNotice("");
  renderChannels();
  state.hls?.destroy();
  state.hls = null;
  elements.video.removeAttribute("src");
  elements.video.load();

  try {
    const payload = await request("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel.id }),
    });
    if (window.Hls?.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      state.hls = hls;
      hls.loadSource(payload.stream);
      hls.attachMedia(elements.video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        elements.videoLoading.hidden = true;
        elements.video.play().catch(() => undefined);
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        elements.videoLoading.hidden = true;
        showNotice(`Playback stopped: ${data.details}. Select the channel again or try another channel.`);
      });
    } else if (elements.video.canPlayType("application/vnd.apple.mpegurl")) {
      elements.video.src = payload.stream;
      await elements.video.play().catch(() => undefined);
      elements.videoLoading.hidden = true;
    } else {
      throw new Error("This browser does not support HLS playback.");
    }
  } catch (error) {
    elements.videoLoading.hidden = true;
    showNotice(error.message);
  }
}

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Saving…";
  elements.setupError.hidden = true;
  try {
    await request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: elements.serviceId.value, mac: elements.mac.value }),
    });
    await loadCatalog();
  } catch (error) {
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Save & connect";
  }
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  renderChannels();
});

elements.settingsButton.addEventListener("click", showSetup);

request("/api/config")
  .then((result) => (result.configured ? loadCatalog() : showSetup()))
  .catch((error) => {
    showSetup();
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  });
