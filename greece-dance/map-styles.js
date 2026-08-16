export const MAP_OPTIONS = [
  { id: "terrain", label: "Terrain" },
  { id: "land-sea", label: "Land & Sea" },
  { id: "boundaries", label: "Boundaries" }
];

export function boundaryLabelExpression(language) {
  return ["coalesce", ["get", `name_${language}`], ["get", "name"]];
}

export function createMapStyle(id, {
  language = "en",
  terrainUrl,
  landSeaSegments = [],
  bounds = { south: 34, west: 12, north: 44, east: 38 }
} = {}) {
  if (id === "terrain") {
    return {
      version: 8,
      sources: {
        "srtm-relief": {
          type: "raster",
          url: `pmtiles://${terrainUrl}`,
          tileSize: 256
        }
      },
      layers: [
        backgroundLayer("#b4d8e9"),
        {
          id: "srtm-relief",
          type: "raster",
          source: "srtm-relief",
          paint: { "raster-resampling": "linear" }
        }
      ]
    };
  }

  if (id === "land-sea") {
    return {
      version: 8,
      sources: Object.fromEntries(landSeaSegments.map((segment) => [
        `etopo-${segment.id}`,
        {
          type: "image",
          url: segment.url,
          coordinates: segment.coordinates
        }
      ])),
      layers: [
        backgroundLayer("#b4d8e9"),
        ...landSeaSegments.map((segment) => ({
          id: `etopo-${segment.id}`,
          type: "raster",
          source: `etopo-${segment.id}`,
          paint: { "raster-resampling": "linear" }
        }))
      ]
    };
  }

  if (id === "boundaries") {
    return {
      version: 8,
      glyphs: "https://vector.openstreetmap.org/styles/shortbread/fonts/{fontstack}/{range}.pbf",
      sources: {
        shortbread: {
          type: "vector",
          tiles: ["https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt"],
          minzoom: 0,
          maxzoom: 14,
          bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
          attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>'
        }
      },
      layers: [
        backgroundLayer("#d6e7cf", "land-background"),
        {
          id: "ocean",
          type: "fill",
          source: "shortbread",
          "source-layer": "ocean",
          paint: { "fill-color": "#b9d7e8" }
        },
        {
          id: "inland-water",
          type: "fill",
          source: "shortbread",
          "source-layer": "water_polygons",
          paint: {
            "fill-color": "#b9d7e8",
            "fill-outline-color": "#a8c8da"
          }
        },
        {
          id: "internal-boundaries",
          type: "line",
          source: "shortbread",
          "source-layer": "boundaries",
          filter: [
            "all",
            [">", ["to-number", ["get", "admin_level"]], 2],
            ["!=", ["get", "maritime"], true]
          ],
          paint: {
            "line-color": "#d0d9d2",
            "line-width": 0.7
          }
        },
        {
          id: "country-boundaries",
          type: "line",
          source: "shortbread",
          "source-layer": "boundaries",
          filter: [
            "all",
            ["<=", ["to-number", ["get", "admin_level"]], 2],
            ["!=", ["get", "maritime"], true]
          ],
          paint: {
            "line-color": "#b7c5bd",
            "line-width": 1
          }
        },
        {
          id: "country-labels",
          type: "symbol",
          source: "shortbread",
          "source-layer": "boundary_labels",
          filter: ["==", ["to-number", ["get", "admin_level"]], 2],
          layout: {
            "text-field": boundaryLabelExpression(language),
            "text-font": ["noto_sans_regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5, 10,
              8, 13
            ],
            "text-letter-spacing": 0.12,
            "text-transform": "uppercase",
            "text-max-width": 10,
            "text-padding": 4
          },
          paint: {
            "text-color": "#7c8982",
            "text-halo-color": "rgba(214, 231, 207, 0.85)",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.5
          }
        }
      ]
    };
  }

  throw new Error(`Unknown map style “${id}”.`);
}

function backgroundLayer(color, id = "basemap-background") {
  return {
    id,
    type: "background",
    paint: { "background-color": color }
  };
}
