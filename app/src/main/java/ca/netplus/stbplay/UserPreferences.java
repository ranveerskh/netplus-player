package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

/** Small local UI preferences store. It never contains portal or playback URLs. */
public final class UserPreferences {
    private static final String PREFS = "stb_play_ui_preferences";
    private static final String THEME = "theme";
    private static final String LANGUAGE = "language";
    private static final String QUALITY = "default_quality";
    private final SharedPreferences preferences;

    public UserPreferences(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isLightTheme() {
        return "light".equals(preferences.getString(THEME, "dark"));
    }

    public void setLightTheme(boolean light) {
        preferences.edit().putString(THEME, light ? "light" : "dark").apply();
    }

    public String getLanguage() {
        return preferences.getString(LANGUAGE, "English");
    }

    public void setLanguage(String language) {
        preferences.edit().putString(LANGUAGE, language == null ? "English" : language).apply();
    }

    public String getDefaultQuality() {
        return preferences.getString(QUALITY, "Auto");
    }

    public void setDefaultQuality(String quality) {
        preferences.edit().putString(QUALITY, quality == null ? "Auto" : quality).apply();
    }
}
