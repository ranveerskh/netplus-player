package ca.netplus.stbplay;

public final class Channel {
    public final String id;
    public final String title;
    public final String categoryId;
    public final String categoryTitle;
    public final String command;
    public final boolean locked;
    public final int number;

    public Channel(String id, String title, String categoryId, String categoryTitle,
                   String command, boolean locked, int number) {
        this.id = id;
        this.title = title;
        this.categoryId = categoryId;
        this.categoryTitle = categoryTitle;
        this.command = command;
        this.locked = locked;
        this.number = number;
    }
}
