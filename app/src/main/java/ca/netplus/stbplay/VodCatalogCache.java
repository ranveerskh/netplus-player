package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Device-local VOD metadata cache. Playback links are deliberately never persisted. */
public final class VodCatalogCache {
    private static final String PREFS = "stb_play_vod_cache";
    private static final String DATA = "items";
    private static final String UPDATED = "updated_at";
    private static final long MAX_AGE_MS = 24L * 60L * 60L * 1000L;
    private final SharedPreferences preferences;

    public VodCatalogCache(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public List<VodItem> loadCategory(String categoryId) {
        List<VodItem> items = new ArrayList<>();
        try {
            JSONArray rows = new JSONArray(preferences.getString(DATA, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null || !categoryId.equals(row.optString("category_id", ""))) continue;
                items.add(fromJson(row));
            }
        } catch (JSONException ignored) { }
        return items;
    }

    public List<VodItem> loadAll() {
        List<VodItem> items = new ArrayList<>();
        try {
            JSONArray rows = new JSONArray(preferences.getString(DATA, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) items.add(fromJson(row));
            }
        } catch (JSONException ignored) { }
        return items;
    }

    /** Rebuilds the category strip from cached titles so VOD opens before the network refresh finishes. */
    public List<VodCategory> loadCategories() {
        List<VodCategory> categories = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try {
            JSONArray rows = new JSONArray(preferences.getString(DATA, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("category_id", "");
                if (id.isEmpty() || !seen.add(id)) continue;
                String title = row.optString("category_title", "");
                if (title.isEmpty()) title = "Movies & Series";
                boolean adultCategory = title.matches("(?i).*?(adult|xxx|porn|erotic|sex|18\\s*(?:\\+|plus)?|nc-?17|\\b(a|r|x)\\b).*?");
                categories.add(new VodCategory(id, title, row.optBoolean("locked", false) || adultCategory));
            }
        } catch (JSONException ignored) { }
        return categories;
    }

    public boolean isStale() {
        long updated = preferences.getLong(UPDATED, 0L);
        return updated == 0L || System.currentTimeMillis() - updated > MAX_AGE_MS;
    }

    public void clear() {
        preferences.edit().remove(DATA).remove(UPDATED).apply();
    }

    public void clearCategory(String categoryId) {
        JSONArray kept = new JSONArray();
        try {
            JSONArray rows = new JSONArray(preferences.getString(DATA, "[]"));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null && !categoryId.equals(row.optString("category_id", ""))) kept.put(row);
            }
        } catch (JSONException ignored) { }
        preferences.edit().putString(DATA, kept.toString()).putLong(UPDATED, System.currentTimeMillis()).apply();
    }

    public void save(List<VodItem> incoming) {
        JSONArray merged = new JSONArray();
        try {
            JSONArray old = new JSONArray(preferences.getString(DATA, "[]"));
            for (int i = 0; i < old.length(); i++) merged.put(old.opt(i));
        } catch (JSONException ignored) { }
        for (VodItem item : incoming) {
            boolean replaced = false;
            for (int i = 0; i < merged.length(); i++) {
                JSONObject existing = merged.optJSONObject(i);
                if (existing != null && item.id.equals(existing.optString("id", ""))
                        && item.categoryId.equals(existing.optString("category_id", ""))) {
                    try { merged.put(i, toJson(item)); } catch (JSONException ignored) { }
                    replaced = true;
                    break;
                }
            }
            if (!replaced) merged.put(toJson(item));
        }
        while (merged.length() > 5000) merged.remove(0);
        preferences.edit().putString(DATA, merged.toString()).putLong(UPDATED, System.currentTimeMillis()).apply();
    }

    private static JSONObject toJson(VodItem item) {
        JSONObject row = new JSONObject();
        try {
            row.put("id", item.id);
            row.put("title", item.title);
            row.put("alternate_title", item.alternateTitle);
            row.put("original_title", item.originalTitle);
            row.put("description", item.description);
            row.put("year", item.year);
            row.put("rating", item.rating);
            row.put("genre", item.genre);
            row.put("language", item.language);
            row.put("category_id", item.categoryId);
            row.put("category_title", item.categoryTitle);
            row.put("poster", item.poster);
            row.put("video_id", item.videoId);
            row.put("movie_id", item.movieId);
            row.put("is_series", item.isSeries);
            row.put("locked", item.locked);
        } catch (JSONException ignored) { }
        return row;
    }

    private static VodItem fromJson(JSONObject row) {
        return new VodItem(
                row.optString("id", ""), row.optString("title", ""),
                row.optString("alternate_title", ""), row.optString("original_title", ""),
                row.optString("description", ""), row.optString("year", ""),
                row.optString("rating", ""), row.optString("genre", ""),
                row.optString("language", ""), row.optString("category_id", ""),
                row.optString("category_title", ""), row.optString("poster", ""), "",
                row.optString("video_id", row.optString("id", "")),
                row.optString("movie_id", row.optString("id", "")),
                row.optBoolean("is_series", false), row.optBoolean("locked", false)
        );
    }
}
