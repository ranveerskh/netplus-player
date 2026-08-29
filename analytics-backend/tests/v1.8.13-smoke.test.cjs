const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, predicate = (response) => response.ok) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (predicate(response)) return response;
      lastError = new Error(`Unexpected status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function startProcess(file, env) {
  const child = spawn(process.execPath, [file], {
    cwd: ROOT,
    env: { ...process.env, ...env, NO_OPEN_BROWSER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.testOutput = () => output;
  return child;
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function startMockPortal(port) {
  const state = {
    handshakeCount: 0,
    createLinkCount: 0,
    staleChannel: false,
  };
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    const action = requestUrl.searchParams.get("action");

    if (action === "handshake") {
      state.handshakeCount += 1;
      if (state.handshakeCount === 1) return jsonResponse(res, 200, { js: { not_valid: 1 } });
      return jsonResponse(res, 200, { js: { token: "mock-session-token" } });
    }
    if (action === "get_profile") return jsonResponse(res, 200, { js: { tariff_plan: "Smoke test" } });
    if (action === "get_genres") {
      return jsonResponse(res, 200, { js: [
        { id: "1", name: "General", locked: "0", adult: "0" },
        { id: "2", title: "Adult", locked: "1", adult: "0" },
      ] });
    }
    if (action === "get_all_channels") {
      const channels = [
        state.staleChannel
          ? null
          : { id: "100", title: "News One", command: "http://127.0.0.1/stream/news", genre_id: "1", channel_number: 1 },
        { id: "200", name: "Private TV HD", cmd: "http://127.0.0.1/stream/adult", tv_genre_id: "2", number: 2 },
      ].filter(Boolean);
      return jsonResponse(res, 200, { js: { data: channels } });
    }
    if (action === "create_link") {
      state.createLinkCount += 1;
      if (state.createLinkCount === 1) return jsonResponse(res, 401, { error: "temporary" });
      if (state.staleChannel) return jsonResponse(res, 404, { error: "missing" });
      return jsonResponse(res, 200, { js: { cmd: `http://127.0.0.1:${port}/stream/mock.m3u8` } });
    }
    return jsonResponse(res, 200, { js: [] });
  });
  server.listen(port, "127.0.0.1");
  return { server, state };
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("v1.8.14 release markers and recovery/search boundaries are present", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const updateJson = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8"));
  const app = fs.readFileSync(path.join(ROOT, "local-player", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "local-player", "server.cjs"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "local-player", "index.html"), "utf8");

  assert.equal(packageJson.version, "1.8.14");
  assert.equal(updateJson.version, "1.8.14");
  assert.match(updateJson.downloadUrl, /v1\.8\.14\/Netplus-IPTV-Player-Setup-1\.8\.14\.exe$/);
  assert.match(app, /function strictTitleSearchMatch/);
  assert.match(app, /!query \|\| strictTitleSearchMatch\(\{ title: channel\.name \}, query\)/);
  assert.doesNotMatch(server, /ADULT_LIVE_CATEGORY_ID/);
  assert.match(server, /function providerFlag\(value\)/);
  assert.match(server, /locked: providerFlag\(genre\.locked\)/);
  assert.match(server, /liveRowsFromResponse\(channelsResponse\)/);
  assert.match(server, /error\.status === 401/);
  assert.match(app, /error\.status === 404/);
  assert.match(server, /\[401, 404\]/);
  assert.match(server, /Channel is no longer available\./);
  assert.match(server, /enabled: false/);
  assert.match(html, /attach the JSON file to your support message/i);
  assert.match(app, /\/api\/analytics\/event/);
});

test("analytics contract keeps payload anonymous and allow-listed", () => {
  const { normalizeAnalyticsPayload, hashInstallationId } = require("../functions/contract.cjs");
  const installationId = "0123456789abcdef0123456789abcdef";
  const payload = normalizeAnalyticsPayload({
    installationId,
    name: "playback_failed",
    version: "1.8.14",
    platform: "linux",
    meta: {
      player: "internal",
      screen: "live",
      errorType: "network",
      statusCode: 401,
      mac: "02:00:00:00:00:01",
      channelName: "private channel",
    },
  });

  assert.deepEqual(payload.meta, {
    player: "internal",
    screen: "live",
    errorType: "network",
    statusCode: 401,
  });
  assert.notEqual(hashInstallationId(installationId, "test-secret"), installationId);
  assert.throws(
    () => normalizeAnalyticsPayload({ ...payload, installationId: "short" }),
    /installation ID is invalid/
  );
});

test("live catalogue preserves the v1.8.12 PIN category and recovers 401/stale playback", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stb-play-live-v1.8.14-"));
  const portalPort = await freePort();
  const playerPort = await freePort();
  const portal = startMockPortal(portalPort);
  const player = startProcess(path.join(ROOT, "local-player", "server.cjs"), {
    NETPLUS_PORT: String(playerPort),
    NETPLUS_CONFIG_PATH: path.join(tempRoot, "config.json"),
    STB_PLAY_ANALYTICS_ENDPOINT: "",
  });
  t.after(async () => {
    stopProcess(player);
    await closeServer(portal.server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitFor(`http://127.0.0.1:${playerPort}/api/config`);
  const save = await fetch(`http://127.0.0.1:${playerPort}/api/portals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nickname: "Mock portal",
      portalUrl: `http://127.0.0.1:${portalPort}`,
      mac: "02:00:00:00:00:01",
      parentalPin: "1234",
    }),
  });
  assert.equal(save.status, 200);

  const catalogResponse = await fetch(`http://127.0.0.1:${playerPort}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const generalCategory = catalog.categories.find((category) => category.id === "1");
  const adultCategory = catalog.categories.find((category) => category.id === "2");
  assert.deepEqual(
    { title: generalCategory?.title, locked: generalCategory?.locked },
    { title: "General", locked: false }
  );
  assert.deepEqual(
    { title: adultCategory?.title, locked: adultCategory?.locked },
    { title: "Adult", locked: true }
  );
  assert.equal(catalog.channels.find((channel) => channel.id === "200")?.genreId, "2");
  assert.equal(catalog.channels.length, 2);
  assert.equal(portal.state.handshakeCount, 2, "the initial temporary authorization should retry");

  const playback = await fetch(`http://127.0.0.1:${playerPort}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "100" }),
  });
  assert.equal(playback.status, 200);
  assert.match((await playback.json()).stream, /\/stream\//);
  assert.equal(portal.state.createLinkCount, 2, "the temporary create_link 401 should retry");

  portal.state.staleChannel = true;
  const stalePlayback = await fetch(`http://127.0.0.1:${playerPort}/api/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: "100" }),
  });
  assert.equal(stalePlayback.status, 404);
  assert.equal((await stalePlayback.json()).error, "Channel is no longer available.");
});

test("local player queues and delivers an analytics event to the backend", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stb-play-v1.8.14-"));
  const analyticsPort = await freePort();
  const playerPort = await freePort();
  const analyticsDataPath = path.join(tempRoot, "analytics-data.json");
  const configPath = path.join(tempRoot, "config.json");
  const analytics = startProcess(path.join(ROOT, "analytics-backend", "local-server.cjs"), {
    ANALYTICS_PORT: String(analyticsPort),
    ANALYTICS_DATA_PATH: analyticsDataPath,
    ANALYTICS_HASH_SECRET: "smoke-test-secret",
  });
  const player = startProcess(path.join(ROOT, "local-player", "server.cjs"), {
    NETPLUS_PORT: String(playerPort),
    NETPLUS_CONFIG_PATH: configPath,
    STB_PLAY_ANALYTICS_ENDPOINT: `http://127.0.0.1:${analyticsPort}/analyticsEvents`,
  });
  t.after(() => {
    stopProcess(player);
    stopProcess(analytics);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitFor(`http://127.0.0.1:${analyticsPort}/health`);
  await waitFor(`http://127.0.0.1:${playerPort}/api/analytics/status`);

  const installationId = "fedcba9876543210fedcba9876543210";
  const response = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId,
      name: "app_opened",
      version: "1.8.14",
      platform: "linux",
      meta: { screen: "app", portalUrl: "https://should-not-be-sent.example" },
    }),
  });
  assert.equal(response.status, 202);

  const crash = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId,
      name: "crash_reported",
      version: "1.8.14",
      platform: "linux",
      meta: { screen: "app", errorType: "unhandled-rejection", rawError: "must-not-be-stored" },
    }),
  });
  assert.equal(crash.status, 202);

  let store;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { store = JSON.parse(fs.readFileSync(analyticsDataPath, "utf8")); } catch {}
    if (store?.events?.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  assert.equal(store?.events?.length, 2, `analytics delivery failed: ${player.testOutput()}`);
  assert.deepEqual(store.events.map((event) => event.name), ["app_opened", "crash_reported"]);
  assert.equal(store.events[0].version, "1.8.14");
  assert.equal(store.events[0].meta.screen, "app");
  assert.equal(store.events[1].meta.errorType, "unhandled-rejection");
  assert.equal(store.events[0].uid.length, 64);
  assert.notEqual(store.events[0].uid, installationId);
  assert.equal(JSON.stringify(store).includes("should-not-be-sent"), false);

  const invalid = await fetch(`http://127.0.0.1:${playerPort}/api/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "bad", name: "app_opened", version: "1.8.14", platform: "linux" }),
  });
  assert.equal(invalid.status, 400);
});
