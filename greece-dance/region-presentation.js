export function localizedName(item, language) {
  return item.names?.[language] || item.names?.en || item.names?.el || item.name || "";
}

export function localizedInfo(item, language) {
  if (typeof item.info === "string") return item.info;
  return item.info?.[language] || item.info?.en || item.info?.el || "";
}

export function sortRegionsAlphabetically(regions, language = "en") {
  const collator = new Intl.Collator(language, {
    numeric: true,
    sensitivity: "base"
  });
  return [...regions].sort((first, second) =>
    collator.compare(localizedName(first, language), localizedName(second, language))
    || collator.compare(first.id, second.id)
  );
}
