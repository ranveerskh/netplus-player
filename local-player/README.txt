STB PLAY — v1.8.13 PUBLIC RELEASE

1. Install the official Node.js 24 LTS Windows x64 version from:
   https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi

2. Extract this entire ZIP folder. Do not run it from inside the ZIP.

3. Double-click "Start Player.bat".

4. Your browser opens automatically. On first launch, add a portal nickname,
   portal URL, and editable MAC address. More portals can be managed in Settings.

5. Keep the black command window open while watching.
   Closing that window stops the local player.

Important:
- No npm install is required.
- Settings shows the active version as STB PLAY v1.8.13.
- Movies and series are browsed together in Movies & Series; series open as
  seasons, episodes, and provider quality choices.
- Home content refreshes once a day; Settings also has Refresh content,
  Clear local cache, and Clear watch history controls.
- Search in Movies & Series searches the full provider catalogue, not only
  the titles currently visible on screen.
- A small set of safe VOD shelves is warmed one request at a time in the
  background. The visible category always has priority.
- All VOD list/search requests share a paced queue, and optional background
  loading stops when the provider returns HTTP 429.
- Search paints local shelf/cache matches immediately and tries the provider's
  native search parameter once; a full local index is optional from Settings.
- Search matches complete title words in the display title or alternate title;
  provider paths and unrelated metadata are not treated as title matches.
- Live TV adds a local PIN-protected 18+ channels category when the provider
  returns adult-marked or clearly 18+ channels. Leaving the category relocks it.
- A transient MAC authorization failure is retried once, and a missing channel
  refreshes the live catalogue once before showing an unavailable message.
- Playback diagnostic reports are created only after the user presses Start
  fresh test and can be downloaded and attached to support.
- Opening a title uses the already cached metadata first and refreshes that
  title's details on demand.
- The Home hero rotates every 8 seconds, supports dots/arrows, and pauses while
  hovered or focused. Poster art stays sharp in a blended cinematic layout.
- Continue Watching shows a visible Resume button. Movies resume from their
  saved position, and series keep the last episode and resume position.
- Category switching cancels stale VOD requests, so a previous All request
  cannot overwrite the newly selected category.
- The local metadata index stores completion state and receives only new rows
  during progress polling instead of downloading the whole partial index again.
- Portal profiles and MAC addresses are stored locally in the app user-data folder.
- This test server listens only on 127.0.0.1, so other computers cannot connect.
- Delete config.json if you want to erase the saved portal settings.
