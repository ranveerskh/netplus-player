package ca.netplus.stbplay;

import android.content.Context;
import android.net.Uri;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** HTTPS-only update manifest and APK downloader for pre-Play-Store sideload builds. */
public final class UpdateClient {
    private static final int BUFFER_SIZE = 32 * 1024;

    private UpdateClient() { }

    public static UpdateInfo check() throws Exception {
        if (AppConfig.UPDATE_MANIFEST_URL.trim().isEmpty()) return null;
        String body = requestText(AppConfig.UPDATE_MANIFEST_URL);
        JSONObject root = new JSONObject(body);
        return new UpdateInfo(
                root.optInt("versionCode", 0),
                root.optString("versionName", ""),
                root.optString("apkUrl", ""),
                root.optString("sha256", ""),
                root.optString("notes", "")
        );
    }

    public static File download(Context context, UpdateInfo info) throws Exception {
        requireHttps(info.apkUrl);
        File directory = new File(context.getCacheDir(), "updates");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Could not create the update folder.");
        File apk = new File(directory, "stb-play-" + Math.max(1, info.versionCode) + ".apk");
        HttpURLConnection connection = (HttpURLConnection) new URL(info.apkUrl).openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Update download returned HTTP " + status + ".");
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 OutputStream output = new java.io.FileOutputStream(apk)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
        } finally {
            connection.disconnect();
        }
        if (apk.length() < 10_000L) throw new IllegalStateException("Downloaded update is incomplete.");
        if (!info.sha256.isEmpty() && !info.sha256.equals(sha256(apk))) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            throw new IllegalStateException("Update checksum verification failed.");
        }
        return apk;
    }

    public static Uri contentUri(Context context, File apk) {
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
    }

    private static String requestText(String endpoint) throws Exception {
        requireHttps(endpoint);
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Update check returned HTTP " + status + ".");
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            return body.toString();
        } finally {
            connection.disconnect();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder output = new StringBuilder(64);
        for (byte value : digest.digest()) output.append(String.format(java.util.Locale.US, "%02x", value));
        return output.toString();
    }

    private static void requireHttps(String endpoint) {
        if (endpoint == null || !endpoint.trim().matches("(?i)^https://.+")) {
            throw new IllegalArgumentException("Update services must use HTTPS.");
        }
    }
}
