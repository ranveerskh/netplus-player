package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Small device-local cache for fast TV startup. It stores catalogue metadata and commands, never stream URLs. */
public final class LiveCatalogCache {
    private static final String PREFS = "stb_play_live_cache";
    private static final String KEY_JSON = "catalogue";
    private final SharedPreferences preferences;

    public LiveCatalogCache(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void save(LiveCatalog catalog) {
        try {
            JSONObject root = new JSONObject();
            JSONArray categories = new JSONArray();
            for (Category category : catalog.categories) {
                categories.put(new JSONObject()
                        .put("id", category.id)
                        .put("title", category.title)
                        .put("locked", category.locked));
            }
            JSONArray channels = new JSONArray();
            for (Channel channel : catalog.channels) {
                channels.put(new JSONObject()
                        .put("id", channel.id)
                        .put("title", channel.title)
                        .put("categoryId", channel.categoryId)
                        .put("categoryTitle", channel.categoryTitle)
                        .put("command", channel.command)
                        .put("locked", channel.locked)
                        .put("number", channel.number));
            }
            root.put("categories", categories);
            root.put("channels", channels);
            root.put("subscription", catalog.subscriptionText);
            root.put("subscription_status", catalog.subscription.providerStatus);
            root.put("raw_expiry", catalog.subscription.rawExpiry);
            root.put("expiry_at_ms", catalog.subscription.expiryAtMs);
            root.put("cachedAt", System.currentTimeMillis());
            preferences.edit().putString(KEY_JSON, root.toString()).apply();
        } catch (Exception ignored) {
            // A cache failure must never block live catalogue loading.
        }
    }

    public LiveCatalog load() {
        String raw = preferences.getString(KEY_JSON, "");
        if (raw.isEmpty()) return null;
        try {
            JSONObject root = new JSONObject(raw);
            List<Category> categories = new ArrayList<>();
            JSONArray categoryRows = root.optJSONArray("categories");
            if (categoryRows != null) {
                for (int i = 0; i < categoryRows.length(); i++) {
                    JSONObject row = categoryRows.optJSONObject(i);
                    if (row != null) categories.add(new Category(row.optString("id"), row.optString("title"), row.optBoolean("locked")));
                }
            }
            List<Channel> channels = new ArrayList<>();
            JSONArray channelRows = root.optJSONArray("channels");
            if (channelRows != null) {
                for (int i = 0; i < channelRows.length(); i++) {
                    JSONObject row = channelRows.optJSONObject(i);
                    if (row != null) channels.add(new Channel(
                            row.optString("id"), row.optString("title"), row.optString("categoryId"),
                            row.optString("categoryTitle"), row.optString("command"), row.optBoolean("locked"),
                            row.optInt("number", -1)
                    ));
                }
            }
            PortalSubscription subscription = new PortalSubscription(
                    root.optString("subscription_status", ""),
                    root.optString("raw_expiry", ""),
                    root.optLong("expiry_at_ms", -1L)
            );
            return channels.isEmpty() ? null : new LiveCatalog(categories, channels, subscription);
        } catch (Exception ignored) {
            return null;
        }
    }

    public boolean isStale() {
        String raw = preferences.getString(KEY_JSON, "");
        if (raw.isEmpty()) return true;
        try {
            long cachedAt = new JSONObject(raw).optLong("cachedAt", 0L);
            return cachedAt <= 0L || System.currentTimeMillis() - cachedAt >= 24L * 60L * 60L * 1000L;
        } catch (Exception ignored) {
            return true;
        }
    }

    public void clear() {
        preferences.edit().remove(KEY_JSON).apply();
    }
}
