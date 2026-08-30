package ca.netplus.stbplay;

import java.util.Locale;

/** Single adult-content rule shared by browsing, favourites and history. */
public final class VodPolicy {
    private VodPolicy() { }

    public static boolean isRestricted(VodItem item) {
        if (item == null || item.locked) return true;
        return adultText(item.title) || adultText(item.genre) || adultText(item.rating);
    }

    private static boolean adultText(String value) {
        String text = String.valueOf(value == null ? "" : value).toLowerCase(Locale.US);
        return text.matches(".*(?:adult|xxx|porn|erotic|sex|18\\s*(?:\\+|plus)?|nc-?17|\\b(?:a|r|x)\\b).*");
    }
}
