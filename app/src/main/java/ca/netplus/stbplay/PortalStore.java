package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Local-only setup storage. No provider credentials or content are bundled. */
public final class PortalStore {
    private static final String PREFS = "stb_play_local";
    private static final String KEY_PORTAL = "portal_url";
    private static final String KEY_MAC = "mac";
    private static final String KEY_PIN = "pin_hash";
    private static final String KEY_DISCLAIMER = "disclaimer_accepted";
    private static final String KEY_EXPIRY_AT = "subscription_expiry_at";
    private static final String KEY_EXPIRY_RAW = "subscription_expiry_raw";
    private static final String KEY_PROVIDER_STATUS = "subscription_provider_status";
    private static final String KEY_LAST_REMINDER_DAY = "expiry_reminder_day";
    private static final String KEY_LAST_REMINDER_EXPIRY = "expiry_reminder_expiry";
    private static final String KEY_PORTALS = "portals_json";
    private static final String KEY_ACTIVE_PORTAL = "active_portal_id";
    private final SharedPreferences preferences;

    public PortalStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String getPortalUrl() {
        PortalProfile active = getActivePortal();
        return active == null ? preferences.getString(KEY_PORTAL, "") : active.url;
    }

    public String getMac() {
        PortalProfile active = getActivePortal();
        if (active != null && active.mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")) return active.mac;
        String mac = preferences.getString(KEY_MAC, "");
        if (!mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")) {
            mac = generateMac();
            preferences.edit().putString(KEY_MAC, mac).apply();
        }
        return mac;
    }

    public void savePortal(String url, String mac) {
        String normalizedUrl = url.trim();
        String normalizedMac = mac.trim().toUpperCase(Locale.US);
        PortalProfile active = getActivePortal();
        if (active != null) {
            boolean changed = !normalizedUrl.equals(active.url) || !normalizedMac.equals(active.mac);
            PortalProfile updated = active.withDetails(active.name, normalizedUrl, normalizedMac);
            if (changed) updated = updated.withSubscription(PortalSubscription.unavailable());
            replaceProfile(updated);
            preferences.edit().putString(KEY_PORTAL, normalizedUrl).putString(KEY_MAC, normalizedMac).apply();
            return;
        }
        if (getPortals().isEmpty()) {
            addPortal("Authorised portal", normalizedUrl, normalizedMac, true);
            return;
        }
        boolean changed = !normalizedUrl.equals(preferences.getString(KEY_PORTAL, ""))
                || !normalizedMac.equals(preferences.getString(KEY_MAC, ""));
        android.content.SharedPreferences.Editor editor = preferences.edit()
                .putString(KEY_PORTAL, normalizedUrl)
                .putString(KEY_MAC, normalizedMac);
        if (changed) {
            editor.remove(KEY_EXPIRY_AT).remove(KEY_EXPIRY_RAW).remove(KEY_PROVIDER_STATUS)
                    .remove(KEY_LAST_REMINDER_DAY).remove(KEY_LAST_REMINDER_EXPIRY);
        }
        editor.apply();
    }

    public List<PortalProfile> getPortals() {
        migrateLegacyIfNeeded();
        List<PortalProfile> result = new ArrayList<>();
        try {
            JSONArray rows = new JSONArray(preferences.getString(KEY_PORTALS, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("id", "");
                String url = row.optString("url", "");
                String mac = row.optString("mac", "");
                if (id.isEmpty() || url.isEmpty() || !mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")) continue;
                result.add(new PortalProfile(id, row.optString("name", "Authorised portal"), url, mac,
                        new PortalSubscription(row.optString("provider_status", ""),
                                row.optString("expiry_raw", ""), row.optLong("expiry_at", -1L))));
            }
        } catch (JSONException ignored) { }
        return result;
    }

    public PortalProfile getActivePortal() {
        List<PortalProfile> profiles = getPortalsWithoutMigration();
        if (profiles.isEmpty()) {
            migrateLegacyIfNeeded();
            profiles = getPortalsWithoutMigration();
        }
        String activeId = preferences.getString(KEY_ACTIVE_PORTAL, "");
        for (PortalProfile profile : profiles) if (profile.id.equals(activeId)) return profile;
        return profiles.isEmpty() ? null : profiles.get(0);
    }

    public String getActivePortalId() {
        PortalProfile active = getActivePortal();
        return active == null ? "" : active.id;
    }

    public void addPortal(String name, String url, String mac, boolean activate) {
        List<PortalProfile> profiles = getPortals();
        String id = "portal-" + System.currentTimeMillis();
        profiles.add(new PortalProfile(id, name, url, mac, PortalSubscription.unavailable()));
        saveProfiles(profiles);
        if (activate) preferences.edit().putString(KEY_ACTIVE_PORTAL, id).apply();
    }

    public void selectPortal(String id) {
        if (id == null || id.trim().isEmpty()) return;
        for (PortalProfile profile : getPortals()) {
            if (id.equals(profile.id)) {
                preferences.edit().putString(KEY_ACTIVE_PORTAL, id).putString(KEY_PORTAL, profile.url)
                        .putString(KEY_MAC, profile.mac).apply();
                return;
            }
        }
    }

    public void renamePortal(String id, String name) {
        if (id == null || id.trim().isEmpty()) return;
        List<PortalProfile> profiles = getPortals();
        for (int i = 0; i < profiles.size(); i++) {
            PortalProfile profile = profiles.get(i);
            if (id.equals(profile.id)) {
                profiles.set(i, profile.withDetails(name, profile.url, profile.mac));
                saveProfiles(profiles);
                return;
            }
        }
    }

    public void updatePortal(String id, String name, String url, String mac) {
        if (id == null || id.trim().isEmpty()) return;
        String normalizedUrl = url == null ? "" : url.trim();
        String normalizedMac = mac == null ? "" : mac.trim().toUpperCase(Locale.US);
        List<PortalProfile> profiles = getPortals();
        for (int i = 0; i < profiles.size(); i++) {
            PortalProfile profile = profiles.get(i);
            if (!id.equals(profile.id)) continue;
            PortalProfile updated = profile.withDetails(name, normalizedUrl, normalizedMac);
            if (!normalizedUrl.equals(profile.url) || !normalizedMac.equals(profile.mac)) {
                updated = updated.withSubscription(PortalSubscription.unavailable());
            }
            profiles.set(i, updated);
            saveProfiles(profiles);
            if (id.equals(preferences.getString(KEY_ACTIVE_PORTAL, ""))) {
                preferences.edit().putString(KEY_PORTAL, normalizedUrl).putString(KEY_MAC, normalizedMac).apply();
            }
            return;
        }
    }

    public boolean deletePortal(String id) {
        List<PortalProfile> profiles = getPortals();
        if (profiles.size() <= 1) return false;
        boolean removed = false;
        for (int i = profiles.size() - 1; i >= 0; i--) {
            if (profiles.get(i).id.equals(id)) { profiles.remove(i); removed = true; }
        }
        if (!removed) return false;
        String active = preferences.getString(KEY_ACTIVE_PORTAL, "");
        if (id.equals(active)) active = profiles.get(0).id;
        saveProfiles(profiles);
        PortalProfile next = null;
        for (PortalProfile profile : profiles) if (profile.id.equals(active)) next = profile;
        if (next == null) next = profiles.get(0);
        preferences.edit().putString(KEY_ACTIVE_PORTAL, next.id).putString(KEY_PORTAL, next.url)
                .putString(KEY_MAC, next.mac).apply();
        return true;
    }

    public boolean hasPin() {
        return !preferences.getString(KEY_PIN, "").isEmpty();
    }

    public void setPin(String pin) {
        preferences.edit().putString(KEY_PIN, sha256(pin)).apply();
    }

    public boolean verifyPin(String pin) {
        return hasPin() && MessageDigest.isEqual(
                preferences.getString(KEY_PIN, "").getBytes(StandardCharsets.UTF_8),
                sha256(pin).getBytes(StandardCharsets.UTF_8)
        );
    }

    public boolean isDisclaimerAccepted() {
        return preferences.getBoolean(KEY_DISCLAIMER, false);
    }

    public void acceptDisclaimer() {
        preferences.edit().putBoolean(KEY_DISCLAIMER, true).apply();
    }

    public PortalSubscription getSubscription() {
        PortalProfile active = getActivePortal();
        if (active != null) return active.subscription;
        long expiryAt = preferences.getLong(KEY_EXPIRY_AT, -1L);
        String raw = preferences.getString(KEY_EXPIRY_RAW, "");
        String status = preferences.getString(KEY_PROVIDER_STATUS, "");
        if (expiryAt <= 0L && status.isEmpty()) return PortalSubscription.unavailable();
        return new PortalSubscription(status, raw, expiryAt);
    }

    public void saveSubscription(PortalSubscription subscription) {
        if (subscription == null) return;
        PortalProfile active = getActivePortal();
        if (active != null) replaceProfile(active.withSubscription(subscription));
        long previousExpiry = preferences.getLong(KEY_EXPIRY_AT, -1L);
        android.content.SharedPreferences.Editor editor = preferences.edit()
                .putLong(KEY_EXPIRY_AT, subscription.expiryAtMs)
                .putString(KEY_EXPIRY_RAW, subscription.rawExpiry)
                .putString(KEY_PROVIDER_STATUS, subscription.providerStatus);
        if (subscription.expiryAtMs != previousExpiry) {
            editor.remove(KEY_LAST_REMINDER_DAY).remove(KEY_LAST_REMINDER_EXPIRY);
        }
        editor.apply();
    }

    public boolean wasExpiryReminderShownToday(String day, long expiryAt) {
        return day != null && day.equals(preferences.getString(KEY_LAST_REMINDER_DAY, ""))
                && expiryAt == preferences.getLong(KEY_LAST_REMINDER_EXPIRY, -1L);
    }

    public void markExpiryReminderShown(String day, long expiryAt) {
        preferences.edit().putString(KEY_LAST_REMINDER_DAY, day)
                .putLong(KEY_LAST_REMINDER_EXPIRY, expiryAt).apply();
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(("stb-play-pin-v1:" + value).getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) output.append(String.format(Locale.US, "%02x", b));
            return output.toString();
        } catch (Exception error) {
            throw new IllegalStateException("PIN storage is unavailable", error);
        }
    }

    private void migrateLegacyIfNeeded() {
        if (preferences.contains(KEY_PORTALS) && !preferences.getString(KEY_PORTALS, "").trim().equals("[]")) return;
        String url = preferences.getString(KEY_PORTAL, "");
        if (url.isEmpty()) return;
        String mac = preferences.getString(KEY_MAC, "");
        if (!mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")) mac = generateMac();
        List<PortalProfile> profiles = new ArrayList<>();
        profiles.add(new PortalProfile("portal-legacy", "Authorised portal", url, mac,
                new PortalSubscription(preferences.getString(KEY_PROVIDER_STATUS, ""),
                        preferences.getString(KEY_EXPIRY_RAW, ""), preferences.getLong(KEY_EXPIRY_AT, -1L))));
        saveProfiles(profiles);
        preferences.edit().putString(KEY_ACTIVE_PORTAL, "portal-legacy").putString(KEY_MAC, mac).apply();
    }

    private List<PortalProfile> getPortalsWithoutMigration() {
        List<PortalProfile> result = new ArrayList<>();
        if (!preferences.contains(KEY_PORTALS)) return result;
        try {
            JSONArray rows = new JSONArray(preferences.getString(KEY_PORTALS, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("id", "");
                String url = row.optString("url", "");
                String mac = row.optString("mac", "");
                if (!id.isEmpty() && !url.isEmpty() && mac.matches("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")) {
                    result.add(new PortalProfile(id, row.optString("name", "Authorised portal"), url, mac,
                            new PortalSubscription(row.optString("provider_status", ""), row.optString("expiry_raw", ""), row.optLong("expiry_at", -1L))));
                }
            }
        } catch (JSONException ignored) { }
        return result;
    }

    private void replaceProfile(PortalProfile profile) {
        List<PortalProfile> profiles = getPortals();
        for (int i = 0; i < profiles.size(); i++) {
            if (profiles.get(i).id.equals(profile.id)) { profiles.set(i, profile); saveProfiles(profiles); return; }
        }
        profiles.add(profile);
        saveProfiles(profiles);
    }

    private void saveProfiles(List<PortalProfile> profiles) {
        JSONArray rows = new JSONArray();
        for (PortalProfile profile : profiles) {
            JSONObject row = new JSONObject();
            try {
                row.put("id", profile.id).put("name", profile.name).put("url", profile.url).put("mac", profile.mac)
                        .put("provider_status", profile.subscription.providerStatus)
                        .put("expiry_raw", profile.subscription.rawExpiry)
                        .put("expiry_at", profile.subscription.expiryAtMs);
            } catch (JSONException ignored) { }
            rows.put(row);
        }
        preferences.edit().putString(KEY_PORTALS, rows.toString()).apply();
    }

    public static String generateMac() {
        byte[] bytes = new byte[6];
        new SecureRandom().nextBytes(bytes);
        bytes[0] = 0x02; // locally administered unicast address; no MAG prefix is used.
        return String.format(Locale.US, "%02X:%02X:%02X:%02X:%02X:%02X",
                bytes[0] & 0xff, bytes[1] & 0xff, bytes[2] & 0xff,
                bytes[3] & 0xff, bytes[4] & 0xff, bytes[5] & 0xff);
    }
}
