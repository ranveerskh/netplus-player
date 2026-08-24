NETPLUS IPTV PLAYER — v1.5.2 MIXED VOD + LIVE STABILITY

This is a FRESH complete replacement source package. The visible app version
must say “NetPlus IPTV Player v1.5.2 Mixed VOD + Live Stability” in Settings
after installation.

WHAT CHANGED IN v1.5.2

1. Mixed VOD shows now follow the same request hierarchy used by MAG/Stalker
   clients: title/movie_id -> season_id -> episode_id -> quality -> play.
2. Catalogue identifiers (id, movie_id and video_id) are preserved separately,
   so portals that require their real movie_id receive the correct request.
3. Movies open the quality picker before playback. Shows open Seasons first,
   then Episodes, then the quality picker, and only then start playback.
4. The Live TV watchdog no longer recreates the stream every 15 seconds.
   Non-fatal levelParsingError and mediaSourceRequiresReset events use soft HLS
   recovery first; a fresh short-lived portal link is requested only after a
   sustained stall.
5. Dashboard grids, empty states, quick actions and narrow-window layout were
   repaired so cards no longer overflow or collapse.
6. Provider “nothing_to_play” responses now show a clear provider-storage
   unavailable message. The app cannot restore a title missing upstream.
7. GitHub Actions builds with --publish never, so electron-builder does not
   require GH_TOKEN merely to create the Windows installer.

BUILD THE WINDOWS EXE

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. Open Actions. “Build Windows installer” starts automatically on main, or
   select Run workflow manually.
5. When the workflow is green, download the artifact named
   Netplus-IPTV-Player-Setup.
6. Run Netplus-IPTV-Player-Setup-1.5.2.exe. Close the app first. It upgrades the
   previous version, so you normally do not need to uninstall it.

TEST AFTER INSTALLATION

1. Open Settings and confirm v1.5.2 Mixed VOD + Live Stability is displayed.
2. Play a Live TV channel continuously for at least 90 seconds.
3. Open a movie and confirm quality selection appears before playback.
4. Open a title from a SHOWS category and confirm Seasons -> Episodes ->
   Quality -> Play.
5. Try several VOD titles. If one says it is unavailable on provider storage,
   test another title; that response comes from the IPTV provider.
6. If a show still exposes no seasons, use Settings -> Start fresh test, repeat
   one show attempt, then download and send netplus-diagnostics-v1.5.2.json.

The report excludes the MAC address, parental PIN, portal token, cookies, and
full stream links.

This Windows installer is unsigned, so Windows may show a security warning until
a NetPlus code-signing certificate is added.
