# STB PLAY Android TV

This is the separate native Android TV project for STB PLAY. The Windows/Electron
build is not changed by this folder.

The first native test target contains:

- Android TV launcher metadata and side navigation with remote/D-pad-friendly controls
- STB PLAY navy/gold branding, disclaimer and local setup
- locally administered `02:` MAC generation and editable MAC storage
- authorised Stalker portal handshake, Live TV categories and channel loading
- device-local Live TV metadata cache with a 24-hour refresh window and manual refresh
- provider-category adult locking with local parental PIN
- Media3 playback for HLS and progressive live streams
- Media3 HLS extension included explicitly for `.m3u8` IPTV streams
- one mixed Movies & Series catalogue with category switching and remote-friendly cards
- local minimum-3-character search across title, original title, genre, language and year
- movie quality selection and series season → episode → quality navigation
- exact provider playback commands passed through native Media3 playback
- persistent local Favourites with a light-gold star and a dedicated section
- Continue Watching with progress saving, resume, remove-entry and clear-history actions
- a Home smart dashboard with Continue Watching, Favourites, Latest Releases and taste-based recommendations
- Home/Favourites/Continue shelves that exclude restricted or adult-rated titles
- polished Media3 playback controls with three-second auto-hide, D-pad focus and fullscreen mode
- optional VLC handoff after a native buffering/error fallback, when VLC is installed on the TV
- portal loading progress with provider-reported Active/Expired status, expiry date, time-left and a once-per-day seven-day reminder
- privacy-safe anonymous analytics event client and a checksum-verified HTTPS sideload updater
- multiple locally saved authorised portals with add, edit, rename, delete and switch actions
- stable Home hero panel, provider poster/thumbnail loading, default quality preference and share-title action
- automatic Next Episode prompt with five-second autoplay countdown, including the next season when available
- Dark/Light theme choice and English/Punjabi/Hindi navigation language choice
- separate `sideload` and `play` build variants; only the sideload variant requests Android's unknown-app installer permission
- v1.6.2 polish: transparent logo treatment, stable hero sizing, restored Season/Episode scroll position, deterministic D-pad focus, player retry and clear unsupported-stream messages
- faster poster loading with request coalescing, image-size sampling and a bounded download size; local catalogue data is shown before refresh work begins
- physical Back now returns through Home, VOD, series, quality and player states without stale loading responses replacing the current screen
- build compatibility fix: Android API 36 with AGP 8.9.1 and Gradle 8.11.1 for the current Media3 release, plus Android-safe JSON key iteration and valid ScrollView listener signatures
- portal-generation guards so a previous portal/category response cannot overwrite the currently selected portal, plus duplicate-load protection and short retry/backoff for transient portal errors
- provider adult/locked flags are retained as visible PIN-protected categories/titles, while restricted items stay out of Home, recommendations, Favourites and Continue Watching
- legal/help copy includes independent-app wording, no bundled service/media, copyright routing, premium-app scope, and configurable Terms, Privacy Policy and Support contact fields

Before publishing a test build, set the private HTTPS endpoints and the final
public legal/support contacts in
`app/src/main/java/ca/netplus/stbplay/AppConfig.java`. Analytics sends only an
anonymous device ID, device type, app version, event name, timestamp and
playback-active flag; it never sends portal URL, MAC, channel/title metadata or
stream links. The updater expects the shape in `update-manifest.example.json`.
For sideload builds Android may require the user to approve installing unknown
apps; Play Store distribution will use Play's normal update system later.

Subtitle tracks remain intentionally deferred for the next pass. Private analytics
dashboard hosting still needs the final HTTPS endpoint; the app keeps analytics
disabled while that endpoint is blank.

## Build

Upload the contents of this `android-tv` folder as the root of a separate
GitHub repository. The supplied GitHub Actions workflow builds the sideload
debug APK. A local Android SDK is required for a local build:

```text
gradle assembleSideloadDebug
```

The GitHub workflows use Android API 36 for the current Media3 release while
keeping target SDK 35 and min SDK 23 for the app's runtime compatibility.

For the later Play Store release, use the Play Store GitHub Actions workflow
after configuring its signing secrets. It runs `gradle bundlePlayRelease`, adds
the signed AAB as an artifact, checks the final legal contacts, and keeps the
`play` variant free of sideload-only installer permission. Play Store updates
should use Google's normal update flow.

The app does not include a portal, subscription, channel list, or media.
Connect only an authorised service.
