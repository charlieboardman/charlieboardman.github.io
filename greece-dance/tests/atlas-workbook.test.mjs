import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";
import { AtlasWorkbookError, parseAtlasWorkbook } from "../atlas-workbook.js";

test("the canonical workbook contains the migrated client hierarchy", async () => {
  const workbook = XLSX.read(await readFile(new URL("../content/atlas.xlsx", import.meta.url)), { type: "buffer" });
  const atlas = parseAtlasWorkbook(workbook, XLSX);

  assert.equal(atlas.regions.length, 24);
  assert.equal(atlas.places.length, 42);
  assert.equal(atlas.places.filter((place) => place.hasDance).length, 42);
  assert.ok(atlas.places.every((place) => place.names.el));

  const thessaly = atlas.regions.find((region) => region.id === "thessaly");
  assert.deepEqual(thessaly.villages.map((village) => village.name), ["Sofades"]);
  assert.deepEqual(thessaly.subregions.map((subregion) => subregion.name), ["Agrafa"]);
  assert.deepEqual(
    thessaly.subregions[0].villages.map((village) => village.name),
    ["Argithea", "Krioneri", "Thrapsimi"]
  );
});

test("has_dance false keeps a map label out of the interactive hierarchy", () => {
  const workbook = makeWorkbook([
    {
      id: "dance-place", latitude: 40, longitude: 22, name_en: "Dance Place",
      name_el: "", has_dance: true, region: "test-region", subregion: "",
      info: "Some **Markdown**.", kind: "village", min_zoom: 8, priority: 600
    },
    {
      id: "map-only", latitude: 41, longitude: 23, name_en: "Map Only",
      name_el: "", has_dance: false, region: "test-region", subregion: "Map Notes",
      info: "", kind: "town", min_zoom: 7, priority: 700
    }
  ]);
  const atlas = parseAtlasWorkbook(workbook, XLSX);

  assert.equal(atlas.places.length, 2);
  assert.equal(atlas.regions[0].villages.length, 1);
  assert.equal(atlas.regions[0].villages[0].id, "dance-place");
  assert.equal(atlas.places.find((place) => place.id === "map-only").hasDance, false);
});

test("validation errors identify the sheet, row, and column", () => {
  const workbook = makeWorkbook([
    {
      id: "broken-place", latitude: "", longitude: 22, name_en: "Broken Place",
      name_el: "", has_dance: true, region: "test-region", subregion: "",
      info: "", kind: "village", min_zoom: 8, priority: 600
    }
  ]);

  assert.throws(
    () => parseAtlasWorkbook(workbook, XLSX),
    (error) => {
      assert.ok(error instanceof AtlasWorkbookError);
      assert.equal(error.location, "Places, row 2, column “latitude”");
      assert.equal(error.message, "This cell is required.");
      return true;
    }
  );
});

function makeWorkbook(places) {
  const workbook = XLSX.utils.book_new();
  const placeHeaders = [
    "id", "latitude", "longitude", "name_en", "name_el", "has_dance",
    "region", "subregion", "info", "kind", "min_zoom", "priority"
  ];
  const regionHeaders = [
    "id", "name_en", "name_el", "color", "south", "west", "north", "east", "order"
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(places, { header: placeHeaders }),
    "Places"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{
      id: "test-region", name_en: "Test Region", name_el: "", color: "#336699",
      south: 35, west: 20, north: 42, east: 28, order: 1
    }], { header: regionHeaders }),
    "Regions"
  );
  return workbook;
}
