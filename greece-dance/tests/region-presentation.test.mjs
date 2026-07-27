import assert from "node:assert/strict";
import test from "node:test";
import { regionDisplayName, sortRegionsAlphabetically } from "../region-presentation.js";

test("regionDisplayName removes parenthetical notes", () => {
  assert.equal(
    regionDisplayName("Anatoliki Romelia (often called Northern Thrace near Burgas Bulgaria)"),
    "Anatoliki Romelia"
  );
  assert.equal(regionDisplayName("Pieria (Mt Olympus area)"), "Pieria");
});

test("sortRegionsAlphabetically orders regions by their displayed names", () => {
  const regions = [
    { id: "thrace", name: "Thrace (often called Western Thrace)" },
    { id: "asia-minor", name: "Asia Minor (coastal Turkey)" },
    { id: "anatoliki-romelia", name: "Anatoliki Romelia (Northern Thrace)" }
  ];

  assert.deepEqual(
    sortRegionsAlphabetically(regions).map((region) => region.id),
    ["anatoliki-romelia", "asia-minor", "thrace"]
  );
  assert.deepEqual(
    regions.map((region) => region.id),
    ["thrace", "asia-minor", "anatoliki-romelia"]
  );
});
