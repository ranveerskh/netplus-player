package ca.netplus.stbplay;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.widget.ImageView;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Best-effort poster loading with a tiny in-memory cache and no third-party image service. */
public final class PosterLoader {
    private static final ExecutorService WORKER = Executors.newFixedThreadPool(3);
    private static final Map<String, Bitmap> CACHE = Collections.synchronizedMap(new java.util.LinkedHashMap<String, Bitmap>(80, .75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Bitmap> eldest) { return size() > 80; }
    });
    private static final Map<ImageView, String> BINDINGS = Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<String, java.util.List<ImageView>> WAITERS = new HashMap<>();
    private static final int MAX_POSTER_BYTES = 8 * 1024 * 1024;

    private PosterLoader() { }

    public static void load(String imageUrl, ImageView target) {
        if (target == null) return;
        String url = imageUrl == null ? "" : imageUrl.trim();
        BINDINGS.put(target, url);
        Bitmap cached = url.isEmpty() ? null : CACHE.get(url);
        if (cached != null) {
            target.setImageBitmap(cached);
            return;
        }
        target.setImageResource(ca.netplus.stbplay.R.drawable.stb_play_logo);
        if (!url.matches("(?i)^https?://.+")) return;
        boolean fetch;
        synchronized (WAITERS) {
            java.util.List<ImageView> waiters = WAITERS.get(url);
            fetch = waiters == null;
            if (fetch) {
                waiters = new ArrayList<>();
                WAITERS.put(url, waiters);
            }
            waiters.add(target);
        }
        if (!fetch) return;
        WORKER.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(8_000);
                connection.setReadTimeout(12_000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "image/*");
                int status = connection.getResponseCode();
                if (status >= 200 && status < 300) {
                    try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        byte[] buffer = new byte[16 * 1024];
                        int total = 0;
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            total += count;
                            if (total > MAX_POSTER_BYTES) { bytes = null; break; }
                            bytes.write(buffer, 0, count);
                        }
                        if (bytes != null) {
                            byte[] encoded = bytes.toByteArray();
                            BitmapFactory.Options bounds = new BitmapFactory.Options();
                            bounds.inJustDecodeBounds = true;
                            BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
                            BitmapFactory.Options options = new BitmapFactory.Options();
                            options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight);
                            bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
                        }
                    }
                }
            } catch (Exception ignored) {
                // Posters are optional; playback and catalogue loading must not depend on them.
            } finally {
                if (connection != null) connection.disconnect();
            }
            if (bitmap != null) CACHE.put(url, bitmap);
            java.util.List<ImageView> waiters;
            synchronized (WAITERS) { waiters = WAITERS.remove(url); }
            if (bitmap == null || waiters == null) return;
            Bitmap result = bitmap;
            for (ImageView waiter : waiters) {
                waiter.post(() -> {
                    if (url.equals(BINDINGS.get(waiter)) && waiter.getVisibility() == View.VISIBLE) {
                        waiter.setImageBitmap(result);
                    }
                });
            }
        });
    }

    private static int sampleSize(int width, int height) {
        if (width <= 0 || height <= 0) return 1;
        int sample = 1;
        while (width / sample > 720 || height / sample > 720) sample *= 2;
        return sample;
    }
}
