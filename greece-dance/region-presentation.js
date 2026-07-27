const regionCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base"
});

export function regionDisplayName(regionName) {
  return String(regionName)
    .replace(/\s*\([^)]*\)/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function sortRegionsAlphabetically(regions) {
  return [...regions].sort((first, second) =>
    regionCollator.compare(regionDisplayName(first.name), regionDisplayName(second.name))
    || regionCollator.compare(first.id, second.id)
  );
}
