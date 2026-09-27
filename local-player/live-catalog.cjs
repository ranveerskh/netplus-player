"use strict";

const CATEGORY_FIELDS = [
  "tv_genre_id",
  "genre_id",
  "genreId",
  "category_id",
  "genre",
  "category",
];

function nonEmpty(value) {
  if (value == null || typeof value === "object") return "";
  return String(value).trim();
}

function rowValue(row, fields) {
  for (const field of fields) {
    const value = nonEmpty(row?.[field]);
    if (value) return value;
  }
  return "";
}

function isPlayableLiveRow(row) {
  return Boolean(
    row &&
      typeof row === "object" &&
      rowValue(row, ["id", "tv_id", "channel_id"]) &&
      rowValue(row, ["name", "title", "channel_name"]) &&
      rowValue(row, ["cmd", "command", "playback_cmd"])
  );
}

function categoryValues(row) {
  const values = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (value && typeof value === "object") {
      for (const key of ["id", "genre_id", "category_id", "title", "name"]) {
        if (value[key] != null) add(value[key]);
      }
      return;
    }
    const text = nonEmpty(value);
    if (text) values.push(text);
  };

  for (const field of CATEGORY_FIELDS) add(row?.[field]);
  return values;
}

function titleKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function categoryLookup(categories) {
  const lookup = new Map();
  for (const category of categories || []) {
    const id = nonEmpty(category?.id ?? category?.genre_id ?? category?.category_id);
    if (!id) continue;
    lookup.set(id, id);
    const title = titleKey(category?.title ?? category?.name ?? category?.genre_name);
    if (title) lookup.set(title, id);
  }
  return lookup;
}

function uncoveredCategories(categories, rows) {
  const lookup = categoryLookup(categories);
  const covered = new Set();

  for (const row of rows || []) {
    if (!isPlayableLiveRow(row)) continue;
    for (const value of categoryValues(row)) {
      const key = value === "0" ? "" : value;
      const categoryId = lookup.get(key) || lookup.get(titleKey(key));
      if (categoryId) covered.add(categoryId);
    }
  }

  return (categories || []).filter((category) => {
    const id = nonEmpty(category?.id ?? category?.genre_id ?? category?.category_id);
    return id && !covered.has(id);
  });
}

function orderedListRequest(category) {
  const id = nonEmpty(category?.id ?? category?.genre_id ?? category?.category_id);
  if (!id) throw new TypeError("A live category ID is required.");
  return {
    type: "itv",
    action: "get_ordered_list",
    genre: id,
    fav: "0",
    hd: "0",
    p: 0,
    sortby: "number",
  };
}

function withFallbackCategory(row, category) {
  const id = nonEmpty(category?.id ?? category?.genre_id ?? category?.category_id);
  return { ...row, __fallbackGenreId: id };
}

function resolveLiveGenreId(row, categories) {
  const lookup = categoryLookup(categories);
  const values = categoryValues(row);
  for (const value of values) {
    if (value === "0") continue;
    const categoryId = lookup.get(value) || lookup.get(titleKey(value));
    if (categoryId) return categoryId;
  }

  for (const value of values) {
    if (value !== "0") return value;
  }

  return nonEmpty(row?.__fallbackGenreId) || "0";
}

module.exports = {
  isPlayableLiveRow,
  uncoveredCategories,
  orderedListRequest,
  withFallbackCategory,
  resolveLiveGenreId,
};
