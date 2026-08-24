NETPLUS IPTV PLAYER — v1.5.1 QUALITY FLOW

This is a FRESH complete replacement source package. The visible app version
must say “NetPlus IPTV Player v1.5.1 Quality Flow” in Settings after installation.

WHAT CHANGED IN v1.5.1

1. Live HLS relay links remain stable across playlist refreshes. This fixes
   the detected media-sequence mismatch that was causing levelParsingError,
   repeated 10–20 second playback, and short buffering loops.
2. Dashboard now has a stable welcome panel, quick actions, Continue Watching,
   and provider-powered Recommended/Popular placeholders.
3. Movies and series now share one VOD catalogue. A title is classified only
   after opening it, so mixed provider categories can show a movie detail view
   or Series → Season → Episode flow without requiring a separate series feed.
4. VOD details, seasons, episodes, and episode playback now handle more Stalker
   response wrappers and nested cmd/playback URL shapes.
5. Movie playback now clearly reports when the provider itself returns
   “nothing_to_play” because its VOD storage is unavailable. This is a provider
   availability issue, not a cached app file.
6. GitHub/Windows builds use --publish never, so electron-builder will not ask
   for a GitHub token while creating the installer.

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. Open Actions. “Build Windows installer” starts automatically.
5. When the workflow is green, download the artifact named
   Netplus-IPTV-Player-Setup.
6. Run Netplus-IPTV-Player-Setup-1.5.1.exe. It can upgrade the previous app;
   you do not need to uninstall first.

TEST AFTER INSTALLATION

1. Open Settings and confirm v1.5.1 Quality Flow is shown at the bottom.
2. Open Movies & Series, choose a category, and open one movie and one show.
3. For a show, confirm seasons and episodes appear, then start an episode.
4. Play a Live TV channel for at least 90 seconds.
5. Try several movies. A provider-unavailable title will now show the correct
   message instead of the generic “playable stream” error.
6. If a series still has no seasons/episodes, use Settings → Start fresh test,
   then download and send netplus-diagnostics-v1.5.1.json.

The report excludes the MAC address, parental PIN, portal token, cookies, and
full stream links.

This Windows installer is unsigned, so Windows may show a security warning until
a Netplus code-signing certificate is added.
