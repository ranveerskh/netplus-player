/*
=========================================================
 NetPlus IPTV Player
 VERSION: 1.4.1 Diagnostic
 File: server.cjs
=========================================================
*/

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = 3847;
const ROOT = __dirname;
const CONFIG_PATH = process.env.NETPLUS_CONFIG_PATH || path.join(ROOT, "config.json");
const APP_VERSION = "1.4.1-diagnostic";
const DIAGNOSTIC_PATH = path.join(
  path.dirname(CONFIG_PATH),
  "netplus-diagnostics-v1.4.1.json"
);
const MAX_DIAGNOSTIC_EVENTS = 450;

const SERVICES = {
  edge: { name: "Netplus Edge", portalUrl: "http://sony4k.me" },
  classic: { name: "Netplus Classic", portalUrl: "http://tv.4ktv.biz" },
};

const MAG_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3";
const X_USER_AGENT = "Model: MAG250; Link: WiFi";

let catalogCache = null;
let catalogPromise = null;

const vodCache = new Map();
const seriesCache = new Map();
const relayTargets = new Map();

const ADULT_TERMS = /\b(adult|xxx|18\+|porn|erotic|sex)\b/i;

/* =====================================================
   SAFE DIAGNOSTICS

   This build records request/response SHAPES and timing only. It never
   writes the user's MAC, PIN, portal token, cookies, or full stream URLs.
===================================================== */

let diagnosticReport = {
  version: APP_VERSION,
  startedAt: new Date().toISOString(),
  events: [],
};

function redactUrl(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi, "[redacted-mac]")
    .replace(
      /\b(token|authorization|cookie|password|pin|session)=([^\s;&,]+)/gi,
      (_match, key) => `${key}=[redacted]`
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  const urlMatch = raw.match(/(?:https?|rtsp|udp):\/\/[^\s"']+/i);

  if (!urlMatch) {
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  }

  try {
    const url = new URL(urlMatch[0]);
    const safeUrl = `${url.protocol}//${url.host}${url.pathname}${url.search ? "?[redacted]" : ""}`;
    return raw.replace(urlMatch[0], safeUrl);
  } catch {
    return "[stream URL redacted]";
  }
}

function safeDiagnosticValue(value, depth = 0) {
  if (depth > 5) return "[max depth]";

  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return {
      _type: "array",
      count: value.length,
      sample: value.slice(0, 3).map((entry) => safeDiagnosticValue(entry, depth + 1)),
    };
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, 30);

    for (const [key, entry] of entries) {
      if (/(?:^|_)(?:mac|token|authorization|cookie|password|pin|session|bearer)(?:$|_)/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = safeDiagnosticValue(entry, depth + 1);
      }
    }

    if (Object.keys(value).length > entries.length) {
      output._moreKeys = Object.keys(value).length - entries.length;
    }

    return output;
  }

  return String(value);
}

function persistDiagnostics() {
  try {
    fs.mkdirSync(path.dirname(DIAGNOSTIC_PATH), { recursive: true });
    fs.writeFileSync(
      DIAGNOSTIC_PATH,
      `${JSON.stringify(diagnosticReport, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* Diagnostics must never stop the player. */
  }
}

function recordDiagnostic(event, details = {}) {
  diagnosticReport.events.push({
    at: new Date().toISOString(),
    event,
    details: safeDiagnosticValue(details),
  });

  if (diagnosticReport.events.length > MAX_DIAGNOSTIC_EVENTS) {
    diagnosticReport.events.splice(0, diagnosticReport.events.length - MAX_DIAGNOSTIC_EVENTS);
  }

  persistDiagnostics();
}

function resetDiagnostics() {
  diagnosticReport = {
    version: APP_VERSION,
    startedAt: new Date().toISOString(),
    events: [],
  };
  recordDiagnostic("diagnostic.reset", { note: "Fresh test started from Settings." });
}

function shouldDiagnosePortalRequest(params) {
  return (
    params?.type === "vod" ||
    params?.type === "series" ||
    (params?.type === "itv" && params?.action === "create_link")
  );
}

class PlayerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function normalizePortalUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new PlayerError("Enter a valid portal URL.", 400);
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new PlayerError("Portal URL must start with http:// or https://.", 400);
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");

  if (/\/(?:server\/load\.php|portal\.php)$/i.test(cleanPath)) {
    url.pathname = cleanPath;
  } else if (/\/stalker_portal\/c$/i.test(cleanPath)) {
    url.pathname = cleanPath.replace(/\/c$/i, "/server/load.php");
  } else if (/\/stalker_portal$/i.test(cleanPath)) {
    url.pathname = `${cleanPath}/server/load.php`;
  } else if (!cleanPath) {
    url.pathname = "/stalker_portal/server/load.php";
  } else {
    url.pathname = `${cleanPath}/stalker_portal/server/load.php`;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function readConfig() {
  const portalFromEnv = process.env.STALKER_PORTAL_URL?.trim();
  const macFromEnv = process.env.STALKER_MAC?.trim();
  const stored = readStoredConfig();

  const service = SERVICES[stored.serviceId];
  const portalUrl = portalFromEnv || service?.portalUrl || stored.portalUrl;
  const mac = (macFromEnv || stored.mac || "").trim().toUpperCase();

  if (!portalUrl || !mac) return null;

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("Saved MAC address is invalid.", 400);
  }

  return {
    endpoint: normalizePortalUrl(portalUrl),
    portalUrl,
    serviceId: stored.serviceId || null,
    mac,
    baseCookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=America%2FToronto`,
  };
}

function pinHash(pin) {
  return scryptSync(pin, "netplus-parental-v1", 32).toString("hex");
}

function isAdult(title) {
  return ADULT_TERMS.test(String(title || ""));
}

function saveConfig(serviceId, macInput, parentalPin) {
  const service = SERVICES[serviceId];

  if (!service) {
    throw new PlayerError("Choose Netplus Edge or Netplus Classic.", 400);
  }

  const mac = String(macInput || "").trim().toUpperCase();

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("Enter all 12 MAC digits.", 400);
  }

  const existing = readStoredConfig();
  const pin = String(parentalPin || "").trim();

  const parentalPinHash =
    /^\d{4}$/.test(pin) ? pinHash(pin) : existing.parentalPinHash;

  if (!parentalPinHash) {
    throw new PlayerError(
      "Set a 4-digit parental PIN to protect restricted content.",
      400
    );
  }

  fs.writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify({ serviceId, mac, parentalPinHash }, null, 2)}\n`,
    "utf8"
  );

  catalogCache = null;
  catalogPromise = null;
  vodCache.clear();
  seriesCache.clear();
  relayTargets.clear();
}

function loadBalancerCookie(headers) {
  const setCookie = headers.get("set-cookie") || "";
  return setCookie.match(/(?:^|[,;]\s*)(__cflb=[^;,\s]+)/i)?.[1] || "";
}

async function portalRequest(params, session) {
  const config = readConfig();

  if (!config) {
    throw new PlayerError("Complete local player setup first.", 400);
  }

  const url = new URL(config.endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("JsHttpRequest", "1-xml");

  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: session?.cookie || config.baseCookie,
    "User-Agent": MAG_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
  };

  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  const startedAt = Date.now();

  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.timeout", {
        request: params,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw new PlayerError("Portal connection timed out.");
  }

  if (!response.ok) {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.http_error", {
        request: params,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw new PlayerError(`Portal returned status ${response.status}.`);
  }

  const text = await response.text();

  if (text.trim() === "Authorization failed.") {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.authorization_failed", {
        request: params,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw new PlayerError("Portal rejected this MAC address.", 401);
  }

  try {
    const data = JSON.parse(text);

    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.response", {
        request: params,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        response: data,
      });
    }

    return {
      data,
      headers: response.headers,
    };
  } catch {
    if (shouldDiagnosePortalRequest(params)) {
      recordDiagnostic("portal.invalid_json", {
        request: params,
        elapsedMs: Date.now() - startedAt,
        responsePreview: text.slice(0, 180),
      });
    }
    throw new PlayerError("Portal returned an unexpected response.");
  }
}

async function createSession() {
  const config = readConfig();

  if (!config) {
    throw new PlayerError("Complete local player setup first.", 400);
  }

  const handshake = await portalRequest({
    type: "stb",
    action: "handshake",
    token: "",
  });

  const token = handshake.data?.js?.token;

  if (!token || handshake.data?.js?.not_valid === 1) {
    throw new PlayerError("Portal did not authorize this MAC address.", 401);
  }

  const extraCookie = loadBalancerCookie(handshake.headers);

  const session = {
    token,
    cookie: [config.baseCookie, extraCookie].filter(Boolean).join("; "),
  };

  const profile = await portalRequest(
    {
      type: "stb",
      action: "get_profile",
      hd: "1",
      stb_type: "MAG250",
      image_version: "218",
      auth_second_step: "1",
      not_valid_token: "0",
    },
    session
  );

  if (!profile.data?.js) {
    throw new PlayerError("MAC profile is unavailable.", 401);
  }

  return session;
}

async function rebuildCatalog() {
  const session = await createSession();

  const [genresResponse, channelsResponse] = await Promise.all([
    portalRequest({ type: "itv", action: "get_genres" }, session),
    portalRequest({ type: "itv", action: "get_all_channels" }, session),
  ]);

  const genres = Array.isArray(genresResponse.data?.js)
    ? genresResponse.data.js
    : [];

  const rawChannels = Array.isArray(channelsResponse.data?.js?.data)
    ? channelsResponse.data.js.data
    : [];

  const commands = new Map();

  const channels = rawChannels
    .filter((channel) => channel.id != null && channel.name && channel.cmd)
    .map((channel) => {
      const id = String(channel.id);
      commands.set(id, String(channel.cmd));

      const number = Number(channel.number);

      return {
        id,
        name: String(channel.name).trim(),
        number: Number.isFinite(number) ? number : null,
        genreId: String(channel.tv_genre_id ?? "0"),
        hd: String(channel.hd) === "1",
      };
    })
    .sort(
      (a, b) =>
        (a.number ?? Number.MAX_SAFE_INTEGER) -
          (b.number ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
    );

  catalogCache = {
    session,
    commands,
    expiresAt: Date.now() + 2 * 60_000,
    publicCatalog: {
      categories: genres
        .filter((genre) => genre.id != null && genre.title)
        .map((genre) => ({
          id: String(genre.id),
          title: String(genre.title).trim(),
          locked: isAdult(genre.title),
        })),
      channels,
    },
  };

  return catalogCache;
}

async function activeCatalog(force = false) {
  if (!force && catalogCache?.expiresAt > Date.now()) {
    return catalogCache;
  }

  if (!force && catalogPromise) {
    return catalogPromise;
  }

  catalogPromise = rebuildCatalog().finally(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

function parsePortalStream(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^(?:ffmpeg|ffrt|auto)\s+/i, "");

  try {
    const url = new URL(cleaned);

    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Unsupported stream");
    }

    return url.toString();
  } catch {
    throw new PlayerError("Portal did not return a playable stream.");
  }
}

async function getStreamUrl(channelId, retry = true) {
  const catalog = await activeCatalog();
  const command = catalog.commands.get(channelId);

  if (!command) {
    throw new PlayerError("Channel is no longer available.", 404);
  }

  try {
    const response = await portalRequest(
      {
        type: "itv",
        action: "create_link",
        cmd: command,
        series: "0",
        forced_storage: "undefined",
        disable_ad: "0",
        download: "0",
      },
      catalog.session
    );

    const raw =
      typeof response.data?.js === "string"
        ? response.data.js
        : response.data?.js?.cmd || "";
    const streamUrl = parsePortalStream(raw);

    recordDiagnostic("live.playback_link", {
      channelId,
      command,
      returnedLink: raw,
      streamUrl,
    });

    return streamUrl;
  } catch (error) {
    if (retry && error instanceof PlayerError && error.status === 401) {
      await activeCatalog(true);
      return getStreamUrl(channelId, false);
    }

    throw error;
  }
}

function cleanPosterUrl(value) {
  const raw = String(value || "").trim();

  if (!raw || raw === "0") return "";

  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeMediaItem(row, kind = "vod") {
  const id = row?.id ?? row?.series_id ?? row?.movie_id ?? row?.stream_id;

  return {
    id: String(id ?? ""),
    title: String(row.name || row.title || "").trim(),
    description: String(
      row.description || row.description_en || row.plot || ""
    ).trim(),
    year: String(row.year || "").trim(),
    rating: String(
      row.rating_imdb || row.rating || row.kinopoisk_rating || ""
    ).trim(),
    poster: cleanPosterUrl(
      row.screenshot_uri ||
        row.poster ||
        row.cover ||
        row.logo ||
        row.movie_image
    ),
    cmd: String(row.cmd || row.command || row.playback_cmd || ""),
    kind,
  };
}

/* =====================================================
   VOD / MOVIES
===================================================== */

async function getVodCategories() {
  const catalog = await activeCatalog();

  const response = await portalRequest(
    { type: "vod", action: "get_categories" },
    catalog.session
  );

  const rows = Array.isArray(response.data?.js) ? response.data.js : [];

  return rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));
}

async function getVodItems(categoryId, page = 0) {
  const safePage = Math.max(0, Math.min(Number(page) || 0, 100));
  const key = `${categoryId}:${safePage}`;

  const cached = vodCache.get(key);

  if (cached?.expiresAt > Date.now()) {
    return cached.value;
  }

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "vod",
      action: "get_ordered_list",
      category: categoryId,
      p: safePage,
      sortby: "added",
    },
    catalog.session
  );

  const js = response.data?.js || {};
  const rows = Array.isArray(js)
    ? js
    : Array.isArray(js.data)
      ? js.data
      : Array.isArray(response.data)
        ? response.data
        : [];

  /*
    Do NOT require cmd here. Some Stalker portals only provide the
    playable command in get_vod_info/get_ordered_list variations.
    Keeping the title visible fixes categories that previously looked empty.
  */
  const items = rows
    .filter((row) =>
      (row.id ?? row.series_id ?? row.movie_id ?? row.stream_id) != null &&
      (row.name || row.title)
    )
    .map((row) => normalizeMediaItem(row, "vod"));

  const value = {
    items,
    total: Number(js.total_items) || Number(js.total) || items.length,
    page: safePage,
  };

  vodCache.set(key, {
    value,
    expiresAt: Date.now() + 5 * 60_000,
  });

  return value;
}

async function findVodItem(categoryId, itemId) {
  for (let page = 0; page <= 10; page += 1) {
    const result = await getVodItems(categoryId, page);
    const item = result.items.find((entry) => entry.id === itemId);

    if (item) return item;

    if (!result.items.length) break;
    if (result.total && (page + 1) * result.items.length >= result.total) {
      /* harmless optimization for smaller catalogues */
    }
  }

  return null;
}

async function resolveVodCommand(item) {
  if (item?.cmd) {
    recordDiagnostic("vod.command_from_list", {
      itemId: item.id,
      title: item.title,
      command: item.cmd,
    });
    return item.cmd;
  }

  const catalog = await activeCatalog();

  const info = await portalRequest(
    {
      type: "vod",
      action: "get_vod_info",
      movie_id: item.id,
    },
    catalog.session
  );

  const js = info.data?.js || {};

  const command = String(
    js.cmd ||
      js.movie?.cmd ||
      js.data?.cmd ||
      js.info?.cmd ||
      js.url ||
      ""
  );

  recordDiagnostic(command ? "vod.command_resolved" : "vod.command_missing", {
    itemId: item.id,
    title: item.title,
    command,
    info: js,
  });

  return command;
}

async function getVodStreamUrl(categoryId, itemId) {
  const item = await findVodItem(categoryId, itemId);

  if (!item) {
    throw new PlayerError(
      "Movie is no longer available. Refresh Movies and try again.",
      404
    );
  }

  const catalog = await activeCatalog();
  const command = await resolveVodCommand(item);

  if (!command) {
    throw new PlayerError("Portal did not provide a movie playback command.");
  }

  const response = await portalRequest(
    {
      type: "vod",
      action: "create_link",
      cmd: command,
      series: "0",
      forced_storage: "undefined",
      disable_ad: "0",
      download: "0",
    },
    catalog.session
  );

  const raw =
    typeof response.data?.js === "string"
      ? response.data.js
      : response.data?.js?.cmd || "";
  const streamUrl = parsePortalStream(raw);

  recordDiagnostic("vod.playback_link", {
    itemId,
    title: item.title,
    command,
    returnedLink: raw,
    streamUrl,
  });

  return streamUrl;
}

/* =====================================================
   SERIES SUPPORT
   Endpoints are ready for the next UI step:
   /api/series/categories
   /api/series/items
   /api/series/seasons
   /api/series/episodes
   /api/series/play
===================================================== */

async function getSeriesCategories() {
  const catalog = await activeCatalog();

  const response = await portalRequest(
    { type: "series", action: "get_categories" },
    catalog.session
  );

  const rows = Array.isArray(response.data?.js) ? response.data.js : [];

  return rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));
}

async function getSeriesItems(categoryId, page = 0) {
  const safePage = Math.max(0, Math.min(Number(page) || 0, 100));
  const key = `items:${categoryId}:${safePage}`;

  const cached = seriesCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "series",
      action: "get_ordered_list",
      category: categoryId,
      p: safePage,
    },
    catalog.session
  );

  const js = response.data?.js || {};
  const rows = Array.isArray(js)
    ? js
    : Array.isArray(js.data)
      ? js.data
      : Array.isArray(response.data)
        ? response.data
        : [];

  const items = rows
    .filter((row) =>
      (row.id ?? row.series_id ?? row.movie_id ?? row.stream_id) != null &&
      (row.name || row.title)
    )
    .map((row) => normalizeMediaItem(row, "series"));

  const value = {
    items,
    total: Number(js.total_items) || Number(js.total) || items.length,
    page: safePage,
  };

  seriesCache.set(key, {
    value,
    expiresAt: Date.now() + 5 * 60_000,
  });

  return value;
}

function normalizeEpisode(raw, seasonNumber, index) {
  const id =
    raw.id ??
    raw.series_id ??
    raw.episode_id ??
    raw.ch_id ??
    `${seasonNumber}-${index + 1}`;

  return {
    id: String(id),
    title: String(
      raw.name ||
        raw.title ||
        raw.episode_name ||
        `Episode ${raw.episode_num || index + 1}`
    ).trim(),
    episode: Number(raw.episode_num || raw.episode || index + 1),
    season: Number(raw.season || seasonNumber || 1),
    cmd: String(raw.cmd || raw.command || ""),
  };
}

async function getSeriesInfo(seriesId) {
  const key = `info:${seriesId}`;

  const cached = seriesCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "series",
      action: "get_ordered_list",
      movie_id: seriesId,
      series_id: seriesId,
      p: 0,
    },
    catalog.session
  );

  let js = response.data?.js || {};

  /*
    Different Stalker builds expose series details through different
    actions. Fall back to get_series_info when get_ordered_list does
    not contain season/episode information.
  */
  const hasUsefulInfo =
    Array.isArray(js.seasons) ||
    Array.isArray(js.episodes) ||
    Array.isArray(js.data?.seasons) ||
    Array.isArray(js.data?.episodes);

  if (!hasUsefulInfo) {
    try {
      const infoResponse = await portalRequest(
        {
          type: "series",
          action: "get_series_info",
          series_id: seriesId,
          movie_id: seriesId,
        },
        catalog.session
      );

      if (infoResponse.data?.js) {
        js = infoResponse.data.js;
      }
    } catch {
      /* Keep first response and normalize whatever it contains. */
    }
  }

  seriesCache.set(key, {
    value: js,
    expiresAt: Date.now() + 5 * 60_000,
  });

  recordDiagnostic("series.info_normalized", {
    seriesId,
    seasonCount: extractSeasons(js).length,
    episodeCounts: extractSeasons(js).map((season) => ({
      season: season.number,
      episodes: extractEpisodes(js, season.number).length,
    })),
    info: js,
  });

  return js;
}

function extractSeasons(info) {
  const rawSeasons =
    (Array.isArray(info?.seasons) && info.seasons) ||
    (Array.isArray(info?.data?.seasons) && info.data.seasons) ||
    [];

  if (rawSeasons.length) {
    return rawSeasons.map((season, index) => ({
      id: String(season.id ?? season.season ?? index + 1),
      number: Number(season.season ?? season.number ?? index + 1),
      title: String(
        season.name ||
          season.title ||
          `Season ${season.season ?? season.number ?? index + 1}`
      ),
    }));
  }

  const rawEpisodes =
    (Array.isArray(info?.episodes) && info.episodes) ||
    (Array.isArray(info?.data?.episodes) && info.data.episodes) ||
    [];

  const numbers = new Set();

  rawEpisodes.forEach((episode) => {
    numbers.add(Number(episode.season || 1));
  });

  return [...numbers]
    .sort((a, b) => a - b)
    .map((number) => ({
      id: String(number),
      number,
      title: `Season ${number}`,
    }));
}

function extractEpisodes(info, seasonNumber) {
  const rawEpisodes =
    (Array.isArray(info?.episodes) && info.episodes) ||
    (Array.isArray(info?.data?.episodes) && info.data.episodes) ||
    [];

  if (rawEpisodes.length) {
    return rawEpisodes
      .filter(
        (episode) =>
          Number(episode.season || seasonNumber || 1) === Number(seasonNumber)
      )
      .map((episode, index) =>
        normalizeEpisode(episode, seasonNumber, index)
      );
  }

  const rawSeasons =
    (Array.isArray(info?.seasons) && info.seasons) ||
    (Array.isArray(info?.data?.seasons) && info.data.seasons) ||
    [];

  const season = rawSeasons.find(
    (entry, index) =>
      Number(entry.season ?? entry.number ?? index + 1) === Number(seasonNumber)
  );

  const episodes =
    season?.episodes ||
    season?.series ||
    season?.data ||
    [];

  return Array.isArray(episodes)
    ? episodes.map((episode, index) =>
        normalizeEpisode(episode, seasonNumber, index)
      )
    : [];
}

async function getSeriesEpisodeStream(seriesId, seasonNumber, episodeId) {
  const info = await getSeriesInfo(seriesId);
  const episodes = extractEpisodes(info, seasonNumber);

  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));

  if (!episode) {
    recordDiagnostic("series.episode_missing", {
      seriesId,
      seasonNumber,
      episodeId,
      availableEpisodes: episodes,
    });
    throw new PlayerError("Episode is no longer available.", 404);
  }

  if (!episode.cmd) {
    recordDiagnostic("series.episode_command_missing", {
      seriesId,
      seasonNumber,
      episodeId,
      episode,
    });
    throw new PlayerError("Portal did not provide an episode playback command.");
  }

  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "series",
      action: "create_link",
      cmd: episode.cmd,
      series: "1",
      forced_storage: "undefined",
      disable_ad: "0",
      download: "0",
    },
    catalog.session
  );

  const raw =
    typeof response.data?.js === "string"
      ? response.data.js
      : response.data?.js?.cmd || "";
  const streamUrl = parsePortalStream(raw);

  recordDiagnostic("series.playback_link", {
    seriesId,
    seasonNumber,
    episodeId,
    episode,
    returnedLink: raw,
    streamUrl,
  });

  return streamUrl;
}

/* =====================================================
   RELAY
===================================================== */

function createRelayTarget(url, lifetimeMs = 2 * 60 * 60_000, context = "unknown") {
  if (typeof lifetimeMs === "string") {
    context = lifetimeMs;
    lifetimeMs = 2 * 60 * 60_000;
  }

  const ticket = randomBytes(18).toString("base64url");

  relayTargets.set(ticket, {
    url,
    expiresAt: Date.now() + lifetimeMs,
    context,
  });

  return `/stream/${ticket}`;
}

function rewriteUriAttributes(line, baseUrl, context) {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    return `URI="${createRelayTarget(new URL(uri, baseUrl).toString(), `${context}:manifest-uri`)}"`;
  });
}

function rewriteManifest(manifest, baseUrl, context) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return rewriteUriAttributes(line, baseUrl, context);
      }

      return createRelayTarget(
        new URL(trimmed, baseUrl).toString(),
        `${context}:segment`
      );
    })
    .join("\n");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function downloadDiagnosticReport(res) {
  const body = `${JSON.stringify(diagnosticReport, null, 2)}\n`;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Content-Disposition": "attachment; filename=netplus-diagnostics-v1.4.1.json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });

  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let failed = false;

    req.on("data", (chunk) => {
      if (failed) return;

      body += chunk;

      if (body.length > 64 * 1024) {
        failed = true;
        reject(new PlayerError("Request too large.", 413));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (failed) return;

      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new PlayerError("Invalid request.", 400));
      }
    });

    req.on("error", reject);
  });
}

function serveFile(res, filename, contentType) {
  try {
    const data = fs.readFileSync(path.join(ROOT, filename));

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,

      /*
        v1.4: disable cache for app files while testing.
        This prevents Windows/browser from silently running old JS/CSS.
      */
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(data);
  } catch {
    text(res, 404, "Not found.");
  }
}

function isLikelyHls(url, contentType = "") {
  return (
    String(contentType).toLowerCase().includes("mpegurl") ||
    /\.m3u8(?:$|\?)/i.test(String(url))
  );
}

async function relay(req, res, ticket) {
  const target = relayTargets.get(ticket);

  if (!target || target.expiresAt < Date.now()) {
    relayTargets.delete(ticket);
    return text(res, 401, "Stream link expired. Select the channel again.");
  }

  const headers = {
    Accept: "*/*",
    "User-Agent": MAG_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
    Referer: target.url,
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  let upstream;
  const startedAt = Date.now();

  try {
    upstream = await fetch(target.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    recordDiagnostic("relay.timeout", {
      context: target.context,
      url: target.url,
      elapsedMs: Date.now() - startedAt,
    });
    return text(res, 504, "Stream server timed out.");
  }

  if (!upstream.ok && upstream.status !== 206) {
    recordDiagnostic("relay.http_error", {
      context: target.context,
      url: upstream.url || target.url,
      status: upstream.status,
      elapsedMs: Date.now() - startedAt,
      contentType: upstream.headers.get("content-type") || "",
    });
    return text(
      res,
      upstream.status,
      `Stream server returned ${upstream.status}.`
    );
  }

  const contentType = upstream.headers.get("content-type") || "";
  const isManifest = isLikelyHls(upstream.url, contentType);

  recordDiagnostic("relay.response", {
    context: target.context,
    url: upstream.url || target.url,
    status: upstream.status,
    elapsedMs: Date.now() - startedAt,
    contentType,
    contentLength: upstream.headers.get("content-length") || "",
    isManifest,
    ranged: Boolean(req.headers.range),
  });

  if (isManifest) {
    const body = rewriteManifest(await upstream.text(), upstream.url, target.context);

    return text(
      res,
      200,
      body,
      "application/vnd.apple.mpegurl; charset=utf-8"
    );
  }

  const responseHeaders = {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
  };

  for (const header of [
    "accept-ranges",
    "content-range",
    "content-length",
    "content-disposition",
  ]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    return res.end();
  }

  const readable = Readable.fromWeb(upstream.body);

  req.on("close", () => {
    try {
      readable.destroy();
    } catch {}
  });

  readable.on("error", () => {
    recordDiagnostic("relay.body_error", {
      context: target.context,
      url: upstream.url || target.url,
      elapsedMs: Date.now() - startedAt,
    });
    if (!res.destroyed) res.destroy();
  });

  readable.on("end", () => {
    recordDiagnostic("relay.complete", {
      context: target.context,
      url: upstream.url || target.url,
      elapsedMs: Date.now() - startedAt,
    });
  });

  readable.pipe(res);
}

/* =====================================================
   ROUTES
===================================================== */

async function handle(req, res) {
  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "GET" && requestUrl.pathname === "/") {
    return serveFile(res, "index.html", "text/html; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/styles.css") {
    return serveFile(res, "styles.css", "text/css; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/app.js") {
    return serveFile(res, "app.js", "text/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/hls.min.js") {
    return serveFile(res, "hls.min.js", "text/javascript; charset=utf-8");
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/config") {
    let configured = false;
    let parentalConfigured = false;
    let serviceId = null;
    let mac = "";

    try {
      configured = Boolean(readConfig());
      const stored = readStoredConfig();
      parentalConfigured = Boolean(stored.parentalPinHash);
      serviceId = stored.serviceId || null;
      mac = stored.mac || "";
    } catch {
      configured = false;
    }

    return json(res, 200, {
      configured,
      parentalConfigured,
      serviceId,
      mac,
      services: Object.entries(SERVICES).map(([id, service]) => ({
        id,
        name: service.name,
      })),
    });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/config") {
    const body = await readJson(req);
    saveConfig(body.serviceId, body.mac, body.parentalPin);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/diagnostics/reset") {
    resetDiagnostics();
    return json(res, 200, { ok: true, startedAt: diagnosticReport.startedAt });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/diagnostics/event") {
    const body = await readJson(req);
    const event = String(body.event || "client.event").slice(0, 80);
    recordDiagnostic(event, body.details || {});
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/diagnostics/download") {
    return downloadDiagnosticReport(res);
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/parental/verify"
  ) {
    const body = await readJson(req);
    const stored = readStoredConfig();

    const actual = Buffer.from(stored.parentalPinHash || "", "hex");
    const expected = Buffer.from(
      pinHash(String(body.pin || "")),
      "hex"
    );

    const valid =
      actual.length > 0 &&
      actual.length === expected.length &&
      timingSafeEqual(actual, expected);

    return json(
      res,
      valid ? 200 : 401,
      valid ? { ok: true } : { error: "Incorrect parental PIN." }
    );
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/catalog") {
    return json(res, 200, (await activeCatalog()).publicCatalog);
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/vod/categories"
  ) {
    return json(res, 200, {
      categories: await getVodCategories(),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/vod/items"
  ) {
    const categoryId = requestUrl.searchParams.get("categoryId");

    if (!categoryId) {
      throw new PlayerError("Choose a VOD category.", 400);
    }

    return json(
      res,
      200,
      await getVodItems(
        categoryId,
        requestUrl.searchParams.get("page")
      )
    );
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/play") {
    const body = await readJson(req);

    if (typeof body.channelId !== "string") {
      throw new PlayerError("Choose a valid channel.", 400);
    }

    /*
      Always request a fresh portal create_link on each recovery.
      app.js v1.4 will call this again if a short-lived IPTV URL dies.
    */
    const streamUrl = await getStreamUrl(body.channelId);

    return json(res, 200, {
      stream: createRelayTarget(streamUrl, "live"),
      hls: /\.m3u8(?:$|\?)/i.test(streamUrl),
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/vod/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.categoryId !== "string" ||
      typeof body.itemId !== "string"
    ) {
      throw new PlayerError("Choose a valid movie.", 400);
    }

    const streamUrl = await getVodStreamUrl(
      body.categoryId,
      body.itemId
    );

    return json(res, 200, {
      stream: createRelayTarget(streamUrl, "vod"),
      hls: /\.m3u8(?:$|\?)/i.test(streamUrl),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/categories"
  ) {
    return json(res, 200, {
      categories: await getSeriesCategories(),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/items"
  ) {
    const categoryId = requestUrl.searchParams.get("categoryId");

    if (!categoryId) {
      throw new PlayerError("Choose a series category.", 400);
    }

    return json(
      res,
      200,
      await getSeriesItems(
        categoryId,
        requestUrl.searchParams.get("page")
      )
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/seasons"
  ) {
    const seriesId = requestUrl.searchParams.get("seriesId");

    if (!seriesId) {
      throw new PlayerError("Choose a series.", 400);
    }

    const info = await getSeriesInfo(seriesId);

    return json(res, 200, {
      seasons: extractSeasons(info),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/series/episodes"
  ) {
    const seriesId = requestUrl.searchParams.get("seriesId");
    const season = requestUrl.searchParams.get("season");

    if (!seriesId || !season) {
      throw new PlayerError("Choose a series and season.", 400);
    }

    const info = await getSeriesInfo(seriesId);

    return json(res, 200, {
      episodes: extractEpisodes(info, Number(season)),
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/series/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.seriesId !== "string" ||
      body.season == null ||
      body.episodeId == null
    ) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    const streamUrl = await getSeriesEpisodeStream(
      body.seriesId,
      Number(body.season),
      String(body.episodeId)
    );

    return json(res, 200, {
      stream: createRelayTarget(streamUrl, "series"),
      hls: /\.m3u8(?:$|\?)/i.test(streamUrl),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname.startsWith("/stream/")
  ) {
    return relay(
      req,
      res,
      requestUrl.pathname.slice("/stream/".length)
    );
  }

  return text(res, 404, "Not found.");
}

/* =====================================================
   SERVER
===================================================== */

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error.message);
    recordDiagnostic("local.request_error", {
      method: req.method,
      path: new URL(req.url, `http://${HOST}:${PORT}`).pathname,
      status: error.status || 500,
      message: error.message || "Local player request failed.",
    });

    if (res.headersSent) {
      return res.destroy();
    }

    json(res, error.status || 500, {
      error: error.message || "Local player request failed.",
    });
  });
});

function openBrowser() {
  const url = `http://${HOST}:${PORT}`;

  if (process.env.NO_OPEN_BROWSER === "1") return;

  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  try {
    spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(
      "Player is already running. Opening it in your browser..."
    );

    openBrowser();

    setTimeout(() => process.exit(0), 800);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`NetPlus IPTV Player v${APP_VERSION} is running.`);
  console.log(`Open http://${HOST}:${PORT}`);
  console.log(
    "Keep this window open while watching. Close it to stop the player."
  );

  openBrowser();
});
