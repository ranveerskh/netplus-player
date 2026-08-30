# STB PLAY Play Store release checklist

This source is prepared with two distribution variants:

- `sideload`: debug/test distribution; includes the optional HTTPS sideload updater permission.
- `play`: Play Store distribution; does not include `REQUEST_INSTALL_PACKAGES` and expects Play Store updates.

Before the first Play Console upload:

1. Configure a private release keystore and signing secrets in CI. Never commit the keystore or passwords.
2. Configure the Play Store GitHub Actions secrets: `STB_PLAY_KEYSTORE_BASE64`, `STB_PLAY_KEYSTORE_PASSWORD`, `STB_PLAY_KEY_ALIAS` and `STB_PLAY_KEY_PASSWORD`. The workflow builds the signed bundle with `gradle bundlePlayRelease`.
3. Set `PRIVACY_POLICY_URL`, `TERMS_URL` and `SUPPORT_EMAIL` in `app/src/main/java/ca/netplus/stbplay/AppConfig.java`, then verify the in-app legal/help screens before publishing.
4. Complete Play Console Data safety answers from the final analytics configuration. The current analytics client is disabled while its endpoint is blank and is designed not to send portal URL, MAC, channel names, titles or stream URLs.
5. Confirm that all portal, subscription and content services used by testers are authorised and that no provider media is bundled in the app.
6. Add the final Android TV screenshots, app description, support email and content-rating answers.
7. Use Play's normal update flow for the `play` variant; keep the sideload updater for test builds only.

Subtitles are intentionally not part of this release pass and will be added separately.
