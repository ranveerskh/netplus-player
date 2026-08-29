STB PLAY — v1.8.15 RELEASE PACKAGE

This package contains the Windows desktop player source, the anonymous
analytics endpoint, and a separate private admin dashboard. Deploy the
analytics endpoint before distributing the desktop build. Until it is live,
the player keeps a small local outbox and retries events later.

WHAT CHANGED IN v1.8.15

1. Strict search
   Search results are matched against title, old title, and alternate/original
   title fields only. Paths, descriptions, provider metadata, URLs, and raw
   catalogue text cannot create unrelated matches. Search phrases use whole
   title words, so a query such as “from” returns relevant titles only.

2. Live 18+ channels
   Live adult protection follows the working v1.8.12 provider-category model.
   Provider categories and channel genre IDs are preserved, and a provider
   category marked adult/locked is displayed with “[PIN]” until the app
   parental PIN is verified. No synthetic category or provider PIN is used.
   Leaving the category or switching mode locks it again. Live catalogue
   responses are normalized so valid channels are not dropped because the
   provider uses a supported alternate field shape.

3. Live recovery
   Temporary portal/MAC authorization HTTP 401 responses retry automatically.
   A missing or stale channel ID refreshes the live catalogue once and retries
   the selected channel. If the channel is genuinely gone, the player says
   “This channel is no longer available” and does not loop forever.

4. Diagnostics
   Diagnostics remain off by default. Settings explains that support should
   ask the user to start a fresh test, reproduce the problem, download the
   JSON report, and attach it to the support message. The report excludes MAC,
   PIN, portal token, cookies, stream URLs, channel names, and personal files.

5. Anonymous analytics and private dashboard
   The desktop app sends only allow-listed health events through the local
   player server. The server queues events during an endpoint outage and sends
   them to Firebase Functions. The endpoint stores a one-way HMAC installation
   ID plus version, platform, event name, and safe metadata. The dashboard is
   a separate Firebase-Auth-protected webpage, not part of the app UI.

6. VOD online subtitles
   Provider subtitle files can be loaded online for the current movie or
   episode. English, Punjabi, and Hindi preferences are supported, and the
   setting remains Off by default. A deployment may configure
   STB_PLAY_SUBTITLE_API_URL and STB_PLAY_SUBTITLE_API_KEY on the local player
   server for an approved subtitle service; the key never reaches the app UI.

BACKEND FIRST — DEPLOY BEFORE THE NEXT BUILD

1. Install Firebase CLI and sign in with the private project owner account.
2. From this package root, run:

   firebase use stb-play-analytics
   firebase functions:secrets:set ANALYTICS_HASH_SECRET
   npm run analytics:install
   firebase deploy --only functions:analyticsEvents,firestore:rules

3. Set the stable Functions secret ANALYTICS_HASH_SECRET before production
   use. Keep it private; changing it creates a new anonymous ID namespace.
4. Create the private dashboard admin in Firebase Authentication using
   Email/Password. Add a document at admins/{uid} with role: "admin".
5. Publish the separate dashboard:

   firebase deploy --only hosting

The player default endpoint is:
https://us-central1-stb-play-analytics.cloudfunctions.net/analyticsEvents

BUILD THE WINDOWS INSTALLER

1. Extract this ZIP outside the archive.
2. Replace the files in the netplus-player repository and commit to main.
3. Run the “Build Windows installer” GitHub Actions workflow.
4. The expected release asset is:
   Netplus-IPTV-Player-Setup-1.8.15.exe
5. The installer upgrades the previous version; an uninstall is normally not
   required. The installer is unsigned unless a NetPlus code-signing
   certificate is configured.

LOCAL CHECKS

Run the backend smoke tests from the package root:

   npm run analytics:test

For a local end-to-end analytics check, use two terminals:

   node analytics-backend/local-server.cjs
   STB_PLAY_ANALYTICS_ENDPOINT=http://127.0.0.1:3850/analyticsEvents node local-player/server.cjs

On Windows, double-click “local-player\\Start Player.bat” for the normal
player. Keep the command window open while testing.

INSTALL / UPDATE / PLAYBACK CHECKLIST

1. Install the v1.8.15 installer and confirm Settings shows v1.8.15.
2. Launch the old build, use its update check, and confirm the v1.8.15
   installer link is accepted and the new build opens.
3. Add a portal and confirm Live TV loads.
4. Search a title by exact title/alternate title words; verify a description,
   path, or metadata-only match is not shown.
5. If the provider exposes adult live channels, confirm the provider's
   category shows with “[PIN]”, unlock it with the app PIN, play a channel,
   leave it, and confirm it locks again. Confirm normal categories do not get
   marked as adult when their provider flag is the string “0”.
6. Test a live channel through a temporary 401 and a removed channel where
   possible; confirm retry, catalogue refresh, and the clear unavailable text.
7. Confirm anonymous analytics is enabled by default, can be disabled in
   Settings, and that diagnostics are still off by default.
8. If support asks for diagnostics: Settings → Start fresh test → reproduce
   the issue → Download diagnostic report → attach
   netplus-diagnostics-v1.8.15.json to the support message.
9. For a title with provider subtitle files, set Settings → Subtitle
   preference to English, Punjabi, Hindi, or Auto and confirm the player
   subtitle selector loads the available online track.
