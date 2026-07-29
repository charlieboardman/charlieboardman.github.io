import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DancesMarkdownError, parseDancesMarkdown, stripComments } from "../dances-markdown.js";

test("the canonical Markdown remains valid as its content changes", async () => {
  const source = await readFile(new URL("../content/dances.md", import.meta.url), "utf8");
  const atlas = parseDancesMarkdown(source);

  const hierarchyPlaces = atlas.regions.flatMap((region) => [
    ...region.villages,
    ...region.subregions.flatMap((subregion) => subregion.villages)
  ]);

  assert.ok(atlas.regions.length > 0);
  assert.equal(atlas.places.length, hierarchyPlaces.length);
  assert.ok(atlas.regions.every((region) => region.names.en && region.names.el));
  assert.ok(atlas.places.every((place) => place.names.en && place.names.el));
  assert.ok(atlas.places.every((place) => typeof place.info.en === "string"));
  assert.ok(atlas.places.every((place) => typeof place.info.el === "string"));
  assert.equal(new Set(atlas.regions.map((region) => region.id)).size, atlas.regions.length);
  assert.equal(new Set(atlas.places.map((place) => place.id)).size, atlas.places.length);
  assert.doesNotMatch(source, /^(?:id|has_dance|kind|min_zoom|priority|order)=/mu);
});

test("HTML comments apply globally and can span multiple lines", () => {
  const atlas = parseDancesMarkdown(`
# Test Region <!-- source note -->
greek_name=Περιοχή <!-- translated name -->
color=#336699

<!--
This multi-line comment is ignored.
It preserves the source line count.
-->

## Test Village <!-- source note -->
greek_name=Χωριό
latitude=40
longitude=22

### info
Visit https://example.com/path//segment
Keep this <!-- remove the aside --> text.
<!-- Remove this entire line. -->
  `);

  assert.equal(atlas.regions[0].name, "Test Region");
  assert.equal(
    atlas.places[0].info.en,
    "Visit https://example.com/path//segment\nKeep this  text."
  );
  assert.equal(stripComments("value <!-- note -->"), "value ");
  assert.equal(stripComments("before\n<!-- note\non two lines -->\nafter"), "before\n\n\nafter");
});

test("unclosed HTML comments identify their starting line", () => {
  assert.throws(
    () => parseDancesMarkdown("# Region\n<!-- unfinished"),
    (error) => {
      assert.ok(error instanceof DancesMarkdownError);
      assert.equal(error.location, "dances.md, line 2");
      assert.equal(error.message, "This HTML comment is not closed with -->.");
      return true;
    }
  );
});

test("Markdown headings inside fenced info code remain content", () => {
  const atlas = parseDancesMarkdown(`
# Test Region
greek_name=Περιοχή
color=#336699

## Test Village
greek_name=Χωριό
latitude=40
longitude=22

### info
\`\`\`md
# This is not a region
## This is not a village
### info
\`\`\`

After the code.
  `);

  assert.equal(atlas.regions.length, 1);
  assert.equal(atlas.places.length, 1);
  assert.match(atlas.places[0].info.en, /^```md\n# This is not a region/mu);
  assert.match(atlas.places[0].info.en, /After the code\.$/u);
});

test("English and Greek info sections are parsed independently", () => {
  const atlas = parseDancesMarkdown(`
# Test Region
greek_name=Περιοχή
color=#336699

## Test Village
greek_name=Χωριό
latitude=40
longitude=22

### info
English **description**

### info_greek
Ελληνική **περιγραφή**
  `);

  assert.deepEqual(atlas.places[0].info, {
    en: "English **description**",
    el: "Ελληνική **περιγραφή**"
  });
});

test("duplicate localized info sections identify their line", () => {
  const source = `# Test Region
greek_name=Περιοχή
color=#336699
## Test Village
greek_name=Χωριό
latitude=40
longitude=22
### info_greek
Πρώτο
### info_greek
Δεύτερο`;

  assert.throws(
    () => parseDancesMarkdown(source),
    (error) => {
      assert.ok(error instanceof DancesMarkdownError);
      assert.equal(error.location, "dances.md, line 10");
      assert.equal(error.message, "A village can only have one info_greek section.");
      return true;
    }
  );
});

test("localized info headings inside fenced code remain content", () => {
  const atlas = parseDancesMarkdown(`
# Test Region
greek_name=Περιοχή
color=#336699
## Test Village
greek_name=Χωριό
latitude=40
longitude=22
### info
\`\`\`md
### info_greek
\`\`\`
Still English.
### info_greek
Ελληνικά.
  `);

  assert.match(atlas.places[0].info.en, /### info_greek/u);
  assert.match(atlas.places[0].info.en, /Still English\.$/u);
  assert.equal(atlas.places[0].info.el, "Ελληνικά.");
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
