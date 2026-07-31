import assert from "node:assert/strict";
import test from "node:test";
import {
  expandedVillageBounds,
  localizedInfo,
  localizedName,
  sortRegionsAlphabetically
} from "../region-presentation.js";

test("localizedName uses the requested language with sensible fallbacks", () => {
  assert.equal(localizedName({ names: { en: "Thessaly", el: "Θεσσαλία" } }, "el"), "Θεσσαλία");
  assert.equal(localizedName({ names: { en: "Thessaly", el: "" } }, "el"), "Thessaly");
});

test("localizedInfo uses Greek when available and otherwise falls back to English", () => {
  assert.equal(
    localizedInfo({ info: { en: "English text", el: "Ελληνικό κείμενο" } }, "el"),
    "Ελληνικό κείμενο"
  );
  assert.equal(localizedInfo({ info: { en: "English text", el: "" } }, "el"), "English text");
});

test("expandedVillageBounds adds ten percent around the village extrema", () => {
  const villages = [
    { coordinates: [10, 2] },
    { coordinates: [3, 20] },
    { coordinates: [0, 5] },
    { coordinates: [4, 0] }
  ];

  assert.deepEqual(expandedVillageBounds(villages), [
    [-1, -0.5],
    [21, 10.5]
  ]);
  assert.equal(expandedVillageBounds([]), null);
});

test("sortRegionsAlphabetically orders regions in the displayed language", () => {
  const regions = [
    { id: "beta", names: { en: "Beta", el: "Άλφα" } },
    { id: "alpha", names: { en: "Alpha", el: "Βήτα" } }
  ];

  assert.deepEqual(
    sortRegionsAlphabetically(regions).map((region) => region.id),
    ["alpha", "beta"]
  );
  assert.deepEqual(
    sortRegionsAlphabetically(regions, "el").map((region) => region.id),
    ["beta", "alpha"]
  );
  assert.deepEqual(
    regions.map((region) => region.id),
    ["beta", "alpha"]
  );
});
