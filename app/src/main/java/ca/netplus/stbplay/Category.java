package ca.netplus.stbplay;

public final class Category {
    public final String id;
    public final String title;
    public final boolean locked;

    public Category(String id, String title, boolean locked) {
        this.id = id;
        this.title = title;
        this.locked = locked;
    }
}
