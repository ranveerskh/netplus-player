package ca.netplus.stbplay;

/** A device-local Continue Watching entry. It contains metadata and position only. */
public final class WatchProgress {
    public final String key;
    public final VodItem item;
    public final boolean episode;
    public final int seasonNumber;
    public final String seasonPortalId;
    public final String episodeId;
    public final String episodePortalId;
    public final int episodeNumber;
    public final String episodeTitle;
    public final long positionMs;
    public final long durationMs;
    public final long updatedAt;

    public WatchProgress(String key, VodItem item, boolean episode, int seasonNumber,
                         String seasonPortalId, String episodeId, String episodePortalId,
                         int episodeNumber, String episodeTitle, long positionMs,
                         long durationMs, long updatedAt) {
        this.key = key;
        this.item = item;
        this.episode = episode;
        this.seasonNumber = seasonNumber;
        this.seasonPortalId = seasonPortalId;
        this.episodeId = episodeId;
        this.episodePortalId = episodePortalId;
        this.episodeNumber = episodeNumber;
        this.episodeTitle = episodeTitle;
        this.positionMs = positionMs;
        this.durationMs = durationMs;
        this.updatedAt = updatedAt;
    }

    public static WatchProgress movie(VodItem item) {
        return new WatchProgress("movie:" + item.id, item, false, 0, "", "", "", 0, "", 0, 0, 0);
    }

    public static WatchProgress episode(VodItem item, Season season, Episode episode) {
        return new WatchProgress(
                "episode:" + item.id + ":" + episode.id, item, true, season.number,
                season.portalId, episode.id, episode.portalId, episode.number, episode.title,
                0, 0, 0
        );
    }

    public int percent() {
        if (durationMs <= 0) return 0;
        return Math.max(0, Math.min(99, (int) ((positionMs * 100L) / durationMs)));
    }
}
