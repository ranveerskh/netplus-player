package ca.netplus.stbplay;

/** Release-time endpoints. Keep these empty for a local build until the private services are ready. */
public final class AppConfig {
    private AppConfig() { }

    /** HTTPS JSON endpoint receiving anonymous analytics events. */
    public static final String ANALYTICS_ENDPOINT = "";

    /** HTTPS JSON manifest describing the latest sideload APK. */
    public static final String UPDATE_MANIFEST_URL = "";

    /** Public HTTPS privacy policy URL. Keep empty until the release website is ready. */
    public static final String PRIVACY_POLICY_URL = "";

    /** Public HTTPS terms URL. Keep empty until the release website is ready. */
    public static final String TERMS_URL = "";

    /** Support contact shown in the legal and help screens. */
    public static final String SUPPORT_EMAIL = "";
}
