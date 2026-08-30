package ca.netplus.stbplay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;

/** Best-effort anonymous analytics. It sends no portal URL, MAC, title, channel or stream link. */
public final class AnalyticsClient {
    private static final String PREFS = "stb_play_anonymous_analytics";
    private static final String DEVICE_ID = "anonymous_device_id";
    private static final String SESSION_ACTIVE = "session_active";
    private final SharedPreferences preferences;
    private final ExecutorService worker;

    public AnalyticsClient(Context context, ExecutorService worker) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.worker = worker;
    }

    public void track(String event, boolean playbackActive) {
        if (!AppConfig.ANALYTICS_ENDPOINT.trim().matches("(?i)^https://.+")
                || event == null || event.trim().isEmpty()) return;
        final String eventName = event.trim();
        worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                JSONObject payload = new JSONObject();
                payload.put("event", eventName);
                payload.put("anonymous_device_id", anonymousId());
                payload.put("device_type", "android_tv");
                payload.put("app_version", BuildConfig.VERSION_NAME);
                payload.put("playback_active", playbackActive);
                payload.put("timestamp_ms", System.currentTimeMillis());
                connection = (HttpURLConnection) new URL(AppConfig.ANALYTICS_ENDPOINT).openConnection();
                connection.setConnectTimeout(8_000);
                connection.setReadTimeout(8_000);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                connection.getResponseCode();
            } catch (Exception ignored) {
                // Analytics must never affect portal loading or playback.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    public void beginSession() {
        boolean previousSessionWasOpen = preferences.getBoolean(SESSION_ACTIVE, false);
        preferences.edit().putBoolean(SESSION_ACTIVE, true).apply();
        if (previousSessionWasOpen) track("previous_session_interrupted", false);
    }

    public void endSession() {
        preferences.edit().putBoolean(SESSION_ACTIVE, false).apply();
    }

    private String anonymousId() {
        String existing = preferences.getString(DEVICE_ID, "");
        if (!existing.isEmpty()) return existing;
        String created = UUID.randomUUID().toString();
        preferences.edit().putString(DEVICE_ID, created).apply();
        return created;
    }
}
