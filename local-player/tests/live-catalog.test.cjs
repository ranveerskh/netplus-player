"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPlayableLiveRow,
  uncoveredCategories,
  orderedListRequest,
  withFallbackCategory,
  resolveLiveGenreId,
} = require("../live-catalog.cjs");

const categories = [
  { id: "1", title: "News" },
  { id: "2", title: "Sports" },
];

test("finds categories missing from an empty global channel list", () => {
  assert.deepEqual(uncoveredCategories(categories, []), categories);
});

test("requests only categories not represented by playable rows", () => {
  const rows = [
    { id: "a", name: "News One", cmd: "news", tv_genre_id: "1" },
  ];
  assert.deepEqual(uncoveredCategories(categories, rows), [categories[1]]);
});

test("maps category titles and ignores rows without playable commands", () => {
  const rows = [
    { id: "a", name: "News One", cmd: "news", genre: "News" },
    { id: "b", name: "Sports placeholder", genre_id: "2" },
  ];
  assert.deepEqual(uncoveredCategories(categories, rows), [categories[1]]);
  assert.equal(isPlayableLiveRow(rows[1]), false);
});

test("builds the observed Stalker ordered-list request", () => {
  assert.deepEqual(orderedListRequest(categories[1]), {
    type: "itv",
    action: "get_ordered_list",
    genre: "2",
    fav: "0",
    hd: "0",
    p: 0,
    sortby: "number",
  });
});

test("tags fallback rows with the queried category and restores its genre ID", () => {
  const tagged = withFallbackCategory(
    { id: "c", name: "Sports One", cmd: "sports" },
    categories[1]
  );
  assert.equal(tagged.__fallbackGenreId, "2");
  assert.equal(resolveLiveGenreId(tagged, categories), "2");
});

test("uses a recognized category ID even when the provider returns its title", () => {
  assert.equal(
    resolveLiveGenreId(
      { genre: "Sports", __fallbackGenreId: "1" },
      categories
    ),
    "2"
  );
});
