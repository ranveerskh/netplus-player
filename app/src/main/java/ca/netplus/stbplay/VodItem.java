package ca.netplus.stbplay;

public final class VodItem {
    public final String id;
    public final String title;
    public final String alternateTitle;
    public final String originalTitle;
    public final String description;
    public final String year;
    public final String rating;
    public final String genre;
    public final String language;
    public final String categoryId;
    public final String categoryTitle;
    public final String poster;
    public final String command;
    public final String videoId;
    public final String movieId;
    public final boolean isSeries;
    public final boolean locked;

    public VodItem(String id, String title, String alternateTitle, String originalTitle,
                   String description, String year, String rating, String genre,
                   String language, String categoryId, String categoryTitle, String poster,
                   String command, String videoId, String movieId, boolean isSeries,
                   boolean locked) {
        this.id = id;
        this.title = title;
        this.alternateTitle = alternateTitle;
        this.originalTitle = originalTitle;
        this.description = description;
        this.year = year;
        this.rating = rating;
        this.genre = genre;
        this.language = language;
        this.categoryId = categoryId;
        this.categoryTitle = categoryTitle;
        this.poster = poster;
        this.command = command;
        this.videoId = videoId;
        this.movieId = movieId;
        this.isSeries = isSeries;
        this.locked = locked;
    }

    public String searchableText() {
        return title + "\n" + alternateTitle + "\n" + originalTitle + "\n" + genre + "\n" + language + "\n" + year;
    }
}
