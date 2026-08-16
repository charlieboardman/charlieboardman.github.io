import test from "node:test";
import assert from "node:assert/strict";

import {
  boundaryLabelExpression,
  createMapStyle,
  MAP_OPTIONS
} from "../map-styles.js";

test("the map selector exposes the three intended choices", () => {
  assert.deepEqual(MAP_OPTIONS, [
    { id: "terrain", label: "Terrain" },
    { id: "land-sea", label: "Land & Sea" },
    { id: "boundaries", label: "Boundaries" }
  ]);
});

test("terrain uses the range-addressable SRTM archive", () => {
  const style = createMapStyle("terrain", { terrainUrl: "https://example.test/terrain.pmtiles" });

  assert.equal(style.sources["srtm-relief"].url, "pmtiles://https://example.test/terrain.pmtiles");
  assert.equal(style.layers[1].source, "srtm-relief");
});

test("land and sea creates one image source and raster layer per segment", () => {
  const segments = [
    { id: "west", url: "west.webp", coordinates: [[1, 2], [3, 2], [3, 0], [1, 0]] },
    { id: "east", url: "east.webp", coordinates: [[3, 2], [5, 2], [5, 0], [3, 0]] }
  ];
  const style = createMapStyle("land-sea", { landSeaSegments: segments });

  assert.deepEqual(Object.keys(style.sources), ["etopo-west", "etopo-east"]);
  assert.deepEqual(style.layers.slice(1).map((layer) => layer.source), ["etopo-west", "etopo-east"]);
});

test("boundaries uses localized OpenStreetMap labels", () => {
  const style = createMapStyle("boundaries", { language: "el" });
  const labels = style.layers.find((layer) => layer.id === "country-labels");

  assert.deepEqual(labels.layout["text-field"], boundaryLabelExpression("el"));
  assert.deepEqual(labels.layout["text-field"], ["coalesce", ["get", "name_el"], ["get", "name"]]);
  assert.match(style.sources.shortbread.tiles[0], /vector\.openstreetmap\.org/u);
});

test("unknown map choices are rejected", () => {
  assert.throws(() => createMapStyle("satellite"), /Unknown map style/u);
});
