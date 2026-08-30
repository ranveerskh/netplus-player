package ca.netplus.stbplay;

public final class Season {
    public final String id;
    public final String portalId;
    public final int number;
    public final String title;

    public Season(String id, String portalId, int number, String title) {
        this.id = id;
        this.portalId = portalId;
        this.number = number;
        this.title = title;
    }
}
