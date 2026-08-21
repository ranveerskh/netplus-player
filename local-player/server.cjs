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

let catalogCache = null;
let catalogPromise = null;
const vodCache = new Map();
const relayTargets = new Map();
const ADULT_TERMS = /\b(adult|xxx|18\+|porn|erotic|sex)\b/i;

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

function readConfig() {
  const portalFromEnv = process.env.STALKER_PORTAL_URL?.trim();
  const macFromEnv = process.env.STALKER_MAC?.trim();
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // First launch has no local configuration yet.
  }

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

function pinHash(pin) { return scryptSync(pin, "netplus-parental-v1", 32).toString("hex"); }
function isAdult(title) { return ADULT_TERMS.test(String(title || "")); }

function saveConfig(serviceId, macInput, parentalPin) {
  const service = SERVICES[serviceId];
  if (!service) throw new PlayerError("Choose Netplus Edge or Netplus Classic.", 400);
  const endpoint = normalizePortalUrl(service.portalUrl);
  const mac = String(macInput || "").trim().toUpperCase();
  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    throw new PlayerError("MAC must look like 00:1A:79:12:34:56.", 400);
  }
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { /* First setup. */ }
  const pin = String(parentalPin || "").trim();
  const parentalPinHash = /^\d{4}$/.test(pin) ? pinHash(pin) : existing.parentalPinHash;
  if (!parentalPinHash) throw new PlayerError("Set a 4-digit parental PIN to protect restricted content.", 400);
  fs.writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify({ serviceId, mac, parentalPinHash }, null, 2)}\n`,
    "utf8",
  );
  catalogCache = null;
  catalogPromise = null;
  relayTargets.clear();
  vodCache.clear();
}

function loadBalancerCookie(headers) {
  const setCookie = headers.get("set-cookie") || "";
  return setCookie.match(/(?:^|[,;]\s*)(__cflb=[^;,\s]+)/i)?.[1] || "";
}

async function portalRequest(params, session) {
  const config = readConfig();
  if (!config) throw new PlayerError("Complete local player setup first.", 400);
  const url = new URL(config.endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("JsHttpRequest", "1-xml");

  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: session?.cookie || config.baseCookie,
    "User-Agent": MAG_USER_AGENT,
    "X-User-Agent": X_USER_AGENT,
  };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

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
  const text = await response.text();
  if (text.trim() === "Authorization failed.") {
    throw new PlayerError("Portal rejected this MAC address.", 401);
  }
  try {
    return { data: JSON.parse(text), headers: response.headers };
  } catch {
    throw new PlayerError("Portal returned an unexpected response.");
  }
}

async function createSession() {
  const config = readConfig();
  if (!config) throw new PlayerError("Complete local player setup first.", 400);
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
    .sort((a, b) =>
      (a.number ?? Number.MAX_SAFE_INTEGER) -
        (b.number ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
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
  if (!force && catalogCache?.expiresAt > Date.now()) return catalogCache;
  if (!force && catalogPromise) return catalogPromise;
  catalogPromise = rebuildCatalog().finally(() => {
    catalogPromise = null;
  });
  return catalogPromise;
}

async function getStreamUrl(channelId, retry = true) {
  const catalog = await activeCatalog();
  const command = catalog.commands.get(channelId);
  if (!command) throw new PlayerError("Channel is no longer available.", 404);
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
    const raw =
      typeof response.data?.js === "string"
        ? response.data.js
        : response.data?.js?.cmd || "";
    const url = new URL(raw.trim().replace(/^(?:ffmpeg|ffrt|auto)\s+/i, ""));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported stream");
    return url.toString();
  } catch (error) {
    if (retry && error instanceof PlayerError && error.status === 401) {
      await activeCatalog(true);
      return getStreamUrl(channelId, false);
    }
    if (error instanceof PlayerError) throw error;
    throw new PlayerError("Portal did not return a playable stream.");
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

async function getVodCategories() {
  const catalog = await activeCatalog();
  const response = await portalRequest({ type: "vod", action: "get_categories" }, catalog.session);
  const rows = Array.isArray(response.data?.js) ? response.data.js : [];
  return rows
    .filter((row) => row.id != null && (row.title || row.name))
    .map((row) => ({ id: String(row.id), title: String(row.title || row.name).trim(), locked: isAdult(row.title || row.name) }));
}

async function getVodItems(categoryId, page = 0) {
  const safePage = Math.max(0, Math.min(Number(page) || 0, 30));
  const key = `${categoryId}:${safePage}`;
  const cached = vodCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;

  const catalog = await activeCatalog();
  const response = await portalRequest(
    { type: "vod", action: "get_ordered_list", category: categoryId, p: safePage },
    catalog.session,
  );
  const js = response.data?.js || {};
  const rows = Array.isArray(js.data) ? js.data : [];
  const items = rows
    .filter((row) => row.id != null && row.cmd && (row.name || row.title))
    .map((row) => ({
      id: String(row.id),
      title: String(row.name || row.title).trim(),
      description: String(row.description || row.description_en || "").trim(),
      year: String(row.year || "").trim(),
      rating: String(row.rating_imdb || row.rating || "").trim(),
      poster: cleanPosterUrl(row.screenshot_uri || row.poster || row.cover),
      cmd: String(row.cmd),
    }));
  const value = { items, total: Number(js.total_items) || items.length, page: safePage };
  vodCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

async function getVodStreamUrl(categoryId, itemId) {
  const firstPage = await getVodItems(categoryId, 0);
  let item = firstPage.items.find((entry) => entry.id === itemId);
  if (!item) {
    for (let page = 1; page <= 3 && !item; page += 1) {
      const result = await getVodItems(categoryId, page);
      item = result.items.find((entry) => entry.id === itemId);
    }
  }
  if (!item) throw new PlayerError("Movie is no longer available. Refresh VOD and try again.", 404);
  const catalog = await activeCatalog();
  const response = await portalRequest(
    { type: "vod", action: "create_link", cmd: item.cmd, series: "0", forced_storage: "undefined", download: "0" },
    catalog.session,
  );
  const raw = typeof response.data?.js === "string" ? response.data.js : response.data?.js?.cmd || "";
  try {
    const url = new URL(raw.trim().replace(/^(?:ffmpeg|ffrt|auto)\s+/i, ""));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported stream");
    return url.toString();
  } catch {
    throw new PlayerError("Portal did not return a playable movie stream.");
  }
}

function createRelayTarget(url, lifetimeMs = 2 * 60 * 60_000) {
  const ticket = randomBytes(18).toString("base64url");
  relayTargets.set(ticket, { url, expiresAt: Date.now() + lifetimeMs });
  return `/stream/${ticket}`;
}

function rewriteUriAttributes(line, baseUrl) {
  return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
    return `URI="${createRelayTarget(new URL(uri, baseUrl).toString())}"`;
  });
}

function rewriteManifest(manifest, baseUrl) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return rewriteUriAttributes(line, baseUrl);
      return createRelayTarget(new URL(trimmed, baseUrl).toString());
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
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) reject(new PlayerError("Request too large.", 413));
    });
    req.on("end", () => {
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
      "Cache-Control": filename === "index.html" ? "no-store" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } catch {
    text(res, 404, "Not found.");
  }
}

async function relay(req, res, ticket) {
  const target = relayTargets.get(ticket);
  if (!target || target.expiresAt < Date.now()) {
    relayTargets.delete(ticket);
    return text(res, 401, "Stream link expired. Select the channel again.");
  }

  const headers = { Accept: "*/*", "User-Agent": MAG_USER_AGENT };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(target.url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return text(res, upstream.status, `Stream server returned ${upstream.status}.`);
  }

  const contentType = upstream.headers.get("content-type") || "";
  const isManifest =
    contentType.toLowerCase().includes("mpegurl") ||
    new URL(upstream.url).pathname.toLowerCase().endsWith(".m3u8");
  if (isManifest) {
    const body = rewriteManifest(await upstream.text(), upstream.url);
    return text(res, 200, body, "application/vnd.apple.mpegurl; charset=utf-8");
  }

  const responseHeaders = {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": upstream.headers.get("cache-control") || "private, max-age=5",
  };
  for (const header of ["accept-ranges", "content-range", "content-length"]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  }
  res.writeHead(upstream.status, responseHeaders);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

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
    try {
      configured = Boolean(readConfig());
    } catch {
      configured = false;
    }
    return json(res, 200, {
      configured,
      parentalConfigured: configured && Boolean(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).parentalPinHash),
      services: Object.entries(SERVICES).map(([id, service]) => ({ id, name: service.name })),
    });
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/config") {
    const body = await readJson(req);
    saveConfig(body.serviceId, body.mac, body.parentalPin);
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/parental/verify") {
    const body = await readJson(req);
    const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const actual = Buffer.from(stored.parentalPinHash || "", "hex");
    const expected = Buffer.from(pinHash(String(body.pin || "")), "hex");
    const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    return json(res, valid ? 200 : 401, valid ? { ok: true } : { error: "Incorrect parental PIN." });
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/catalog") {
    return json(res, 200, (await activeCatalog()).publicCatalog);
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/vod/categories") {
    return json(res, 200, { categories: await getVodCategories() });
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/vod/items") {
    const categoryId = requestUrl.searchParams.get("categoryId");
    if (!categoryId) throw new PlayerError("Choose a VOD category.", 400);
    return json(res, 200, await getVodItems(categoryId, requestUrl.searchParams.get("page")));
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/play") {
    const body = await readJson(req);
    if (typeof body.channelId !== "string") {
      throw new PlayerError("Choose a valid channel.", 400);
    }
    const streamUrl = await getStreamUrl(body.channelId);
    return json(res, 200, { stream: createRelayTarget(streamUrl) });
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/vod/play") {
    const body = await readJson(req);
    if (typeof body.categoryId !== "string" || typeof body.itemId !== "string") {
      throw new PlayerError("Choose a valid movie.", 400);
    }
    const streamUrl = await getVodStreamUrl(body.categoryId, body.itemId);
    return json(res, 200, { stream: createRelayTarget(streamUrl) });
  }
  if (req.method === "GET" && requestUrl.pathname.startsWith("/stream/")) {
    return relay(req, res, requestUrl.pathname.slice("/stream/".length));
  }
  text(res, 404, "Not found.");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error.message);
    if (res.headersSent) return res.destroy();
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
    spawn(command[0], command[1], { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log("Player is already running. Opening it in your browser...");
    openBrowser();
    setTimeout(() => process.exit(0), 800);
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("Ranvexsi Local IPTV Player is running.");
  console.log(`Open http://${HOST}:${PORT}`);
  console.log("Keep this window open while watching. Close it to stop the player.");
  openBrowser();
});
