/*
=========================================================
 NetPlus IPTV Player
 VERSION: 1.2.0
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

const SERVICES = {
  edge: { name: "Netplus Edge", portalUrl: "http://sony4k.me" },
  classic: { name: "Netplus Classic", portalUrl: "http://tv.4ktv.biz" },
};

const MAG_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3";
const X_USER_AGENT = "Model: MAG250; Link: WiFi";

const ADULT_TERMS = /\b(adult|xxx|18\+|porn|erotic|sex)\b/i;

const CATALOG_TTL_MS = 2 * 60_000;
const VOD_TTL_MS = 5 * 60_000;
const RELAY_TTL_MS = 12 * 60 * 60_000;
const POSTER_TTL_MS = 12 * 60 * 60_000;
const MAX_VOD_PAGE = 500;

let catalogCache = null;
let catalogPromise = null;

const vodCache = new Map();
const vodItemCommands = new Map();
const relayTargets = new Map();
const posterTargets = new Map();

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

function clearRuntimeCaches() {
  catalogCache = null;
  catalogPromise = null;
  vodCache.clear();
  vodItemCommands.clear();
  relayTargets.clear();
  posterTargets.clear();
}

function writeStoredConfig(stored) {
  fs.writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify(stored, null, 2)}\n`,
    "utf8",
  );
}

function saveConfig(serviceId, macInput, parentalPin) {
  const service = SERVICES[serviceId];

  if (!service) {
    throw new PlayerError("Choose Netplus Edge or Netplus Classic.", 400);
  }

  normalizePortalUrl(service.portalUrl);

  const mac = String(macInput || "").trim().toUpperCase();

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("MAC must look like 00:1A:79:12:34:56.", 400);
  }

  const existing = readStoredConfig();
  const pin = String(parentalPin || "").trim();

  const parentalPinHash =
    /^\d{4}$/.test(pin)
      ? pinHash(pin)
      : existing.parentalPinHash;

  if (!parentalPinHash) {
    throw new PlayerError(
      "Set a 4-digit parental PIN to protect restricted content.",
      400,
    );
  }

  writeStoredConfig({
    serviceId,
    mac,
    parentalPinHash,
  });

  clearRuntimeCaches();
}

function updateParentalPin(pinInput) {
  const pin = String(pinInput || "").trim();

  if (!/^\d{4}$/.test(pin)) {
    throw new PlayerError("Parental PIN must be exactly 4 digits.", 400);
  }

  const existing = readStoredConfig();

  if (!existing.serviceId || !existing.mac) {
    throw new PlayerError("Complete local player setup first.", 400);
  }

  existing.parentalPinHash = pinHash(pin);
  writeStoredConfig(existing);
}

function resetPortalConfig() {
  try {
    fs.rmSync(CONFIG_PATH, { force: true });
  } catch {
    try {
      fs.writeFileSync(CONFIG_PATH, "{}\n", "utf8");
    } catch {
      throw new PlayerError("Could not reset local portal configuration.", 500);
    }
  }

  clearRuntimeCaches();
}

function loadBalancerCookie(headers) {
  const setCookie = headers.get("set-cookie") || "";

  return (
    setCookie.match(/(?:^|[,;]\s*)(__cflb=[^;,\s]+)/i)?.[1] || ""
  );
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

  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PlayerError("Portal connection timed out.");
  }

  if (!response.ok) {
    throw new PlayerError(`Portal returned status ${response.status}.`);
  }

  const body = await response.text();

  if (body.trim() === "Authorization failed.") {
    throw new PlayerError("Portal rejected this MAC address.", 401);
  }

  try {
    return {
      data: JSON.parse(body),
      headers: response.headers,
    };
  } catch {
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
    cookie: [config.baseCookie, extraCookie]
      .filter(Boolean)
      .join("; "),
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
    session,
  );

  if (!profile.data?.js) {
    throw new PlayerError("MAC profile is unavailable.", 401);
  }

  return session;
}

async function rebuildCatalog() {
  const session = await createSession();

  const [genresResponse, channelsResponse] = await Promise.all([
    portalRequest(
      {
        type: "itv",
        action: "get_genres",
      },
      session,
    ),
    portalRequest(
      {
        type: "itv",
        action: "get_all_channels",
      },
      session,
    ),
  ]);

  const genres = Array.isArray(genresResponse.data?.js)
    ? genresResponse.data.js
    : [];

  const rawChannels = Array.isArray(channelsResponse.data?.js?.data)
    ? channelsResponse.data.js.data
    : [];

  const commands = new Map();

  const channels = rawChannels
    .filter(
      (channel) =>
        channel.id != null &&
        channel.name &&
        channel.cmd,
    )
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
        a.name.localeCompare(b.name),
    );

  catalogCache = {
    session,
    commands,
    expiresAt: Date.now() + CATALOG_TTL_MS,
    publicCatalog: {
      categories: genres
        .filter(
          (genre) =>
            genre.id != null &&
            genre.title,
        )
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
  if (
    !force &&
    catalogCache?.expiresAt > Date.now()
  ) {
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

function extractPlayableUrl(payload) {
  const candidates = [];

  if (typeof payload === "string") {
    candidates.push(payload);
  }

  if (payload && typeof payload === "object") {
    for (const key of [
      "cmd",
      "url",
      "stream",
      "link",
      "src",
    ]) {
      if (typeof payload[key] === "string") {
        candidates.push(payload[key]);
      }
    }
  }

  for (const candidate of candidates) {
    const cleaned = String(candidate)
      .trim()
      .replace(/^(?:ffmpeg|ffrt|auto)\s+/i, "");

    if (!cleaned) continue;

    try {
      const url = new URL(cleaned);

      if (/^https?:$/.test(url.protocol)) {
        return url.toString();
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new PlayerError(
    "Portal did not return a playable stream.",
  );
}

async function getStreamUrl(channelId, retry = true) {
  const catalog = await activeCatalog();
  const command = catalog.commands.get(channelId);

  if (!command) {
    throw new PlayerError(
      "Channel is no longer available.",
      404,
    );
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
      catalog.session,
    );

    return extractPlayableUrl(response.data?.js);
  } catch (error) {
    if (
      retry &&
      error instanceof PlayerError &&
      error.status === 401
    ) {
      await activeCatalog(true);
      return getStreamUrl(channelId, false);
    }

    if (error instanceof PlayerError) {
      throw error;
    }

    throw new PlayerError(
      "Portal did not return a playable stream.",
    );
  }
}

function normalizeHttpUrl(value, baseUrl = null) {
  const raw = String(value || "").trim();

  if (!raw || raw === "0") {
    return "";
  }

  try {
    const url = baseUrl
      ? new URL(raw, baseUrl)
      : new URL(raw);

    return /^https?:$/.test(url.protocol)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function createPosterTarget(url) {
  if (!url) return "";

  for (const [ticket, target] of posterTargets.entries()) {
    if (
      target.url === url &&
      target.expiresAt > Date.now()
    ) {
      return `/poster/${ticket}`;
    }
  }

  const ticket = randomBytes(18).toString("base64url");

  posterTargets.set(ticket, {
    url,
    expiresAt: Date.now() + POSTER_TTL_MS,
  });

  return `/poster/${ticket}`;
}

function getPosterSource(row) {
  return (
    row.screenshot_uri ||
    row.screenshot ||
    row.poster ||
    row.cover ||
    row.cover_big ||
    row.movie_image ||
    row.logo ||
    row.image ||
    row.icon ||
    ""
  );
}

async function getVodCategories() {
  const catalog = await activeCatalog();

  const response = await portalRequest(
    {
      type: "vod",
      action: "get_categories",
    },
    catalog.session,
  );

  const rows = Array.isArray(response.data?.js)
    ? response.data.js
    : [];

  return rows
    .filter(
      (row) =>
        row.id != null &&
        (row.title || row.name),
    )
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || row.name).trim(),
      locked: isAdult(row.title || row.name),
    }));
}

function vodCommandKey(categoryId, itemId) {
  return `${String(categoryId)}:${String(itemId)}`;
}

async function getVodItems(categoryId, page = 0) {
  const numericPage = Number(page);

  const safePage = Math.max(
    0,
    Math.min(
      Number.isFinite(numericPage)
        ? Math.floor(numericPage)
        : 0,
      MAX_VOD_PAGE,
    ),
  );

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
    },
    catalog.session,
  );

  const js = response.data?.js || {};
  const rows = Array.isArray(js.data)
    ? js.data
    : Array.isArray(js)
      ? js
      : [];

  const items = rows
    .filter(
      (row) =>
        row.id != null &&
        (row.name || row.title),
    )
    .map((row) => {
      const id = String(row.id);
      const cmd = String(row.cmd || "").trim();

      if (cmd) {
        vodItemCommands.set(
          vodCommandKey(categoryId, id),
          {
            cmd,
            expiresAt:
              Date.now() + 12 * 60 * 60_000,
          },
        );
      }

      const posterSource = normalizeHttpUrl(
        getPosterSource(row),
      );

      return {
        id,
        title: String(
          row.name || row.title,
        ).trim(),
        description: String(
          row.description ||
            row.description_en ||
            row.descr ||
            row.plot ||
            "",
        ).trim(),
        year: String(
          row.year ||
            row.release_year ||
            "",
        ).trim(),
        rating: String(
          row.rating_imdb ||
            row.rating ||
            row.imdb_rating ||
            "",
        ).trim(),
        poster: posterSource
          ? createPosterTarget(posterSource)
          : "",
      };
    });

  const totalCandidates = [
    js.total_items,
    js.total,
    js.max_page_items,
  ];

  let total = items.length;

  for (const candidate of totalCandidates) {
    const number = Number(candidate);

    if (Number.isFinite(number) && number >= 0) {
      total = number;
      break;
    }
  }

  const value = {
    items,
    total,
    page: safePage,
    hasMore:
      items.length > 0 &&
      (
        total > (safePage + 1) * Math.max(items.length, 1) ||
        items.length >= 10
      ),
  };

  vodCache.set(key, {
    value,
    expiresAt: Date.now() + VOD_TTL_MS,
  });

  return value;
}

async function findVodCommand(categoryId, itemId) {
  const key = vodCommandKey(categoryId, itemId);
  const known = vodItemCommands.get(key);

  if (known?.expiresAt > Date.now()) {
    return known.cmd;
  }

  for (let page = 0; page <= MAX_VOD_PAGE; page += 1) {
    const result = await getVodItems(categoryId, page);

    const refreshed = vodItemCommands.get(key);

    if (refreshed?.cmd) {
      return refreshed.cmd;
    }

    if (!result.items.length) {
      break;
    }

    if (
      Number.isFinite(result.total) &&
      result.total > 0 &&
      (page + 1) * Math.max(result.items.length, 1) >= result.total
    ) {
      break;
    }
  }

  throw new PlayerError(
    "Movie is no longer available. Refresh VOD and try again.",
    404,
  );
}

async function getVodStreamUrl(
  categoryId,
  itemId,
  retry = true,
) {
  const command = await findVodCommand(
    categoryId,
    itemId,
  );

  const catalog = await activeCatalog();

  try {
    const response = await portalRequest(
      {
        type: "vod",
        action: "create_link",
        cmd: command,
        series: "0",
        forced_storage: "undefined",
        download: "0",
      },
      catalog.session,
    );

    return extractPlayableUrl(response.data?.js);
  } catch (error) {
    if (
      retry &&
      error instanceof PlayerError &&
      error.status === 401
    ) {
      await activeCatalog(true);

      return getVodStreamUrl(
        categoryId,
        itemId,
        false,
      );
    }

    if (error instanceof PlayerError) {
      if (
        error.message ===
        "Portal did not return a playable stream."
      ) {
        throw new PlayerError(
          "Portal did not return a playable movie stream.",
        );
      }

      throw error;
    }

    throw new PlayerError(
      "Portal did not return a playable movie stream.",
    );
  }
}

function createRelayTarget(
  url,
  lifetimeMs = RELAY_TTL_MS,
) {
  const ticket = randomBytes(18).toString("base64url");

  relayTargets.set(ticket, {
    url,
    expiresAt: Date.now() + lifetimeMs,
  });

  return `/stream/${ticket}`;
}

function refreshRelayTarget(target) {
  target.expiresAt =
    Date.now() + RELAY_TTL_MS;
}

function rewriteUriAttributes(line, baseUrl) {
  return line.replace(
    /URI=(["'])(.*?)\1/g,
    (_match, quote, uri) => {
      const absolute = normalizeHttpUrl(
        uri,
        baseUrl,
      );

      if (!absolute) {
        return _match;
      }

      return `URI=${quote}${createRelayTarget(
        absolute,
      )}${quote}`;
    },
  );
}

function rewriteManifest(manifest, baseUrl) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#")) {
        return rewriteUriAttributes(
          line,
          baseUrl,
        );
      }

      const absolute = normalizeHttpUrl(
        trimmed,
        baseUrl,
      );

      return absolute
        ? createRelayTarget(absolute)
        : line;
    })
    .join("\n");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Content-Length":
      Buffer.byteLength(body),
    "Cache-Control":
      "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(body);
}

function text(
  res,
  status,
  body,
  type = "text/plain; charset=utf-8",
  extraHeaders = {},
) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length":
      Buffer.byteLength(body),
    ...extraHeaders,
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
        reject(
          new PlayerError(
            "Request too large.",
            413,
          ),
        );
      }
    });

    req.on("end", () => {
      if (failed) return;

      try {
        resolve(
          JSON.parse(body || "{}"),
        );
      } catch {
        reject(
          new PlayerError(
            "Invalid request.",
            400,
          ),
        );
      }
    });

    req.on("error", reject);
  });
}

function serveFile(
  res,
  filename,
  contentType,
) {
  try {
    const data = fs.readFileSync(
      path.join(ROOT, filename),
    );

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,

      // Disable stale local app assets while testing/updating.
      "Cache-Control":
        "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",

      "X-Content-Type-Options":
        "nosniff",
    });

    res.end(data);
  } catch {
    text(res, 404, "Not found.");
  }
}

function copyHeader(
  upstream,
  responseHeaders,
  name,
) {
  const value =
    upstream.headers.get(name);

  if (value) {
    responseHeaders[name] = value;
  }
}

async function relay(req, res, ticket) {
  const target = relayTargets.get(ticket);

  if (
    !target ||
    target.expiresAt < Date.now()
  ) {
    relayTargets.delete(ticket);

    return text(
      res,
      401,
      "Stream link expired. Select the channel or movie again.",
      "text/plain; charset=utf-8",
      {
        "Cache-Control": "no-store",
      },
    );
  }

  refreshRelayTarget(target);

  const headers = {
    Accept: "*/*",
    "User-Agent": MAG_USER_AGENT,
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  let upstream;

  try {
    upstream = await fetch(target.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new PlayerError(
      "Stream server connection timed out.",
      504,
    );
  }

  if (
    !upstream.ok &&
    upstream.status !== 206
  ) {
    return text(
      res,
      upstream.status,
      `Stream server returned ${upstream.status}.`,
      "text/plain; charset=utf-8",
      {
        "Cache-Control": "no-store",
      },
    );
  }

  const contentType =
    upstream.headers.get("content-type") || "";

  let upstreamPath = "";

  try {
    upstreamPath =
      new URL(upstream.url)
        .pathname
        .toLowerCase();
  } catch {
    upstreamPath = "";
  }

  const isManifest =
    contentType
      .toLowerCase()
      .includes("mpegurl") ||
    upstreamPath.endsWith(".m3u8");

  if (isManifest) {
    const manifest =
      await upstream.text();

    const body = rewriteManifest(
      manifest,
      upstream.url,
    );

    return text(
      res,
      200,
      body,
      "application/vnd.apple.mpegurl; charset=utf-8",
      {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    );
  }

  const responseHeaders = {
    "Content-Type":
      contentType ||
      "application/octet-stream",
    "Cache-Control":
      upstream.headers.get(
        "cache-control",
      ) || "private, max-age=5",
    "X-Content-Type-Options":
      "nosniff",
  };

  for (const header of [
    "accept-ranges",
    "content-range",
    "content-length",
    "content-disposition",
  ]) {
    copyHeader(
      upstream,
      responseHeaders,
      header,
    );
  }

  res.writeHead(
    upstream.status,
    responseHeaders,
  );

  if (!upstream.body) {
    return res.end();
  }

  const readable =
    Readable.fromWeb(upstream.body);

  readable.on("error", () => {
    if (!res.destroyed) {
      res.destroy();
    }
  });

  req.on("aborted", () => {
    readable.destroy();
  });

  readable.pipe(res);
}

async function relayPoster(
  req,
  res,
  ticket,
) {
  const target = posterTargets.get(ticket);

  if (
    !target ||
    target.expiresAt < Date.now()
  ) {
    posterTargets.delete(ticket);

    return text(
      res,
      404,
      "Poster expired.",
      "text/plain; charset=utf-8",
      {
        "Cache-Control": "no-store",
      },
    );
  }

  target.expiresAt =
    Date.now() + POSTER_TTL_MS;

  let upstream;

  try {
    upstream = await fetch(target.url, {
      headers: {
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          MAG_USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return text(
      res,
      502,
      "Poster unavailable.",
      "text/plain; charset=utf-8",
      {
        "Cache-Control": "no-store",
      },
    );
  }

  if (!upstream.ok) {
    return text(
      res,
      upstream.status,
      "Poster unavailable.",
      "text/plain; charset=utf-8",
      {
        "Cache-Control": "no-store",
      },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ||
    "image/jpeg";

  const responseHeaders = {
    "Content-Type": contentType,
    "Cache-Control":
      "private, max-age=3600",
    "X-Content-Type-Options":
      "nosniff",
  };

  copyHeader(
    upstream,
    responseHeaders,
    "content-length",
  );

  res.writeHead(200, responseHeaders);

  if (!upstream.body) {
    return res.end();
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

async function handle(req, res) {
  const requestUrl = new URL(
    req.url,
    `http://${HOST}:${PORT}`,
  );

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/"
  ) {
    return serveFile(
      res,
      "index.html",
      "text/html; charset=utf-8",
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/styles.css"
  ) {
    return serveFile(
      res,
      "styles.css",
      "text/css; charset=utf-8",
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/app.js"
  ) {
    return serveFile(
      res,
      "app.js",
      "text/javascript; charset=utf-8",
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/hls.min.js"
  ) {
    return serveFile(
      res,
      "hls.min.js",
      "text/javascript; charset=utf-8",
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/config"
  ) {
    let configured = false;
    let parentalConfigured = false;

    try {
      configured = Boolean(readConfig());

      const stored =
        readStoredConfig();

      parentalConfigured =
        configured &&
        Boolean(
          stored.parentalPinHash,
        );
    } catch {
      configured = false;
      parentalConfigured = false;
    }

    return json(res, 200, {
      configured,
      parentalConfigured,
      services:
        Object.entries(SERVICES).map(
          ([id, service]) => ({
            id,
            name: service.name,
          }),
        ),
      version: "1.2.0",
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/config"
  ) {
    const body = await readJson(req);

    saveConfig(
      body.serviceId,
      body.mac,
      body.parentalPin,
    );

    return json(res, 200, {
      ok: true,
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname ===
      "/api/parental/verify"
  ) {
    const body = await readJson(req);
    const stored = readStoredConfig();

    if (!stored.parentalPinHash) {
      throw new PlayerError(
        "Parental PIN is not configured.",
        400,
      );
    }

    const actual = Buffer.from(
      stored.parentalPinHash,
      "hex",
    );

    const expected = Buffer.from(
      pinHash(
        String(body.pin || ""),
      ),
      "hex",
    );

    const valid =
      actual.length === expected.length &&
      timingSafeEqual(
        actual,
        expected,
      );

    return json(
      res,
      valid ? 200 : 401,
      valid
        ? { ok: true }
        : {
            error:
              "Incorrect parental PIN.",
          },
    );
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname ===
      "/api/parental/update"
  ) {
    const body = await readJson(req);

    updateParentalPin(
      body.pin ??
        body.parentalPin ??
        body.newPin,
    );

    return json(res, 200, {
      ok: true,
    });
  }

  if (
    req.method === "POST" &&
    (
      requestUrl.pathname ===
        "/api/config/reset" ||
      requestUrl.pathname ===
        "/api/reset"
    )
  ) {
    resetPortalConfig();

    return json(res, 200, {
      ok: true,
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname ===
      "/api/catalog"
  ) {
    return json(
      res,
      200,
      (await activeCatalog())
        .publicCatalog,
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname ===
      "/api/vod/categories"
  ) {
    return json(res, 200, {
      categories:
        await getVodCategories(),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname ===
      "/api/vod/items"
  ) {
    const categoryId =
      requestUrl.searchParams.get(
        "categoryId",
      );

    if (!categoryId) {
      throw new PlayerError(
        "Choose a VOD category.",
        400,
      );
    }

    return json(
      res,
      200,
      await getVodItems(
        categoryId,
        requestUrl.searchParams.get(
          "page",
        ),
      ),
    );
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.channelId !==
        "string" ||
      !body.channelId.trim()
    ) {
      throw new PlayerError(
        "Choose a valid channel.",
        400,
      );
    }

    const streamUrl =
      await getStreamUrl(
        body.channelId,
      );

    return json(res, 200, {
      stream:
        createRelayTarget(
          streamUrl,
        ),
    });
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname ===
      "/api/vod/play"
  ) {
    const body = await readJson(req);

    if (
      typeof body.categoryId !==
        "string" ||
      typeof body.itemId !==
        "string" ||
      !body.categoryId.trim() ||
      !body.itemId.trim()
    ) {
      throw new PlayerError(
        "Choose a valid movie.",
        400,
      );
    }

    const streamUrl =
      await getVodStreamUrl(
        body.categoryId,
        body.itemId,
      );

    return json(res, 200, {
      stream:
        createRelayTarget(
          streamUrl,
        ),
    });
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname.startsWith(
      "/stream/",
    )
  ) {
    return relay(
      req,
      res,
      requestUrl.pathname.slice(
        "/stream/".length,
      ),
    );
  }

  if (
    req.method === "GET" &&
    requestUrl.pathname.startsWith(
      "/poster/",
    )
  ) {
    return relayPoster(
      req,
      res,
      requestUrl.pathname.slice(
        "/poster/".length,
      ),
    );
  }

  return text(
    res,
    404,
    "Not found.",
  );
}

const server = http.createServer(
  (req, res) => {
    handle(req, res).catch(
      (error) => {
        console.error(
          error?.stack ||
            error?.message ||
            error,
        );

        if (res.headersSent) {
          return res.destroy();
        }

        json(
          res,
          error.status || 500,
          {
            error:
              error.message ||
              "Local player request failed.",
          },
        );
      },
    );
  },
);

function openBrowser() {
  const url =
    `http://${HOST}:${PORT}`;

  if (
    process.env.NO_OPEN_BROWSER ===
    "1"
  ) {
    return;
  }

  const command =
    process.platform === "win32"
      ? [
          "cmd",
          ["/c", "start", "", url],
        ]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  try {
    spawn(
      command[0],
      command[1],
      {
        detached: true,
        stdio: "ignore",
      },
    ).unref();
  } catch {
    console.log(
      `Open ${url} in your browser.`,
    );
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(
      "Player is already running. Opening it in your browser...",
    );

    openBrowser();

    setTimeout(
      () => process.exit(0),
      800,
    );

    return;
  }

  console.error(error);
  process.exit(1);
});

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      "NetPlus IPTV Player v1.2.0 is running.",
    );

    console.log(
      `Open http://${HOST}:${PORT}`,
    );

    console.log(
      "Keep this window open while watching. Close it to stop the player.",
    );

    openBrowser();
  },
);