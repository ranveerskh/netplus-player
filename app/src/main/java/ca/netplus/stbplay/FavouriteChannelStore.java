package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/** Stores only channel IDs locally; no portal URLs or stream links are persisted. */
public final class FavouriteChannelStore {
    private static final String PREFS = "stb_play_channel_favourites";
    private static final String IDS = "ids";
    private final SharedPreferences preferences;

    public FavouriteChannelStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isFavorite(String id) {
        return preferences.getStringSet(IDS, new HashSet<>()).contains(id == null ? "" : id);
    }

    public boolean toggle(Channel channel) {
        if (channel == null || channel.id == null || channel.id.isEmpty()) return false;
        Set<String> ids = new HashSet<>(preferences.getStringSet(IDS, new HashSet<>()));
        boolean added = ids.add(channel.id);
        if (!added) ids.remove(channel.id);
        preferences.edit().putStringSet(IDS, ids).apply();
        return added;
    }

    public boolean isEmpty() {
        return preferences.getStringSet(IDS, new HashSet<>()).isEmpty();
    }
}
