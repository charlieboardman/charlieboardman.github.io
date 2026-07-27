export function localizedName(item, language) {
  return item.names?.[language] || item.names?.en || item.names?.el || item.name || "";
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
