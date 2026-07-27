import assert from "node:assert/strict";
import test from "node:test";
import { localizedName, sortRegionsAlphabetically } from "../region-presentation.js";

test("localizedName uses the requested language with sensible fallbacks", () => {
  assert.equal(localizedName({ names: { en: "Thessaly", el: "Θεσσαλία" } }, "el"), "Θεσσαλία");
  assert.equal(localizedName({ names: { en: "Thessaly", el: "" } }, "el"), "Thessaly");
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
