STB PLAY — v1.8.13 PLAYER

1. Install the official Node.js 24 LTS Windows x64 version.
2. Extract this package outside the ZIP.
3. Double-click “Start Player.bat”.
4. Add a portal nickname, portal URL, editable MAC address, and the app
   parental PIN on first launch.
5. Keep the command window open while watching.

v1.8.13 behavior

- Movies & Series search checks title, old title, and alternate/original title
  fields only. It does not match paths, descriptions, URLs, or provider
  metadata. Results use whole title words and phrases.
- If live adult channels are present, a “[PIN] 18+ Channels” category is
  created automatically. It uses the app parental PIN, never a provider PIN,
  and locks again after leaving the category.
- Temporary live HTTP 401 authorization failures retry automatically.
  Stale channel IDs refresh the catalogue once. A channel that is truly gone
  gets a clear unavailable message.
- Anonymous analytics is enabled by default and can be disabled in Settings.
  It sends only a random installation identifier, version, platform, event
  name, and safe allow-listed metadata. The local outbox retries a temporary
  backend outage.
- Diagnostics are disabled by default. Start a fresh diagnostic test only
  when support asks. Reproduce the issue, download the report, and attach
  netplus-diagnostics-v1.8.13.json to the support message.
- Portal profiles, MAC addresses, parental PIN hashes, analytics outbox, and
  diagnostics remain in the local user-data/config location.
- This local server listens only on 127.0.0.1.

No provider URL, provider credential, provider PIN, stream URL, channel name,
or personal file is bundled in this folder.
