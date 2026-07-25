import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "map-source", "data");
const force = process.argv.includes("--force");
await mkdir(outputDir, { recursive: true });

// Clean up place data created by the former OSM/Overpass pipeline. Place labels
// now live exclusively in content/atlas.xlsx.
await Promise.all([
  rm(path.join(outputDir, "osm-places.json"), { force: true }),
  rm(path.join(outputDir, "overpass-cache"), { recursive: true, force: true })
]);

const files = [
  {
    name: "natural-earth-countries.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
  },
  {
    name: "natural-earth-admin1.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson"
  },
  {
    name: "natural-earth-lakes.geojson",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson"
  }
];

for (const file of files) await download(file);

const metadata = {
  generatedAt: new Date().toISOString(),
  bounds: { south: 34, west: 18, north: 43.5, east: 34.5 },
  naturalEarth: "https://www.naturalearthdata.com/",
  placeLabels: "content/atlas.xlsx"
};
await writeFile(path.join(outputDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

for (const file of files) JSON.parse(await readFile(path.join(outputDir, file.name), "utf8"));
console.log("Natural Earth map geometry is ready. Curated place labels come from content/atlas.xlsx.");

async function download({ name, url }) {
  const destination = path.join(outputDir, name);
  if (!force && await exists(destination)) {
    console.log(`Using cached ${name}.`);
    return;
  }
  const response = await fetch(url, { headers: { "User-Agent": "DanceAtlas/0.1" } });
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, destination);
  console.log(`Downloaded ${name} (${Math.round(body.length / 1024)} KB)`);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}
