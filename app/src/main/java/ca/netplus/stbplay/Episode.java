package ca.netplus.stbplay;

import org.json.JSONObject;

public final class Episode {
    public final String id;
    public final String portalId;
    public final String seasonPortalId;
    public final int number;
    public final int seasonNumber;
    public final String title;
    public final String description;
    public final String command;
    public final JSONObject raw;

    public Episode(String id, String portalId, String seasonPortalId, int number, int seasonNumber,
                   String title, String description, String command, JSONObject raw) {
        this.id = id;
        this.portalId = portalId;
        this.seasonPortalId = seasonPortalId;
        this.number = number;
        this.seasonNumber = seasonNumber;
        this.title = title;
        this.description = description;
        this.command = command;
        this.raw = raw;
    }
}
