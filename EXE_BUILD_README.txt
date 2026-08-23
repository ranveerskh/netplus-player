NETPLUS IPTV PLAYER — v1.4.1 DIAGNOSTIC BUILD

This is a FRESH diagnostic source package. The visible app version must say
“NetPlus IPTV Player v1.4.1 Diagnostic” in Settings after installation.

1. Extract this ZIP on your computer.
2. Open your netplus-player GitHub repository.
3. Upload and replace ALL extracted files and folders, then commit the changes.
4. Open Actions. “Build Windows installer” starts automatically.
5. When the workflow is green, download the artifact named
   Netplus-IPTV-Player-Setup.
6. Run Netplus-IPTV-Player-Setup-1.4.1.exe. It can upgrade the previous app;
   you do not need to uninstall first.

DIAGNOSTIC TEST — do exactly this:

1. Open Settings and confirm v1.4.1 Diagnostic is shown at the bottom.
2. Click “Start fresh test”.
3. Play one Live TV channel for 45 seconds (let the buffering happen).
4. Try one movie that fails.
5. Open one web series and choose its season/episodes screen.
6. Return to Settings and click “Download report”.
7. Send the downloaded file netplus-diagnostics-v1.4.1.json in chat.

The report records API response structure and stream timing. It excludes the
MAC address, parental PIN, portal token, cookies, and full stream links.

This Windows installer is unsigned, so Windows may show a security warning until
a Netplus code-signing certificate is added.
