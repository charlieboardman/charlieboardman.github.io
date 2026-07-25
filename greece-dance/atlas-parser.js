export class AtlasParseError extends Error {
  constructor(message, line, sourceLine = "") {
    super(message);
    this.name = "AtlasParseError";
    this.line = line;
    this.sourceLine = sourceLine;
  }
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/u;
const TYPED_HEADING = /^(Region|Subregion|Village)\s*:\s*(.+)$/iu;
const METADATA = /^([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(.*?)\s*$/u;
const FENCE = /^(`{3,}|~{3,})/u;

export function parseAtlas(source) {
  const lines = String(source).replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");
  const result = { version: null, regions: [] };
  const regionIds = new Set();
  let region = null;
  let subregion = null;
  let village = null;
  let fence = null;
  let fenceLine = null;

  const fail = (message, index, sourceLine = lines[index] || "") => {
    throw new AtlasParseError(message, index + 1, sourceLine);
  };

  const requireRegionMetadata = (item, index) => {
    if (!item.color) fail(`Region “${item.name}” is missing a color.`, item.headingLine - 1);
    if (!item.bounds) fail(`Region “${item.name}” is missing bounds.`, item.headingLine - 1);
  };

  const finishVillage = () => {
    if (!village) return;
    if (!village.coordinates) {
      fail(`Village “${village.name}” is missing coordinates.`, village.headingLine - 1);
    }
    while (village.infoLines.length && !village.infoLines[0].trim()) village.infoLines.shift();
    while (village.infoLines.length && !village.infoLines.at(-1).trim()) village.infoLines.pop();
    village.info = village.infoLines.join("\n");
    delete village.infoLines;
    delete village.headingLine;
    delete village.metadataOpen;
    village = null;
  };

  const parseNumbers = (value, count, label, index) => {
    const values = value.split(",").map((part) => Number(part.trim()));
    if (values.length !== count || values.some((number) => !Number.isFinite(number))) {
      fail(`${label} must contain ${count} comma-separated numbers.`, index);
    }
    return values;
  };

  const makeId = (name, label, index) => {
    const id = name
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    if (!id) fail(`${label} needs at least one letter or number in its name.`, index);
    return id;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const trimmed = original.trim();

    if (village) {
      const fenceMatch = trimmed.match(FENCE);
      if (fence) {
        village.infoLines.push(original);
        if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) {
          fence = null;
          fenceLine = null;
        }
        continue;
      }
      if (fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        fenceLine = index;
        village.infoLines.push(original);
        village.metadataOpen = false;
        continue;
      }
    }

    const headingMatch = trimmed.match(HEADING);
    if (headingMatch && headingMatch[1].length <= 3) {
      finishVillage();
      const level = headingMatch[1].length;
      const typedMatch = headingMatch[2].match(TYPED_HEADING);
      if (!typedMatch) {
        fail("Level 1–3 headings must say Region:, Subregion:, or Village:.", index);
      }

      const type = typedMatch[1].toLocaleLowerCase("en");
      const name = typedMatch[2].trim();
      if (!name) fail(`${typedMatch[1]} needs a name after the colon.`, index);

      if (level === 1) {
        if (type !== "region") fail("A level-1 heading must be a Region: heading.", index);
        if (result.version === null) fail("Add “atlas-version: 1” before the first region.", index);
        if (region) requireRegionMetadata(region, index);
        const id = makeId(name, "Region", index);
        if (regionIds.has(id)) fail(`Duplicate region ID “${id}”. Region names must be unique.`, index);
        regionIds.add(id);
        region = {
          id,
          name,
          color: null,
          bounds: null,
          villages: [],
          subregions: [],
          headingLine: index + 1,
          childIds: new Set()
        };
        result.regions.push(region);
        subregion = null;
        continue;
      }

      if (!region) fail("Add a Region: heading before subregions or villages.", index);
      requireRegionMetadata(region, index);

      if (level === 2 && type === "subregion") {
        const id = makeId(name, "Subregion", index);
        if (region.childIds.has(id)) fail(`Duplicate level-2 ID “${id}” in ${region.name}.`, index);
        region.childIds.add(id);
        subregion = { id, name, villages: [], childIds: new Set() };
        region.subregions.push(subregion);
        continue;
      }

      if (level === 2 && type === "village") {
        const idPart = makeId(name, "Village", index);
        if (region.childIds.has(idPart)) fail(`Duplicate level-2 ID “${idPart}” in ${region.name}.`, index);
        region.childIds.add(idPart);
        village = {
          id: `${region.id}/${idPart}`,
          name,
          coordinates: null,
          infoLines: [],
          headingLine: index + 1,
          metadataOpen: true
        };
        region.villages.push(village);
        subregion = null;
        continue;
      }

      if (level === 3 && type === "village") {
        if (!subregion) fail("A level-3 Village: must follow a level-2 Subregion:.", index);
        const idPart = makeId(name, "Village", index);
        if (subregion.childIds.has(idPart)) fail(`Duplicate village ID “${idPart}” in ${subregion.name}.`, index);
        subregion.childIds.add(idPart);
        village = {
          id: `${region.id}/${subregion.id}/${idPart}`,
          name,
          coordinates: null,
          infoLines: [],
          headingLine: index + 1,
          metadataOpen: true
        };
        subregion.villages.push(village);
        continue;
      }

      if (level === 2) fail("A level-2 heading must be Subregion: or Village:.", index);
      fail("A level-3 heading must be Village: inside a subregion.", index);
    }

    if (headingMatch && headingMatch[1].length >= 4) {
      if (!village) fail("Level 4–6 Markdown headings can only appear inside village text.", index);
      village.infoLines.push(original);
      village.metadataOpen = false;
      continue;
    }

    if (!trimmed) {
      if (village) village.infoLines.push(original);
      continue;
    }

    const metadataMatch = trimmed.match(METADATA);
    if (result.version === null) {
      if (!metadataMatch || metadataMatch[1].toLocaleLowerCase("en") !== "atlas-version") {
        fail("The first non-empty line must be “atlas-version: 1”.", index);
      }
      if (metadataMatch[2] !== "1") fail("Only atlas-version: 1 is supported.", index);
      result.version = 1;
      continue;
    }

    if (!region) fail("Content outside a region is not allowed.", index);

    if (!village) {
      if (!metadataMatch) fail(`Unexpected text in region “${region.name}”.`, index);
      const key = metadataMatch[1].toLocaleLowerCase("en");
      const value = metadataMatch[2];
      if (subregion) fail(`Unexpected metadata in subregion “${subregion.name}”. Add a Village: heading.`, index);
      if (key === "color") {
        if (region.color) fail(`Region “${region.name}” has more than one color.`, index);
        if (!/^#[0-9a-f]{6}$/iu.test(value)) fail("color must be a six-digit hex value such as #e5a83f.", index);
        region.color = value.toLocaleLowerCase("en");
        continue;
      }
      if (key === "bounds") {
        if (region.bounds) fail(`Region “${region.name}” has more than one bounds line.`, index);
        const [south, west, north, east] = parseNumbers(value, 4, "bounds", index);
        if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
          fail("bounds must be south, west, north, east with valid ranges and increasing edges.", index);
        }
        region.bounds = [[south, west], [north, east]];
        continue;
      }
      fail(`Unknown region setting “${metadataMatch[1]}”. Use color or bounds.`, index);
    }

    if (village.metadataOpen && !village.coordinates) {
      if (!metadataMatch || metadataMatch[1].toLocaleLowerCase("en") !== "coordinates") {
        fail(`Village “${village.name}” needs a coordinates line before its Markdown text.`, index);
      }
      const [north, east] = parseNumbers(metadataMatch[2], 2, "coordinates", index);
      if (north < -90 || north > 90 || east < -180 || east > 180) {
        fail("coordinates must be north, east within valid latitude and longitude ranges.", index);
      }
      village.coordinates = [north, east];
      continue;
    }

    village.metadataOpen = false;
    village.infoLines.push(original);
  }

  if (fence) fail("This fenced code block is never closed.", fenceLine);
  finishVillage();
  if (result.version === null) fail("The atlas is empty. Add “atlas-version: 1”.", 0, "");
  if (region) requireRegionMetadata(region, lines.length - 1);
  if (!result.regions.length) fail("Add at least one Region: heading.", lines.length - 1);

  for (const item of result.regions) {
    delete item.headingLine;
    delete item.childIds;
    for (const child of item.subregions) delete child.childIds;
  }
  return result;
}
