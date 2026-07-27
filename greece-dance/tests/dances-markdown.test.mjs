import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DancesMarkdownError, parseDancesMarkdown, stripComment } from "../dances-markdown.js";

test("the canonical Markdown contains the migrated client hierarchy", async () => {
  const source = await readFile(new URL("../content/dances.md", import.meta.url), "utf8");
  const atlas = parseDancesMarkdown(source);

  assert.equal(atlas.regions.length, 24);
  assert.equal(atlas.places.length, 42);
  assert.ok(atlas.regions.every((region) => region.names.en && region.names.el));
  assert.ok(atlas.places.every((place) => place.names.en && place.names.el));
  assert.doesNotMatch(source, /^(?:id|has_dance|kind|min_zoom|priority|order)=/mu);
  assert.deepEqual(
    atlas.regions
      .filter((region) => region.name.startsWith("Macedonia,"))
      .map((region) => region.names),
    [
      { en: "Macedonia, Eastern", el: "Μακεδονία, Ανατολική" },
      { en: "Macedonia, Northern", el: "Μακεδονία, Βόρεια" },
      { en: "Macedonia, Central", el: "Μακεδονία, Κεντρική" },
      { en: "Macedonia, Western", el: "Μακεδονία, Δυτική" }
    ]
  );

  const thessaly = atlas.regions.find((region) => region.id === "thessaly");
  assert.equal(thessaly.names.el, "Θεσσαλία");
  assert.deepEqual(thessaly.villages.map((village) => village.name), ["Sofades"]);
  assert.deepEqual(thessaly.subregions.map((subregion) => subregion.names), [
    { en: "Agrafa", el: "Άγραφα" }
  ]);
  assert.deepEqual(
    thessaly.subregions[0].villages.map((village) => village.name),
    ["Argithea", "Krioneri", "Thrapsimi"]
  );
});

test("comments apply globally without damaging URLs or escaped slashes", () => {
  const atlas = parseDancesMarkdown(`
# Test Region // source note
greek_name=Περιοχή // translated name
color=#336699

## Test Village // source note
greek_name=Χωριό
latitude=40
longitude=22

### info
Visit https://example.com/path//segment
Keep this \\// literal text.
Remove this // editorial note
// Remove this entire line.
  `);

  assert.equal(atlas.regions[0].name, "Test Region");
  assert.equal(
    atlas.places[0].info,
    "Visit https://example.com/path//segment\nKeep this // literal text.\nRemove this"
  );
  assert.equal(stripComment("value // note"), "value");
  assert.equal(stripComment("https://example.com"), "https://example.com");
});

test("subregion fields must be paired and consistently translated", () => {
  const missingTranslation = `
# Test Region
greek_name=Περιοχή
color=#336699
## First Village
greek_name=Πρώτο Χωριό
latitude=40
longitude=22
subregion=Test Area
  `;
  assert.throws(
    () => parseDancesMarkdown(missingTranslation),
    (error) => {
      assert.ok(error instanceof DancesMarkdownError);
      assert.equal(error.location, "dances.md, line 5, field “subregion_greek_name”");
      return true;
    }
  );

  const inconsistentTranslation = `
# Test Region
greek_name=Περιοχή
color=#336699
## First Village
greek_name=Πρώτο Χωριό
latitude=40
longitude=22
subregion=Test Area
subregion_greek_name=Πρώτη Περιοχή
## Second Village
greek_name=Δεύτερο Χωριό
latitude=41
longitude=23
subregion=Test Area
subregion_greek_name=Δεύτερη Περιοχή
  `;
  assert.throws(
    () => parseDancesMarkdown(inconsistentTranslation),
    /Use the same subregion_greek_name/u
  );
});

test("validation errors identify the line and field", () => {
  const source = `
# Test Region
greek_name=Περιοχή
color=#336699
## Broken Village
greek_name=Χωριό
latitude=nowhere
longitude=22
  `;

  assert.throws(
    () => parseDancesMarkdown(source),
    (error) => {
      assert.ok(error instanceof DancesMarkdownError);
      assert.equal(error.location, "dances.md, line 7, field “latitude”");
      assert.equal(error.message, "This field must be a number.");
      return true;
    }
  );
});
