import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "map-source", "data");
const outputRoot = path.join(root, "assets", "map");
const tileSize = 256;
const tilePixelRatio = 2;
const outputTileSize = tileSize * tilePixelRatio;
const bounds = { south: 34, west: 18, north: 43.5, east: 34.5 };
const zooms = [5, 6, 7, 8, 9];
const maxNativeZoom = Math.max(...zooms);

const [countries, admin1, lakes] = await Promise.all([
  loadJson("natural-earth-countries.geojson"),
  loadJson("natural-earth-admin1.geojson"),
  loadJson("natural-earth-lakes.geojson")
]);

const relevantCountries = countries.features.filter((feature) => intersects(featureBounds(feature), bounds));
const relevantAdmin1 = admin1.features.filter((feature) => intersects(featureBounds(feature), bounds));
const relevantLakes = lakes.features.filter((feature) => intersects(featureBounds(feature), bounds));
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const zoom of zooms) {
  const range = tileRange(bounds, zoom);
  const width = (range.maxX - range.minX + 1) * tileSize;
  const height = (range.maxY - range.minY + 1) * tileSize;
  const base = buildGeometrySvg(zoom, range);
  const renderWidth = width * tilePixelRatio;
  const renderHeight = height * tilePixelRatio;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#cfd9d5"/>
    ${base}
  </svg>`;

  const { data, info } = await sharp(Buffer.from(svg), { limitInputPixels: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== renderWidth || info.height !== renderHeight) {
    throw new Error(`Unexpected raster dimensions at z${zoom}: ${info.width}×${info.height}; expected ${renderWidth}×${renderHeight}.`);
  }

  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const tileDir = path.join(outputRoot, String(zoom), String(x));
      await mkdir(tileDir, { recursive: true });
      await sharp(data, { raw: info })
        .extract({
          left: (x - range.minX) * outputTileSize,
          top: (y - range.minY) * outputTileSize,
          width: outputTileSize,
          height: outputTileSize
        })
        .webp({ quality: 92, effort: 4, smartSubsample: true })
        .toFile(path.join(tileDir, `${y}.webp`));
    }
  }
  console.log(`Rendered geometry-only z${zoom} tiles (${range.maxX - range.minX + 1}×${range.maxY - range.minY + 1}).`);
}

await writeFile(path.join(outputRoot, "metadata.json"), `${JSON.stringify({
  bounds,
  minZoom: 5,
  maxNativeZoom,
  tileSize,
  tilePixelRatio,
  labels: "interactive browser overlay"
}, null, 2)}\n`);
console.log("Local geometry-only map tiles are ready.");

async function loadJson(name) {
  return JSON.parse(await readFile(path.join(sourceDir, name), "utf8"));
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const radians = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}

function project(lon, lat, zoom, range) {
  return [
    lonToTileX(lon, zoom) * tileSize - range.minX * tileSize,
    latToTileY(lat, zoom) * tileSize - range.minY * tileSize
  ];
}

function tileRange(area, zoom) {
  return {
    minX: Math.floor(lonToTileX(area.west, zoom)),
    maxX: Math.floor(lonToTileX(area.east - 1e-8, zoom)),
    minY: Math.floor(latToTileY(area.north, zoom)),
    maxY: Math.floor(latToTileY(area.south + 1e-8, zoom))
  };
}

function buildGeometrySvg(zoom, range) {
  const land = relevantCountries.map((feature) => geometryPath(feature.geometry, zoom, range, true)).join("");
  const borders = relevantCountries.map((feature) => geometryPath(feature.geometry, zoom, range, true)).join("");
  const internal = relevantAdmin1.map((feature) => geometryPath(feature.geometry, zoom, range, false)).join("");
  const lakePaths = relevantLakes.map((feature) => geometryPath(feature.geometry, zoom, range, true)).join("");
  return `
    <g fill="#edf2ec" fill-rule="evenodd"><path d="${land}"/></g>
    <g fill="none" stroke="#b7c5bd" stroke-width="${zoom >= 8 ? 0.8 : 0.65}" stroke-linejoin="round"><path d="${borders}"/></g>
    <g fill="none" stroke="#d0d9d2" stroke-width="0.55" stroke-linejoin="round"><path d="${internal}"/></g>
    <g fill="#cfd9d5" stroke="#c3d0ca" stroke-width="0.45"><path d="${lakePaths}"/></g>
  `;
}

function geometryPath(geometry, zoom, range, closeRings) {
  if (!geometry) return "";
  const paths = [];
  const addLine = (coordinates, shouldClose) => {
    let previous;
    let value = "";
    coordinates.forEach(([lon, lat], index) => {
      const [x, y] = project(lon, lat, zoom, range);
      if (index > 0 && index < coordinates.length - 1 && previous && Math.hypot(x - previous[0], y - previous[1]) < 0.28) return;
      value += `${value ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      previous = [x, y];
    });
    if (shouldClose) value += "Z";
    paths.push(value);
  };

  if (geometry.type === "Polygon") geometry.coordinates.forEach((ring) => addLine(ring, closeRings));
  if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => addLine(ring, closeRings)));
  if (geometry.type === "LineString") addLine(geometry.coordinates, false);
  if (geometry.type === "MultiLineString") geometry.coordinates.forEach((line) => addLine(line, false));
  return paths.join("");
}

function featureBounds(feature) {
  const values = [];
  visitCoordinates(feature.geometry?.coordinates, (coordinate) => values.push(coordinate));
  return values.reduce((result, [lon, lat]) => ({
    west: Math.min(result.west, lon), east: Math.max(result.east, lon),
    south: Math.min(result.south, lat), north: Math.max(result.north, lat)
  }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number") callback(value);
  else value.forEach((item) => visitCoordinates(item, callback));
}

function intersects(a, b) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}
