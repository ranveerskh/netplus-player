NETPLUS IPTV PLAYER — v1.6.1 PREMIUM UI + FRESH VOD PLAYBACK

This is a complete replacement source package. After installation,
Settings must show “NetPlus IPTV Player v1.6.1”.

WHAT CHANGED IN v1.6.1

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
11. The tested V1.5.8 server playback fix is included in local-player/server.cjs.
12. GitHub Actions builds with --publish never, so electron-builder does not
   require GH_TOKEN merely to create the Windows installer.

BUILD THE WINDOWS EXE

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. Open Actions. “Build Windows installer” starts automatically on main, or
   select Run workflow manually.
5. When the workflow is green, download the artifact named
   Netplus-IPTV-Player-Setup.
6. Close the old app and run Netplus-IPTV-Player-Setup-1.6.1.exe. It upgrades
   the previous version; normally you do not need to uninstall first.

TEST AFTER INSTALLATION

1. Open Settings and confirm v1.6.1 Premium UI is shown.
2. Play a Live TV channel continuously for at least 90 seconds.
3. Open multiple movies and confirm Quality -> Play.
4. Open a title from a SHOWS category and confirm Seasons -> Episodes ->
   Quality -> Play.
5. If any problem remains, choose Settings -> Start fresh test, reproduce one
   Live TV and one VOD attempt, then send netplus-diagnostics-v1.6.1.json.

The diagnostic report excludes the MAC address, parental PIN, portal token,
cookies, and full stream links.

The Windows installer is unsigned, so Windows may show a security warning
until a NetPlus code-signing certificate is added.
