export function localizedName(item, language) {
  return item.names?.[language] || item.names?.en || item.names?.el || item.name || "";
}

export function localizedInfo(item, language) {
  if (typeof item.info === "string") return item.info;
  return item.info?.[language] || item.info?.en || item.info?.el || "";
}

export function expandedVillageBounds(villages, scale = 1.1) {
  if (!villages.length) return null;

  const latitudes = villages.map((village) => village.coordinates[0]);
  const longitudes = villages.map((village) => village.coordinates[1]);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const centerLatitude = (south + north) / 2;
  const centerLongitude = (west + east) / 2;

  return [
    [
      centerLongitude + (west - centerLongitude) * scale,
      centerLatitude + (south - centerLatitude) * scale
    ],
    [
      centerLongitude + (east - centerLongitude) * scale,
      centerLatitude + (north - centerLatitude) * scale
    ]
  ];
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
