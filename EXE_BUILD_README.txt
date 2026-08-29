STB PLAY — v1.8.13 PUBLIC RELEASE

This is a complete replacement source package. After installation,
Settings must show “STB PLAY v1.8.13”.

WHAT CHANGED IN v1.8.13

0.1. The bundled HLS.js runtime and logo assets are included in the GitHub
     build. Earlier v1.8.9 packaging omitted these runtime files, which made
     the installed app report that HLS was unavailable.
0.2. Settings now uses a readable two-column layout on desktop and one column
     on smaller windows. Auto playback falls back to VLC when HLS.js is not
     available, while Internal player remains an explicit built-in-only mode.

0. Settings now includes Default player: Auto, Internal player, and VLC.
   Auto starts with the built-in player and exposes VLC when a codec or
   provider stream cannot be decoded. VLC mode opens live, movie, and episode
   streams directly in VLC.

1. Movies and episodes whose selected quality is already a final http/https
   stream URL now play that URL directly. The app no longer sends a final
   .m3u8 URL through Stalker create_link a second time, which caused the
   provider to reply “nothing_to_play”.
2. Relative and opaque provider commands still use create_link, preserving
   compatibility with titles that require portal-side link creation.
3. Mixed VOD navigation remains: movie -> quality -> play, and show ->
   seasons -> episodes -> quality -> play.
4. Live TV now requests a fresh create_link immediately when an HLS request
   returns 401, 403, 410, 502, or an invalid HLS manifest.
5. The replacement Live TV link is fetched before the current HLS MediaSource
   is detached, reducing avoidable recovery delay.
6. The relay validates that .m3u8 responses begin with #EXTM3U. Provider
   SafeBrowse/login HTML redirects are rejected as invalid manifests instead
   of being passed to HLS.js as playlists.
7. Recovery attempts are capped within a short window, while a successfully
   loaded fragment resets the cap.
8. The Home screen has Continue Watching, recommendations, popular picks,
   saved themes, history controls, and responsive spacing.
9. Movies and Series remain on one page, with poster fallback, provider-wide
   search, readable quality names, and full-screen VOD playback overlay.
10. Content refreshes once per day and can be refreshed manually in Settings.
11. VOD list/search calls use one paced priority queue. A small safe shelf set
    warms in the background, visible categories take priority, and optional
    background work stops on HTTP 429.
12. Local search uses cached shelf metadata immediately; the full local index
    is optional from Settings and is built one page at a time.
13. The tested V1.5.8 server playback fix is included in local-player/server.cjs.
14. GitHub Actions builds with --publish never, so electron-builder does not
   require GH_TOKEN merely to create the Windows installer.
15. The Home hero rotates on an exact 8-second timer with manual arrows/dots,
    while preserving crisp poster art over a cinematic backdrop.
16. Continue Watching now exposes Resume for movies and the last saved episode
    for series. Duplicate provider cards and metadata overlap are cleaned up.
17. The clean navy/gold STB PLAY PNG has a transparent outside area with no
   white/grey halo or screenshot background.
18. The Windows desktop, installer, taskbar, and BrowserWindow icon are built
   from that same app PNG, so the desktop logo matches the in-app logo.
19. Hero copy no longer clips its buttons or metadata, while the hero height
   stays stable between rotating titles.
20. Long series episode lists stay inside a fixed, scrollable details box and
   retain the last scroll position for the selected season.
21. Returning from Home playback restores and renders the Movies & Series All
   catalogue instead of leaving a stale empty grid.
22. New portal IDs use a locally administered 02-series MAC and additional
   portals reuse the existing MAC unless it is manually changed.
23. Successful portal loading holds the completed 100% state for one second
   before opening Home. Startup also shows progress before the saved portal
   refresh begins.
24. Auto Live TV playback opens VLC after three seconds of buffering or an
   unsupported codec. A provider response with no stream shows a simple
   temporarily-unavailable message.
25. The Windows update button downloads the trusted installer, starts it
   automatically, and closes STB PLAY after the installer launches.

26. VOD search now matches complete words in the display title or alternate
    title only; provider paths and unrelated metadata are excluded.
27. Live TV adds a local PIN-protected 18+ channels category when the provider
    returns adult-marked or clearly 18+ channels.
28. A transient MAC authorization 401 is retried once, and a missing channel
    refreshes the live catalogue once before the unavailable message.
29. Diagnostic instructions tell users to download and attach the report only
    when support requests it.

BUILD THE WINDOWS EXE

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. The “Build Windows installer” workflow builds the installer and publishes
   a GitHub Release automatically after the commit reaches main.
5. The release asset is named Netplus-IPTV-Player-Setup-1.8.13.exe. The
   installer bootstrapper can download it from Releases/latest.
6. Close the old app and run the STB-PLAY installer for v1.8.13. It upgrades
   the previous version; normally you do not need to uninstall first.

TEST AFTER INSTALLATION

1. Open Settings and confirm v1.8.13 Premium Home + Personalised Recommendations UI is shown.
2. Open Settings > Playback and confirm Auto, Internal player, and VLC are present.
3. Play a Live TV channel continuously for at least 90 seconds.
4. Open multiple movies and confirm Quality -> Play.
5. Open a title from a SHOWS category and confirm Seasons -> Episodes ->
   Quality -> Play.
6. If any problem remains, choose Settings -> Start fresh test, reproduce one
   Live TV and one VOD attempt, then send netplus-diagnostics-v1.8.13.json.

The diagnostic report excludes the MAC address, parental PIN, portal token,
cookies, and full stream links.

The Windows installer is unsigned, so Windows may show a security warning
until a NetPlus code-signing certificate is added.
