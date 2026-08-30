package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Local VOD favourites. Adult/locked titles are never written. */
public final class FavouriteStore {
    private static final String PREFS = "stb_play_favourites";
    private static final String DATA = "items";
    private final SharedPreferences preferences;

    public FavouriteStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isFavorite(String id) {
        for (VodItem item : load()) if (item.id.equals(id)) return true;
        return false;
    }

    public boolean toggle(VodItem item) {
        if (VodPolicy.isRestricted(item)) return false;
        JSONArray rows = readRows();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && item.id.equals(row.optString("id", ""))) {
                rows.remove(i);
                write(rows);
                return false;
            }
        }
        rows.put(toJson(item));
        write(rows);
        return true;
    }

    public List<VodItem> load() {
        List<VodItem> result = new ArrayList<>();
        JSONArray rows = readRows();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || row.optBoolean("locked", false)) continue;
            VodItem item = fromJson(row);
            if (!VodPolicy.isRestricted(item)) result.add(item);
        }
        return result;
    }

    private JSONArray readRows() {
        try { return new JSONArray(preferences.getString(DATA, "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    private void write(JSONArray rows) {
        preferences.edit().putString(DATA, rows.toString()).apply();
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
                row.optBoolean("is_series", false), false
        );
    }
}
