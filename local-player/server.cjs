/*
=========================================================
 NetPlus IPTV Player
 VERSION: 1.5.7 Native VOD CDN Request Fix
 File: server.cjs
=========================================================
*/

const http = require("node:http");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");

/* IPTV/CDN hosts used by the provider can publish broken IPv6 routes. */
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const HOST = "127.0.0.1";
const PORT = 3847;
const ROOT = __dirname;
const CONFIG_PATH = process.env.NETPLUS_CONFIG_PATH || path.join(ROOT, "config.json");
const APP_VERSION = "1.5.7";
const DIAGNOSTIC_PATH = path.join(
  path.dirname(CONFIG_PATH),
  "netplus-diagnostics-v1.5.7.json"
);
const MAX_DIAGNOSTIC_EVENTS = 450;

const SERVICES = {
  edge: { name: "Netplus Edge", portalUrl: "http://sony4k.me" },
  classic: { name: "Netplus Classic", portalUrl: "http://tv.4ktv.biz" },
};

const MAG_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3";
const X_USER_AGENT = "Model: MAG250; Link: WiFi";
/* STBEmu's native media path identifies itself differently from the portal UI. */
const MEDIA_USER_AGENT = "Lavf53.32.100";

let catalogCache = null;
let catalogPromise = null;
let vodCategoriesCache = null;

const vodCache = new Map();
const vodInfoCache = new Map();
const seriesCache = new Map();
const qualityOptionCache = new Map();
const relayTargets = new Map();
const relayTicketsByKey = new Map();

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
  vodCategoriesCache = null;
  vodCache.clear();
  seriesCache.clear();
  relayTargets.clear();
  relayTicketsByKey.clear();
}

function extractSetCookiePairs(headers) {
  if (!headers) return [];

  let values = [];

  try {
    if (typeof headers.getSetCookie === "function") {
      values = headers.getSetCookie();
    }
  } catch {}

  if (!Array.isArray(values) || values.length === 0) {
    const combined = headers.get?.("set-cookie") || "";
    values = combined ? [combined] : [];
  }

  const pairs = [];

  for (const value of values) {
    /* Node versions without getSetCookie() may join multiple cookies. */
    const chunks = String(value || "").split(/,(?=\s*[^;,=\s]+=[^;,]*)/);

    for (const chunk of chunks) {
      const pair = String(chunk).split(";", 1)[0].trim();
      if (/^[^=;\s]+=[^;]*$/.test(pair)) pairs.push(pair);
    }
  }

  return pairs;
}

function mergeCookieHeader(existing, headersOrPairs) {
  const jar = new Map();

  for (const part of String(existing || "").split(";")) {
    const pair = part.trim();
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }

  const pairs = Array.isArray(headersOrPairs)
    ? headersOrPairs
    : extractSetCookiePairs(headersOrPairs);

  for (const pair of pairs) {
    const index = String(pair).indexOf("=");
    if (index > 0) {
      jar.set(String(pair).slice(0, index).trim(), String(pair).slice(index + 1));
    }
  }

  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function loadBalancerCookie(headers) {
  return extractSetCookiePairs(headers)
    .find((pair) => /^__cflb=/i.test(pair)) || "";
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

  /* Keep every provider session cookie, not only Cloudflare's __cflb. */
  if (session) {
    session.cookie = mergeCookieHeader(session.cookie, response.headers);
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

  const session = {
    token,
    cookie: mergeCookieHeader(config.baseCookie, handshake.headers),
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
    .replace(/^(?:ffmpeg|ffrt|auto)\s+/i, "")
    .replace(/&amp;/gi, "&");

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

/*
  Some Stalker portals return the final CDN URL while resolving a movie or
  episode quality. Sending that URL through create_link a second time makes
  those portals interpret it as a missing movie id and return
  "nothing_to_play". Only opaque/relative commands need create_link.
*/
function directStreamFromCommand(command) {
  try {
    return parsePortalStream(command);
  } catch {
    return "";
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
  const videoId = row?.video_id ?? row?.movie_id ?? row?.id ?? row?.series_id;
  const movieId = row?.movie_id ?? row?.video_id ?? row?.id ?? row?.series_id;
  const seriesValue = row?.series;
  const seriesFlag = typeof seriesValue === "object"
    ? ""
    : String(seriesValue ?? "").trim().toLowerCase();
  const hasSeriesShape =
    kind === "series" ||
    ["1", "true", "yes"].includes(seriesFlag) ||
    row?.series_name != null ||
    row?.seasons != null ||
    row?.episodes != null ||
    row?.season != null ||
    (seriesValue && typeof seriesValue === "object" &&
      (Array.isArray(seriesValue) ? seriesValue.length > 0 : Object.keys(seriesValue).length > 0));

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
        row.pic ||
        row.poster ||
        row.cover ||
        row.logo ||
        row.movie_image
    ),
    cmd: String(row.cmd || row.command || row.playback_cmd || ""),
    videoId: String(videoId ?? ""),
    movieId: String(movieId ?? ""),
    path: String(row.path || row.file || "").trim(),
    protocol: String(row.protocol || "").trim(),
    kind: hasSeriesShape ? "series" : "vod",
    isSeries: hasSeriesShape,
    categoryId: row?.category_id == null ? undefined : String(row.category_id),
  };
}

function uniqueMediaIds(itemOrId) {
  const candidates = itemOrId && typeof itemOrId === "object"
    ? [
        itemOrId.movieId,
        itemOrId.movie_id,
        itemOrId.videoId,
        itemOrId.video_id,
        itemOrId.id,
        itemOrId.seriesId,
        itemOrId.series_id,
      ]
    : [itemOrId];

  return [...new Set(
    candidates
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
}

function portalRows(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 6) return [];

  if (typeof value === "string") {
    try {
      return portalRows(JSON.parse(value), depth + 1, seen);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const preferredKeys = [
    "data",
    "items",
    "records",
    "list",
    "seasons",
    "episodes",
    "series",
    "qualities",
    "streams",
    "js",
    "result",
    "payload",
  ];

  for (const key of preferredKeys) {
    if (value[key] == null) continue;
    const rows = portalRows(value[key], depth + 1, seen);
    if (rows.length) return rows;
  }

  return [];
}

function hierarchyTitle(row) {
  return String(
    row?.name || row?.title || row?.episode_name || row?.season_name || ""
  ).trim();
}

function numberFromTitle(value, expression, fallback) {
  const match = String(value || "").match(expression);
  return numberOrFallback(match?.[1], fallback);
}

function seasonNumberFromRow(row, index = 0) {
  return numberOrFallback(
    row?.season_number ?? row?.season_num ?? row?.season ?? row?.number,
    numberFromTitle(hierarchyTitle(row), /(?:^|\b)(?:season|s)\s*[-_.:]?\s*(\d+)/i, index + 1)
  );
}

function episodeNumberFromRow(row, index = 0) {
  return numberOrFallback(
    row?.episode_num ?? row?.episode_number ?? row?.episode ?? row?.number,
    numberFromTitle(hierarchyTitle(row), /(?:^|\b)(?:episode|ep|e)\s*[-_.:]?\s*(\d+)/i, index + 1)
  );
}

function isSeasonHierarchyRow(row) {
  if (!row || typeof row !== "object") return false;
  return (
    row.season_id != null ||
    row.season_number != null ||
    row.season_num != null ||
    row.season != null ||
    /(?:^|\b)(?:season|s)\s*[-_.:]?\s*\d+/i.test(hierarchyTitle(row))
  );
}

function isEpisodeHierarchyRow(row) {
  if (!row || typeof row !== "object") return false;
  return (
    row.episode_id != null ||
    row.episode_num != null ||
    row.episode_number != null ||
    row.episode != null ||
    /(?:^|\b)(?:episode|ep|e)\s*[-_.:]?\s*\d+/i.test(hierarchyTitle(row))
  );
}

function hasVodHierarchySignal(rows) {
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    if (isSeasonHierarchyRow(row) || isEpisodeHierarchyRow(row)) return true;

    return Boolean(
      firstNestedValue(row, QUALITY_COMMAND_KEYS) ||
      row.qualities ||
      row.streams ||
      row.quality ||
      row.resolution
    );
  });
}

function portalProviderError(value) {
  const direct = firstNestedValue(value, ["error", "error_message", "error_msg"]);
  if (direct) return String(direct).trim().replace(/^error\s*:\s*/i, "");

  const text = typeof value?.js === "string"
    ? value.js
    : typeof value === "string"
      ? value
      : "";
  const match = text.match(/(?:^|\b)error\s*:\s*([a-z0-9_-]+)/i);
  return match ? match[1] : "";
}

async function requestVodHierarchy(
  itemOrId,
  { seasonId = "0", episodeId = "0" } = {}
) {
  const catalog = await activeCatalog();
  const mediaIds = uniqueMediaIds(itemOrId);
  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const categories = [...new Set(
    [item.categoryId, item.category_id, "*"]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
  let lastRaw = {};

  for (const movieId of mediaIds) {
    for (const category of categories) {
      for (const page of [0, 1]) {
        try {
          const response = await portalRequest(
            {
              type: "vod",
              action: "get_ordered_list",
              category,
              movie_id: movieId,
              season_id: String(seasonId ?? "0"),
              episode_id: String(episodeId ?? "0"),
              p: page,
              sortby: "added",
            },
            catalog.session
          );
          lastRaw = response.data?.js ?? response.data ?? {};
          const rows = portalRows(lastRaw);

          /*
            A few Stalker portals silently ignore movie_id and return the
            normal category page.  Treating that page as a season list is
            what made mixed VOD shows appear empty or malformed.  Only stop
            probing when the response has a real season, episode, quality,
            or playable-command signal.
          */
          if (rows.length && hasVodHierarchySignal(rows)) {
            recordDiagnostic("vod.hierarchy_resolved", {
              movieId,
              category,
              seasonId,
              episodeId,
              page,
              rowCount: rows.length,
              rows,
            });
            return { rows, raw: lastRaw, movieId, category, seasonId, episodeId };
          }

          if (rows.length) {
            recordDiagnostic("vod.hierarchy_catalogue_page_ignored", {
              movieId,
              category,
              seasonId,
              episodeId,
              page,
              rowCount: rows.length,
            });
          }
        } catch (error) {
          recordDiagnostic("vod.hierarchy_attempt_failed", {
            movieId,
            category,
            seasonId,
            episodeId,
            page,
            message: error.message,
          });
        }
      }
    }
  }

  return {
    rows: [],
    raw: lastRaw,
    movieId: mediaIds[0] || "",
    category: categories[0] || "*",
    seasonId: String(seasonId ?? "0"),
    episodeId: String(episodeId ?? "0"),
  };
}

/* =====================================================
   VOD / MOVIES
===================================================== */

async function getVodCategories() {
  if (vodCategoriesCache?.expiresAt > Date.now()) {
    return vodCategoriesCache.value;
  }

  const catalog = await activeCatalog();

  const response = await portalRequest(
    { type: "vod", action: "get_categories" },
    catalog.session
  );

  const raw = response.data?.js;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(response.data)
          ? response.data
          : [];

  const value = rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));

  vodCategoriesCache = {
    value,
    expiresAt: Date.now() + 60_000,
  };

  return value;
}

async function isLikelySeriesCategory(categoryId) {
  const categories = await getVodCategories();
  const title = categories.find((category) => category.id === String(categoryId))?.title || "";
  return /\b(series|shows?|episodes?|seasons?)\b/i.test(title) &&
    !/\b(movie|movies|film|films)\b/i.test(title);
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
  /*
    A number of Stalker portals put movies and series in the same VOD
    catalogue and leave `series` empty in get_ordered_list.  The category
    name is therefore a useful hint at list-render time; detail loading
    still verifies the actual seasons/episodes before opening the series UI.
  */
  let categorySuggestsSeries = false;
  try {
    categorySuggestsSeries = await isLikelySeriesCategory(categoryId);
  } catch {
    /* Category naming must never make the catalogue fail. */
  }

  const items = rows
    .filter((row) =>
      (row.id ?? row.series_id ?? row.movie_id ?? row.stream_id) != null &&
      (row.name || row.title)
    )
    .map((row) => {
      const normalized = normalizeMediaItem(row, "vod");
      return categorySuggestsSeries
        ? { ...normalized, kind: "series", isSeries: true }
        : normalized;
    });

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

function firstNestedValue(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return "";
  for (const key of keys) {
    if (value[key] != null && (typeof value[key] === "string" || typeof value[key] === "number")) {
      const candidate = String(value[key]).trim();
      if (candidate) return candidate;
    }
  }
  for (const child of Object.values(value)) {
    const found = firstNestedValue(child, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

async function getVodInfo(item) {
  const ids = uniqueMediaIds(item);
  const key = `vod-info:${ids.join(":")}`;
  const cached = vodInfoCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const catalog = await activeCatalog();
  let value = {};

  for (const mediaId of ids) {
    try {
      const response = await portalRequest(
        { type: "vod", action: "get_vod_info", movie_id: mediaId, vod_id: mediaId },
        catalog.session
      );
      const rawValue = response.data?.js ?? response.data ?? {};
      value = rawValue;
      if (typeof rawValue === "string") {
        try {
          value = JSON.parse(rawValue);
        } catch {
          value = { cmd: rawValue };
        }
      }
      if (value && value !== false && (typeof value !== "object" || Object.keys(value).length)) break;
    } catch (error) {
      if (mediaId === ids.at(-1)) throw error;
    }
  }

  vodInfoCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
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

  const js = await getVodInfo(item);
  const command = firstNestedValue(js, ["cmd", "command", "playback_cmd", "url", "stream_url"]);

  recordDiagnostic(command ? "vod.command_resolved" : "vod.command_missing", {
    itemId: item.id,
    title: item.title,
    command,
    info: js,
  });

  return command;
}

const QUALITY_COMMAND_KEYS = ["cmd", "command", "playback_cmd", "url", "stream_url"];
const QUALITY_LABEL_KEYS = [
  "quality_name",
  "quality",
  "profile",
  "resolution",
  "language",
  "format",
  "label",
  "name",
  "title",
];

function collectQualityCommands(value, inheritedLabel = "", output = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectQualityCommands(entry, inheritedLabel || `Quality ${index + 1}`, output, seen, depth + 1);
    });
    return output;
  }

  let label = inheritedLabel;
  for (const key of QUALITY_LABEL_KEYS) {
    const candidate = value[key];
    if (candidate != null && (typeof candidate === "string" || typeof candidate === "number")) {
      const text = String(candidate).trim();
      if (text && text.length < 120) {
        label = text;
        break;
      }
    }
  }

  for (const key of QUALITY_COMMAND_KEYS) {
    const command = value[key];
    if (typeof command === "string" && command.trim()) {
      output.push({ command: command.trim(), label: label || "Quality" });
      break;
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== "object") continue;
    const nextLabel = /quality|profile|resolution|language|format|label/i.test(key)
      ? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : label;
    collectQualityCommands(child, nextLabel, output, seen, depth + 1);
  }

  return output;
}

function createQualityOptions(rawOptions, context) {
  const unique = [];
  const commands = new Set();

  for (const option of rawOptions) {
    const command = String(option?.command || "").trim();
    if (!command || commands.has(command)) continue;
    commands.add(command);
    const id = randomBytes(18).toString("hex");
    qualityOptionCache.set(id, {
      ...context,
      command,
      expiresAt: Date.now() + 5 * 60_000,
    });
    unique.push({
      id,
      label: String(option?.label || "Quality").trim() || "Quality",
    });
  }

  return unique;
}

function getQualityCommand(token, expected) {
  const key = String(token || "").trim();
  const entry = qualityOptionCache.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    qualityOptionCache.delete(key);
    throw new PlayerError("Playback quality expired. Select the quality again.", 410);
  }

  for (const field of ["kind", "categoryId", "itemId", "season", "episodeId"]) {
    if (expected[field] != null && String(entry[field]) !== String(expected[field])) {
      throw new PlayerError("Playback quality does not match this title.", 400);
    }
  }

  return entry.command;
}

async function getVodQualityOptions(categoryId, itemId) {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Movie is no longer available. Refresh Movies & Series and try again.", 404);

  let info = {};
  try {
    info = await getVodInfo(item);
  } catch {
    /* Some mixed portals reject get_vod_info; series probing can still work. */
  }

  /*
    On mixed MAG/Stalker portals the quality rows are not returned by
    get_vod_info. They live behind the same VOD hierarchy used by the native
    client: movie_id -> season_id -> episode_id. Query the movie level before
    falling back to the catalogue command.
  */
  const hierarchy = await requestVodHierarchy(item, {
    seasonId: "0",
    episodeId: "0",
  });
  const rawOptions = collectQualityCommands(info);
  collectQualityCommands(hierarchy.raw, "", rawOptions);
  hierarchy.rows.forEach((row) => {
    collectQualityCommands(row, hierarchyTitle(row), rawOptions);
  });
  if (item.cmd) rawOptions.push({ command: item.cmd, label: "Default quality" });
  if (!rawOptions.length) {
    const command = await resolveVodCommand(item);
    if (command) rawOptions.push({ command, label: "Default quality" });
  }

  const options = createQualityOptions(rawOptions, {
    kind: "movie",
    categoryId: String(categoryId),
    itemId: String(itemId),
  });

  if (!options.length) throw new PlayerError("Portal did not provide playback quality for this movie.");
  return { item: { ...item, categoryId: String(categoryId) }, options };
}

async function getVodEpisodeQualityOptions(categoryId, itemId, seasonNumber, episodeId) {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);

  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => entry.portalId === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));
  if (!episode) throw new PlayerError("Episode is no longer available. Refresh and try again.", 404);

  const rawOptions = collectQualityCommands(episode.raw || episode);
  const hierarchy = await requestVodHierarchy(item, {
    seasonId: episode.seasonPortalId || safeSeason,
    episodeId: episode.portalId || episode.id,
  });
  collectQualityCommands(hierarchy.raw, "", rawOptions);
  hierarchy.rows.forEach((row) => {
    collectQualityCommands(row, hierarchyTitle(row), rawOptions);
  });

  /* A few portals use the episode id as movie_id for the final quality row. */
  if (!rawOptions.length && (episode.portalId || episode.id)) {
    const episodeMediaId = episode.portalId || episode.id;
    const episodeHierarchy = await requestVodHierarchy(
      { ...item, movieId: episodeMediaId, videoId: episodeMediaId, id: episodeMediaId },
      { seasonId: "0", episodeId: "0" }
    );
    collectQualityCommands(episodeHierarchy.raw, "", rawOptions);
    episodeHierarchy.rows.forEach((row) => {
      collectQualityCommands(row, hierarchyTitle(row), rawOptions);
    });
  }
  if (episode.cmd) rawOptions.push({ command: episode.cmd, label: "Default quality" });
  const options = createQualityOptions(rawOptions, {
    kind: "episode",
    categoryId: String(categoryId),
    itemId: String(itemId),
    season: String(safeSeason),
    episodeId: String(episode.id),
  });

  if (!options.length) throw new PlayerError("Portal did not provide playback quality for this episode.");
  return {
    item: { ...item, categoryId: String(categoryId), kind: "series", isSeries: true },
    season: safeSeason,
    episode,
    options,
  };
}

async function getVodStreamUrl(categoryId, itemId, qualityId = "") {
  const item = await findVodItem(categoryId, itemId);

  if (!item) {
    throw new PlayerError(
      "Movie is no longer available. Refresh Movies and try again.",
      404
    );
  }

  const command = qualityId
    ? getQualityCommand(qualityId, { kind: "movie", categoryId, itemId })
    : await resolveVodCommand(item);

  if (!command) {
    throw new PlayerError("Portal did not provide a movie playback command.");
  }

  const directStreamUrl = directStreamFromCommand(command);
  if (directStreamUrl) {
    recordDiagnostic("vod.direct_playback_link", {
      itemId,
      title: item.title,
      command,
      streamUrl: directStreamUrl,
      createLinkBypassed: true,
    });
    return directStreamUrl;
  }

  const catalog = await activeCatalog();

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
      : firstNestedValue(response.data?.js || response.data, [
          "cmd",
          "url",
          "stream_url",
          "stream",
        ]);

  const providerError = portalProviderError(response.data);

  if (providerError) {
    recordDiagnostic("vod.provider_unavailable", {
      itemId,
      title: item.title,
      command,
      providerError,
    });

    if (providerError.toLowerCase() === "nothing_to_play") {
      throw new PlayerError(
        "This movie is currently unavailable on the provider's VOD storage. Please try another title.",
        503
      );
    }

    throw new PlayerError(
      "The provider could not start this movie. Please try another title.",
      503
    );
  }

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

/*
  Many providers put both films and shows in the VOD catalogue. The same
  get_vod_info response can contain seasons/episodes, so the combined UI
  asks these routes first and decides which detail view to show at runtime.
*/
async function getCombinedVodDetail(categoryId, itemId) {
  const item = await findVodItem(categoryId, itemId);

  if (!item) {
    throw new PlayerError("Title is no longer available. Refresh Movies & Series and try again.", 404);
  }

  let info = {};
  try {
    info = await getVodInfo(item);
  } catch (error) {
    if (!item.cmd) throw error;
  }

  let seasons = extractSeasons(info);
  let categorySuggestsSeries = false;
  try {
    categorySuggestsSeries = await isLikelySeriesCategory(categoryId);
  } catch {
    /* Category naming is only a hint; metadata remains authoritative. */
  }

  /*
    The provider's "All" category can contain shows too, but it has no
    useful category name to identify them.  Rows without a direct movie
    command are therefore also probed through the series dialects.
  */
  /*
    A mixed VOD row may still contain a direct `cmd` even when it is a
    show.  Do not use that command as a movie classification signal: the
    provider's series endpoint is the source of truth for seasons and
    episodes.  Probe it whenever VOD info did not already expose seasons.
    This keeps the UI flow deterministic: show -> season -> episode ->
    quality, while ordinary movies simply return no series details.
  */
  if (!seasons.length) {
    try {
      const seriesInfo = await getSeriesInfo(item);
      const seriesSeasons = extractSeasons(seriesInfo);
      if (seriesSeasons.length || hasSeriesDetails(seriesInfo)) {
        info = seriesInfo;
        seasons = seriesSeasons;
      }
    } catch {
      /* Some portals do not implement the series endpoint. */
    }
  }

  const isSeries = Boolean(
    item.isSeries ||
    item.kind === "series" ||
    seasons.length ||
    hasSeriesDetails(info) ||
    categorySuggestsSeries
  );
  const normalizedItem = {
    ...item,
    categoryId: String(categoryId),
    kind: isSeries ? "series" : "vod",
    isSeries,
  };

  recordDiagnostic("vod.detail_normalized", {
    categoryId,
    itemId,
    title: item.title,
    kind: normalizedItem.kind,
    seasonCount: seasons.length,
    info,
  });

  return { item: normalizedItem, seasons };
}

async function getCombinedVodEpisodes(categoryId, itemId, seasonNumber) {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);

  return {
    item: { ...item, categoryId: String(categoryId), kind: "series", isSeries: true },
    season: safeSeason,
    episodes,
  };
}

async function getCombinedVodEpisodeStream(categoryId, itemId, seasonNumber, episodeId, qualityId = "") {
  const item = await findVodItem(categoryId, itemId);
  if (!item) throw new PlayerError("Series is no longer available. Refresh and try again.", 404);

  const safeSeason = numberOrFallback(seasonNumber, 1);
  const info = await getSeriesSeasonInfo(item, safeSeason);
  const episodes = extractEpisodes(info, safeSeason);
  const episode =
    episodes.find((entry) => entry.id === String(episodeId)) ||
    episodes.find((entry) => entry.portalId === String(episodeId)) ||
    episodes.find((entry) => String(entry.episode) === String(episodeId));

  if (!episode) {
    recordDiagnostic("vod.series_episode_missing", {
      categoryId,
      itemId,
      seasonNumber: safeSeason,
      episodeId,
      availableEpisodes: episodes,
    });
    throw new PlayerError("Episode is no longer available. Refresh and try again.", 404);
  }

  const command = qualityId
    ? getQualityCommand(qualityId, {
        kind: "episode",
        categoryId,
        itemId,
        season: safeSeason,
        episodeId: episode.id,
      })
    : episode.cmd || firstNestedValue(episode.raw, ["cmd", "command", "playback_cmd", "url", "stream_url"]);
  if (!command) {
    recordDiagnostic("vod.series_episode_command_missing", {
      categoryId,
      itemId,
      seasonNumber: safeSeason,
      episodeId,
      episode,
    });
    throw new PlayerError("Portal did not provide a playback command for this episode.");
  }

  const directStreamUrl = directStreamFromCommand(command);
  if (directStreamUrl) {
    recordDiagnostic("vod.series_direct_playback_link", {
      categoryId,
      itemId,
      seasonNumber: safeSeason,
      episodeId,
      command,
      streamUrl: directStreamUrl,
      createLinkBypassed: true,
    });
    return directStreamUrl;
  }

  const catalog = await activeCatalog();
  const response = await portalRequest(
    {
      type: "vod",
      action: "create_link",
      cmd: command,
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
      : firstNestedValue(response.data?.js || response.data, [
          "cmd",
          "url",
          "stream_url",
          "stream",
        ]);
  const providerError = portalProviderError(response.data);

  if (providerError) {
    recordDiagnostic("vod.series_provider_unavailable", {
      categoryId,
      itemId,
      episodeId,
      command,
      providerError,
    });
    throw new PlayerError(
      providerError.toLowerCase() === "nothing_to_play"
        ? "This episode is currently unavailable on the provider's VOD storage."
        : "The provider could not start this episode. Please try another episode.",
      503
    );
  }

  const streamUrl = parsePortalStream(raw);
  recordDiagnostic("vod.series_playback_link", {
    categoryId,
    itemId,
    seasonNumber: safeSeason,
    episodeId,
    episode,
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

  const raw = response.data?.js;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(response.data)
          ? response.data
          : [];

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
  const source = raw && typeof raw === "object" ? raw : {};
  const id =
    source.episode_id ??
    source.video_id ??
    source.id ??
    source.series_id ??
    source.ch_id ??
    `${seasonNumber}-${index + 1}`;

  return {
    id: String(id),
    title: String(
      source.name ||
        source.title ||
        source.episode_name ||
        `Episode ${source.episode_num || index + 1}`
    ).trim(),
    description: String(source.description || source.plot || source.info || "").trim(),
    episode: Number(source.episode_num || source.episode || source.number || index + 1),
    season: Number(source.season || source.season_number || seasonNumber || 1),
    portalId: String(
      source._portalEpisodeId ??
      source.episode_id ??
      source.video_id ??
      source.id ??
      id
    ),
    seasonPortalId: String(
      source._portalSeasonId ??
      source.season_id ??
      source.season ??
      seasonNumber ??
      1
    ),
    cmd: firstNestedValue(source, ["cmd", "command", "playback_cmd", "url", "stream_url"]),
    raw: source,
  };
}

/*
  Stalker/Ministra portals do not agree on whether seasons and episodes are
  arrays or objects keyed by the season number. Normalize both shapes before
  the UI asks for seasons or episode rows.
*/
function seriesInfoCandidates(info, depth = 0, seen = new Set()) {
  if (!info || typeof info !== "object" || depth > 4 || seen.has(info)) return [];
  seen.add(info);

  const candidates = [info];
  /*
    Stalker builds wrap the same payload under different names.  In
    particular, mixed VOD portals commonly return `movie_data` or
    `series_data`, while some return a generic `payload` object.  Walk all
    of those wrappers so the UI can still discover seasons/episodes instead
    of incorrectly treating a show as a movie.
  */
  const wrapperKeys = [
    "data",
    "js",
    "info",
    "movie",
    "movie_data",
    "series",
    "series_data",
    "vod",
    "result",
    "details",
    "payload",
  ];

  for (const key of wrapperKeys) {
    const child = info[key];
    if (child && typeof child === "object") {
      candidates.push(...seriesInfoCandidates(child, depth + 1, seen));
    }
  }

  return candidates;
}

function seriesField(info, field) {
  const aliases = {
    seasons: ["seasons", "season", "season_list", "season_data"],
    episodes: ["episodes", "episode", "episode_list", "episode_data"],
  }[field] || [field];

  for (const candidate of seriesInfoCandidates(info)) {
    for (const alias of aliases) {
      if (candidate[alias] != null) return candidate[alias];
    }
  }

  return null;
}

function numberOrFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function recordsFromSeasonObject(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry)) {
      return { season: numberOrFallback(key, 1), episodes: entry };
    }

    if (entry && typeof entry === "object") {
      return {
        ...entry,
        season: entry.season ?? entry.number ?? numberOrFallback(key, 1),
      };
    }

    return { season: numberOrFallback(key, 1) };
  });
}

function recordsFromEpisodeObject(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const season = numberOrFallback(key, 1);
    const entries = Array.isArray(entry) ? entry : [entry];

    return entries
      .filter((episode) => episode && typeof episode === "object")
      .map((episode) => ({
        ...episode,
        season:
          episode.season ?? episode.season_number ?? episode.number ?? season,
      }));
  });
}

function rawSeriesSeasons(info) {
  const explicitSeasons = seriesField(info, "seasons");

  if (explicitSeasons != null) {
    return recordsFromSeasonObject(explicitSeasons);
  }

  for (const candidate of seriesInfoCandidates(info)) {
    for (const value of Object.values(candidate)) {
      if (!Array.isArray(value)) continue;
      if (value.some((entry) => entry?.episodes || entry?.series || entry?.season_number)) {
        return recordsFromSeasonObject(value);
      }
    }
  }

  return [];
}

function rawSeriesEpisodes(info) {
  const explicitEpisodes = seriesField(info, "episodes");

  if (explicitEpisodes != null) {
    return recordsFromEpisodeObject(explicitEpisodes);
  }

  for (const candidate of seriesInfoCandidates(info)) {
    for (const value of Object.values(candidate)) {
      if (!Array.isArray(value)) continue;
      if (value.some((entry) => entry?.episode_num || entry?.episode_id || entry?.episode || entry?.cmd)) {
        return recordsFromEpisodeObject(value);
      }
    }
  }

  return [];
}

function hasSeriesDetails(info) {
  return rawSeriesSeasons(info).length > 0 || rawSeriesEpisodes(info).length > 0;
}

async function getSeriesInfo(itemOrId) {
  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const mediaIds = uniqueMediaIds(itemOrId);
  const key = `info:${mediaIds.join(":")}:${item.categoryId || item.category_id || ""}`;

  const cached = seriesCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();
  let js = {};

  /*
    Native MAG clients open shows through the VOD hierarchy, not through the
    often-empty `type=series` API.  At the title level the portal returns
    season rows; a small number of portals return episode rows immediately.
  */
  try {
    const hierarchy = await requestVodHierarchy(itemOrId, {
      seasonId: "0",
      episodeId: "0",
    });
    const rows = hierarchy.rows.filter((row) => row && typeof row === "object");
    const episodeRows = rows.filter(isEpisodeHierarchyRow);
    const seasonRows = rows.filter(
      (row) => isSeasonHierarchyRow(row) && !isEpisodeHierarchyRow(row)
    );

    if (episodeRows.length) {
      js = {
        episodes: episodeRows.map((row, index) => {
          const season = seasonNumberFromRow(row, 0);
          return {
            ...row,
            season,
            season_id: String(row.season_id ?? row.season ?? season),
            episode_num: episodeNumberFromRow(row, index),
            _portalSeasonId: String(row.season_id ?? row.season ?? season),
            _portalEpisodeId: String(
              row.episode_id ?? row.video_id ?? row.id ?? row.number ?? index + 1
            ),
          };
        }),
        _hierarchy: hierarchy,
      };
    } else if (seasonRows.length) {
      js = {
        seasons: seasonRows.map((row, index) => {
          const season = seasonNumberFromRow(row, index);
          return {
            ...row,
            season,
            _portalSeasonId: String(
              row.season_id ?? row.id ?? row.number ?? season
            ),
          };
        }),
        _hierarchy: hierarchy,
      };
    }
  } catch (error) {
    recordDiagnostic("series.vod_hierarchy_failed", {
      mediaIds,
      message: error.message,
    });
  }

  /*
    Mixed VOD portals are not consistent about the series endpoint.  Try
    the common variants in order and keep the first response that contains
    seasons or episodes.  This is deliberately server-side so the browser
    never needs to know which Stalker dialect the portal uses.
  */
  const requests = mediaIds.flatMap((seriesId) => [
    {
      type: "series",
      action: "get_ordered_list",
      movie_id: seriesId,
      series_id: seriesId,
      p: 0,
    },
    {
      type: "series",
      action: "get_series_info",
      series_id: seriesId,
      movie_id: seriesId,
    },
    {
      type: "vod",
      action: "get_vod_info",
      movie_id: seriesId,
      vod_id: seriesId,
      series_id: seriesId,
    },
  ]);

  for (const request of hasSeriesDetails(js) ? [] : requests) {
    try {
      const response = await portalRequest(request, catalog.session);
      const jsValue = response.data?.js;
      const candidate =
        jsValue && typeof jsValue === "object"
          ? jsValue
          : response.data && typeof response.data === "object"
            ? response.data
            : {};
      if (!Object.keys(js || {}).length || hasSeriesDetails(candidate)) {
        js = candidate;
      }
      if (hasSeriesDetails(candidate)) break;
    } catch {
      /* Try the next supported Stalker dialect. */
    }
  }

  seriesCache.set(key, {
    value: js,
    expiresAt: Date.now() + 5 * 60_000,
  });

  recordDiagnostic("series.info_normalized", {
    mediaIds,
    seasonCount: extractSeasons(js).length,
    episodeCounts: extractSeasons(js).map((season) => ({
      season: season.number,
      episodes: extractEpisodes(js, season.number).length,
    })),
    info: js,
  });

  return js;
}

async function getSeriesSeasonInfo(itemOrId, seasonNumber) {
  const safeSeason = numberOrFallback(seasonNumber, 1);
  const baseInfo = await getSeriesInfo(itemOrId);
  if (extractEpisodes(baseInfo, safeSeason).length) return baseInfo;

  const item = itemOrId && typeof itemOrId === "object" ? itemOrId : {};
  const mediaIds = uniqueMediaIds(itemOrId);
  const season = extractSeasons(baseInfo).find(
    (entry) => Number(entry.number) === safeSeason
  );
  const seasonIds = [...new Set(
    [season?.portalId, season?.id, safeSeason]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];
  let episodes = [];
  let usedHierarchy = null;

  const normalizeRows = (rows, seasonId) => rows
    .filter((row) => row && typeof row === "object")
    .filter((row) => {
      if (isEpisodeHierarchyRow(row)) return true;
      if (isSeasonHierarchyRow(row)) return false;

      const rowId = String(
        row.episode_id ?? row.video_id ?? row.id ?? row.ch_id ?? ""
      ).trim();
      const hasEpisodeShape = Boolean(
        rowId &&
        hierarchyTitle(row) &&
        (firstNestedValue(row, QUALITY_COMMAND_KEYS) || row.episode_id != null)
      );
      return hasEpisodeShape && !mediaIds.includes(rowId);
    })
    .map((row, index) => ({
      ...row,
      season: safeSeason,
      season_id: String(seasonId),
      episode_num: episodeNumberFromRow(row, index),
      _portalSeasonId: String(seasonId),
      _portalEpisodeId: String(
        row.episode_id ?? row.video_id ?? row.id ?? row.ch_id ?? row.number ?? index + 1
      ),
    }));

  for (const seasonId of seasonIds) {
    const hierarchy = await requestVodHierarchy(itemOrId, {
      seasonId,
      episodeId: "0",
    });
    episodes = normalizeRows(hierarchy.rows, seasonId);
    if (episodes.length) {
      usedHierarchy = hierarchy;
      break;
    }

    /* Some middleware promotes the season row to movie_id for step two. */
    const seasonHierarchy = await requestVodHierarchy(
      {
        ...item,
        id: seasonId,
        movieId: seasonId,
        videoId: seasonId,
      },
      { seasonId: "0", episodeId: "0" }
    );
    episodes = normalizeRows(seasonHierarchy.rows, seasonId);
    if (episodes.length) {
      usedHierarchy = seasonHierarchy;
      break;
    }
  }

  const value = episodes.length
    ? { ...baseInfo, episodes, _seasonHierarchy: usedHierarchy }
    : baseInfo;

  recordDiagnostic("series.season_normalized", {
    mediaIds,
    season: safeSeason,
    portalSeasonId: season?.portalId || season?.id || "",
    episodeCount: episodes.length,
    episodes,
  });

  return value;
}

function extractSeasons(info) {
  const rawSeasons = rawSeriesSeasons(info);

  if (rawSeasons.length) {
    return rawSeasons.map((season, index) => {
      const number = numberOrFallback(
        season.season ?? season.number ?? season.season_number,
        index + 1
      );
      const portalId = String(
        season._portalSeasonId ?? season.season_id ?? season.id ?? season.number ?? number
      );
      return {
        id: String(season.id ?? season.season_id ?? season.season ?? season.number ?? number),
        portalId,
        number,
        title: String(
          season.name ||
          season.title ||
          `Season ${number}`
        ),
      };
    });
  }

  const rawEpisodes = rawSeriesEpisodes(info);

  const numbers = new Set();

  rawEpisodes.forEach((episode) => {
    numbers.add(Number(episode.season || 1));
  });

  return [...numbers]
    .sort((a, b) => a - b)
    .map((number) => ({
      id: String(number),
      portalId: String(number),
      number,
      title: `Season ${number}`,
    }));
}

function extractEpisodes(info, seasonNumber) {
  const rawEpisodes = rawSeriesEpisodes(info);

  if (rawEpisodes.length) {
    return rawEpisodes
      .filter(
        (episode) =>
          numberOrFallback(
            episode.season ?? episode.season_number,
            Number(seasonNumber) || 1
          ) === Number(seasonNumber)
      )
      .map((episode, index) =>
        normalizeEpisode(episode, seasonNumber, index)
      );
  }

  const rawSeasons = rawSeriesSeasons(info);

  const season = rawSeasons.find(
    (entry, index) =>
      numberOrFallback(
        entry.season ?? entry.number ?? entry.season_number,
        index + 1
      ) === Number(seasonNumber)
  );

  const episodes =
    season?.episodes ||
    season?.series ||
    season?.data ||
    season?.items ||
    [];

  if (Array.isArray(episodes)) {
    return episodes.map((episode, index) =>
      normalizeEpisode(episode, seasonNumber, index)
    );
  }

  return recordsFromEpisodeObject(episodes).map((episode, index) =>
    normalizeEpisode(episode, seasonNumber, index)
  );
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

  const directStreamUrl = directStreamFromCommand(episode.cmd);
  if (directStreamUrl) {
    recordDiagnostic("series.direct_playback_link", {
      seriesId,
      seasonNumber,
      episodeId,
      command: episode.cmd,
      streamUrl: directStreamUrl,
      createLinkBypassed: true,
    });
    return directStreamUrl;
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

function deleteRelayTarget(ticket) {
  const target = relayTargets.get(ticket);

  if (target?.key && relayTicketsByKey.get(target.key) === ticket) {
    relayTicketsByKey.delete(target.key);
  }

  relayTargets.delete(ticket);
}

function pruneExpiredRelayTargets(now = Date.now()) {
  for (const [ticket, target] of relayTargets) {
    if (target.expiresAt < now) deleteRelayTarget(ticket);
  }
}

/*
  HLS identifies a segment using its URI and media sequence number. The old
  relay generated a new random local URI on every playlist refresh, so HLS
  rejected the same sequence as changed content (levelParsingError). Only
  children inside an HLS manifest use stable tickets. A newly selected channel
  still gets a fresh root ticket and never reuses an old create_link session.
*/
function createRelayTarget(
  url,
  lifetimeMs = 2 * 60 * 60_000,
  context = "unknown",
  stable = false,
  credentials = null
) {
  if (typeof lifetimeMs === "string") {
    context = lifetimeMs;
    lifetimeMs = 2 * 60 * 60_000;
  }

  const now = Date.now();
  pruneExpiredRelayTargets(now);
  const key = stable ? `${context}\u0000${url}` : null;

  if (key) {
    const existingTicket = relayTicketsByKey.get(key);
    const existingTarget = existingTicket
      ? relayTargets.get(existingTicket)
      : null;

    if (existingTarget && existingTarget.expiresAt > now) {
      return `/stream/${existingTicket}`;
    }

    if (existingTicket) deleteRelayTarget(existingTicket);
  }

  const ticket = randomBytes(18).toString("base64url");

  relayTargets.set(ticket, {
    url,
    expiresAt: now + lifetimeMs,
    context,
    key,
    /* Shared per-playback jar: manifest and segment tickets must see cookies
       learned during an earlier redirect/request in the same playback. */
    credentials: credentials || null,
  });

  if (key) relayTicketsByKey.set(key, ticket);

  return `/stream/${ticket}`;
}

function relayCredentials(session) {
  if (!session) return null;

  return {
    cookie: session.cookie || "",
    authorization: session.token ? `Bearer ${session.token}` : "",
  };
}

function createStreamRelayTarget(url, context, session) {
  return createRelayTarget(
    url,
    2 * 60 * 60_000,
    context,
    false,
    relayCredentials(session)
  );
}

function rewriteUriAttributes(line, baseUrl, context, credentials) {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    return `URI="${createRelayTarget(
      new URL(uri, baseUrl).toString(),
      2 * 60 * 60_000,
      `${context}:manifest-uri`,
      true,
      credentials
    )}"`;
  });
}

function rewriteManifest(manifest, baseUrl, context, credentials) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return rewriteUriAttributes(line, baseUrl, context, credentials);
      }

      return createRelayTarget(
        new URL(trimmed, baseUrl).toString(),
        2 * 60 * 60_000,
        `${context}:segment`,
        true,
        credentials
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
    "Content-Disposition": "attachment; filename=netplus-diagnostics-v1.5.7.json",
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

/* Relay URLs hide the provider's original extension. Unknown HTTP streams
   should be tried through HLS.js first; explicit progressive files stay native. */
function shouldTryHlsFirst(url) {
  return !/\.(?:mp4|m4v|webm|ogv|ogg|mp3|aac|wav)(?:$|\?)/i.test(
    String(url || "")
  );
}

function isValidHlsManifest(body) {
  return String(body || "")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .startsWith("#EXTM3U");
}

async function fetchRelayUpstream(target, headers) {
  let currentUrl = target.url;
  const requestHeaders = { ...headers };
  const redirects = [];

  /*
    The working STBEmu capture is decisive here: VOD media requests are made
    directly to the provider's dynamic host and custom port with only the
    native FFmpeg identity (Lavf53.32.100).  The portal MAC/Bearer/cookie
    session is used to obtain create_link, but is not attached to the VOD CDN
    requests.  Some CDN nodes reject those extra portal headers with 403.
  */
  const isVodMedia = /^(?:vod|series)(?::|$)/i.test(String(target.context || ""));
  if (isVodMedia) {
    delete requestHeaders.Cookie;
    delete requestHeaders.Authorization;
    delete requestHeaders["X-User-Agent"];
    delete requestHeaders.Referer;
    delete requestHeaders.Origin;
  }

  for (let redirectCount = 0; redirectCount <= 6; redirectCount += 1) {
    /* STBEmu asks FFmpeg for compressed playlists and identity-encoded TS
       segments. Preserve the provider's custom host and port exactly. */
    if (isVodMedia) {
      requestHeaders["Accept-Encoding"] = /\.m3u8(?:$|\?)/i.test(currentUrl)
        ? "gzip"
        : "identity";
    }

    const response = await fetch(currentUrl, {
      headers: requestHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });

    /* Native fetch/undici has no persistent cookie jar. Capture cookies from
       every CDN hop and send them on the next hop and later HLS requests. */
    const responseCookies = isVodMedia
      ? []
      : extractSetCookiePairs(response.headers);
    if (responseCookies.length) {
      target.credentials ||= {};
      target.credentials.cookie = mergeCookieHeader(
        target.credentials.cookie,
        responseCookies
      );
      requestHeaders.Cookie = target.credentials.cookie;
    }

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400;

    if (!isRedirect || !location) {
      return { response, finalUrl: currentUrl, redirects };
    }

    const nextUrl = new URL(location, currentUrl).toString();
    redirects.push({
      from: currentUrl,
      to: nextUrl,
      status: response.status,
    });

    /* Authorization is origin-bound. Cookies learned from the redirect are
       retained, while the portal Bearer token is not sent to a new CDN host. */
    try {
      if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
        delete requestHeaders.Authorization;
      }
    } catch {}

    try { await response.body?.cancel(); } catch {}
    currentUrl = nextUrl;
  }

  throw new PlayerError("The stream provider returned too many redirects.", 502);
}

async function relay(req, res, ticket) {
  const target = relayTargets.get(ticket);

  if (!target || target.expiresAt < Date.now()) {
    deleteRelayTarget(ticket);
    return text(res, 401, "Stream link expired. Select the channel again.");
  }

  const headers = {
    Accept: "*/*",
    "User-Agent": MEDIA_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
  };

  /* The portal API session is also needed by many CDN stream links. */
  if (target.credentials?.cookie) {
    headers.Cookie = target.credentials.cookie;
  }

  if (target.credentials?.authorization) {
    headers.Authorization = target.credentials.authorization;
  }

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  let upstream;
  let finalUrl = target.url;
  let redirects = [];
  const startedAt = Date.now();

  try {
    const result = await fetchRelayUpstream(target, headers);
    upstream = result.response;
    finalUrl = result.finalUrl;
    redirects = result.redirects;
  } catch (error) {
    const errorStatus = error instanceof PlayerError ? error.status : 504;
    recordDiagnostic("relay.upstream_error", {
      context: target.context,
      url: target.url,
      redirects,
      elapsedMs: Date.now() - startedAt,
      status: errorStatus,
      message: error?.message || "upstream request failed",
    });
    return text(
      res,
      errorStatus,
      errorStatus === 504 ? "Stream server timed out." : error.message
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    recordDiagnostic("relay.http_error", {
      context: target.context,
      url: finalUrl || upstream.url || target.url,
      redirects,
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
  const isManifest =
    isLikelyHls(target.url, contentType) ||
    isLikelyHls(finalUrl || upstream.url, contentType);

  recordDiagnostic("relay.response", {
    context: target.context,
    url: finalUrl || upstream.url || target.url,
    redirects,
    status: upstream.status,
    elapsedMs: Date.now() - startedAt,
    contentType,
    contentLength: upstream.headers.get("content-length") || "",
    isManifest,
    ranged: Boolean(req.headers.range),
  });

  if (isManifest) {
    const upstreamBody = await upstream.text();

    /*
      Some expired provider links redirect to a SafeBrowse/login HTML page
      with HTTP 200. Passing that page to HLS.js causes a misleading
      "no EXTM3U delimiter" parsing error. Detect it at the relay boundary so
      Live TV can request a fresh create_link immediately.
    */
    if (!isValidHlsManifest(upstreamBody)) {
      recordDiagnostic("relay.invalid_manifest", {
        context: target.context,
        requestedUrl: target.url,
        returnedUrl: finalUrl || upstream.url || target.url,
        status: upstream.status,
        contentType,
        contentLength: upstream.headers.get("content-length") || "",
        redirected: Boolean(upstream.redirected),
        looksLikeHtml: /<(?:!doctype|html|head|body)\b/i.test(upstreamBody.slice(0, 512)),
      });
      return text(
        res,
        502,
        "The stream provider returned a web page instead of an HLS playlist. A fresh link is required."
      );
    }

    const body = rewriteManifest(
      upstreamBody,
      finalUrl,
      target.context,
      target.credentials
    );

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
      url: finalUrl || upstream.url || target.url,
      elapsedMs: Date.now() - startedAt,
    });
    if (!res.destroyed) res.destroy();
  });

  readable.on("end", () => {
    recordDiagnostic("relay.complete", {
      context: target.context,
      url: finalUrl || upstream.url || target.url,
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

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/item") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid movie or series.", 400);
    }

    return json(res, 200, await getCombinedVodDetail(categoryId, itemId));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/seasons") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid series.", 400);
    }

    const detail = await getCombinedVodDetail(categoryId, itemId);
    return json(res, 200, { seasons: detail.seasons });
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/episodes") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");
    const season = requestUrl.searchParams.get("season");

    if (!categoryId || !itemId || !season) {
      throw new PlayerError("Choose a series and season.", 400);
    }

    return json(
      res,
      200,
      await getCombinedVodEpisodes(categoryId, itemId, Number(season))
    );
  }

  /*
    Quality is selected before a stream is created.  The portal command is
    kept server-side behind a short-lived opaque token, so the renderer never
    needs to expose a raw Stalker command or stream URL.
  */
  if (req.method === "GET" && requestUrl.pathname === "/api/vod/options") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");

    if (!categoryId || !itemId) {
      throw new PlayerError("Choose a valid movie.", 400);
    }

    return json(res, 200, await getVodQualityOptions(categoryId, itemId));
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/vod/episode/options") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    const itemId = requestUrl.searchParams.get("itemId");
    const season = requestUrl.searchParams.get("season");
    const episodeId = requestUrl.searchParams.get("episodeId");

    if (!categoryId || !itemId || !season || !episodeId) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    return json(
      res,
      200,
      await getVodEpisodeQualityOptions(
        categoryId,
        itemId,
        Number(season),
        String(episodeId)
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
      app.js v1.5.5 calls this again immediately when a short-lived IPTV URL
      returns 401/403/410/502 or stops returning a valid HLS manifest.
    */
    const streamUrl = await getStreamUrl(body.channelId);
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "live", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
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
      body.itemId,
      typeof body.qualityId === "string" ? body.qualityId : ""
    );
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "vod", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/vod/episode/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.categoryId !== "string" ||
      typeof body.itemId !== "string" ||
      body.season == null ||
      body.episodeId == null
    ) {
      throw new PlayerError("Choose a valid episode.", 400);
    }

    const streamUrl = await getCombinedVodEpisodeStream(
      body.categoryId,
      body.itemId,
      Number(body.season),
      String(body.episodeId),
      typeof body.qualityId === "string" ? body.qualityId : ""
    );
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "vod", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
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
    const session = (await activeCatalog()).session;

    return json(res, 200, {
      stream: createStreamRelayTarget(streamUrl, "series", session),
      hls: shouldTryHlsFirst(streamUrl),
      mediaType: shouldTryHlsFirst(streamUrl) ? "hls-or-auto" : "progressive",
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
