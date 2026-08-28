STB PLAY — v1.7.5 CLEAN LOGO + STABLE HERO + CATALOGUE + SERIES + THEME FIXES

This is a complete replacement source package. After installation,
Settings must show “STB PLAY v1.7.5”.

WHAT CHANGED IN v1.7.5

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
18. Hero copy no longer clips its buttons or metadata, while the hero height
    stays stable between rotating titles.
19. Long series episode lists stay inside a fixed, scrollable details box and
    retain the last scroll position for the selected season.
20. Returning from Home playback restores and renders the Movies & Series All
    catalogue instead of leaving a stale empty grid.

BUILD THE WINDOWS EXE

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. Open Actions. “Build Windows installer” starts automatically on main, or
   select Run workflow manually.
5. When the workflow is green, download the artifact named
   Netplus-IPTV-Player-Setup.
6. Close the old app and run the STB-PLAY installer for v1.7.5. It upgrades
   the previous version; normally you do not need to uninstall first.

TEST AFTER INSTALLATION

1. Open Settings and confirm v1.7.5 Premium Home + Personalised Recommendations UI is shown.
2. Play a Live TV channel continuously for at least 90 seconds.
3. Open multiple movies and confirm Quality -> Play.
4. Open a title from a SHOWS category and confirm Seasons -> Episodes ->
   Quality -> Play.
5. If any problem remains, choose Settings -> Start fresh test, reproduce one
   Live TV and one VOD attempt, then send netplus-diagnostics-v1.7.5.json.

The diagnostic report excludes the MAC address, parental PIN, portal token,
cookies, and full stream links.

The Windows installer is unsigned, so Windows may show a security warning
until a NetPlus code-signing certificate is added.
