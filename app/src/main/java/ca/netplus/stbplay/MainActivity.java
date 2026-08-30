package ca.netplus.stbplay;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.BaseAdapter;
import android.widget.AbsListView;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** First native Android TV target: setup, authorised Live TV, PIN protection and Media3 playback. */
public final class MainActivity extends android.app.Activity {
    private int NAVY = Color.rgb(7, 16, 27);
    private int PANEL = Color.rgb(16, 29, 44);
    private int PANEL_LIGHT = Color.rgb(23, 40, 58);
    private int GOLD = Color.rgb(233, 185, 87);
    private int GOLD_BRIGHT = Color.rgb(255, 217, 130);
    private int TEXT = Color.rgb(245, 248, 252);
    private int MUTED = Color.rgb(169, 182, 197);
    private int DANGER = Color.rgb(255, 154, 154);

    private final ExecutorService worker = Executors.newCachedThreadPool();
    private PortalStore store;
    private LiveCatalogCache liveCache;
    private VodCatalogCache vodCache;
    private FavouriteStore favouriteStore;
    private FavouriteChannelStore favouriteChannelStore;
    private ContinueWatchingStore continueStore;
    private UserPreferences userPreferences;
    private AnalyticsClient analytics;
    private StalkerClient client;
    private LiveCatalog catalog;
    private PortalSubscription subscription;
    private String selectedCategory = "all";
    private boolean livePinUnlocked;
    private LinearLayout root;
    private FrameLayout content;
    private TextView pageTitle;
    private TextView pageStatus;
    private PlayerView playerView;
    private ExoPlayer player;
    private WatchProgress activeWatch;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressSaver = this::saveActiveProgress;
    private final Handler playbackHandler = new Handler(Looper.getMainLooper());
    private final Runnable vlcFallback = this::launchVlcFallback;
    private final Handler portalHandler = new Handler(Looper.getMainLooper());
    private final Runnable portalProgressAnimator = this::tickPortalProgress;
    private String activeStream = "";
    private String activePlaybackTitle = "";
    private boolean vlcFallbackAttempted;
    private boolean fullscreenPlayback;
    private VodItem activeVodItem;
    private Season activeSeason;
    private Episode activeEpisode;
    private QualityOption activeQuality;
    private boolean episodeEndHandled;
    private View appHeader;
    private View navigationRail;
    private Button fullscreenToggle;
    private ProgressBar portalProgressBar;
    private TextView portalProgressText;
    private int portalProgress;
    private boolean portalBootstrapLoading;
    private boolean liveCatalogueLoading;
    private volatile long portalGeneration;
    private volatile long playbackRequestGeneration;
    private Runnable retryPlaybackAction;
    private boolean updateChecking;
    private File pendingUpdateApk;
    private final List<VodCategory> vodCategories = new ArrayList<>();
    private final List<VodItem> vodItems = new ArrayList<>();
    private VodCategory selectedVodCategory;
    private int vodPage;
    private boolean vodCategoriesLoading;
    private boolean vodCategoriesRefreshStarted;
    private boolean vodItemsLoading;
    private long vodRequestGeneration;
    private String vodSearchQuery = "";
    private EditText vodSearchField;
    private LinearLayout vodItemsContainer;
    private TextView vodItemsStatus;
    private final Map<String, Integer> listScrollPositions = new HashMap<>();
    private Button retryPlaybackButton;
    private Runnable screenBackAction;
    private Runnable playbackBackAction;
    private boolean livePlayerScreen;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        userPreferences = new UserPreferences(this);
        applyThemePalette(userPreferences.isLightTheme());
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);
        store = new PortalStore(this);
        liveCache = new LiveCatalogCache(this);
        vodCache = new VodCatalogCache(this);
        favouriteStore = new FavouriteStore(this);
        favouriteChannelStore = new FavouriteChannelStore(this);
        continueStore = new ContinueWatchingStore(this);
        analytics = new AnalyticsClient(this, worker);
        subscription = store.getSubscription();
        analytics.beginSession();
        analytics.track("app_open", false);
        if (!store.isDisclaimerAccepted()) showDisclaimer();
        else if (store.getPortalUrl().isEmpty()) showSetup();
        else startPortalBootstrap();
    }

    private void showDisclaimer() {
        LinearLayout layout = pageColumn();
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(110), dp(40), dp(110), dp(40));
        ImageView logo = logoImage();
        layout.addView(logo, new LinearLayout.LayoutParams(dp(190), dp(190)));
        layout.addView(title("Before you continue", 30), wrap());
        layout.addView(text("STB PLAY is an independent media player, not a provider or content host. It is not affiliated with STBEmu, Infomir, MAG or any provider. It does not provide, sell, host, activate, or distribute IPTV subscriptions, channels, movies, or series. Add only services and content you are authorised to use.", MUTED, 18), wrapWithTop(18));
        Button accept = actionButton("I have read and understand", GOLD);
        accept.setOnClickListener(view -> {
            store.acceptDisclaimer();
            if (store.getPortalUrl().isEmpty()) showSetup(); else showMainShell();
        });
        layout.addView(accept, new LinearLayout.LayoutParams(dp(360), dp(58)));
        setContentView(layout);
    }

    private void showSetup() {
        screenBackAction = null;
        playbackBackAction = null;
        livePlayerScreen = false;
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(NAVY);
        LinearLayout layout = pageColumn();
        layout.setPadding(dp(90), dp(42), dp(90), dp(42));
        ImageView logo = logoImage();
        layout.addView(logo, new LinearLayout.LayoutParams(dp(150), dp(150)));
        layout.addView(title("Connect your authorised portal", 30), wrap());
        layout.addView(text("STB PLAY does not include IPTV service. Enter the portal and MAC details supplied or authorised by your provider.", MUTED, 17), wrapWithTop(10));

        EditText portal = field("Portal URL", store.getPortalUrl());
        layout.addView(portal, wrapWithTop(22));
        EditText mac = field("MAC address", store.getMac());
        mac.setInputType(InputType.TYPE_CLASS_TEXT);
        layout.addView(mac, wrapWithTop(12));
        TextView macHelp = text("The MAC is locally generated with the 02: prefix and remains saved on this device until you change it.", MUTED, 14);
        layout.addView(macHelp, wrapWithTop(5));
        EditText pin = field("Create a 4-digit parental PIN", "");
        pin.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin.setSingleLine(true);
        layout.addView(pin, wrapWithTop(12));
        TextView pinHelp = text("The PIN protects adult/locked provider categories. STB PLAY does not bundle a shared master PIN.", MUTED, 14);
        layout.addView(pinHelp, wrapWithTop(5));

        TextView status = text("", DANGER, 16);
        layout.addView(status, wrapWithTop(16));
        Button connect = actionButton("Save & Connect", GOLD);
        layout.addView(connect, new LinearLayout.LayoutParams(dp(330), dp(58)));
        TextView version = text("STB PLAY Android TV · native test build 1.6.2", MUTED, 14);
        layout.addView(version, wrapWithTop(20));
        connect.setOnClickListener(view -> {
            String url = portal.getText().toString().trim();
            String macValue = mac.getText().toString().trim().toUpperCase(Locale.US);
            String pinValue = pin.getText().toString().trim();
            if (!url.matches("(?i)^https?://.+")) { status.setText("Enter a valid http:// or https:// portal URL."); return; }
            if (!macValue.matches("(?i)^02(:[0-9a-f]{2}){5}$")) { status.setText("Use a locally generated MAC beginning with 02:, for example 02:12:34:56:78:90."); return; }
            if (!pinValue.matches("^[0-9]{4}$") && !store.hasPin()) { status.setText("Create a 4-digit parental PIN first."); return; }
            store.savePortal(url, macValue);
            analytics.track("portal_saved", false);
            if (!store.hasPin()) store.setPin(pinValue);
            client = new StalkerClient(url, macValue);
            status.setTextColor(GOLD_BRIGHT);
            status.setText("Preparing portal connection…");
            connect.setEnabled(false);
            startPortalBootstrap();
        });
        scroll.addView(layout);
        setContentView(scroll);
        portal.requestFocus();
    }

    private void startPortalBootstrap() {
        if (store.getPortalUrl().isEmpty()) { showSetup(); return; }
        if (portalBootstrapLoading) return;
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        final long requestGeneration = ++portalGeneration;
        liveCatalogueLoading = false;
        vodCategoriesLoading = false;
        vodCategoriesRefreshStarted = false;
        vodItemsLoading = false;
        vodRequestGeneration++;
        subscription = store.getSubscription();
        portalBootstrapLoading = true;
        showPortalLoading();
        analytics.track("portal_connect_started", false);
        worker.execute(() -> {
            try {
                LiveCatalog loaded = requestClient.loadLiveCatalog();
                if (requestGeneration != portalGeneration) return;
                PortalSubscription saved = store.getSubscription();
                PortalSubscription current = saved.merge(loaded.subscription);
                LiveCatalog result = new LiveCatalog(loaded.categories, loaded.channels, current);
                liveCache.save(result);
                store.saveSubscription(current);
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration) return;
                    portalBootstrapLoading = false;
                    portalHandler.removeCallbacks(portalProgressAnimator);
                    setPortalProgress(100, "Portal verified");
                    catalog = result;
                    subscription = current;
                    analytics.track("portal_connected", false);
                    portalHandler.postDelayed(() -> {
                        showMainShell();
                        Toast.makeText(this, "Portal connected", Toast.LENGTH_SHORT).show();
                    }, 250L);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration) return;
                    portalBootstrapLoading = false;
                    portalHandler.removeCallbacks(portalProgressAnimator);
                    analytics.track("portal_connect_failed", false);
                    showPortalBootstrapError(error.getMessage());
                });
            }
        });
    }

    private void showPortalLoading() {
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(90), dp(40), dp(90), dp(40));
        page.addView(title("Connecting to your portal", 30), wrap());
        page.addView(text(portalDisplayName(), GOLD_BRIGHT, 19), wrapWithTop(10));
        portalProgressText = text("Starting…", MUTED, 16);
        page.addView(portalProgressText, wrapWithTop(28));
        portalProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        portalProgressBar.setMax(100);
        portalProgressBar.setProgress(0);
        page.addView(portalProgressBar, new LinearLayout.LayoutParams(dp(660), dp(16)));
        page.addView(text("Refreshing portal access and subscription status. This can take a few seconds.", MUTED, 14), wrapWithTop(14));
        portalProgress = 0;
        portalHandler.removeCallbacks(portalProgressAnimator);
        portalHandler.post(portalProgressAnimator);
        setContentView(page);
    }

    private void tickPortalProgress() {
        if (!portalBootstrapLoading || portalProgressBar == null) return;
        if (portalProgress < 92) {
            portalProgress++;
            if (portalProgressText != null) portalProgressText.setText("Connecting… " + portalProgress + "%");
            portalProgressBar.setProgress(portalProgress);
        }
        portalHandler.postDelayed(portalProgressAnimator, 110L);
    }

    private void setPortalProgress(int progress, String message) {
        portalProgress = Math.max(0, Math.min(100, progress));
        if (portalProgressBar != null) portalProgressBar.setProgress(portalProgress);
        if (portalProgressText != null) portalProgressText.setText(message + "  " + portalProgress + "%");
    }

    private void showPortalBootstrapError(String detail) {
        setPortalProgress(100, "Connection stopped");
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        String heading = subscription != null && subscription.isExpired() ? "Portal subscription expired" : "Portal connection failed";
        page.addView(title(heading, 29), wrap());
        page.addView(text(subscription != null && subscription.isExpired()
                ? "Your authorised subscription has expired. Renew it with your provider, then try again."
                : (detail == null || detail.trim().isEmpty() ? "Check the portal URL, MAC authorization and network, then try again." : detail), DANGER, 17), wrapWithTop(14));
        Button retry = actionButton("Try again", GOLD);
        retry.setOnClickListener(view -> startPortalBootstrap());
        page.addView(retry, new LinearLayout.LayoutParams(dp(240), dp(56)));
        LiveCatalog cached = liveCache.load();
        if (cached != null) {
            Button cachedButton = navButton("Open cached catalogue");
            cachedButton.setOnClickListener(view -> { catalog = cached; showMainShell(); });
            page.addView(cachedButton, new LinearLayout.LayoutParams(dp(280), dp(52)));
        }
        setContentView(page);
        retry.requestFocus();
    }

    private String portalDisplayName() {
        PortalProfile active = store.getActivePortal();
        String host = Uri.parse(store.getPortalUrl()).getHost();
        String readableHost = host == null || host.trim().isEmpty() ? "Authorised portal" : host;
        if (active == null || active.name.equals("Authorised portal")) return readableHost;
        return active.name + " · " + readableHost;
    }

    private void showMainShell() {
        stopPlayback();
        retryPlaybackAction = null;
        root = pageColumn();
        root.setPadding(dp(24), dp(18), dp(24), dp(18));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = logoImage();
        header.addView(logo, new LinearLayout.LayoutParams(dp(64), dp(64)));
        pageTitle = title("STB PLAY", 25);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, dp(64), 1f);
        titleParams.leftMargin = dp(16);
        header.addView(pageTitle, titleParams);
        pageStatus = text("Android TV", MUTED, 14);
        header.addView(pageStatus, wrap());
        appHeader = header;
        root.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(70)));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout nav = pageColumn();
        nav.setBackgroundColor(PANEL);
        nav.setPadding(dp(5), dp(12), dp(5), dp(12));
        String[] labels = {"⌂", "▣", "▤", "◷", "♡", "⚙"};
        String[] descriptions = {"Home", "Live TV", "Movies & Series", "Continue Watching", "Favourites", "Settings"};
        for (int index = 0; index < labels.length; index++) {
            String label = labels[index];
            Button button = navButton(ui(label));
            button.setTextSize(25);
            button.setContentDescription(descriptions[index]);
            nav.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)));
            if (index == 0) button.setOnClickListener(view -> showHomeScreen());
            if (index == 1) button.setOnClickListener(view -> showLiveScreen());
            if (index == 2) button.setOnClickListener(view -> showVodScreen());
            if (index == 3) button.setOnClickListener(view -> showContinueWatchingScreen());
            if (index == 4) button.setOnClickListener(view -> showFavoritesScreen());
            if (index == 5) button.setOnClickListener(view -> showSettings());
        }
        navigationRail = nav;
        body.addView(nav, new LinearLayout.LayoutParams(dp(76), ViewGroup.LayoutParams.MATCH_PARENT));
        content = new FrameLayout(this);
        body.addView(content, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        root.addView(body, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        showHomeScreen();
        updateHeaderStatus();
        portalHandler.postDelayed(this::maybeShowExpiryReminder, 500L);
        checkForUpdates(false);
    }

    private void showHomeScreen() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = null;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        pageTitle.setText("Home");
        pageStatus.setText("Android TV");
        LinearLayout page = pageColumn();
        page.setPadding(dp(36), dp(32), dp(36), dp(24));
        page.addView(title("Welcome to STB PLAY", 34), wrap());
        page.addView(text("A clean player for your authorised IPTV portal.", MUTED, 19), wrapWithTop(8));
        addHomeHero(page);
        LinearLayout cards = new LinearLayout(this);
        cards.setPadding(0, dp(28), 0, 0);
        cards.addView(infoCard("LIVE TV", "Open your provider's live catalogue", v -> showLiveScreen()), new LinearLayout.LayoutParams(0, dp(150), 1f));
        cards.addView(infoCard("MOVIES & SERIES", "Open the provider's VOD catalogue", v -> showVodScreen()), new LinearLayout.LayoutParams(0, dp(150), 1f));
        page.addView(cards);
        List<WatchProgress> inProgress = visibleWatchProgress();
        List<VodItem> cachedItems = vodCache.loadAll();
        List<VodItem> favorites = visibleFavorites();
        List<VodItem> latest = uniqueVisible(cachedItems, 8, null);
        List<VodItem> recommended = buildRecommendations(cachedItems, inProgress, favorites);

        if (!inProgress.isEmpty()) addHomeContinueShelf(page, inProgress);
        if (!favorites.isEmpty()) addHomeVodShelf(page, "Favourites", favorites);
        if (!latest.isEmpty()) addHomeVodShelf(page, "Latest Releases", latest);
        if (!recommended.isEmpty()) addHomeVodShelf(page, "Recommended for You", recommended);
        if (cachedItems.isEmpty()) {
            page.addView(text("Open Movies & Series once to load your provider catalogue. Home will then show Latest Releases and recommendations here.", MUTED, 16), wrapWithTop(28));
        } else {
            page.addView(text("Home automatically hides restricted/adult titles from recommendations, favourites and Continue Watching.", MUTED, 15), wrapWithTop(28));
        }
        page.addView(text("Your portal, MAC, preferences and PIN stay on this device. No IPTV subscription or media is included.", MUTED, 15), wrapWithTop(18));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        replaceContent(scroll);
        updateHeaderStatus();
        cards.getChildAt(0).requestFocus();
    }

    private void addHomeHero(LinearLayout page) {
        LinearLayout hero = new LinearLayout(this);
        hero.setGravity(Gravity.CENTER_VERTICAL);
        hero.setClipChildren(false);
        hero.setPadding(dp(18), dp(12), dp(18), dp(12));
        hero.setBackground(round(PANEL_LIGHT, GOLD, 1, 14));
        ImageView logo = logoImage();
        hero.addView(logo, new LinearLayout.LayoutParams(dp(140), dp(140)));
        LinearLayout copy = pageColumn();
        copy.setBackgroundColor(Color.TRANSPARENT);
        copy.setPadding(dp(18), 0, 0, 0);
        copy.addView(title("Your entertainment hub", 25), wrap());
        copy.addView(text(portalDisplayName() + "  ·  " + store.getMac(), MUTED, 15), wrapWithTop(7));
        copy.addView(text("Browse provider content, continue where you stopped, and keep your setup private on this TV.", TEXT, 16), wrapWithTop(12));
        hero.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        page.addView(hero, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(176)));
    }

    private void addHomeContinueShelf(LinearLayout page, List<WatchProgress> entries) {
        page.addView(title("Continue Watching", 22), wrapWithTop(28));
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int count = Math.min(8, entries.size());
        for (int i = 0; i < count; i++) {
            WatchProgress entry = entries.get(i);
            String detail = entry.episode
                    ? "S" + entry.seasonNumber + " · E" + entry.episodeNumber
                    : "Movie";
            Button card = navButton(entry.item.title + "\n" + detail + " · " + entry.percent() + "% watched");
            card.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            card.setTextSize(15);
            card.setOnClickListener(view -> resumeContinueEntry(entry));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(250), dp(92));
            params.rightMargin = dp(10);
            row.addView(card, params);
        }
        scroll.addView(row, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(100)));
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(105)));
    }

    private void addHomeVodShelf(LinearLayout page, String heading, List<VodItem> source) {
        List<VodItem> items = uniqueVisible(source, 8, null);
        if (items.isEmpty()) return;
        page.addView(title(heading, 22), wrapWithTop(26));
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (VodItem item : items) {
            LinearLayout card = vodShelfCard(item);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(250), dp(128));
            params.rightMargin = dp(10);
            row.addView(card, params);
        }
        scroll.addView(row, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(136)));
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(141)));
    }

    private LinearLayout vodShelfCard(VodItem item) {
        LinearLayout card = pageColumn();
        card.setBackground(round(PANEL, PANEL, 1, 8));
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setImageResource(ca.netplus.stbplay.R.drawable.stb_play_logo);
        PosterLoader.load(item.poster, poster);
        card.addView(poster, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
        Button label = navButton(item.title + "\n" + vodMetadata(item));
        label.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
        label.setTextSize(12);
        label.setOnClickListener(view -> openVodItem(item));
        card.addView(label, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)));
        return card;
    }

    private List<VodItem> uniqueVisible(List<VodItem> source, int max, List<VodItem> excluded) {
        List<VodItem> result = new ArrayList<>();
        for (VodItem item : source) {
            if (item == null || item.id.isEmpty() || VodPolicy.isRestricted(item)) continue;
            if (excluded != null && containsVodId(excluded, item.id)) continue;
            if (containsVodId(result, item.id)) continue;
            result.add(item);
            if (result.size() >= max) break;
        }
        return result;
    }

    private List<VodItem> buildRecommendations(List<VodItem> cached, List<WatchProgress> watched,
                                                List<VodItem> favorites) {
        List<VodItem> result = new ArrayList<>();
        if (!watched.isEmpty() || !favorites.isEmpty()) {
            for (VodItem candidate : cached) {
                if (candidate == null || VodPolicy.isRestricted(candidate)
                        || containsVodId(favorites, candidate.id)
                        || containsWatchId(watched, candidate.id)
                        || containsVodId(result, candidate.id)) continue;
                if (!sharesTaste(candidate, watched, favorites)) continue;
                result.add(candidate);
                if (result.size() >= 8) return result;
            }
        }
        return result;
    }

    private boolean containsVodId(List<VodItem> items, String id) {
        if (items == null) return false;
        for (VodItem item : items) if (item != null && item.id.equals(id)) return true;
        return false;
    }

    private boolean containsWatchId(List<WatchProgress> entries, String id) {
        for (WatchProgress entry : entries) if (entry.item.id.equals(id)) return true;
        return false;
    }

    private boolean sharesTaste(VodItem candidate, List<WatchProgress> watched, List<VodItem> favorites) {
        String candidateGenre = candidate.genre.toLowerCase(Locale.US);
        String candidateLanguage = candidate.language.toLowerCase(Locale.US);
        for (WatchProgress entry : watched) {
            if (sharesTaste(candidateGenre, candidateLanguage, entry.item.genre, entry.item.language)) return true;
        }
        for (VodItem favorite : favorites) {
            if (sharesTaste(candidateGenre, candidateLanguage, favorite.genre, favorite.language)) return true;
        }
        return false;
    }

    private boolean sharesTaste(String candidateGenre, String candidateLanguage, String seedGenre, String seedLanguage) {
        String genre = seedGenre.toLowerCase(Locale.US).trim();
        String language = seedLanguage.toLowerCase(Locale.US).trim();
        return (!genre.isEmpty() && !candidateGenre.isEmpty() && candidateGenre.contains(genre))
                || (!language.isEmpty() && !candidateLanguage.isEmpty() && candidateLanguage.contains(language));
    }

    private Button infoCard(String heading, String subtitle, View.OnClickListener listener) {
        return infoCard(heading, subtitle, listener, false);
    }

    private Button infoCard(String heading, String subtitle, View.OnClickListener listener, boolean muted) {
        Button card = actionButton(heading + "\n" + subtitle, muted ? PANEL_LIGHT : GOLD);
        card.setTextSize(17);
        card.setGravity(Gravity.CENTER);
        card.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(150), 1f);
        params.rightMargin = dp(12);
        card.setLayoutParams(params);
        return card;
    }

    private void showLiveScreen() {
        setFullscreenPlayback(false);
        stopPlayback();
        retryPlaybackAction = null;
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = true;
        pageTitle.setText("Live TV");
        pageStatus.setText(catalog == null ? "Loading catalogue…" : (catalog.channels.size() + " channels"));
        if (catalog == null) {
            LiveCatalog cached = liveCache.load();
            if (cached != null) {
                catalog = cached;
                subscription = store.getSubscription().merge(cached.subscription);
                renderLiveScreen();
                if (liveCache.isStale()) {
                    pageStatus.setText(cached.channels.size() + " cached channels · refreshing…");
                    refreshLiveCatalogue(false);
                }
                return;
            }
            LinearLayout loading = pageColumn();
            loading.setGravity(Gravity.CENTER);
            loading.addView(title("Loading Live TV…", 27), wrap());
            replaceContent(loading);
            refreshLiveCatalogue(true);
            return;
        }

        renderLiveScreen();
    }

    private void renderLiveScreen() {
        pageTitle.setText("Live TV");
        pageStatus.setText(catalog.channels.size() + " channels");

        LinearLayout split = new LinearLayout(this);
        split.setOrientation(LinearLayout.HORIZONTAL);
        split.setPadding(0, dp(14), 0, 0);
        LinearLayout left = pageColumn();
        left.setPadding(dp(6), 0, dp(18), 0);
        LinearLayout categories = pageColumn();
        categories.setPadding(0, 0, dp(8), dp(8));
        Button all = navButton("All Channels");
        all.setOnClickListener(view -> { livePinUnlocked = false; selectedCategory = "all"; showLiveScreen(); });
        categories.addView(all, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        for (Category category : catalog.categories) {
            Button item = navButton((category.locked ? "[PIN] " : "") + category.title);
            item.setOnClickListener(view -> {
                if (!category.id.equals(selectedCategory)) livePinUnlocked = false;
                if (category.locked && !livePinUnlocked) {
                    askForPin(() -> { livePinUnlocked = true; selectedCategory = category.id; showLiveScreen(); });
                } else { selectedCategory = category.id; showLiveScreen(); }
            });
            categories.addView(item, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        }
        ScrollView categoryScroll = new ScrollView(this);
        categoryScroll.setVerticalScrollBarEnabled(false);
        categoryScroll.addView(categories);

        List<Channel> visible = new ArrayList<>();
        for (Channel channel : catalog.channels) {
            if (selectedCategory.equals("all") || selectedCategory.equals(channel.categoryId)) visible.add(channel);
        }
        ListView channelScroll = new ListView(this);
        channelScroll.setDivider(null);
        channelScroll.setVerticalScrollBarEnabled(false);
        channelScroll.setAdapter(new LiveChannelAdapter(visible));
        LinearLayout lists = new LinearLayout(this);
        lists.setOrientation(LinearLayout.HORIZONTAL);
        lists.addView(categoryScroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.34f));
        lists.addView(channelScroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.66f));
        left.addView(lists, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        Button refresh = navButton("Refresh catalogue");
        refresh.setOnClickListener(view -> refreshLiveCatalogue(false));
        left.addView(refresh, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        split.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.52f));

        LinearLayout right = pageColumn();
        right.setPadding(dp(8), 0, 0, 0);
        playerView = new PlayerView(this);
        configurePlayerView(playerView);
        right.addView(playerView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        Button fullscreen = fullscreenButton();
        right.addView(fullscreen, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        Button retry = navButton("Retry stream");
        retryPlaybackButton = retry;
        retry.setEnabled(false);
        retry.setOnClickListener(view -> retryCurrentPlayback());
        right.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        TextView hint = text("Select a channel. The built-in Media3 player handles HLS and progressive streams on Android TV.", MUTED, 15);
        right.addView(hint, wrapWithTop(12));
        split.addView(right, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.48f));
        replaceContent(split);
        all.requestFocus();
    }

    /** Recycles channel rows so changing categories never rebuilds thousands of views on the UI thread. */
    private final class LiveChannelAdapter extends BaseAdapter {
        private final List<Channel> items;

        LiveChannelAdapter(List<Channel> items) {
            this.items = items;
        }

        @Override public int getCount() { return items.size(); }
        @Override public Channel getItem(int position) { return items.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override public View getView(int position, View recycled, ViewGroup parent) {
            Button row = recycled instanceof Button ? (Button) recycled : navButton("");
            Channel channel = getItem(position);
            row.setText((channel.number >= 0 ? channel.number + "  " : "")
                    + (channel.locked ? "[PIN] " : "") + channel.title
                    + (!channel.locked && favouriteChannelStore.isFavorite(channel.id) ? "   ♥" : ""));
            row.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            row.setTextSize(15);
            row.setContentDescription("Open " + channel.title);
            row.setOnClickListener(view -> {
                if (channel.locked && !livePinUnlocked) askForPin(() -> { livePinUnlocked = true; startChannel(channel); });
                else startChannel(channel);
            });
            row.setOnLongClickListener(view -> {
                if (!channel.locked) {
                    favouriteChannelStore.toggle(channel);
                    notifyDataSetChanged();
                }
                return true;
            });
            row.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
            return row;
        }
    }

    private void refreshLiveCatalogue(boolean showErrorPageOnFailure) {
        if (liveCatalogueLoading) return;
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        liveCatalogueLoading = true;
        pageStatus.setText("Refreshing Live TV…");
        worker.execute(() -> {
            try {
                LiveCatalog result = requestClient.loadLiveCatalog();
                if (requestGeneration != portalGeneration) return;
                if (requestPlaybackGeneration != playbackRequestGeneration) {
                    runOnUiThread(() -> liveCatalogueLoading = false);
                    return;
                }
                PortalSubscription current = store.getSubscription().merge(result.subscription);
                LiveCatalog refreshed = new LiveCatalog(result.categories, result.channels, current);
                liveCache.save(refreshed);
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration) return;
                    if (requestPlaybackGeneration != playbackRequestGeneration) {
                        liveCatalogueLoading = false;
                        return;
                    }
                    liveCatalogueLoading = false;
                    catalog = refreshed;
                    subscription = current;
                    store.saveSubscription(current);
                    renderLiveScreen();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration) return;
                    if (requestPlaybackGeneration != playbackRequestGeneration) {
                        liveCatalogueLoading = false;
                        return;
                    }
                    liveCatalogueLoading = false;
                    if (catalog != null) {
                        pageStatus.setText(catalog.channels.size() + " cached channels · refresh failed");
                        Toast.makeText(this, error.getMessage() == null ? "Could not refresh Live TV." : error.getMessage(), Toast.LENGTH_LONG).show();
                    } else if (showErrorPageOnFailure) {
                        showErrorPage(error.getMessage());
                    }
                });
            }
        });
    }

    private void startChannel(Channel channel) {
        pageStatus.setText("Opening " + channel.title + "…");
        retryPlaybackAction = () -> startChannel(channel);
        final long requestGeneration = ++playbackRequestGeneration;
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        worker.execute(() -> {
            try {
                String stream = requestClient.createLiveStream(channel);
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText(channel.title);
                    playStream(stream);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText("Playback unavailable");
                    if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                    Toast.makeText(this, error.getMessage() == null ? "Channel is temporarily unavailable." : error.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void playStream(String stream) {
        playStream(stream, null);
    }

    private void playStream(String stream, WatchProgress watch) {
        playStream(stream, watch, null, null, null, null);
    }

    private void playStream(String stream, WatchProgress watch, VodItem vodItem, Season season,
                            Episode episode, QualityOption quality) {
        stopPlayback();
        if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(false);
        if (playerView == null) return;
        activeWatch = watch;
        activeVodItem = vodItem;
        activeSeason = season;
        activeEpisode = episode;
        activeQuality = quality;
        episodeEndHandled = false;
        activeStream = stream == null ? "" : stream.trim();
        activePlaybackTitle = pageTitle == null ? "STB PLAY" : pageTitle.getText().toString();
        vlcFallbackAttempted = false;
        if (activeStream.isEmpty()) {
            pageStatus.setText("Playback unavailable");
            Toast.makeText(this, "The portal did not provide a playable stream.", Toast.LENGTH_LONG).show();
            return;
        }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("Lavf53.32.100")
                .setAllowCrossProtocolRedirects(true);
        if (client != null) http.setDefaultRequestProperties(client.mediaHeaders());
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(this, http);
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSource))
                .build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_BUFFERING) scheduleVlcFallback();
                else if (state == Player.STATE_READY) {
                    cancelVlcFallback();
                    if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                }
                else if (state == Player.STATE_ENDED) {
                    cancelVlcFallback();
                    if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                    saveActiveProgress();
                    handleEpisodeEnded();
                }
            }

            @Override public void onPlayerError(PlaybackException error) {
                pageStatus.setText("Built-in player error · VLC fallback in 3 seconds…");
                if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                analytics.track("playback_error", true);
                scheduleVlcFallback();
            }
        });
        player.setMediaItem(MediaItem.fromUri(activeStream));
        player.prepare();
        if (watch != null && watch.positionMs > 0) player.seekTo(watch.positionMs);
        player.play();
        analytics.track("playback_started", true);
        progressHandler.removeCallbacks(progressSaver);
        progressHandler.postDelayed(progressSaver, 5000L);
    }

    private void retryCurrentPlayback() {
        String stream = activeStream;
        WatchProgress watch = activeWatch;
        VodItem item = activeVodItem;
        Season season = activeSeason;
        Episode episode = activeEpisode;
        QualityOption quality = activeQuality;
        if (!stream.isEmpty()) {
            playStream(stream, watch, item, season, episode, quality);
        } else if (retryPlaybackAction != null) {
            retryPlaybackAction.run();
        } else if (pageStatus != null) {
            pageStatus.setText("This stream is temporarily unavailable.");
        }
    }

    private void showVodScreen() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        pageTitle.setText("Movies & Series");
        pageStatus.setText(vodCategories.isEmpty() ? "Loading catalogue…" : "Provider VOD catalogue");
        if (vodCategories.isEmpty()) {
            vodCategories.addAll(vodCache.loadCategories());
            if (!vodCategories.isEmpty()) {
                selectedVodCategory = vodCategories.get(0);
                vodItems.addAll(vodCache.loadCategory(selectedVodCategory.id));
            }
        }
        if (vodCategories.isEmpty()) {
            LinearLayout loading = pageColumn();
            loading.setGravity(Gravity.CENTER);
            loading.addView(title("Loading Movies & Series…", 27), wrap());
            loading.addView(text("Reading categories from your authorised portal.", MUTED, 17), wrapWithTop(10));
            replaceContent(loading);
            if (!vodCategoriesLoading) loadVodCategories();
            return;
        }
        if (selectedVodCategory == null) selectedVodCategory = vodCategories.get(0);
        if (vodItems.isEmpty()) vodItems.addAll(vodCache.loadCategory(selectedVodCategory.id));
        renderVodScreen();
        if (!vodItems.isEmpty() && vodCache.isStale() && !vodItemsLoading) loadVodPage(false);
        else if (vodItems.isEmpty() && !vodItemsLoading) loadVodPage(true);
        if (!vodCategoriesLoading && !vodCategoriesRefreshStarted) loadVodCategories();
    }

    private void loadVodCategories() {
        if (vodCategoriesLoading) return;
        vodCategoriesLoading = true;
        vodCategoriesRefreshStarted = true;
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                List<VodCategory> result = requestClient.loadVodCategories();
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration) return;
                    if (requestPlaybackGeneration != playbackRequestGeneration) {
                        vodCategoriesLoading = false;
                        vodCategoriesRefreshStarted = false;
                        return;
                    }
                    vodCategoriesLoading = false;
                    // Keep a useful cached category strip if a portal temporarily returns no categories.
                    if (result.isEmpty() && !vodCategories.isEmpty()) {
                        renderVodScreen();
                        if (!vodItemsLoading && vodItems.isEmpty()) loadVodPage(true);
                        return;
                    }
                    String previousCategoryId = selectedVodCategory == null ? "" : selectedVodCategory.id;
                    vodCategories.clear();
                    vodCategories.addAll(result);
                    if (vodCategories.isEmpty()) vodCategories.add(new VodCategory("*", "All Movies & Series", false));
                    VodCategory replacement = vodCategories.get(0);
                    for (VodCategory category : vodCategories) {
                        if (category.id.equals(previousCategoryId)) { replacement = category; break; }
                    }
                    boolean categoryChanged = selectedVodCategory == null || !replacement.id.equals(previousCategoryId);
                    selectedVodCategory = replacement;
                    if (categoryChanged) {
                        vodItems.clear();
                        vodItems.addAll(vodCache.loadCategory(selectedVodCategory.id));
                        vodPage = 0;
                    }
                    renderVodScreen();
                    if (!vodItemsLoading && (categoryChanged || vodItems.isEmpty())) loadVodPage(vodItems.isEmpty());
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != portalGeneration || requestPlaybackGeneration != playbackRequestGeneration) return;
                    vodCategoriesLoading = false;
                    vodCategoriesRefreshStarted = false;
                    showVodError(error.getMessage() == null ? "Could not load Movies & Series." : error.getMessage());
                });
            }
        });
    }

    private void renderVodScreen() {
        pageTitle.setText("Movies & Series");
        pageStatus.setText(vodItems.size() + " titles loaded");
        LinearLayout page = pageColumn();
        page.setPadding(dp(10), dp(10), dp(18), dp(16));

        LinearLayout categories = pageColumn();
        categories.setPadding(dp(4), 0, dp(8), dp(8));
        ScrollView categoryScroll = new ScrollView(this);
        categoryScroll.setVerticalScrollBarEnabled(false);
        categoryScroll.addView(categories);
        for (VodCategory category : vodCategories) {
            Button button = navButton((category.locked ? "[PIN] " : "") + category.title);
            button.setOnClickListener(view -> {
                if (category.locked && !livePinUnlocked) {
                    askForPin(() -> selectVodCategory(category));
                } else {
                    selectVodCategory(category);
                }
            });
            categories.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        }
        LinearLayout browse = pageColumn();
        browse.setPadding(dp(4), 0, 0, 0);
        LinearLayout searchRow = new LinearLayout(this);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        vodSearchField = field("Search title, original title, genre, language or year", vodSearchQuery);
        vodSearchField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        searchRow.addView(vodSearchField, new LinearLayout.LayoutParams(0, dp(54), 1f));
        Button refresh = navButton("Refresh");
        refresh.setOnClickListener(view -> loadVodPage(true));
        LinearLayout.LayoutParams refreshParams = new LinearLayout.LayoutParams(dp(130), dp(54));
        refreshParams.leftMargin = dp(10);
        searchRow.addView(refresh, refreshParams);
        browse.addView(searchRow, wrapWithTop(5));
        vodSearchField.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                vodSearchQuery = value.toString();
                renderVodItems();
            }
            @Override public void afterTextChanged(Editable value) { }
        });

        vodItemsStatus = text("", MUTED, 14);
        browse.addView(vodItemsStatus, wrapWithTop(10));
        ScrollView scroll = new ScrollView(this);
        vodItemsContainer = pageColumn();
        vodItemsContainer.setPadding(0, dp(4), dp(8), dp(24));
        scroll.addView(vodItemsContainer);
        browse.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout browseShell = new LinearLayout(this);
        browseShell.setOrientation(LinearLayout.HORIZONTAL);
        browseShell.addView(categoryScroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.22f));
        browseShell.addView(browse, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0.78f));
        page.addView(browseShell, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        replaceContent(page);
        renderVodItems();
        if (!vodCategories.isEmpty()) categories.getChildAt(0).requestFocus();
    }

    private void selectVodCategory(VodCategory category) {
        vodRequestGeneration++;
        vodItemsLoading = false;
        selectedVodCategory = category;
        vodPage = 0;
        vodItems.clear();
        vodItems.addAll(vodCache.loadCategory(category.id));
        livePinUnlocked = category.locked;
        renderVodScreen();
        loadVodPage(vodItems.isEmpty());
    }

    private void loadVodPage(boolean reset) {
        if (vodItemsLoading || selectedVodCategory == null) return;
        if (reset) {
            vodPage = 0;
            vodItems.clear();
            vodCache.clearCategory(selectedVodCategory.id);
            renderVodItems();
        }
        vodItemsLoading = true;
        final int requestedPage = vodPage;
        final VodCategory category = selectedVodCategory;
        final long requestPortalGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        final long requestGeneration = ++vodRequestGeneration;
        pageStatus.setText("Loading VOD page " + (requestedPage + 1) + "…");
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        worker.execute(() -> {
            try {
                List<VodItem> result = requestClient.loadVodItems(category, requestedPage, "");
                runOnUiThread(() -> {
                    if (requestPortalGeneration != portalGeneration || requestGeneration != vodRequestGeneration) return;
                    if (requestPlaybackGeneration != playbackRequestGeneration) {
                        vodItemsLoading = false;
                        return;
                    }
                    vodItemsLoading = false;
                    if (selectedVodCategory != category) {
                        if (!vodItemsLoading && selectedVodCategory != null) loadVodPage(vodItems.isEmpty());
                        return;
                    }
                    for (VodItem item : result) {
                        boolean duplicate = false;
                        for (VodItem existing : vodItems) if (existing.id.equals(item.id)) { duplicate = true; break; }
                        if (!duplicate) vodItems.add(item);
                    }
                    vodCache.save(result);
                    vodPage = requestedPage + 1;
                    pageStatus.setText(vodItems.size() + " titles loaded");
                    renderVodItems();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestPortalGeneration != portalGeneration || requestGeneration != vodRequestGeneration) return;
                    if (requestPlaybackGeneration != playbackRequestGeneration) {
                        vodItemsLoading = false;
                        return;
                    }
                    vodItemsLoading = false;
                    vodItemsStatus.setText(error.getMessage() == null ? "Could not load this VOD category." : error.getMessage());
                    pageStatus.setText("VOD unavailable");
                });
            }
        });
    }

    private void renderVodItems() {
        if (vodItemsContainer == null) return;
        vodItemsContainer.removeAllViews();
        String query = vodSearchQuery.trim();
        if (!query.isEmpty() && query.length() < 3) {
            vodItemsStatus.setText("Type at least 3 characters to search titles.");
        } else {
            vodItemsStatus.setText(vodItemsLoading ? "Loading provider titles…" : "Search is local and only matches title/original title, genre, language or year.");
        }
        int visibleCount = 0;
        for (VodItem item : vodItems) {
            if (!query.isEmpty() && (query.length() < 3 || !matchesVodSearch(item, query))) continue;
            visibleCount++;
            addVodItemRow(vodItemsContainer, item, true);
        }
        if (visibleCount == 0 && !vodItemsLoading) {
            vodItemsContainer.addView(text(query.length() >= 3 ? "No matching titles in the locally loaded catalogue." : "No titles are available in this category.", MUTED, 17), wrapWithTop(20));
        }
        Button more = navButton(vodItemsLoading ? "Loading…" : "Load more titles");
        more.setEnabled(!vodItemsLoading);
        more.setOnClickListener(view -> loadVodPage(false));
        vodItemsContainer.addView(more, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
    }

    private boolean matchesVodSearch(VodItem item, String query) {
        String needle = query.toLowerCase(Locale.US).trim();
        for (String field : new String[]{item.title, item.alternateTitle, item.originalTitle, item.genre, item.language, item.year}) {
            if (field.toLowerCase(Locale.US).contains(needle)) return true;
        }
        return false;
    }

    private void addVodItemRow(LinearLayout container, VodItem item, boolean showFavorite) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        poster.setImageResource(ca.netplus.stbplay.R.drawable.stb_play_logo);
        PosterLoader.load(item.poster, poster);
        row.addView(poster, new LinearLayout.LayoutParams(dp(82), dp(104)));
        Button card = navButton((VodPolicy.isRestricted(item) ? "[PIN] " : "") + item.title + "\n" + vodMetadata(item));
        card.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
        card.setTextSize(16);
        card.setOnClickListener(view -> {
            if (VodPolicy.isRestricted(item) && !livePinUnlocked) askForPin(() -> openVodItem(item));
            else openVodItem(item);
        });
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(0, dp(104), 1f);
        cardParams.leftMargin = dp(10);
        row.addView(card, cardParams);
        if (showFavorite && !VodPolicy.isRestricted(item)) {
            Button favorite = navButton(favouriteStore.isFavorite(item.id) ? "★" : "☆");
            favorite.setTextSize(28);
            favorite.setTextColor(GOLD_BRIGHT);
            favorite.setContentDescription("Toggle favourite for " + item.title);
            favorite.setOnClickListener(view -> {
                favouriteStore.toggle(item);
                if (pageTitle != null && "Favourites".equals(pageTitle.getText().toString())) showFavoritesScreen();
                else renderVodItems();
            });
            LinearLayout.LayoutParams favoriteParams = new LinearLayout.LayoutParams(dp(64), dp(104));
            favoriteParams.leftMargin = dp(8);
            row.addView(favorite, favoriteParams);
        }
        Button share = navButton("Share");
        share.setContentDescription("Share " + item.title);
        share.setOnClickListener(view -> shareVodItem(item));
        LinearLayout.LayoutParams shareParams = new LinearLayout.LayoutParams(dp(90), dp(104));
        shareParams.leftMargin = dp(8);
        row.addView(share, shareParams);
        container.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(110)));
    }

    private void shareVodItem(VodItem item) {
        String message = item.title + (item.year.isEmpty() ? "" : " (" + item.year + ")")
                + "\nShared from STB PLAY. Use only with an authorised provider service.";
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT, message);
        try {
            startActivity(Intent.createChooser(share, "Share title"));
        } catch (ActivityNotFoundException error) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("STB PLAY title", message));
            Toast.makeText(this, "Title copied to clipboard.", Toast.LENGTH_SHORT).show();
        }
    }

    private String vodMetadata(VodItem item) {
        String kind = item.isSeries ? "SERIES" : "MOVIE";
        String metadata = kind + (item.year.isEmpty() ? "" : " · " + item.year)
                + (item.language.isEmpty() ? "" : " · " + item.language)
                + (item.genre.isEmpty() ? "" : "\n" + item.genre);
        return metadata;
    }

    private void showFavoritesScreen() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        pageTitle.setText("Favourites");
        List<VodItem> favorites = visibleFavorites();
        pageStatus.setText(favorites.size() + " saved titles");
        LinearLayout page = pageColumn();
        page.setPadding(dp(30), dp(24), dp(30), dp(24));
        page.addView(title("Favourites", 28), wrap());
        page.addView(text("Your saved Movies & Series titles", MUTED, 17), wrapWithTop(8));
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout filters = pageColumn();
        filters.setPadding(0, dp(14), dp(12), 0);
        String[] filterLabels = {"All Favourites", "Live Channels", "Movies", "Series"};
        for (String filterLabel : filterLabels) {
            Button filter = navButton(filterLabel);
            filters.addView(filter, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        }
        body.addView(filters, new LinearLayout.LayoutParams(dp(190), ViewGroup.LayoutParams.MATCH_PARENT));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setSmoothScrollingEnabled(false);
        scroll.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        LinearLayout list = pageColumn();
        list.setPadding(dp(4), dp(14), dp(10), dp(20));
        list.addView(title("Favourite Channels", 21), wrap());
        int channelCount = 0;
        if (catalog != null) {
            for (Channel channel : catalog.channels) {
                if (!favouriteChannelStore.isFavorite(channel.id)) continue;
                channelCount++;
                Button channelButton = navButton((channel.number >= 0 ? channel.number + "  " : "") + channel.title + "   ♥");
                channelButton.setOnClickListener(view -> startChannel(channel));
                list.addView(channelButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
            }
        }
        if (channelCount == 0) list.addView(text("No favourite channels yet.", MUTED, 16), wrapWithTop(8));
        list.addView(title("Favourite Movies & Series", 21), wrapWithTop(22));
        for (VodItem item : favorites) addVodItemRow(list, item, true);
        if (favorites.isEmpty()) list.addView(text("No favourite movies or series yet. Use the heart button to save a title.", MUTED, 16), wrapWithTop(8));
        scroll.addView(list);
        body.addView(scroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        page.addView(body, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        replaceContent(page);
        if (list.getChildCount() > 1) list.getChildAt(1).requestFocus();
    }

    private void showContinueWatchingScreen() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        pageTitle.setText("Continue Watching");
        List<WatchProgress> entries = visibleWatchProgress();
        pageStatus.setText(entries.size() + " titles in progress");
        LinearLayout page = pageColumn();
        page.setPadding(dp(30), dp(24), dp(30), dp(24));
        page.addView(title("Continue Watching", 28), wrap());
        page.addView(text("Resume your movie or episode from where you stopped", MUTED, 17), wrapWithTop(8));
        Button clear = navButton("Clear all history");
        clear.setOnClickListener(view -> {
            continueStore.clear();
            showContinueWatchingScreen();
        });
        page.addView(clear, new LinearLayout.LayoutParams(dp(220), dp(52)));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setSmoothScrollingEnabled(true);
        scroll.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        LinearLayout list = pageColumn();
        list.setPadding(0, dp(18), dp(10), dp(20));
        for (WatchProgress entry : entries) addContinueRow(list, entry);
        if (entries.isEmpty()) list.addView(text("Nothing to resume yet. Start a movie or episode and your progress will appear here.", MUTED, 17), wrapWithTop(22));
        scroll.addView(list);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        replaceContent(page);
        if (list.getChildCount() > 0) list.getChildAt(0).requestFocus();
    }

    private List<VodItem> visibleFavorites() {
        List<VodItem> visible = new ArrayList<>();
        for (VodItem item : favouriteStore.load()) {
            if (item != null && !VodPolicy.isRestricted(item)) visible.add(item);
        }
        return visible;
    }

    private List<WatchProgress> visibleWatchProgress() {
        List<WatchProgress> visible = new ArrayList<>();
        for (WatchProgress entry : continueStore.load()) {
            if (entry != null && !VodPolicy.isRestricted(entry.item)) visible.add(entry);
        }
        return visible;
    }

    private void addContinueRow(LinearLayout container, WatchProgress entry) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        String detail = entry.episode
                ? "S" + entry.seasonNumber + " · E" + entry.episodeNumber + " · " + entry.episodeTitle
                : "Movie";
        Button resume = navButton(entry.item.title + "\n" + detail + " · " + entry.percent() + "% watched");
        resume.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
        resume.setOnClickListener(view -> resumeContinueEntry(entry));
        row.addView(resume, new LinearLayout.LayoutParams(0, dp(76), 1f));
        Button remove = navButton("×");
        remove.setTextSize(26);
        remove.setContentDescription("Remove " + entry.item.title + " from Continue Watching");
        remove.setOnClickListener(view -> {
            continueStore.remove(entry.key);
            showContinueWatchingScreen();
        });
        LinearLayout.LayoutParams removeParams = new LinearLayout.LayoutParams(dp(68), dp(76));
        removeParams.leftMargin = dp(8);
        row.addView(remove, removeParams);
        container.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76)));
    }

    private void resumeContinueEntry(WatchProgress entry) {
        showVodLoading("Loading " + entry.item.title + "…");
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                if (!entry.episode) {
                    List<QualityOption> qualities = requestClient.loadMovieQualities(entry.item);
                    runOnUiThread(() -> {
                        if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                            showQualityPicker(entry.item, null, null, qualities, entry);
                        }
                    });
                    return;
                }
                List<Season> seasons = requestClient.loadSeriesSeasons(entry.item);
                Season selectedSeason = null;
                for (Season season : seasons) {
                    if (season.number == entry.seasonNumber || season.portalId.equals(entry.seasonPortalId)) { selectedSeason = season; break; }
                }
                if (selectedSeason == null) throw new IllegalStateException("The saved season is no longer available.");
                List<Episode> episodes = requestClient.loadSeriesEpisodes(entry.item, selectedSeason);
                Episode selectedEpisode = null;
                for (Episode episode : episodes) {
                    if (episode.id.equals(entry.episodeId) || episode.portalId.equals(entry.episodePortalId)
                            || episode.number == entry.episodeNumber) { selectedEpisode = episode; break; }
                }
                if (selectedEpisode == null) throw new IllegalStateException("The saved episode is no longer available.");
                List<QualityOption> qualities = requestClient.loadEpisodeQualities(entry.item, selectedSeason, selectedEpisode);
                Episode finalEpisode = selectedEpisode;
                Season finalSeason = selectedSeason;
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showQualityPicker(entry.item, finalSeason, finalEpisode, qualities, entry);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showVodError(error.getMessage() == null ? "Saved playback is unavailable." : error.getMessage());
                    }
                });
            }
        });
    }

    private void openVodItem(VodItem item) {
        showVodLoading("Opening " + item.title + "…");
        if (client == null) client = new StalkerClient(store.getPortalUrl(), store.getMac());
        final StalkerClient requestClient = client;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                List<Season> seasons = requestClient.loadSeriesSeasons(item);
                if (!seasons.isEmpty()) {
                    runOnUiThread(() -> {
                        if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                            showSeriesSeasons(item, seasons);
                        }
                    });
                    return;
                }
                List<QualityOption> qualities = requestClient.loadMovieQualities(item);
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showQualityPicker(item, null, null, qualities);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showVodError(error.getMessage() == null ? "This title is not playable right now." : error.getMessage());
                    }
                });
            }
        });
    }

    private void showSeriesSeasons(VodItem item, List<Season> seasons) {
        screenBackAction = this::showVodScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        pageTitle.setText("Series");
        pageStatus.setText(item.title);
        LinearLayout page = pageColumn();
        page.setPadding(dp(30), dp(24), dp(30), dp(24));
        page.addView(title(item.title, 28), wrap());
        page.addView(text("Choose a season", MUTED, 17), wrapWithTop(8));
        Button back = navButton("Back to Movies & Series");
        back.setOnClickListener(view -> showVodScreen());
        page.addView(back, new LinearLayout.LayoutParams(dp(280), dp(52)));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setSmoothScrollingEnabled(true);
        scroll.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        scroll.setFocusable(false);
        LinearLayout list = pageColumn();
        list.setPadding(0, dp(18), dp(10), dp(20));
        for (Season season : seasons) {
            Button button = navButton(season.title);
            button.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            button.setOnClickListener(view -> loadAndShowEpisodes(item, season));
            list.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
        }
        scroll.addView(list);
        String scrollKey = "seasons:" + item.id;
        int savedScrollY = listScrollPositions.containsKey(scrollKey) ? listScrollPositions.get(scrollKey) : 0;
        scroll.setOnScrollChangeListener((view, scrollX, scrollY, oldScrollX, oldScrollY) -> listScrollPositions.put(scrollKey, scrollY));
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        replaceContent(page);
        final int seasonFocusIndex = Math.max(0, Math.min(list.getChildCount() - 1, savedScrollY / Math.max(1, dp(58))));
        scroll.post(() -> {
            scroll.scrollTo(0, savedScrollY);
            if (list.getChildCount() > 0) list.getChildAt(seasonFocusIndex).requestFocus();
        });
    }

    private void loadAndShowSeasons(VodItem item) {
        showVodLoading("Loading seasons…");
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                List<Season> seasons = requestClient.loadSeriesSeasons(item);
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showSeriesSeasons(item, seasons);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showVodError(error.getMessage() == null ? "Seasons are unavailable right now." : error.getMessage());
                    }
                });
            }
        });
    }

    private void loadAndShowEpisodes(VodItem item, Season season) {
        showVodLoading("Loading " + season.title + "…");
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                List<Episode> episodes = requestClient.loadSeriesEpisodes(item, season);
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showSeriesEpisodes(item, season, episodes);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showVodError(error.getMessage() == null ? "Episodes are unavailable right now." : error.getMessage());
                    }
                });
            }
        });
    }

    private void showSeriesEpisodes(VodItem item, Season season, List<Episode> episodes) {
        screenBackAction = () -> loadAndShowSeasons(item);
        playbackBackAction = null;
        livePlayerScreen = false;
        pageTitle.setText("Series");
        pageStatus.setText(item.title + " · " + season.title);
        LinearLayout page = pageColumn();
        page.setPadding(dp(30), dp(24), dp(30), dp(24));
        page.addView(title(item.title, 28), wrap());
        page.addView(text(season.title + " · choose an episode", MUTED, 17), wrapWithTop(8));
        Button back = navButton("Back to seasons");
        back.setOnClickListener(view -> loadAndShowSeasons(item));
        page.addView(back, new LinearLayout.LayoutParams(dp(220), dp(52)));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setSmoothScrollingEnabled(true);
        scroll.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        scroll.setFocusable(false);
        LinearLayout list = pageColumn();
        list.setPadding(0, dp(18), dp(10), dp(20));
        for (Episode episode : episodes) {
            Button button = navButton("Episode " + episode.number + "  ·  " + episode.title);
            button.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            button.setOnClickListener(view -> loadAndShowEpisodeQualities(item, season, episode));
            list.addView(button, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
        }
        if (episodes.isEmpty()) list.addView(text("No episodes are available for this season.", MUTED, 17), wrapWithTop(20));
        scroll.addView(list);
        String scrollKey = "episodes:" + item.id + ":" + season.id;
        int savedScrollY = listScrollPositions.containsKey(scrollKey) ? listScrollPositions.get(scrollKey) : 0;
        scroll.setOnScrollChangeListener((view, scrollX, scrollY, oldScrollX, oldScrollY) -> listScrollPositions.put(scrollKey, scrollY));
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        replaceContent(page);
        final int episodeFocusIndex = Math.max(0, Math.min(list.getChildCount() - 1, savedScrollY / Math.max(1, dp(58))));
        scroll.post(() -> {
            scroll.scrollTo(0, savedScrollY);
            if (list.getChildCount() > 0) list.getChildAt(episodeFocusIndex).requestFocus();
        });
    }

    private void loadAndShowEpisodeQualities(VodItem item, Season season, Episode episode) {
        showVodLoading("Loading qualities for Episode " + episode.number + "…");
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        final long requestGeneration = portalGeneration;
        final long requestPlaybackGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                List<QualityOption> qualities = requestClient.loadEpisodeQualities(item, season, episode);
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showQualityPicker(item, season, episode, qualities);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == portalGeneration && requestPlaybackGeneration == playbackRequestGeneration) {
                        showVodError(error.getMessage() == null ? "Episode playback is unavailable." : error.getMessage());
                    }
                });
            }
        });
    }

    private void showQualityPicker(VodItem item, Season season, Episode episode, List<QualityOption> qualities) {
        showQualityPicker(item, season, episode, qualities, null);
    }

    private void showQualityPicker(VodItem item, Season season, Episode episode,
                                   List<QualityOption> qualities, WatchProgress resumeEntry) {
        screenBackAction = resumeEntry != null ? this::showContinueWatchingScreen
                : episode != null ? () -> loadAndShowEpisodes(item, season) : this::showVodScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        if (qualities == null || qualities.isEmpty()) {
            showVodError("Portal did not provide a playable quality for this title.");
            return;
        }
        if (qualities.size() == 1) {
            if (episode == null) startMoviePlayback(item, qualities.get(0), resumeEntry);
            else startEpisodePlayback(item, season, episode, qualities.get(0), resumeEntry);
            return;
        }
        pageTitle.setText(episode == null ? "Movie quality" : "Episode quality");
        pageStatus.setText(item.title);
        LinearLayout page = pageColumn();
        page.setPadding(dp(30), dp(24), dp(30), dp(24));
        page.addView(title(item.title, 28), wrap());
        page.addView(text("Choose playback quality", MUTED, 17), wrapWithTop(8));
        QualityOption preferred = preferredQuality(qualities);
        Button back = navButton("Back");
        back.setOnClickListener(view -> {
            if (resumeEntry != null) showContinueWatchingScreen();
            else if (episode != null) loadAndShowEpisodes(item, season);
            else showVodScreen();
        });
        page.addView(back, new LinearLayout.LayoutParams(dp(170), dp(52)));
        for (QualityOption quality : qualities) {
            Button button = actionButton(quality.label + (quality == preferred ? "  ·  Default" : ""), PANEL_LIGHT);
            button.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            button.setOnClickListener(view -> {
                if (episode == null) startMoviePlayback(item, quality, resumeEntry);
                else startEpisodePlayback(item, season, episode, quality, resumeEntry);
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(420), dp(58));
            params.topMargin = dp(12);
            page.addView(button, params);
        }
        replaceContent(page);
        if (page.getChildCount() > 3) {
            int preferredIndex = qualities.indexOf(preferred);
            page.getChildAt(3 + Math.max(0, preferredIndex)).requestFocus();
        }
    }

    private void startMoviePlayback(VodItem item, QualityOption quality) {
        startMoviePlayback(item, quality, null);
    }

    private void startMoviePlayback(VodItem item, QualityOption quality, WatchProgress resumeEntry) {
        showVodPlayerShell(item.title, resumeEntry == null ? this::showVodScreen : this::showContinueWatchingScreen);
        retryPlaybackAction = () -> startMoviePlayback(item, quality, resumeEntry);
        final long requestGeneration = ++playbackRequestGeneration;
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        worker.execute(() -> {
            try {
                String stream = requestClient.createVodStream(item, quality);
                WatchProgress progress = resumeEntry == null ? WatchProgress.movie(item) : resumeEntry;
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText(item.title);
                    playStream(stream, progress, item, null, null, quality);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText("Movie temporarily unavailable");
                    if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                    Toast.makeText(this, error.getMessage() == null ? "Movie is temporarily unavailable." : error.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void startEpisodePlayback(VodItem item, Season season, Episode episode, QualityOption quality) {
        startEpisodePlayback(item, season, episode, quality, null);
    }

    private void startEpisodePlayback(VodItem item, Season season, Episode episode,
                                      QualityOption quality, WatchProgress resumeEntry) {
        showVodPlayerShell(item.title + " · E" + episode.number,
                resumeEntry == null ? () -> loadAndShowEpisodes(item, season) : this::showContinueWatchingScreen);
        retryPlaybackAction = () -> startEpisodePlayback(item, season, episode, quality, resumeEntry);
        final long requestGeneration = ++playbackRequestGeneration;
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        worker.execute(() -> {
            try {
                String stream = requestClient.createEpisodeStream(item, season, episode, quality);
                WatchProgress progress = resumeEntry == null ? WatchProgress.episode(item, season, episode) : resumeEntry;
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText(item.title + " · Episode " + episode.number);
                    playStream(stream, progress, item, season, episode, quality);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration != playbackRequestGeneration) return;
                    pageStatus.setText("Episode temporarily unavailable");
                    if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(true);
                    Toast.makeText(this, error.getMessage() == null ? "Episode is temporarily unavailable." : error.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void handleEpisodeEnded() {
        if (episodeEndHandled || activeVodItem == null || activeSeason == null || activeEpisode == null) return;
        episodeEndHandled = true;
        progressHandler.removeCallbacks(progressSaver);
        VodItem item = activeVodItem;
        Season season = activeSeason;
        Episode episode = activeEpisode;
        pageStatus.setText("Finding next episode…");
        final StalkerClient requestClient = client == null
                ? new StalkerClient(store.getPortalUrl(), store.getMac()) : client;
        client = requestClient;
        final long requestGeneration = playbackRequestGeneration;
        worker.execute(() -> {
            try {
                Season nextSeason = season;
                List<Episode> episodes = requestClient.loadSeriesEpisodes(item, season);
                Episode next = null;
                for (Episode candidate : episodes) {
                    if (candidate.number > episode.number) { next = candidate; break; }
                }
                if (next == null) {
                    List<Season> seasons = requestClient.loadSeriesSeasons(item);
                    for (Season candidateSeason : seasons) {
                        if (candidateSeason.number <= season.number) continue;
                        List<Episode> nextSeasonEpisodes = requestClient.loadSeriesEpisodes(item, candidateSeason);
                        if (!nextSeasonEpisodes.isEmpty()) {
                            nextSeason = candidateSeason;
                            next = nextSeasonEpisodes.get(0);
                            break;
                        }
                    }
                }
                if (next == null) {
                    runOnUiThread(() -> Toast.makeText(this, "You reached the end of this series.", Toast.LENGTH_SHORT).show());
                    return;
                }
                Season finalSeason = nextSeason;
                Episode nextEpisode = next;
                List<QualityOption> qualities = requestClient.loadEpisodeQualities(item, finalSeason, nextEpisode);
                runOnUiThread(() -> {
                    if (requestGeneration == playbackRequestGeneration) showNextEpisodePrompt(item, finalSeason, nextEpisode, qualities);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (requestGeneration == playbackRequestGeneration) Toast.makeText(this, "Next episode is not available right now.", Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void showNextEpisodePrompt(VodItem item, Season season, Episode episode, List<QualityOption> qualities) {
        if (qualities == null || qualities.isEmpty()) return;
        QualityOption selected = preferredQuality(qualities);
        String message = "Episode " + episode.number + " · " + episode.title + "\n\nStarting automatically in 5 seconds.";
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Next episode")
                .setMessage(message)
                .setNegativeButton("Stop", null)
                .setPositiveButton("Play now", (window, which) -> startEpisodePlayback(item, season, episode, selected))
                .create();
        dialog.setOnShowListener(window -> playbackHandler.postDelayed(() -> {
            if (dialog.isShowing()) {
                dialog.dismiss();
                startEpisodePlayback(item, season, episode, selected);
            }
        }, 5000L));
        dialog.show();
    }

    private void showVodPlayerShell(String title) {
        showVodPlayerShell(title, this::showVodScreen);
    }

    private void showVodPlayerShell(String title, Runnable backAction) {
        setFullscreenPlayback(false);
        stopPlayback();
        retryPlaybackAction = null;
        screenBackAction = backAction;
        playbackBackAction = backAction;
        livePlayerScreen = false;
        pageTitle.setText(title);
        pageStatus.setText("Opening playback…");
        LinearLayout page = pageColumn();
        page.setPadding(dp(24), dp(16), dp(24), dp(16));
        playerView = new PlayerView(this);
        configurePlayerView(playerView);
        page.addView(playerView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        Button fullscreen = fullscreenButton();
        controls.addView(fullscreen, new LinearLayout.LayoutParams(dp(190), dp(52)));
        Button retry = navButton("Retry stream");
        retryPlaybackButton = retry;
        retry.setEnabled(false);
        retry.setOnClickListener(view -> retryCurrentPlayback());
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(dp(190), dp(52));
        retryParams.leftMargin = dp(10);
        controls.addView(retry, retryParams);
        Button back = navButton("Back to Movies & Series");
        back.setOnClickListener(view -> backAction.run());
        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(dp(280), dp(52));
        backParams.leftMargin = dp(10);
        controls.addView(back, backParams);
        page.addView(controls, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
        replaceContent(page);
    }

    private void showVodLoading(String message) {
        setFullscreenPlayback(false);
        stopPlayback();
        retryPlaybackAction = null;
        screenBackAction = this::showVodScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        pageTitle.setText("Movies & Series");
        pageStatus.setText("Loading…");
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        page.addView(title(message, 27), wrap());
        page.addView(text("Please wait for the authorised portal response.", MUTED, 17), wrapWithTop(10));
        replaceContent(page);
    }

    private void showVodError(String message) {
        setFullscreenPlayback(false);
        screenBackAction = this::showVodScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        pageTitle.setText("Movies & Series");
        pageStatus.setText("VOD unavailable");
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        page.addView(title("Could not open this title", 27), wrap());
        page.addView(text(message == null ? "Try again after refreshing the catalogue." : message, DANGER, 17), wrapWithTop(12));
        Button retry = actionButton("Back to Movies & Series", GOLD);
        retry.setOnClickListener(view -> showVodScreen());
        page.addView(retry, new LinearLayout.LayoutParams(dp(300), dp(56)));
        replaceContent(page);
        retry.requestFocus();
    }

    private void showComingSoon(String section) {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        pageTitle.setText(section);
        pageStatus.setText("Android TV port in progress");
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        page.addView(title(section + " are coming to the native Android TV build", 28), wrap());
        page.addView(text("Subtitles and the remaining Windows features are planned for the next porting pass.", MUTED, 17), wrapWithTop(14));
        Button live = actionButton("Open Live TV", GOLD);
        live.setOnClickListener(view -> showLiveScreen());
        page.addView(live, new LinearLayout.LayoutParams(dp(260), dp(56)));
        replaceContent(page);
    }

    private void showSettings() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showHomeScreen;
        playbackBackAction = null;
        livePlayerScreen = false;
        livePinUnlocked = false;
        subscription = store.getSubscription();
        pageTitle.setText("Settings");
        updateHeaderStatus();
        LinearLayout page = pageColumn();
        page.setPadding(dp(40), dp(24), dp(40), dp(24));
        page.addView(title("Settings", 28), wrap());
        page.addView(text("Professional controls for your portal, catalogue, playback and privacy.", MUTED, 16), wrapWithTop(6));

        LinearLayout settingsShell = new LinearLayout(this);
        settingsShell.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout settingsSections = pageColumn();
        settingsSections.setPadding(0, dp(18), dp(18), dp(8));
        String[] sectionLabels = {"General", "Player", "Portals", "Parental Control", "Appearance", "Updates", "About & FAQ"};
        for (String sectionLabel : sectionLabels) {
            Button section = navButton(sectionLabel);
            settingsSections.addView(section, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        }
        LinearLayout settingsDetail = pageColumn();
        settingsDetail.setPadding(dp(4), dp(18), 0, dp(8));
        settingsShell.addView(settingsSections, new LinearLayout.LayoutParams(dp(210), ViewGroup.LayoutParams.MATCH_PARENT));
        settingsShell.addView(settingsDetail, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        page.addView(settingsShell, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout settingsRoot = page;
        page = settingsDetail;

        page.addView(title("Portal Management", 21), wrapWithTop(24));
        Button managePortals = actionButton("Manage portals (" + store.getPortals().size() + ")", GOLD);
        managePortals.setOnClickListener(view -> showPortalManager());
        page.addView(managePortals, new LinearLayout.LayoutParams(dp(300), dp(56)));
        page.addView(text("Portal URL", GOLD_BRIGHT, 15), wrapWithTop(12));
        page.addView(text(store.getPortalUrl(), TEXT, 18), wrapWithTop(5));
        page.addView(text("MAC address", GOLD_BRIGHT, 15), wrapWithTop(18));
        page.addView(text(store.getMac(), TEXT, 18), wrapWithTop(5));
        page.addView(text("Your MAC stays locally administered with the 02: prefix. Provider authorization is still required.", MUTED, 15), wrapWithTop(7));
        TextView expiry = text(portalStatusText(), subscription != null && subscription.isExpired() ? DANGER : GOLD_BRIGHT, 17);
        expiry.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
        page.addView(expiry, wrapWithTop(24));
        page.addView(text("Expiry is shown only when the provider reports a valid date. STB PLAY never invents an expiry date.", MUTED, 14), wrapWithTop(6));
        Button refreshPortal = actionButton("Refresh portal & content", GOLD);
        refreshPortal.setOnClickListener(view -> refreshPortalAndContent());
        page.addView(refreshPortal, new LinearLayout.LayoutParams(dp(300), dp(56)));

        page.addView(title("Content & Catalogue", 21), wrapWithTop(26));
        int liveCount = catalog == null ? 0 : catalog.channels.size();
        String catalogueText = "Live TV: " + (liveCount == 0 ? "not loaded" : liveCount + " channels")
                + "\nMovies & Series: " + (vodItems.isEmpty() ? "not loaded" : vodItems.size() + " titles")
                + "\nProvider data is refreshed on demand and cached locally for faster startup.";
        page.addView(text(catalogueText, TEXT, 16), wrapWithTop(10));
        Button clearCache = navButton("Clear local catalogue cache");
        clearCache.setOnClickListener(view -> confirmClearCatalogueCache());
        page.addView(clearCache, new LinearLayout.LayoutParams(dp(300), dp(52)));

        page.addView(title("Playback", 21), wrapWithTop(26));
        page.addView(text("Android TV playback uses the native Media3 player with auto-hide controls. If a stream buffers or errors, STB PLAY can hand it to VLC when VLC is installed.", MUTED, 15), wrapWithTop(22));
        page.addView(text("Quality: Auto when only one quality is available; choices are shown when the provider offers multiple qualities. Fullscreen and D-pad controls are available in the player.", MUTED, 15), wrapWithTop(8));
        Button defaultQuality = navButton("Default quality: " + userPreferences.getDefaultQuality());
        defaultQuality.setOnClickListener(view -> chooseDefaultQuality());
        page.addView(defaultQuality, new LinearLayout.LayoutParams(dp(300), dp(52)));
        page.addView(text("Audio uses the provider default. Subtitle tracks will be added in the next pass.", MUTED, 14), wrapWithTop(8));

        page.addView(title("Appearance & Language", 21), wrapWithTop(26));
        Button theme = navButton("Theme: " + (userPreferences.isLightTheme() ? "Light" : "Dark"));
        theme.setOnClickListener(view -> {
            userPreferences.setLightTheme(!userPreferences.isLightTheme());
            applyThemePalette(userPreferences.isLightTheme());
            showSettings();
        });
        page.addView(theme, new LinearLayout.LayoutParams(dp(300), dp(52)));
        Button language = navButton("App language: " + userPreferences.getLanguage());
        language.setOnClickListener(view -> chooseLanguage());
        page.addView(language, new LinearLayout.LayoutParams(dp(300), dp(52)));

        page.addView(title("Parental Controls", 21), wrapWithTop(26));
        page.addView(text("Adult/A-rated provider content stays behind your local PIN. The PIN is never displayed in the app.", MUTED, 15), wrapWithTop(8));
        Button changePin = navButton("Change parental PIN");
        changePin.setOnClickListener(view -> showChangePinDialog());
        page.addView(changePin, new LinearLayout.LayoutParams(dp(260), dp(52)));

        page.addView(title("History & Local Data", 21), wrapWithTop(26));
        page.addView(text("Favourites and Continue Watching are stored locally on this TV. Stream URLs and portal credentials are not saved in playback history.", MUTED, 15), wrapWithTop(8));
        Button clearHistory = navButton("Clear Continue Watching history");
        clearHistory.setOnClickListener(view -> confirmClearHistory());
        page.addView(clearHistory, new LinearLayout.LayoutParams(dp(300), dp(52)));

        page.addView(title("App Information & Help", 21), wrapWithTop(26));
        Button appInfo = navButton("App info & build number");
        appInfo.setOnClickListener(view -> showAppInfoDialog());
        page.addView(appInfo, new LinearLayout.LayoutParams(dp(300), dp(52)));
        Button legal = navButton("Terms, Privacy & authorized use");
        legal.setOnClickListener(view -> showLegalDialog());
        page.addView(legal, new LinearLayout.LayoutParams(dp(300), dp(52)));
        Button faq = navButton("FAQ / Help");
        faq.setOnClickListener(view -> showFaqDialog());
        page.addView(faq, new LinearLayout.LayoutParams(dp(300), dp(52)));

        page.addView(title("Updates & Distribution", 21), wrapWithTop(26));
        page.addView(text("Premium status: Free tier · no subscription or media is included. Premium can later remove ads only.", MUTED, 15), wrapWithTop(8));
        page.addView(text("Current channel: " + ("sideload".equals(BuildConfig.DISTRIBUTION_CHANNEL) ? "sideload test build" : "Play Store build")
                + ". Play Store builds use Google's normal update system.", MUTED, 15), wrapWithTop(8));
        Button reconnect = actionButton("Reconnect portal", GOLD);
        reconnect.setOnClickListener(view -> showSetup());
        page.addView(reconnect, new LinearLayout.LayoutParams(dp(260), dp(56)));
        Button updates = navButton("Check for updates");
        updates.setOnClickListener(view -> checkForUpdates(true));
        page.addView(updates, new LinearLayout.LayoutParams(dp(260), dp(52)));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        settingsShell.removeView(settingsDetail);
        settingsShell.addView(scroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        replaceContent(settingsRoot);
    }

    private void showPortalManager() {
        setFullscreenPlayback(false);
        stopPlayback();
        screenBackAction = this::showSettings;
        playbackBackAction = null;
        livePlayerScreen = false;
        pageTitle.setText("Portal Management");
        pageStatus.setText(store.getPortals().size() + " saved portal" + (store.getPortals().size() == 1 ? "" : "s"));
        LinearLayout page = pageColumn();
        page.setPadding(dp(36), dp(24), dp(36), dp(24));
        page.addView(title("Portal Management", 28), wrap());
        page.addView(text("Save more than one authorised portal and switch between them from this TV.", MUTED, 16), wrapWithTop(8));
        Button add = actionButton("Add portal", GOLD);
        add.setOnClickListener(view -> showPortalEditor(null));
        page.addView(add, new LinearLayout.LayoutParams(dp(240), dp(54)));
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = pageColumn();
        list.setPadding(0, dp(18), dp(10), dp(20));
        String activeId = store.getActivePortalId();
        for (PortalProfile profile : store.getPortals()) {
            String host = Uri.parse(profile.url).getHost();
            Button portal = navButton((profile.id.equals(activeId) ? "✓ " : "") + profile.name
                    + "\n" + (host == null ? profile.url : host) + " · " + profile.subscription.statusLabel());
            portal.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
            portal.setOnClickListener(view -> showPortalActions(profile));
            list.addView(portal, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(70)));
        }
        scroll.addView(list);
        page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        Button back = navButton("Back to Settings");
        back.setOnClickListener(view -> showSettings());
        page.addView(back, new LinearLayout.LayoutParams(dp(240), dp(52)));
        replaceContent(page);
        if (list.getChildCount() > 0) list.getChildAt(0).requestFocus();
        else add.requestFocus();
    }

    private void showPortalActions(PortalProfile profile) {
        String activeId = store.getActivePortalId();
        String[] actions = {"Use this portal", "Edit portal", "Rename portal", "Delete portal"};
        new AlertDialog.Builder(this)
                .setTitle(profile.name)
                .setItems(actions, (dialog, which) -> {
                    if (which == 0) {
                        if (profile.id.equals(activeId)) Toast.makeText(this, "This portal is already active.", Toast.LENGTH_SHORT).show();
                        else switchPortal(profile.id);
                    } else if (which == 1) showPortalEditor(profile);
                    else if (which == 2) showRenamePortalDialog(profile);
                    else confirmDeletePortal(profile);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showPortalEditor(PortalProfile existing) {
        boolean adding = existing == null;
        LinearLayout fields = pageColumn();
        fields.setPadding(dp(10), dp(4), dp(10), 0);
        EditText name = field("Portal name", adding ? "My portal" : existing.name);
        EditText url = field("Portal URL", adding ? "" : existing.url);
        EditText mac = field("MAC address", adding ? PortalStore.generateMac() : existing.mac);
        fields.addView(name, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        fields.addView(url, wrapWithTop(10));
        fields.addView(mac, wrapWithTop(10));
        fields.addView(text("Use only a portal and MAC authorised by your provider. STB PLAY does not bypass provider access controls.", MUTED, 13), wrapWithTop(10));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(adding ? "Add authorised portal" : "Edit portal")
                .setView(fields)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", null)
                .create();
        dialog.setOnShowListener(view -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String portalName = name.getText().toString().trim();
            String portalUrl = url.getText().toString().trim();
            String portalMac = mac.getText().toString().trim().toUpperCase(Locale.US);
            if (portalName.isEmpty()) { name.setError("Enter a name"); return; }
            if (!portalUrl.matches("(?i)^https?://.+")) { url.setError("Enter a valid http:// or https:// URL"); return; }
            if (!portalMac.matches("(?i)^02(:[0-9a-f]{2}){5}$")) { mac.setError("MAC must begin with 02:"); return; }
            if (adding) store.addPortal(portalName, portalUrl, portalMac, true);
            else store.updatePortal(existing.id, portalName, portalUrl, portalMac);
            dialog.dismiss();
            if (adding || existing.id.equals(store.getActivePortalId())) switchPortal(store.getActivePortalId());
            else showPortalManager();
        }));
        dialog.show();
        name.requestFocus();
    }

    private void showRenamePortalDialog(PortalProfile profile) {
        EditText input = field("Portal name", profile.name);
        new AlertDialog.Builder(this)
                .setTitle("Rename portal")
                .setView(input)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (dialog, which) -> {
                    store.renamePortal(profile.id, input.getText().toString().trim());
                    showPortalManager();
                })
                .show();
        input.requestFocus();
    }

    private void confirmDeletePortal(PortalProfile profile) {
        if (store.getPortals().size() <= 1) {
            Toast.makeText(this, "Keep at least one portal saved.", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Delete portal?")
                .setMessage("Remove “" + profile.name + "” from this TV? Provider access is not changed.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Delete", (dialog, which) -> {
                    boolean active = profile.id.equals(store.getActivePortalId());
                    store.deletePortal(profile.id);
                    if (active) switchPortal(store.getActivePortalId());
                    else showPortalManager();
                })
                .show();
    }

    private void switchPortal(String portalId) {
        portalGeneration++;
        playbackRequestGeneration++;
        liveCatalogueLoading = false;
        vodCategoriesLoading = false;
        vodCategoriesRefreshStarted = false;
        vodItemsLoading = false;
        vodRequestGeneration++;
        store.selectPortal(portalId);
        client = null;
        catalog = null;
        subscription = store.getSubscription();
        vodCategories.clear();
        vodItems.clear();
        selectedVodCategory = null;
        vodPage = 0;
        liveCache.clear();
        vodCache.clear();
        startPortalBootstrap();
    }

    private void chooseDefaultQuality() {
        String[] choices = {"Auto", "1080p", "720p", "480p"};
        int selected = 0;
        for (int i = 0; i < choices.length; i++) if (choices[i].equals(userPreferences.getDefaultQuality())) selected = i;
        new AlertDialog.Builder(this)
                .setTitle("Default playback quality")
                .setSingleChoiceItems(choices, selected, (dialog, which) -> {
                    userPreferences.setDefaultQuality(choices[which]);
                    dialog.dismiss();
                    showSettings();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private QualityOption preferredQuality(List<QualityOption> qualities) {
        if (qualities == null || qualities.isEmpty()) return null;
        String preferred = userPreferences.getDefaultQuality().toLowerCase(Locale.US);
        if (preferred.equals("auto")) return qualities.get(0);
        for (QualityOption quality : qualities) {
            if (quality.label.toLowerCase(Locale.US).contains(preferred)) return quality;
        }
        return qualities.get(0);
    }

    private void chooseLanguage() {
        String[] choices = {"English", "Punjabi", "Hindi"};
        int selected = 0;
        for (int i = 0; i < choices.length; i++) if (choices[i].equals(userPreferences.getLanguage())) selected = i;
        new AlertDialog.Builder(this)
                .setTitle("App language")
                .setSingleChoiceItems(choices, selected, (dialog, which) -> {
                    userPreferences.setLanguage(choices[which]);
                    dialog.dismiss();
                    showMainShell();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void refreshPortalAndContent() {
        portalGeneration++;
        playbackRequestGeneration++;
        liveCatalogueLoading = false;
        vodCategoriesLoading = false;
        vodItemsLoading = false;
        vodRequestGeneration++;
        client = null;
        vodCategories.clear();
        vodItems.clear();
        selectedVodCategory = null;
        vodPage = 0;
        catalog = null;
        liveCache.clear();
        vodCache.clear();
        startPortalBootstrap();
    }

    private void confirmClearCatalogueCache() {
        new AlertDialog.Builder(this)
                .setTitle("Clear catalogue cache?")
                .setMessage("This removes locally cached channel and Movies & Series metadata. Your portal, favourites, history and PIN will stay safe.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Clear", (dialog, which) -> {
                    liveCache.clear();
                    vodCache.clear();
                    catalog = null;
                    vodCategories.clear();
                    vodCategoriesRefreshStarted = false;
                    vodItems.clear();
                    selectedVodCategory = null;
                    Toast.makeText(this, "Catalogue cache cleared.", Toast.LENGTH_SHORT).show();
                    showSettings();
                })
                .show();
    }

    private void confirmClearHistory() {
        new AlertDialog.Builder(this)
                .setTitle("Clear Continue Watching?")
                .setMessage("All saved movie and episode progress will be removed. Favourites will not be affected.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Clear", (dialog, which) -> {
                    continueStore.clear();
                    Toast.makeText(this, "Continue Watching history cleared.", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void showChangePinDialog() {
        LinearLayout fields = pageColumn();
        fields.setPadding(dp(12), dp(4), dp(12), 0);
        EditText current = field("Current PIN", "");
        current.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText next = field("New 4-digit PIN", "");
        next.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText confirm = field("Confirm new PIN", "");
        confirm.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        fields.addView(current, new LinearLayout.LayoutParams(dp(300), dp(54)));
        fields.addView(next, wrapWithTop(10));
        fields.addView(confirm, wrapWithTop(10));
        fields.addView(text("Your current PIN is required. No master PIN is shown or bundled.", MUTED, 14), wrapWithTop(10));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Change parental PIN")
                .setView(fields)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", null)
                .create();
        dialog.setOnShowListener(view -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            String currentValue = current.getText().toString().trim();
            String nextValue = next.getText().toString().trim();
            String confirmValue = confirm.getText().toString().trim();
            if (!store.verifyPin(currentValue)) { current.setError("Current PIN is incorrect"); return; }
            if (!nextValue.matches("^[0-9]{4}$")) { next.setError("Use exactly 4 digits"); return; }
            if (!nextValue.equals(confirmValue)) { confirm.setError("PINs do not match"); return; }
            store.setPin(nextValue);
            dialog.dismiss();
            Toast.makeText(this, "Parental PIN updated.", Toast.LENGTH_SHORT).show();
        }));
        dialog.show();
        current.requestFocus();
    }

    private void showAppInfoDialog() {
        showTextDialog("About STB PLAY", "STB PLAY\nIPTV Player\n\n"
                + "Version: " + BuildConfig.VERSION_NAME + "\n"
                + "Build number: " + BuildConfig.VERSION_CODE + "\n"
                + "Channel: " + BuildConfig.DISTRIBUTION_CHANNEL + "\n"
                + "Application ID: " + BuildConfig.APPLICATION_ID + "\n\n"
                + "A native Android TV media player for services and content you are authorised to use. STB PLAY is an independent app and is not affiliated with STBEmu, Infomir, MAG or any provider. It does not provide, sell, host or activate IPTV service.");
    }

    private void showLegalDialog() {
        showTextDialog("Terms, Privacy & Authorized Use", "AUTHORIZED USE\n\n"
                + "STB PLAY is only a media player. You must use it only with a portal, subscription, channel and content service that you are legally authorised to access. STB PLAY does not provide, sell, host, activate or distribute IPTV subscriptions, channels, movies or series.\n\n"
                + "No portal, subscription or media is preloaded or included. You are responsible for the portal URL, MAC authorization, subscription, content rights and local laws that apply to your use. STB PLAY does not bypass provider access controls and cannot guarantee that a provider stream will remain available.\n\n"
                + "INDEPENDENCE & COPYRIGHT\n\n"
                + "STB PLAY is independent and is not affiliated with STBEmu, Infomir, MAG or any IPTV provider. STB PLAY does not host or distribute provider content. Copyright, takedown and rights questions must be directed to the relevant provider or rights holder. Any premium app purchase, if offered, covers app features only and does not include an IPTV subscription.\n\n"
                + "PRIVACY\n\n"
                + "Portal URL, MAC, PIN, favourites, watch progress and catalogue cache are stored locally on this TV for app operation. Playback links are not saved in watch history.\n\n"
                + "If the private analytics endpoint is enabled for a release, only an anonymous device ID, device type, app version, event name, timestamp and playback-active flag may be sent. Portal URL, MAC, channel names, movie/series titles and stream links are not sent.\n\n"
                + configuredContact("Privacy Policy", AppConfig.PRIVACY_POLICY_URL) + "\n"
                + configuredContact("Terms", AppConfig.TERMS_URL) + "\n"
                + configuredContact("Support", AppConfig.SUPPORT_EMAIL) + "\n\n"
                + "UPDATES\n\n"
                + "Sideload test builds may download an update and ask Android to show its normal installation confirmation. Play Store builds will use Google's update system.\n\n"
                + "This information is general app-use information, not legal advice. Keep your provider's terms and applicable law in mind.");
    }

    private void showFaqDialog() {
        showTextDialog("FAQ / Help", "1. Does STB PLAY provide channels or movies?\n"
                + "No. Add only an authorised provider portal and content service.\n\n"
                + "2. Why are channels missing?\n"
                + "Check the portal URL, the locally generated 02: MAC authorization, your network and your provider account.\n\n"
                + "3. Where can I see expiry?\n"
                + "Open Settings. When the provider reports a valid date, STB PLAY shows Active/Expired, expiry date and time remaining. If no valid date is reported, no date is invented.\n\n"
                + "4. How does parental protection work?\n"
                + "Adult/A-rated categories and titles require your local 4-digit PIN. Leaving the protected area locks it again.\n\n"
                + "5. How do I change or recover my PIN?\n"
                + "Use Settings → Change parental PIN and enter the current PIN. A master PIN is not shown or bundled; forgotten-PIN recovery must use the secure support process.\n\n"
                + "6. Why does playback fail?\n"
                + "The provider may have returned no link, an expired link or a format the native player cannot open. STB PLAY shows an unavailable message and can try VLC after buffering/error when VLC is installed.\n\n"
                + "7. How do updates work?\n"
                + "The test updater checks the configured HTTPS manifest at startup and from Settings. It verifies the APK checksum, then asks Android to install it.\n\n"
                + "8. What data is used for analytics?\n"
                + "Only anonymous app/playback/update events when the private endpoint is enabled. Provider and content details are excluded.\n\n"
                + "9. Is STB PLAY a provider or content host?\n"
                + "No. It is an independent player. No portal, subscription or media is included, and premium app features do not include an IPTV subscription. Copyright or takedown questions belong with the provider or rights holder.\n\n"
                + "10. Where is support and privacy information?\n"
                + "Use the Support and Privacy Policy details in Terms, Privacy & Authorized Use. These release contacts must be configured before public distribution.");
    }

    private String configuredContact(String label, String value) {
        String clean = value == null ? "" : value.trim();
        return label + ": " + (clean.isEmpty() ? "To be configured before public release." : clean);
    }

    private void showTextDialog(String heading, String message) {
        ScrollView scroll = new ScrollView(this);
        TextView body = text(message, TEXT, 16);
        body.setGravity(Gravity.TOP | Gravity.LEFT);
        body.setPadding(dp(10), dp(4), dp(10), dp(4));
        scroll.addView(body, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(this)
                .setTitle(heading)
                .setView(scroll)
                .setPositiveButton("Close", null)
                .show();
    }

    private void showErrorPage(String message) {
        LinearLayout page = pageColumn();
        page.setGravity(Gravity.CENTER);
        page.addView(title("Portal connection failed", 28), wrap());
        page.addView(text(message == null ? "Try again after checking the URL and authorised MAC." : message, DANGER, 17), wrapWithTop(12));
        Button retry = actionButton("Try again", GOLD);
        retry.setOnClickListener(view -> { catalog = null; showLiveScreen(); });
        page.addView(retry, new LinearLayout.LayoutParams(dp(220), dp(56)));
        replaceContent(page);
    }

    private String portalStatusText() {
        if (subscription == null) return "Portal status unavailable";
        return "Portal status: " + subscription.statusLabel() + "\n" + subscription.displaySummary();
    }

    private void updateHeaderStatus() {
        if (pageStatus == null) return;
        PortalSubscription current = subscription == null ? store.getSubscription() : subscription;
        if (current == null || !current.hasExpiry()) {
            pageStatus.setText(current == null || "Unavailable".equals(current.statusLabel())
                    ? "Portal connected · expiry unavailable"
                    : current.statusLabel() + " · expiry unavailable");
            pageStatus.setTextColor(current != null && current.isExpired() ? DANGER : MUTED);
            return;
        }
        pageStatus.setText(current.statusLabel() + " · " + current.timeLeftText());
        pageStatus.setTextColor(current.isExpired() ? DANGER : GOLD_BRIGHT);
    }

    private void maybeShowExpiryReminder() {
        PortalSubscription current = subscription == null ? store.getSubscription() : subscription;
        if (current == null || !current.hasExpiry() || current.isExpired()) return;
        long days = current.daysRemaining();
        if (days < 1L || days > 7L) return;
        String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (store.wasExpiryReminderShownToday(day, current.expiryAtMs)) return;
        store.markExpiryReminderShown(day, current.expiryAtMs);
        String dayLabel = days == 1L ? "1 day" : days + " days";
        new AlertDialog.Builder(this)
                .setTitle("Subscription reminder")
                .setMessage("Your subscription expires in " + dayLabel + ".\n\nExpiry: " + current.expiryDateText())
                .setPositiveButton("OK", null)
                .show();
    }

    private void checkForUpdates(boolean manual) {
        if (updateChecking) return;
        if (!"sideload".equals(BuildConfig.DISTRIBUTION_CHANNEL)) {
            if (manual) Toast.makeText(this, "Play Store manages updates for this build.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (AppConfig.UPDATE_MANIFEST_URL.trim().isEmpty()) {
            if (manual) Toast.makeText(this, "Updater endpoint is not configured for this test build.", Toast.LENGTH_LONG).show();
            return;
        }
        updateChecking = true;
        if (manual && pageStatus != null) pageStatus.setText("Checking for updates…");
        analytics.track("update_check", false);
        worker.execute(() -> {
            try {
                UpdateInfo info = UpdateClient.check();
                runOnUiThread(() -> {
                    updateChecking = false;
                    if (info != null && info.isNewer()) {
                        analytics.track("update_available", false);
                        showUpdateAvailable(info);
                    } else if (manual) {
                        updateHeaderStatus();
                        Toast.makeText(this, "STB PLAY is up to date.", Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    updateChecking = false;
                    updateHeaderStatus();
                    if (manual) Toast.makeText(this, "Update check failed. Try again later.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void showUpdateAvailable(UpdateInfo info) {
        String message = "STB PLAY " + (info.versionName.isEmpty() ? "new version" : "v" + info.versionName)
                + " is available.\n\nDownload and install it now?";
        if (!info.notes.trim().isEmpty()) message += "\n\n" + info.notes.trim();
        new AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage(message)
                .setNegativeButton("Later", null)
                .setPositiveButton("Download & install", (dialog, which) -> downloadAndInstall(info))
                .show();
    }

    private void downloadAndInstall(UpdateInfo info) {
        if (pageStatus != null) pageStatus.setText("Downloading update v" + info.versionName + "…");
        analytics.track("update_download_started", false);
        worker.execute(() -> {
            try {
                File apk = UpdateClient.download(this, info);
                runOnUiThread(() -> {
                    analytics.track("update_downloaded", false);
                    installUpdate(apk);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    updateHeaderStatus();
                    analytics.track("update_download_failed", false);
                    Toast.makeText(this, "Update download failed. Try again later.", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void installUpdate(File apk) {
        if (apk == null || !apk.isFile()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            pendingUpdateApk = apk;
            analytics.track("update_install_permission_required", false);
            Toast.makeText(this, "Allow STB PLAY to install updates, then return here.", Toast.LENGTH_LONG).show();
            Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()));
            startActivity(permission);
            return;
        }
        Intent installer = new Intent(Intent.ACTION_VIEW);
        installer.setDataAndType(UpdateClient.contentUri(this, apk), "application/vnd.android.package-archive");
        installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            analytics.track("update_install_requested", false);
            startActivity(installer);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Android TV could not open the update installer.", Toast.LENGTH_LONG).show();
        }
    }

    private void askForPin(Runnable success) {
        EditText input = new EditText(this);
        input.setHint("4-digit PIN");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Restricted category")
                .setMessage("Enter your parental PIN to continue.")
                .setView(input)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Unlock", null)
                .create();
        dialog.setOnShowListener(view -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            if (store.verifyPin(input.getText().toString().trim())) { dialog.dismiss(); success.run(); }
            else input.setError("Incorrect PIN");
        }));
        dialog.show();
        input.requestFocus();
    }

    private void replaceContent(View view) {
        if (content == null) return;
        content.removeAllViews();
        content.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view.post(() -> requestFirstFocusable(view));
    }

    private boolean requestFirstFocusable(View view) {
        if (view != null && view.isFocusable() && view.isEnabled() && view.getVisibility() == View.VISIBLE) {
            return view.requestFocus();
        }
        if (view instanceof ViewGroup group) {
            for (int i = 0; i < group.getChildCount(); i++) {
                if (requestFirstFocusable(group.getChildAt(i))) return true;
            }
        }
        return false;
    }

    private void configurePlayerView(PlayerView view) {
        view.setUseController(true);
        view.setControllerAutoShow(true);
        view.setControllerHideOnTouch(true);
        view.setControllerShowTimeoutMs(3000);
        view.setKeepScreenOn(true);
        view.setBackgroundColor(Color.BLACK);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
    }

    private Button fullscreenButton() {
        Button button = navButton("Fullscreen");
        fullscreenToggle = button;
        button.setOnClickListener(view -> setFullscreenPlayback(!fullscreenPlayback));
        return button;
    }

    private void scheduleVlcFallback() {
        if (vlcFallbackAttempted || activeStream.isEmpty()) return;
        playbackHandler.removeCallbacks(vlcFallback);
        playbackHandler.postDelayed(vlcFallback, 3000L);
    }

    private void cancelVlcFallback() {
        playbackHandler.removeCallbacks(vlcFallback);
    }

    private void launchVlcFallback() {
        if (vlcFallbackAttempted || activeStream.isEmpty()) return;
        if (player != null && player.getPlaybackState() == Player.STATE_READY) return;
        vlcFallbackAttempted = true;
        String stream = activeStream;
        String title = activePlaybackTitle;
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(stream), "video/*");
        intent.setPackage("org.videolan.vlc");
        if (intent.resolveActivity(getPackageManager()) == null) {
            if (pageStatus != null) pageStatus.setText("This stream is not supported by the built-in player; VLC is not installed.");
            Toast.makeText(this, "This stream is temporarily unavailable or unsupported. Install VLC to try the fallback.", Toast.LENGTH_LONG).show();
            return;
        }
        stopPlayback();
        try {
            startActivity(intent);
            if (pageStatus != null) pageStatus.setText(title + " · VLC");
        } catch (ActivityNotFoundException error) {
            if (pageStatus != null) pageStatus.setText("This stream is temporarily unavailable; VLC could not open it.");
            Toast.makeText(this, "This stream is temporarily unavailable or unsupported.", Toast.LENGTH_LONG).show();
        }
    }

    private void setFullscreenPlayback(boolean enabled) {
        fullscreenPlayback = enabled;
        if (appHeader != null) appHeader.setVisibility(enabled ? View.GONE : View.VISIBLE);
        if (navigationRail != null) navigationRail.setVisibility(enabled ? View.GONE : View.VISIBLE);
        if (root != null) {
            int padding = enabled ? 0 : dp(24);
            int vertical = enabled ? 0 : dp(18);
            root.setPadding(padding, vertical, padding, vertical);
        }
        if (fullscreenToggle != null) fullscreenToggle.setText(enabled ? "Exit Fullscreen" : "Fullscreen");
        int immersive = View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        getWindow().getDecorView().setSystemUiVisibility(enabled ? immersive : 0);
    }

    private void stopPlayback() {
        playbackRequestGeneration++;
        boolean hadPlayer = player != null;
        saveActiveProgress();
        progressHandler.removeCallbacks(progressSaver);
        cancelVlcFallback();
        activeWatch = null;
        activeVodItem = null;
        activeSeason = null;
        activeEpisode = null;
        activeQuality = null;
        episodeEndHandled = false;
        activeStream = "";
        activePlaybackTitle = "";
        vlcFallbackAttempted = false;
        if (retryPlaybackButton != null) retryPlaybackButton.setEnabled(false);
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        if (playerView != null) playerView.setPlayer(null);
        if (hadPlayer) analytics.track("playback_stopped", false);
    }

    private void applyThemePalette(boolean light) {
        if (light) {
            NAVY = Color.rgb(244, 247, 251);
            PANEL = Color.rgb(255, 255, 255);
            PANEL_LIGHT = Color.rgb(231, 237, 244);
            GOLD = Color.rgb(171, 117, 18);
            GOLD_BRIGHT = Color.rgb(126, 82, 0);
            TEXT = Color.rgb(16, 32, 51);
            MUTED = Color.rgb(84, 103, 123);
            DANGER = Color.rgb(178, 25, 45);
        } else {
            NAVY = Color.rgb(7, 16, 27);
            PANEL = Color.rgb(16, 29, 44);
            PANEL_LIGHT = Color.rgb(23, 40, 58);
            GOLD = Color.rgb(233, 185, 87);
            GOLD_BRIGHT = Color.rgb(255, 217, 130);
            TEXT = Color.rgb(245, 248, 252);
            MUTED = Color.rgb(169, 182, 197);
            DANGER = Color.rgb(255, 154, 154);
        }
        if (getWindow() != null) {
            getWindow().setStatusBarColor(NAVY);
            getWindow().setNavigationBarColor(NAVY);
        }
    }

    private String ui(String english) {
        if (english == null || "English".equals(userPreferences.getLanguage())) return english;
        if ("Punjabi".equals(userPreferences.getLanguage())) {
            if ("Home".equals(english)) return "ਘਰ";
            if ("Live TV".equals(english)) return "ਲਾਈਵ ਟੀਵੀ";
            if ("Movies & Series".equals(english)) return "ਫਿਲਮਾਂ ਤੇ ਸੀਰੀਜ਼";
            if ("Continue Watching".equals(english)) return "ਦੇਖਣਾ ਜਾਰੀ";
            if ("Favourites".equals(english)) return "ਪਸੰਦੀਦਾ";
            if ("Settings".equals(english)) return "ਸੈਟਿੰਗਜ਼";
        }
        if ("Hindi".equals(userPreferences.getLanguage())) {
            if ("Home".equals(english)) return "होम";
            if ("Live TV".equals(english)) return "लाइव टीवी";
            if ("Movies & Series".equals(english)) return "फिल्में और सीरीज़";
            if ("Continue Watching".equals(english)) return "देखना जारी रखें";
            if ("Favourites".equals(english)) return "पसंदीदा";
            if ("Settings".equals(english)) return "सेटिंग्स";
        }
        return english;
    }

    private void saveActiveProgress() {
        if (player != null && activeWatch != null) {
            long position = player.getCurrentPosition();
            long duration = player.getDuration();
            if (position > 0) continueStore.save(activeWatch, position, duration > 0 ? duration : 0);
            if (activeWatch != null) progressHandler.postDelayed(progressSaver, 5000L);
        }
    }

    private LinearLayout pageColumn() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(NAVY);
        return layout;
    }

    private ImageView logoImage() {
        ImageView logo = new ImageView(this);
        logo.setImageResource(ca.netplus.stbplay.R.drawable.stb_play_logo);
        logo.setAdjustViewBounds(true);
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        logo.setBackgroundColor(Color.TRANSPARENT);
        logo.setPadding(dp(5), dp(5), dp(5), dp(5));
        logo.setFocusable(false);
        return logo;
    }

    private TextView title(String value, int size) {
        TextView view = text(value, TEXT, size);
        view.setTypeface(null, android.graphics.Typeface.BOLD);
        return view;
    }

    private TextView text(String value, int color, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private EditText field(String hint, String value) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setText(value);
        field.setTextColor(TEXT);
        field.setHintTextColor(MUTED);
        field.setTextSize(17);
        field.setSingleLine(true);
        field.setPadding(dp(16), 0, dp(16), 0);
        field.setBackground(round(PANEL_LIGHT, GOLD, 2, 10));
        return field;
    }

    private Button actionButton(String label, int color) {
        Button button = navButton(label);
        button.setBackground(round(color, color, 1, 10));
        button.setTextColor(color == GOLD ? NAVY : TEXT);
        return button;
    }

    private Button navButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setFocusable(true);
        button.setFocusableInTouchMode(true);
        button.setClickable(true);
        button.setStateListAnimator(null);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(round(PANEL, PANEL, 1, 8));
        button.setOnFocusChangeListener((view, hasFocus) -> {
            view.setBackground(round(hasFocus ? PANEL_LIGHT : PANEL,
                    hasFocus ? GOLD_BRIGHT : PANEL, hasFocus ? 2 : 1, 8));
            view.setScaleX(hasFocus ? 1.025f : 1f);
            view.setScaleY(hasFocus ? 1.025f : 1f);
            ((Button) view).setTextColor(TEXT);
        });
        return button;
    }

    private GradientDrawable round(int fill, int stroke, int width, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(width), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams wrapWithTop(int margin) {
        LinearLayout.LayoutParams params = wrap();
        params.topMargin = dp(margin);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingUpdateApk != null
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls())) {
            File apk = pendingUpdateApk;
            pendingUpdateApk = null;
            installUpdate(apk);
        }
    }

    @Override
    public void onBackPressed() {
        if (fullscreenPlayback) {
            setFullscreenPlayback(false);
            return;
        }
        if (livePlayerScreen && player != null) {
            stopPlayback();
            if (pageStatus != null) pageStatus.setText("Select a channel to start playback.");
            return;
        }
        if (player != null && player.isPlaying()) {
            player.pause();
            return;
        }
        if (playbackBackAction != null) {
            Runnable back = playbackBackAction;
            playbackBackAction = null;
            screenBackAction = null;
            livePlayerScreen = false;
            stopPlayback();
            back.run();
            return;
        }
        if (screenBackAction != null) {
            Runnable back = screenBackAction;
            screenBackAction = null;
            back.run();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopPlayback();
        playbackHandler.removeCallbacks(vlcFallback);
        portalHandler.removeCallbacks(portalProgressAnimator);
        portalHandler.removeCallbacksAndMessages(null);
        analytics.endSession();
        worker.shutdownNow();
        super.onDestroy();
    }
}
