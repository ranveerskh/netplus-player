package ca.netplus.stbplay;

/** A locally stored authorised portal profile. It contains no provider password or media. */
public final class PortalProfile {
    public final String id;
    public final String name;
    public final String url;
    public final String mac;
    public final PortalSubscription subscription;

    public PortalProfile(String id, String name, String url, String mac, PortalSubscription subscription) {
        this.id = id == null ? "" : id.trim();
        this.name = name == null || name.trim().isEmpty() ? "Authorised portal" : name.trim();
        this.url = url == null ? "" : url.trim();
        this.mac = mac == null ? "" : mac.trim().toUpperCase(java.util.Locale.US);
        this.subscription = subscription == null ? PortalSubscription.unavailable() : subscription;
    }

    public PortalProfile withDetails(String nextName, String nextUrl, String nextMac) {
        return new PortalProfile(id, nextName, nextUrl, nextMac, subscription);
    }

    public PortalProfile withSubscription(PortalSubscription nextSubscription) {
        return new PortalProfile(id, name, url, mac, nextSubscription);
    }
}
