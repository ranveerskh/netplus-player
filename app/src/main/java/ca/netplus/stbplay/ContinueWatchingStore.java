package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Local Continue Watching history. No portal credentials or stream links are persisted. */
public final class ContinueWatchingStore {
    private static final String PREFS = "stb_play_continue_watching";
    private static final String DATA = "items";
    private final SharedPreferences preferences;

    public ContinueWatchingStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public WatchProgress find(String key) {
        for (WatchProgress entry : load()) if (entry.key.equals(key)) return entry;
        return null;
    }

    public List<WatchProgress> load() {
        List<WatchProgress> result = new ArrayList<>();
        JSONArray rows = readRows();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || row.optBoolean("locked", false)) continue;
            WatchProgress entry = fromJson(row);
            if (entry != null && !VodPolicy.isRestricted(entry.item)) result.add(entry);
        }
        result.sort(Comparator.comparingLong((WatchProgress entry) -> entry.updatedAt).reversed());
        return result;
    }

    public void save(WatchProgress base, long positionMs, long durationMs) {
        if (base == null || VodPolicy.isRestricted(base.item) || positionMs < 5000L) return;
        if (durationMs > 0 && positionMs >= durationMs - 10000L) {
            remove(base.key);
            return;
        }
        JSONArray rows = readRows();
        JSONObject value = toJson(base, positionMs, durationMs);
        boolean replaced = false;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject existing = rows.optJSONObject(i);
            if (existing != null && base.key.equals(existing.optString("key", ""))) {
                try { rows.put(i, value); } catch (JSONException ignored) { }
                replaced = true;
                break;
            }
        }
        if (!replaced) rows.put(value);
        while (rows.length() > 100) rows.remove(0);
        preferences.edit().putString(DATA, rows.toString()).apply();
    }

    public void remove(String key) {
        JSONArray rows = readRows();
        for (int i = rows.length() - 1; i >= 0; i--) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && key.equals(row.optString("key", ""))) rows.remove(i);
        }
        preferences.edit().putString(DATA, rows.toString()).apply();
    }

    public void clear() {
        preferences.edit().remove(DATA).apply();
    }

    private JSONArray readRows() {
        try { return new JSONArray(preferences.getString(DATA, "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    private static JSONObject toJson(WatchProgress entry, long positionMs, long durationMs) {
        JSONObject row = new JSONObject();
        try {
            VodItem item = entry.item;
            row.put("key", entry.key);
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
            row.put("episode", entry.episode);
            row.put("season_number", entry.seasonNumber);
            row.put("season_portal_id", entry.seasonPortalId);
            row.put("episode_id", entry.episodeId);
            row.put("episode_portal_id", entry.episodePortalId);
            row.put("episode_number", entry.episodeNumber);
            row.put("episode_title", entry.episodeTitle);
            row.put("position_ms", positionMs);
            row.put("duration_ms", durationMs);
            row.put("updated_at", System.currentTimeMillis());
        } catch (JSONException ignored) { }
        return row;
    }

    private static WatchProgress fromJson(JSONObject row) {
        String id = row.optString("id", "");
        String title = row.optString("title", "");
        String key = row.optString("key", "");
        if (id.isEmpty() || title.isEmpty() || key.isEmpty()) return null;
        VodItem item = new VodItem(
                id, title, row.optString("alternate_title", ""), row.optString("original_title", ""),
                row.optString("description", ""), row.optString("year", ""), row.optString("rating", ""),
                row.optString("genre", ""), row.optString("language", ""), row.optString("category_id", ""),
                row.optString("category_title", ""), row.optString("poster", ""), "",
                row.optString("video_id", id), row.optString("movie_id", id),
                row.optBoolean("is_series", false), false
        );
        return new WatchProgress(
                key, item, row.optBoolean("episode", false), row.optInt("season_number", 0),
                row.optString("season_portal_id", ""), row.optString("episode_id", ""),
                row.optString("episode_portal_id", ""), row.optInt("episode_number", 0),
                row.optString("episode_title", ""), row.optLong("position_ms", 0),
                row.optLong("duration_ms", 0), row.optLong("updated_at", 0)
        );
    }
}
