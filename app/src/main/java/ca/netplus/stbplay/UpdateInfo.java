package ca.netplus.stbplay;

/** Small update-manifest model used by the sideload updater. */
public final class UpdateInfo {
    public final int versionCode;
    public final String versionName;
    public final String apkUrl;
    public final String sha256;
    public final String notes;

    public UpdateInfo(int versionCode, String versionName, String apkUrl, String sha256, String notes) {
        this.versionCode = versionCode;
        this.versionName = versionName == null ? "" : versionName;
        this.apkUrl = apkUrl == null ? "" : apkUrl;
        this.sha256 = sha256 == null ? "" : sha256.trim().toLowerCase(java.util.Locale.US);
        this.notes = notes == null ? "" : notes;
    }

    public boolean isNewer() {
        return versionCode > BuildConfig.VERSION_CODE && !apkUrl.trim().isEmpty();
    }
}
