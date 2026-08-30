package ca.netplus.stbplay;

import java.util.Collections;
import java.util.List;

public final class LiveCatalog {
    public final List<Category> categories;
    public final List<Channel> channels;
    public final String subscriptionText;
    public final PortalSubscription subscription;

    public LiveCatalog(List<Category> categories, List<Channel> channels, String subscriptionText) {
        this(categories, channels, new PortalSubscription("", subscriptionText, -1L));
    }

    public LiveCatalog(List<Category> categories, List<Channel> channels, PortalSubscription subscription) {
        this.categories = Collections.unmodifiableList(categories);
        this.channels = Collections.unmodifiableList(channels);
        this.subscription = subscription == null ? PortalSubscription.unavailable() : subscription;
        this.subscriptionText = this.subscription.displaySummary();
    }
}
