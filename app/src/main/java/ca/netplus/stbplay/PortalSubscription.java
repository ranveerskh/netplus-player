package ca.netplus.stbplay;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Provider-reported subscription state. It never contains portal credentials or content. */
public final class PortalSubscription {
    public final String providerStatus;
    public final String rawExpiry;
    public final long expiryAtMs;

    public PortalSubscription(String providerStatus, String rawExpiry, long expiryAtMs) {
        this.providerStatus = providerStatus == null ? "" : providerStatus.trim();
        this.rawExpiry = rawExpiry == null ? "" : rawExpiry.trim();
        this.expiryAtMs = expiryAtMs;
    }

    public static PortalSubscription unavailable() {
        return new PortalSubscription("", "", -1L);
    }

    public boolean hasExpiry() {
        return expiryAtMs > 0L;
    }

    public boolean isExpired() {
        return (hasExpiry() && System.currentTimeMillis() >= expiryAtMs) || providerSaysExpired();
    }

    public String statusLabel() {
        if (isExpired() || providerStatus.matches("(?i).*?(expired|disabled|blocked|inactive|not active).*")
                || providerStatus.trim().equals("0")) return "Expired";
        if (hasExpiry() || !providerStatus.isEmpty()) return "Active";
        return "Unavailable";
    }

    public long daysRemaining() {
        if (!hasExpiry()) return -1L;
        if (isExpired()) return 0L;
        long remaining = expiryAtMs - System.currentTimeMillis();
        if (remaining <= 0L) return 0L;
        return (remaining + 86_399_999L) / 86_400_000L;
    }

    public String timeLeftText() {
        if (!hasExpiry()) return "Time remaining unavailable";
        if (isExpired()) return "Expired";
        long remaining = expiryAtMs - System.currentTimeMillis();
        if (remaining <= 0L) return "Expired";
        long totalMinutes = remaining / 60_000L;
        long days = totalMinutes / 1_440L;
        long hours = (totalMinutes % 1_440L) / 60L;
        long minutes = totalMinutes % 60L;
        if (days > 0L) return days + (days == 1L ? " day" : " days") + " · " + hours + "h left";
        if (hours > 0L) return hours + (hours == 1L ? " hour" : " hours") + " · " + minutes + "m left";
        return Math.max(1L, minutes) + "m left";
    }

    public String expiryDateText() {
        if (!hasExpiry()) return "Expiry date unavailable";
        return new SimpleDateFormat("MMM d, yyyy · h:mm a", Locale.getDefault()).format(new Date(expiryAtMs));
    }

    public String displaySummary() {
        if (!hasExpiry()) return statusLabel() + " · Expiry date unavailable";
        return statusLabel() + " · " + timeLeftText() + " · Expires " + expiryDateText();
    }

    public PortalSubscription merge(PortalSubscription preferred) {
        if (preferred == null) return this;
        if (preferred.hasExpiry()) return preferred;
        if (preferred.providerStatus.isEmpty()) return this;
        return new PortalSubscription(preferred.providerStatus, rawExpiry, expiryAtMs);
    }

    private boolean providerSaysExpired() {
        return providerStatus.matches("(?i).*?(expired|disabled|blocked|inactive|not active).*")
                || providerStatus.trim().equals("0");
    }
}
