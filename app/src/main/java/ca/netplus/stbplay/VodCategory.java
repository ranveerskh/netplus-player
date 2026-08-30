package ca.netplus.stbplay;

public final class VodCategory {
    public final String id;
    public final String title;
    public final boolean locked;

    public VodCategory(String id, String title, boolean locked) {
        this.id = id;
        this.title = title;
        this.locked = locked;
    }
}
