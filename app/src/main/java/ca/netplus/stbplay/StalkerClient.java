package ca.netplus.stbplay;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/** Small Android port of the v1.8.12-compatible Stalker live-TV flow. */
public final class StalkerClient {
    private static final String MAG_USER_AGENT =
            "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3";
    private static final String X_USER_AGENT = "Model: MAG250; Link: WiFi";
    private static final String MEDIA_USER_AGENT = "Lavf53.32.100";

    private final String portalUrl;
    private final String mac;
    private Session session;

    public StalkerClient(String portalUrl, String mac) {
        this.portalUrl = normalizePortalUrl(portalUrl);
        this.mac = mac.trim().toUpperCase(Locale.US);
    }

    public LiveCatalog loadLiveCatalog() throws Exception {
        session = createSessionWithRetry();
        JSONObject genresResponse = portalRequest(mapOf("type", "itv", "action", "get_genres"), session);
        JSONObject channelsResponse = portalRequest(mapOf("type", "itv", "action", "get_all_channels"), session);

        List<JSONObject> genreRows = rowsFromResponse(genresResponse);
        List<JSONObject> channelRows = rowsFromResponse(channelsResponse);
        List<Category> categories = new ArrayList<>();
        Map<String, Boolean> lockedById = new HashMap<>();
        Map<String, String> titleById = new HashMap<>();

        for (JSONObject row : genreRows) {
            String id = firstString(row, "id", "genre_id", "category_id");
            String title = firstString(row, "title", "name", "genre_name", "category_name");
            if (id.isEmpty() || title.isEmpty()) continue;
            boolean locked = providerFlag(row.opt("locked")) || providerFlag(row.opt("adult")) || isAdult(title);
            categories.add(new Category(id, title, locked));
            lockedById.put(id, locked);
            titleById.put(id, title);
        }

        List<Channel> channels = new ArrayList<>();
        for (JSONObject row : channelRows) {
            String id = firstString(row, "id", "tv_id", "channel_id");
            String title = firstString(row, "name", "title", "channel_name");
            String command = firstString(row, "cmd", "command", "playback_cmd");
            if (id.isEmpty() || title.isEmpty() || command.isEmpty()) continue;
            String genreId = firstString(row, "tv_genre_id", "genre_id", "genreId");
            if (genreId.isEmpty()) genreId = "0";
            boolean providerLocked = providerFlag(row.opt("locked"))
                    || providerFlag(row.opt("adult"))
                    || providerFlag(row.opt("parental_control"))
                    || providerFlag(row.opt("age_restricted"));
            if (!titleById.containsKey(genreId) && !"0".equals(genreId)) {
                String derivedTitle = firstString(row, "tv_genre_name", "genre_name", "category_name");
                if (derivedTitle.isEmpty()) derivedTitle = "Other";
                boolean derivedLocked = providerLocked || isAdult(derivedTitle);
                categories.add(new Category(genreId, derivedTitle, derivedLocked));
                lockedById.put(genreId, derivedLocked);
                titleById.put(genreId, derivedTitle);
            }
            String categoryTitle = titleById.getOrDefault(genreId, "Live TV");
            boolean locked = providerLocked || isAdult(title) || Boolean.TRUE.equals(lockedById.get(genreId));
            int number = firstInt(row, "number", "channel_number", "num");
            channels.add(new Channel(id, title, genreId, categoryTitle, command, locked, number));
        }
        channels.sort(Comparator.comparingInt((Channel channel) -> channel.number < 0 ? Integer.MAX_VALUE : channel.number)
                .thenComparing(channel -> channel.title.toLowerCase(Locale.US)));
        PortalSubscription responseSubscription = extractSubscription(genresResponse, channelsResponse);
        PortalSubscription subscription = session.subscription.merge(responseSubscription);
        return new LiveCatalog(categories, channels, subscription);
    }

    public String createLiveStream(Channel channel) throws Exception {
        if (session == null) loadLiveCatalog();
        try {
            return createLiveStreamOnce(channel);
        } catch (PortalException error) {
            if (error.status == 401) {
                LiveCatalog refreshed = loadLiveCatalog(); // refresh short-lived authorization once.
                for (Channel replacement : refreshed.channels) {
                    if (replacement.id.equals(channel.id)) return createLiveStreamOnce(replacement);
                }
                throw new PortalException("Channel is no longer available.", 404);
            }
            throw error;
        }
    }

    private String createLiveStreamOnce(Channel channel) throws Exception {
        String direct = directUrl(channel.command);
        if (!direct.isEmpty()) return direct;
        JSONObject response = portalRequest(mapOf(
                "type", "itv",
                "action", "create_link",
                "cmd", channel.command,
                "series", "0",
                "forced_storage", "undefined",
                "disable_ad", "0",
                "download", "0"
        ), session);
        Object jsValue = response.opt("js");
        String raw = jsValue instanceof String ? (String) jsValue : "";
        if (jsValue instanceof JSONObject) {
            raw = firstString((JSONObject) jsValue, "cmd", "url", "stream", "stream_url");
        }
        String stream = directUrl(raw);
        if (stream.isEmpty()) throw new PortalException("Portal did not return a playable stream.", 502);
        return stream;
    }

    /** Returns the provider's VOD categories. Movies and shows intentionally share this list. */
    public List<VodCategory> loadVodCategories() throws Exception {
        ensureSession();
        JSONObject response = portalRequest(mapOf("type", "vod", "action", "get_categories"), session);
        List<VodCategory> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JSONObject row : rowsFromResponse(response)) {
            String id = firstString(row, "id", "category_id");
            String title = firstString(row, "title", "name", "category_name");
            if (id.isEmpty() || title.isEmpty() || !seen.add(id)) continue;
            result.add(new VodCategory(id, title, providerFlag(row.opt("locked"))
                    || providerFlag(row.opt("adult")) || isAdult(title)));
        }
        return result;
    }

    /** Loads one provider page and applies the Windows app's strict local title search. */
    public List<VodItem> loadVodItems(VodCategory category, int page, String query) throws Exception {
        ensureSession();
        String categoryId = category == null ? "*" : category.id;
        JSONObject response = portalRequest(mapOf(
                "type", "vod", "action", "get_ordered_list", "category", categoryId,
                "p", String.valueOf(Math.max(0, page)), "sortby", "added"
        ), session);
        List<VodItem> result = new ArrayList<>();
        String categoryTitle = category == null ? "Movies & Series" : category.title;
        for (JSONObject row : rowsFromResponse(response)) {
            VodItem item = mapVodItem(row, categoryId, categoryTitle, category != null && category.locked);
            if (item == null) continue;
            if (query != null && !query.trim().isEmpty() && !strictTitleSearchMatch(item, query)) continue;
            result.add(item);
        }
        return result;
    }

    /**
     * Resolves a movie or show into seasons. An empty list means the title is a movie,
     * or the provider uses a movie-only response for that title.
     */
    public List<Season> loadSeriesSeasons(VodItem item) throws Exception {
        ensureSession();
        List<Season> seasons = new ArrayList<>();
        JSONObject info;
        try { info = fetchVodOrSeriesInfo(item); } catch (Exception ignored) { info = new JSONObject(); }
        collectSeasons(info, seasons, new HashSet<>(), 0);
        if (seasons.isEmpty()) {
            List<JSONObject> episodeRows = objectRows(info, 0, new HashSet<>());
            for (int i = 0; i < episodeRows.size(); i++) {
                JSONObject row = episodeRows.get(i);
                if (looksLikeEpisode(row, i)) {
                    int number = safeNumber(firstString(row, "season", "season_number", "season_num"), 1);
                    addSeason(seasons, new Season(String.valueOf(number), String.valueOf(number), number, "Season " + number));
                }
            }
        }
        if (seasons.isEmpty()) {
            Hierarchy hierarchy = requestVodHierarchy(item, "0", "0");
            for (JSONObject row : hierarchy.rows) {
                int number = seasonNumber(row, seasons.size() + 1);
                boolean isEpisode = hasAny(row, "episode_id", "episode_num", "episode_number", "episode");
                if (!isEpisode && (hasAny(row, "season_id", "season_number", "season_num", "season")
                        || rowTitle(row).matches("(?i).*\\bseason\\s*[-_.:]?\\s*\\d+.*"))) {
                    addSeason(seasons, new Season(
                            firstString(row, "id", "season_id", "number", "season"),
                            firstStringOr(row, String.valueOf(number), "season_id", "id", "number", "season"),
                            number,
                            firstStringOr(row, "Season " + number, "title", "name", "season_name")
                    ));
                }
            }
        }
        seasons.sort(Comparator.comparingInt(season -> season.number));
        return seasons;
    }

    public List<Episode> loadSeriesEpisodes(VodItem item, Season season) throws Exception {
        ensureSession();
        List<Episode> episodes = new ArrayList<>();
        JSONObject info;
        try { info = fetchVodOrSeriesInfo(item); } catch (Exception ignored) { info = new JSONObject(); }
        collectEpisodes(info, season.number, episodes, new HashSet<>(), 0);
        if (episodes.isEmpty()) {
            Hierarchy hierarchy = requestVodHierarchy(item, season.portalId, "0");
            for (int i = 0; i < hierarchy.rows.size(); i++) {
                JSONObject row = hierarchy.rows.get(i);
                if (!looksLikeEpisode(row, i)) continue;
                episodes.add(mapEpisode(row, season.number, i));
            }
        }
        episodes.sort(Comparator.comparingInt(episode -> episode.number));
        return episodes;
    }

    public List<QualityOption> loadMovieQualities(VodItem item) throws Exception {
        ensureSession();
        List<RawQuality> raw = new ArrayList<>();
        JSONObject info;
        try { info = fetchVodOrSeriesInfo(item); } catch (Exception ignored) { info = new JSONObject(); }
        collectQualityCommands(info, "", raw, new HashSet<>(), 0);
        Hierarchy hierarchy = requestVodHierarchy(item, "0", "0");
        collectQualityCommands(hierarchy.raw, "", raw, new HashSet<>(), 0);
        for (JSONObject row : hierarchy.rows) collectQualityCommands(row, rowTitle(row), raw, new HashSet<>(), 0);
        if (raw.isEmpty() && item.command != null && !item.command.isEmpty()) {
            raw.add(new RawQuality("Default quality", item.command));
        }
        return normalizeQualityOptions(raw);
    }

    public List<QualityOption> loadEpisodeQualities(VodItem item, Season season, Episode episode) throws Exception {
        ensureSession();
        List<RawQuality> raw = new ArrayList<>();
        collectQualityCommands(episode.raw, episode.title, raw, new HashSet<>(), 0);
        Hierarchy hierarchy = requestVodHierarchy(item, episode.seasonPortalId, episode.portalId);
        collectQualityCommands(hierarchy.raw, "", raw, new HashSet<>(), 0);
        for (JSONObject row : hierarchy.rows) collectQualityCommands(row, rowTitle(row), raw, new HashSet<>(), 0);
        if (raw.isEmpty() && !episode.command.isEmpty()) raw.add(new RawQuality("Default quality", episode.command));
        return normalizeQualityOptions(raw);
    }

    public String createVodStream(VodItem item, QualityOption quality) throws Exception {
        return createMediaStream(item, quality == null ? "" : quality.command, false, "0", "0");
    }

    public String createEpisodeStream(VodItem item, Season season, Episode episode, QualityOption quality) throws Exception {
        return createMediaStream(item, quality == null ? episode.command : quality.command, true,
                episode.seasonPortalId.isEmpty() ? String.valueOf(season.number) : episode.seasonPortalId,
                episode.portalId);
    }

    private String createMediaStream(VodItem item, String command, boolean series, String seasonId, String episodeId) throws Exception {
        String direct = directUrl(command);
        if (!direct.isEmpty()) return direct;
        if (command == null || command.trim().isEmpty()) throw new PortalException("Portal did not provide a playback command.", 502);
        try {
            JSONObject response = portalRequest(mapOf(
                    "type", "vod", "action", "create_link", "cmd", command,
                    "series", series ? "1" : "0", "season_id", seasonId, "episode_id", episodeId,
                    "forced_storage", "undefined", "disable_ad", "0", "download", "0"
            ), session);
            String stream = directUrl(responseValue(response));
            if (stream.isEmpty()) throw new PortalException("Portal did not return a playable stream.", 502);
            return stream;
        } catch (PortalException error) {
            if (error.status == 401) {
                loadLiveCatalog();
                JSONObject response = portalRequest(mapOf(
                        "type", "vod", "action", "create_link", "cmd", command,
                        "series", series ? "1" : "0", "season_id", seasonId, "episode_id", episodeId,
                        "forced_storage", "undefined", "disable_ad", "0", "download", "0"
                ), session);
                String stream = directUrl(responseValue(response));
                if (!stream.isEmpty()) return stream;
            }
            throw error;
        }
    }

    private void ensureSession() throws Exception {
        if (session == null) session = createSessionWithRetry();
    }

    private VodItem mapVodItem(JSONObject row, String categoryId, String categoryTitle, boolean categoryLocked) {
        String id = firstString(row, "id", "series_id", "movie_id", "stream_id");
        String title = firstString(row, "name", "title");
        if (id.isEmpty() || title.isEmpty()) return null;
        Object seriesValue = row.opt("series");
        boolean series = providerFlag(seriesValue) || row.has("series_name") || row.has("seasons")
                || row.has("episodes") || row.has("season")
                || categoryTitle.matches("(?i).*\\b(series|shows?|episodes?|seasons?)\\b.*")
                && !categoryTitle.matches("(?i).*\\b(movie|movies|film|films)\\b.*");
        String command = firstString(row, "cmd", "command", "playback_cmd");
        return new VodItem(
                id, title,
                firstString(row, "old_name", "o_name", "alternate_title", "alt_title"),
                firstString(row, "original_title", "title_original"),
                firstString(row, "description", "description_en", "plot"),
                firstString(row, "year"), firstString(row, "rating", "rating_imdb", "kinopoisk_rating", "age_rating", "rating_age", "age"),
                firstString(row, "genre", "genre_name", "category_name"),
                firstString(row, "language", "lang", "language_name", "audio_language", "audio_lang"),
                categoryId, categoryTitle,
                firstString(row, "screenshot_uri", "pic", "poster", "cover", "logo", "movie_image"),
                command,
                firstStringOr(row, id, "video_id", "movie_id", "id", "series_id"),
                firstStringOr(row, id, "movie_id", "video_id", "id", "series_id"),
                series, categoryLocked
                || providerFlag(row.opt("locked"))
                || providerFlag(row.opt("adult"))
                || providerFlag(row.opt("parental_control"))
                || providerFlag(row.opt("age_restricted"))
                || isAdult(title)
                        || isAdult(firstString(row, "genre", "genre_name", "category_name"))
                        || isAdult(firstString(row, "rating", "rating_imdb", "kinopoisk_rating", "age_rating", "rating_age", "age"))
        );
    }

    private JSONObject fetchVodOrSeriesInfo(VodItem item) throws Exception {
        List<String> ids = new ArrayList<>();
        for (String id : new String[]{item.movieId, item.videoId, item.id}) if (!id.isEmpty() && !ids.contains(id)) ids.add(id);
        Exception last = null;
        JSONObject fallback = null;
        for (String id : ids) {
            for (Map<String, String> request : new Map[]{
                    mapOf("type", "vod", "action", "get_vod_info", "movie_id", id, "vod_id", id),
                    mapOf("type", "series", "action", "get_series_info", "series_id", id, "movie_id", id),
                    mapOf("type", "series", "action", "get_ordered_list", "series_id", id, "movie_id", id, "p", "0")
            }) {
                try {
                    JSONObject response = portalRequest(request, session);
                    Object raw = response.opt("js");
                    if (raw == null || raw == JSONObject.NULL) raw = response;
                    if (raw instanceof String) {
                        try {
                            String text = (String) raw;
                            if (text.trim().startsWith("[")) raw = new JSONObject().put("data", new JSONArray(text));
                            else raw = new JSONObject(text);
                        } catch (JSONException ignored) { raw = response; }
                    }
                    if (raw instanceof JSONArray) raw = new JSONObject().put("data", raw);
                    if (raw instanceof JSONObject && ((JSONObject) raw).length() > 0) {
                        JSONObject candidate = (JSONObject) raw;
                        if (fallback == null) fallback = candidate;
                        if (containsKeyRecursive(candidate, "seasons", "season", "episodes", "episode")) return candidate;
                    }
                } catch (Exception error) { last = error; }
            }
        }
        if (fallback != null) return fallback;
        if (last != null && item.command.isEmpty()) throw last;
        return new JSONObject();
    }

    private Hierarchy requestVodHierarchy(VodItem item, String seasonId, String episodeId) throws Exception {
        String[] ids = {item.movieId, item.videoId, item.id};
        String[] categories = {item.categoryId, "*"};
        JSONObject lastRaw = new JSONObject();
        for (String id : ids) {
            if (id == null || id.isEmpty()) continue;
            for (String category : categories) {
                if (category == null || category.isEmpty()) continue;
                for (int page = 0; page < 2; page++) {
                    try {
                        JSONObject response = portalRequest(mapOf(
                                "type", "vod", "action", "get_ordered_list", "category", category,
                                "movie_id", id, "season_id", seasonId, "episode_id", episodeId,
                                "p", String.valueOf(page), "sortby", "added"
                        ), session);
                        Object raw = response.opt("js");
                        if (raw == null || raw == JSONObject.NULL) raw = response;
                        if (raw instanceof String) {
                            try {
                                String text = (String) raw;
                                if (text.trim().startsWith("[")) raw = new JSONObject().put("data", new JSONArray(text));
                                else raw = new JSONObject(text);
                            } catch (JSONException ignored) { }
                        }
                        if (raw instanceof JSONArray) raw = new JSONObject().put("data", raw);
                        if (raw instanceof JSONObject) lastRaw = (JSONObject) raw;
                        List<JSONObject> rows = objectRows(raw, 0, new HashSet<>());
                        if (!rows.isEmpty() && hasVodHierarchySignal(rows)) return new Hierarchy(rows, lastRaw);
                    } catch (Exception ignored) { }
                }
            }
        }
        return new Hierarchy(new ArrayList<>(), lastRaw);
    }

    private static boolean hasVodHierarchySignal(List<JSONObject> rows) {
        for (JSONObject row : rows) {
            if (hasAny(row, "season_id", "season_number", "season_num", "season", "episode_id", "episode_num", "episode_number", "episode")) return true;
            if (!firstString(row, "cmd", "command", "playback_cmd", "url", "stream_url").isEmpty()
                    || row.has("qualities") || row.has("streams") || row.has("quality") || row.has("resolution")) return true;
        }
        return false;
    }

    private static List<JSONObject> objectRows(Object value, int depth, Set<Object> seen) {
        List<JSONObject> rows = new ArrayList<>();
        if (value == null || value == JSONObject.NULL || depth > 7) return rows;
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            if (looksLikeRow(object) || hasAny(object, "cmd", "command", "playback_cmd", "season_id", "episode_id", "quality", "resolution")) {
                rows.add(object);
                return rows;
            }
            if (!seen.add(object)) return rows;
            for (String key : new String[]{"data", "items", "rows", "records", "list", "seasons", "episodes", "series", "qualities", "streams", "result", "payload", "js"}) {
                if (object.has(key)) rows.addAll(objectRows(object.opt(key), depth + 1, seen));
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) rows.addAll(objectRows(array.opt(i), depth + 1, seen));
        }
        return rows;
    }

    private static void collectSeasons(Object value, List<Season> output, Set<Object> seen, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 7) return;
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) collectSeasons(array.opt(i), output, seen, depth + 1);
            return;
        }
        if (!(value instanceof JSONObject)) return;
        JSONObject object = (JSONObject) value;
        if (!seen.add(object)) return;
        for (String key : new String[]{"seasons", "season", "season_list", "season_data"}) {
            Object child = object.opt(key);
            if (child instanceof JSONObject) {
                JSONObject keyed = (JSONObject) child;
                Iterator<String> keys = keyed.keys();
                while (keys.hasNext()) {
                    String numberKey = keys.next();
                    Object entry = keyed.opt(numberKey);
                    if (entry instanceof JSONArray) addSeason(output, new Season(numberKey, numberKey, safeNumber(numberKey, output.size() + 1), "Season " + numberKey));
                    else if (entry instanceof JSONObject) addSeasonFromObject(output, (JSONObject) entry, safeNumber(numberKey, output.size() + 1));
                }
            } else if (child instanceof JSONArray) {
                JSONArray array = (JSONArray) child;
                for (int i = 0; i < array.length(); i++) if (array.opt(i) instanceof JSONObject) addSeasonFromObject(output, (JSONObject) array.opt(i), i + 1);
            }
        }
        for (String key : new String[]{"data", "js", "info", "movie", "movie_data", "series", "series_data", "vod", "result", "details", "payload"}) {
            Object child = object.opt(key);
            if (child instanceof JSONObject || child instanceof JSONArray) collectSeasons(child, output, seen, depth + 1);
        }
    }

    private static void addSeasonFromObject(List<Season> output, JSONObject row, int fallback) {
        int number = seasonNumber(row, fallback);
        addSeason(output, new Season(
                firstStringOr(row, String.valueOf(number), "id", "season_id", "number", "season"),
                firstStringOr(row, String.valueOf(number), "season_id", "id", "number", "season"),
                number, firstStringOr(row, "Season " + number, "title", "name", "season_name")
        ));
    }

    private static void addSeason(List<Season> output, Season season) {
        for (Season existing : output) if (existing.number == season.number || existing.id.equals(season.id)) return;
        output.add(season);
    }

    private static void collectEpisodes(Object value, int wantedSeason, List<Episode> output, Set<Object> seen, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 8) return;
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) collectEpisodes(array.opt(i), wantedSeason, output, seen, depth + 1);
            return;
        }
        if (!(value instanceof JSONObject)) return;
        JSONObject object = (JSONObject) value;
        if (!seen.add(object)) return;
        for (String key : new String[]{"episodes", "episode", "episode_list", "episode_data"}) {
            Object child = object.opt(key);
            if (child instanceof JSONObject) {
                JSONObject keyed = (JSONObject) child;
                Iterator<String> keys = keyed.keys();
                while (keys.hasNext()) {
                    String seasonKey = keys.next();
                    int season = safeNumber(seasonKey, wantedSeason);
                    if (season == wantedSeason) collectEpisodeValues(keyed.opt(seasonKey), season, output);
                }
            } else if (child instanceof JSONArray) collectEpisodeValues(child, wantedSeason, output);
        }
        if (looksLikeEpisode(object, output.size())) {
            int season = safeNumber(firstString(object, "season", "season_number", "season_num"), wantedSeason);
            if (season == wantedSeason) addEpisode(output, mapEpisode(object, wantedSeason, output.size()));
        }
        for (String key : new String[]{"data", "js", "info", "movie", "movie_data", "series", "series_data", "vod", "result", "details", "payload"}) {
            Object child = object.opt(key);
            if (child instanceof JSONObject || child instanceof JSONArray) collectEpisodes(child, wantedSeason, output, seen, depth + 1);
        }
    }

    private static void collectEpisodeValues(Object value, int season, List<Episode> output) {
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) if (array.opt(i) instanceof JSONObject) addEpisode(output, mapEpisode((JSONObject) array.opt(i), season, output.size()));
        } else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            if (looksLikeEpisode(object, output.size())) addEpisode(output, mapEpisode(object, season, output.size()));
            else {
                Iterator<String> keys = object.keys();
                while (keys.hasNext()) collectEpisodeValues(object.opt(keys.next()), season, output);
            }
        }
    }

    private static void addEpisode(List<Episode> output, Episode episode) {
        for (Episode existing : output) if (existing.id.equals(episode.id)) return;
        output.add(episode);
    }

    private static Episode mapEpisode(JSONObject row, int season, int index) {
        int number = safeNumber(firstString(row, "episode_num", "episode_number", "episode", "number"), index + 1);
        String id = firstStringOr(row, season + "-" + number, "episode_id", "video_id", "id", "series_id", "ch_id");
        return new Episode(
                id, firstStringOr(row, id, "episode_id", "video_id", "id", "series_id", "ch_id"),
                firstStringOr(row, String.valueOf(season), "season_id", "season", "season_number"),
                number, season, firstStringOr(row, "Episode " + number, "name", "title", "episode_name"),
                firstString(row, "description", "plot", "info"),
                firstString(row, "cmd", "command", "playback_cmd", "url", "stream_url"), row
        );
    }

    private static boolean looksLikeEpisode(JSONObject row, int index) {
        return hasAny(row, "episode_id", "episode_num", "episode_number", "episode")
                || rowTitle(row).matches("(?i).*\\b(?:episode|ep|e)\\s*[-_.:]?\\s*\\d+.*")
                || (!firstString(row, "cmd", "command", "playback_cmd").isEmpty() && hasAny(row, "id", "video_id"));
    }

    private static int seasonNumber(JSONObject row, int fallback) {
        return safeNumber(firstString(row, "season_number", "season_num", "season", "number"), fallback);
    }

    private static void collectQualityCommands(Object value, String inheritedLabel, List<RawQuality> output, Set<Object> seen, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 8) return;
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) collectQualityCommands(array.opt(i), inheritedLabel, output, seen, depth + 1);
            return;
        }
        if (!(value instanceof JSONObject)) return;
        JSONObject object = (JSONObject) value;
        if (!seen.add(object)) return;
        String label = firstString(object, "quality_name", "quality", "profile", "resolution", "label", "name", "title");
        if (label.isEmpty()) label = inheritedLabel;
        String command = firstString(object, "cmd", "command", "playback_cmd", "url", "stream_url");
        if (!command.isEmpty()) output.add(new RawQuality(label.isEmpty() ? "Default quality" : label, command));
        Iterator<String> names = object.keys();
        while (names.hasNext()) {
            String key = names.next();
            Object child = object.opt(key);
            if (child instanceof JSONObject || child instanceof JSONArray) {
                String next = key.matches("(?i).*quality|profile|resolution|stream|format.*") ? key : label;
                collectQualityCommands(child, next, output, seen, depth + 1);
            }
        }
    }

    private static List<QualityOption> normalizeQualityOptions(List<RawQuality> raw) {
        List<QualityOption> result = new ArrayList<>();
        Set<String> commands = new HashSet<>();
        for (RawQuality option : raw) {
            String command = option.command == null ? "" : option.command.trim();
            if (command.isEmpty() || !commands.add(command)) continue;
            result.add(new QualityOption(formatQualityLabel(option.label, command), command));
        }
        return result;
    }

    private static String formatQualityLabel(String label, String command) {
        String text = (label + " " + command).toLowerCase(Locale.US);
        if (text.matches(".*(?:2160|4k|uhd).*")) return "4K · 2160p";
        if (text.matches(".*(?:1080|full.?hd|fhd).*")) return "Full HD · 1080p";
        if (text.matches(".*(?:720|hd).*")) return "HD · 720p";
        if (text.matches(".*(?:480|sd).*")) return "SD · 480p";
        return label == null || label.trim().isEmpty() ? "Default quality" : label.trim();
    }

    private static boolean strictTitleSearchMatch(VodItem item, String query) {
        String needle = normalizeTitleSearch(query);
        if (needle.length() < 3) return false;
        for (String field : new String[]{item.title, item.alternateTitle, item.originalTitle, item.genre, item.language, item.year}) {
            if (normalizeTitleSearch(field).contains(needle)) return true;
        }
        return false;
    }

    private static String normalizeTitleSearch(String value) {
        return String.valueOf(value == null ? "" : value).toLowerCase(Locale.US)
                .replaceAll("[^a-z0-9\\u00c0-\\uFFFF]+", " ").trim().replaceAll("\\s+", " ");
    }

    private static String responseValue(JSONObject response) {
        Object value = response.opt("js");
        if (value instanceof String) return (String) value;
        if (value instanceof JSONObject) return firstString((JSONObject) value, "cmd", "url", "stream_url", "stream");
        return "";
    }

    private static String rowTitle(JSONObject row) { return firstString(row, "title", "name", "episode_name", "season_name"); }

    private static boolean hasAny(JSONObject object, String... keys) { for (String key : keys) if (object.has(key)) return true; return false; }

    private static boolean containsKeyRecursive(Object value, String... keys) {
        if (!(value instanceof JSONObject)) return false;
        JSONObject object = (JSONObject) value;
        if (hasAny(object, keys)) return true;
        Iterator<String> names = object.keys();
        while (names.hasNext()) {
            String name = names.next();
            Object child = object.opt(name);
            if (child instanceof JSONObject && containsKeyRecursive(child, keys)) return true;
            if (child instanceof JSONArray) {
                JSONArray array = (JSONArray) child;
                for (int i = 0; i < array.length(); i++) if (containsKeyRecursive(array.opt(i), keys)) return true;
            }
        }
        return false;
    }

    private static String firstStringOr(JSONObject object, String fallback, String... keys) {
        String value = firstString(object, keys);
        return value.isEmpty() ? fallback : value;
    }

    private static int safeNumber(String value, int fallback) {
        try { int number = Integer.parseInt(String.valueOf(value).trim()); return number > 0 ? number : fallback; }
        catch (Exception ignored) { return fallback; }
    }

    private static final class Hierarchy {
        final List<JSONObject> rows;
        final JSONObject raw;
        Hierarchy(List<JSONObject> rows, JSONObject raw) { this.rows = rows; this.raw = raw; }
    }

    private static final class RawQuality {
        final String label;
        final String command;
        RawQuality(String label, String command) { this.label = label; this.command = command; }
    }

    public Map<String, String> mediaHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("User-Agent", MEDIA_USER_AGENT);
        if (session != null && !session.cookie.isEmpty()) headers.put("Cookie", session.cookie);
        return headers;
    }

    private Session createSessionWithRetry() throws Exception {
        PortalException last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                JSONObject handshake = portalRequest(mapOf("type", "stb", "action", "handshake", "token", ""), null);
                JSONObject js = handshake.optJSONObject("js");
                String token = js == null ? "" : js.optString("token", "");
                if (token.isEmpty() || (js != null && js.optInt("not_valid", 0) == 1)) {
                    throw new PortalException("Portal did not authorize this MAC address.", 401);
                }
                Session created = new Session(token, baseCookie());
                JSONObject profile = portalRequest(mapOf(
                        "type", "stb", "action", "get_profile", "hd", "1", "stb_type", "MAG250",
                        "image_version", "218", "auth_second_step", "1", "not_valid_token", "0"
                ), created);
                if (!profile.has("js")) throw new PortalException("MAC profile is unavailable.", 401);
                created.subscription = extractSubscription(profile);
                return created;
            } catch (PortalException error) {
                last = error;
                if (error.status != 401 || attempt == 1) throw error;
                Thread.sleep(450L);
            }
        }
        throw last == null ? new PortalException("Portal connection failed.", 502) : last;
    }

    private JSONObject portalRequest(Map<String, String> params, Session current) throws Exception {
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (query.length() > 0) query.append('&');
            query.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8.name()));
            query.append('=').append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8.name()));
        }
        if (query.length() > 0) query.append('&');
        query.append("JsHttpRequest=1-xml");

        for (int attempt = 0; attempt < 3; attempt++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(portalUrl + "?" + query).openConnection();
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
            connection.setRequestProperty("Cookie", current == null ? baseCookie() : current.cookie);
            connection.setRequestProperty("User-Agent", MAG_USER_AGENT);
            connection.setRequestProperty("X-User-Agent", X_USER_AGENT);
            if (current != null && !current.token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + current.token);

            int status;
            String body;
            try {
                status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                body = readBody(stream);
                if (current != null) current.cookie = mergeCookies(current.cookie, connection.getHeaderFields());
            } catch (java.io.IOException error) {
                if (attempt < 2) {
                    Thread.sleep(500L * (attempt + 1));
                    continue;
                }
                throw error;
            } finally {
                connection.disconnect();
            }
            if (status == 429 || status >= 500) {
                if (attempt < 2) {
                    Thread.sleep(500L * (attempt + 1));
                    continue;
                }
            }
            if (status < 200 || status >= 300) throw new PortalException("Portal returned status " + status + ".", status);
            if (body.trim().equalsIgnoreCase("Authorization failed.")) throw new PortalException("Portal rejected this MAC address.", 401);
            try {
                return body.trim().startsWith("[")
                        ? new JSONObject().put("js", new JSONArray(body))
                        : new JSONObject(body);
            } catch (JSONException error) {
                throw new PortalException("Portal returned an unexpected response.", 502);
            }
        }
        throw new PortalException("Portal connection failed.", 502);
    }

    private String baseCookie() {
        return "mac=" + mac + "; stb_lang=en; timezone=America%2FToronto";
    }

    private static String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }

    private static String mergeCookies(String current, Map<String, List<String>> headers) {
        Map<String, String> cookies = new LinkedHashMap<>();
        for (String piece : current.split(";")) {
            String[] pair = piece.trim().split("=", 2);
            if (pair.length == 2) cookies.put(pair[0].trim(), pair[1].trim());
        }
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !entry.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String header : entry.getValue()) {
                String[] pair = header.split(";", 2)[0].trim().split("=", 2);
                if (pair.length == 2) cookies.put(pair[0].trim(), pair[1].trim());
            }
        }
        StringBuilder output = new StringBuilder();
        for (Map.Entry<String, String> entry : cookies.entrySet()) {
            if (output.length() > 0) output.append("; ");
            output.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return output.toString();
    }

    private static List<JSONObject> rowsFromResponse(JSONObject root) {
        List<JSONObject> rows = new ArrayList<>();
        collectRows(root.opt("js"), rows, new HashSet<>(), 0);
        if (rows.isEmpty()) collectRows(root, rows, new HashSet<>(), 0);
        return rows;
    }

    private static void collectRows(Object value, List<JSONObject> rows, Set<Object> seen, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 5) return;
        if (value instanceof JSONObject object) {
            if (looksLikeRow(object)) {
                rows.add(object);
                return;
            }
            for (String key : new String[]{"data", "items", "rows", "channels", "genres", "result", "payload", "js"}) {
                if (object.has(key)) collectRows(object.opt(key), rows, seen, depth + 1);
            }
        } else if (value instanceof JSONArray array) {
            for (int i = 0; i < array.length(); i++) collectRows(array.opt(i), rows, seen, depth + 1);
        }
    }

    private static boolean looksLikeRow(JSONObject object) {
        return object.has("name") || object.has("title") || object.has("channel_name") || object.has("genre_name");
    }

    private static String firstString(JSONObject object, String... keys) {
        for (String key : keys) {
            Object value = object.opt(key);
            if (value != null && value != JSONObject.NULL && !String.valueOf(value).trim().isEmpty()) return String.valueOf(value).trim();
        }
        return "";
    }

    private static int firstInt(JSONObject object, String... keys) {
        for (String key : keys) {
            try {
                if (object.has(key)) return Integer.parseInt(String.valueOf(object.opt(key)));
            } catch (NumberFormatException ignored) { }
        }
        return -1;
    }

    private static boolean providerFlag(Object value) {
        if (value instanceof Boolean) return (Boolean) value;
        if (value instanceof Number) return ((Number) value).intValue() == 1;
        String normalized = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.US);
        return normalized.equals("1") || normalized.equals("true") || normalized.equals("yes") || normalized.equals("on");
    }

    private static boolean isAdult(String value) {
        return value != null && value.matches("(?i).*?(adult|xxx|18\\s*(\\+|plus)?|porn|erotic|sex|\\b(a|r|x)\\b|nc-?17).*?");
    }

    private static String directUrl(String raw) {
        String value = String.valueOf(raw == null ? "" : raw).trim()
                .replaceFirst("(?i)^(ffmpeg|ffrt|auto)\\s+", "")
                .replace("&amp;", "&");
        return value.matches("(?i)^https?://.+") ? value : "";
    }

    public static String normalizePortalUrl(String input) {
        String value = input == null ? "" : input.trim();
        if (!value.matches("(?i)^https?://.+")) throw new IllegalArgumentException("Portal URL must start with http:// or https://.");
        try {
            URL url = new URL(value);
            String path = url.getPath().replaceFirst("/+$", "");
            if (path.matches("(?i).*/(server/load\\.php|portal\\.php)")) { }
            else if (path.matches("(?i).*/stalker_portal/c")) path = path.replaceFirst("(?i)/c$", "/server/load.php");
            else if (path.matches("(?i).*/stalker_portal")) path += "/server/load.php";
            else if (path.isEmpty()) path = "/stalker_portal/server/load.php";
            else path += "/stalker_portal/server/load.php";
            return new URL(url.getProtocol(), url.getHost(), url.getPort(), path).toString();
        } catch (Exception error) {
            throw new IllegalArgumentException("Enter a valid portal URL.", error);
        }
    }

    private static PortalSubscription extractSubscription(JSONObject... responses) {
        String expiry = "";
        String status = "";
        for (JSONObject response : responses) {
            String foundExpiry = findValue(response == null ? null : response.opt("js"),
                    new String[]{"end_date", "expire_date", "expiration", "expires_at", "expiry_date", "valid_until", "tariff_expire_date"}, 0);
            if (foundExpiry.isEmpty()) foundExpiry = findValue(response,
                    new String[]{"end_date", "expire_date", "expiration", "expires_at", "expiry_date", "valid_until", "tariff_expire_date"}, 0);
            if (!foundExpiry.isEmpty()) { expiry = foundExpiry; break; }
        }
        for (JSONObject response : responses) {
            String foundStatus = findValue(response == null ? null : response.opt("js"),
                    new String[]{"account_status", "subscription_status", "user_status"}, 0);
            if (foundStatus.isEmpty()) foundStatus = findValue(response,
                    new String[]{"account_status", "subscription_status", "user_status"}, 0);
            if (!foundStatus.isEmpty()) { status = foundStatus; break; }
        }
        return new PortalSubscription(status, expiry, parseExpiry(expiry));
    }

    private static String findValue(Object value, String[] keys, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 7) return "";
        if (value instanceof JSONObject object) {
            for (String key : keys) {
                String found = firstString(object, key);
                if (!found.isEmpty()) return found;
            }
            Iterator<String> names = object.keys();
            while (names.hasNext()) {
                String name = names.next();
                Object child = object.opt(name);
                if (child instanceof JSONObject || child instanceof JSONArray) {
                    String found = findValue(child, keys, depth + 1);
                    if (!found.isEmpty()) return found;
                }
            }
        } else if (value instanceof JSONArray array) {
            for (int i = 0; i < array.length(); i++) {
                String found = findValue(array.opt(i), keys, depth + 1);
                if (!found.isEmpty()) return found;
            }
        } else if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{")) {
                try { return findValue(new JSONObject(trimmed), keys, depth + 1); }
                catch (JSONException ignored) { }
            } else if (trimmed.startsWith("[")) {
                try { return findValue(new JSONArray(trimmed), keys, depth + 1); }
                catch (JSONException ignored) { }
            }
        }
        return "";
    }

    private static long parseExpiry(String raw) {
        if (raw == null) return -1L;
        String value = raw.trim();
        if (value.isEmpty()) return -1L;
        try {
            long numeric = Long.parseLong(value);
            if (numeric < 100_000_000_000L) numeric *= 1000L;
            return numeric > 0L ? numeric : -1L;
        } catch (NumberFormatException ignored) { }

        String normalized = value;
        if (normalized.endsWith("Z")) normalized = normalized.substring(0, normalized.length() - 1) + "+0000";
        if (normalized.matches(".*[+-][0-9]{2}:[0-9]{2}$")) {
            normalized = normalized.substring(0, normalized.length() - 3) + normalized.substring(normalized.length() - 2);
        }
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ",
                "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss",
                "yyyy-MM-dd", "dd.MM.yyyy", "MM/dd/yyyy"
        };
        for (String pattern : patterns) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
            format.setLenient(false);
            format.setTimeZone(pattern.endsWith("Z")
                    ? TimeZone.getTimeZone("UTC")
                    : TimeZone.getTimeZone("America/Toronto"));
            ParsePosition position = new ParsePosition(0);
            Date parsed = format.parse(normalized, position);
            if (parsed == null || position.getIndex() != normalized.length()) continue;
            if (pattern.equals("yyyy-MM-dd") || pattern.equals("dd.MM.yyyy") || pattern.equals("MM/dd/yyyy")) {
                Calendar endOfDay = Calendar.getInstance(TimeZone.getTimeZone("America/Toronto"), Locale.US);
                endOfDay.setTime(parsed);
                endOfDay.set(Calendar.HOUR_OF_DAY, 23);
                endOfDay.set(Calendar.MINUTE, 59);
                endOfDay.set(Calendar.SECOND, 59);
                endOfDay.set(Calendar.MILLISECOND, 999);
                return endOfDay.getTimeInMillis();
            }
            return parsed.getTime();
        }
        return -1L;
    }

    private static Map<String, String> mapOf(String... values) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i + 1 < values.length; i += 2) map.put(values[i], values[i + 1]);
        return map;
    }

    private static final class Session {
        final String token;
        String cookie;
        PortalSubscription subscription;

        Session(String token, String cookie) {
            this.token = token;
            this.cookie = cookie;
            this.subscription = PortalSubscription.unavailable();
        }
    }

    public static final class PortalException extends Exception {
        public final int status;

        PortalException(String message, int status) {
            super(message);
            this.status = status;
        }
    }
}
