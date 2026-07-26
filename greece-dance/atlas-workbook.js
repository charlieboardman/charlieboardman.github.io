export class AtlasWorkbookError extends Error {
  constructor(message, { sheet = "", row = null, column = "" } = {}) {
    super(message);
    this.name = "AtlasWorkbookError";
    this.sheet = sheet;
    this.row = row;
    this.column = column;
  }

  get location() {
    const parts = [];
    if (this.sheet) parts.push(this.sheet);
    if (this.row !== null) parts.push(`row ${this.row}`);
    if (this.column) parts.push(`column “${this.column}”`);
    return parts.join(", ");
  }
}

const PLACE_HEADERS = [
  "id", "latitude", "longitude", "name_en", "name_el", "has_dance",
  "region", "subregion", "info", "kind", "min_zoom", "priority"
];
const REGION_HEADERS = [
  "id", "name_en", "name_el", "color", "order"
];
const PLACE_KINDS = new Set(["city", "town", "village"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseAtlasWorkbook(workbook, XLSX) {
  if (!workbook || !XLSX?.utils?.sheet_to_json) {
    throw new AtlasWorkbookError("The spreadsheet reader was not loaded.");
  }

  const regionRows = readRows(workbook, XLSX, "Regions", REGION_HEADERS);
  const placeRows = readRows(workbook, XLSX, "Places", PLACE_HEADERS);
  const regionIds = new Set();
  const regionOrders = new Set();

  const regions = regionRows.map(({ values, row }) => {
    const id = requiredText(values.id, "Regions", row, "id");
    validateId(id, "Regions", row, "id");
    if (regionIds.has(id)) fail(`Duplicate region id “${id}”.`, "Regions", row, "id");
    regionIds.add(id);

    const order = requiredNumber(values.order, "Regions", row, "order");
    if (!Number.isInteger(order) || order < 1) {
      fail("order must be a positive whole number.", "Regions", row, "order");
    }
    if (regionOrders.has(order)) fail(`Duplicate region order “${order}”.`, "Regions", row, "order");
    regionOrders.add(order);

    const names = parseNames(values, "Regions", row);
    const color = requiredText(values.color, "Regions", row, "color").toLowerCase();
    if (!/^#[0-9a-f]{6}$/u.test(color)) {
      fail("color must be a six-digit hex value such as #e5a83f.", "Regions", row, "color");
    }

    return {
      id,
      name: names.en || names.el,
      names,
      color,
      order,
      villages: [],
      subregions: [],
      _subregions: new Map()
    };
  }).sort((a, b) => a.order - b.order);

  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const placeIds = new Set();
  const places = placeRows.map(({ values, row }) => {
    const id = requiredText(values.id, "Places", row, "id");
    validateId(id, "Places", row, "id");
    if (placeIds.has(id)) fail(`Duplicate place id “${id}”.`, "Places", row, "id");
    placeIds.add(id);

    const lat = requiredNumber(values.latitude, "Places", row, "latitude");
    const lon = requiredNumber(values.longitude, "Places", row, "longitude");
    if (lat < -90 || lat > 90) fail("latitude must be between -90 and 90.", "Places", row, "latitude");
    if (lon < -180 || lon > 180) fail("longitude must be between -180 and 180.", "Places", row, "longitude");

    const names = parseNames(values, "Places", row);
    const hasDance = requiredBoolean(values.has_dance, "Places", row, "has_dance");
    const regionId = optionalText(values.region);
    const subregionName = optionalText(values.subregion);
    const info = optionalText(values.info, false);
    const kind = optionalText(values.kind).toLowerCase() || "village";
    if (!PLACE_KINDS.has(kind)) {
      fail("kind must be city, town, or village.", "Places", row, "kind");
    }
    const minZoom = optionalNumber(values.min_zoom, 8, "Places", row, "min_zoom");
    if (!Number.isInteger(minZoom) || minZoom < 5 || minZoom > 9) {
      fail("min_zoom must be a whole number from 5 through 9.", "Places", row, "min_zoom");
    }
    const priority = optionalNumber(values.priority, 600, "Places", row, "priority");

    if (hasDance && !regionId) {
      fail("region is required when has_dance is true.", "Places", row, "region");
    }
    if (hasDance && !regionsById.has(regionId)) {
      fail(`Unknown region id “${regionId}”. Add it to the Regions sheet first.`, "Places", row, "region");
    }
    const place = {
      id,
      lat,
      lon,
      kind,
      minZoom,
      priority,
      names,
      name: names.en || names.el,
      hasDance,
      regionId,
      subregionName,
      info
    };

    if (hasDance) addDancePlace(regionsById.get(regionId), place, row);
    return place;
  });

  for (const region of regions) delete region._subregions;
  return { regions, places };
}

function readRows(workbook, XLSX, sheetName, expectedHeaders) {
  const sheet = workbook.Sheets?.[sheetName];
  if (!sheet) {
    throw new AtlasWorkbookError(`Required sheet “${sheetName}” is missing.`, { sheet: sheetName });
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true
  });
  if (!matrix.length) {
    throw new AtlasWorkbookError("The sheet is empty.", { sheet: sheetName, row: 1 });
  }

  const headers = matrix[0].map((value) => String(value).trim().toLowerCase());
  const duplicate = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicate) fail(`Duplicate header “${duplicate}”.`, sheetName, 1, duplicate);

  const unknown = headers.find((header) => header && !expectedHeaders.includes(header));
  if (unknown) fail(`Unknown header “${unknown}”.`, sheetName, 1, unknown);

  for (const expected of expectedHeaders) {
    if (!headers.includes(expected)) fail(`Missing required header “${expected}”.`, sheetName, 1, expected);
  }

  return matrix.slice(1).flatMap((cells, index) => {
    if (!cells.some((value) => String(value ?? "").trim() !== "")) return [];
    const values = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""]));
    return [{ values, row: index + 2 }];
  });
}

function parseNames(values, sheet, row) {
  const names = {
    en: optionalText(values.name_en),
    el: optionalText(values.name_el)
  };
  if (!names.en && !names.el) {
    fail("At least one of name_en or name_el is required.", sheet, row, "name_en");
  }
  return names;
}

function addDancePlace(region, place, row) {
  const village = {
    id: place.id,
    name: place.name,
    names: place.names,
    coordinates: [place.lat, place.lon],
    info: place.info
  };
  if (!place.subregionName) {
    region.villages.push(village);
    return;
  }

  let subregion = region._subregions.get(place.subregionName);
  if (!subregion) {
    const id = slug(place.subregionName);
    if (region.subregions.some((item) => item.id === id)) {
      throw new AtlasWorkbookError(
        `Subregion “${place.subregionName}” produces the same id as another subregion in ${region.name}.`,
        { sheet: "Places", row, column: "subregion" }
      );
    }
    subregion = { id, name: place.subregionName, villages: [] };
    region._subregions.set(place.subregionName, subregion);
    region.subregions.push(subregion);
  }
  subregion.villages.push(village);
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "subregion";
}

function validateId(value, sheet, row, column) {
  if (!ID_PATTERN.test(value)) {
    fail("id must use lowercase letters, numbers, and single hyphens only.", sheet, row, column);
  }
}

function requiredText(value, sheet, row, column) {
  const result = optionalText(value);
  if (!result) fail("This cell is required.", sheet, row, column);
  return result;
}

function optionalText(value, trim = true) {
  const result = value === null || value === undefined ? "" : String(value);
  return trim ? result.trim() : result.replace(/\r\n?/gu, "\n").trim();
}

function requiredNumber(value, sheet, row, column) {
  if (String(value ?? "").trim() === "") fail("This cell is required.", sheet, row, column);
  const result = Number(value);
  if (!Number.isFinite(result)) fail("This cell must be a number.", sheet, row, column);
  return result;
}

function optionalNumber(value, fallback, sheet, row, column) {
  if (String(value ?? "").trim() === "") return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) fail("This cell must be a number.", sheet, row, column);
  return result;
}

function requiredBoolean(value, sheet, row, column) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true"].includes(normalized)) return true;
  if (["no", "n", "false"].includes(normalized)) return false;
  fail("Use TRUE/FALSE, yes/no, or 1/0.", sheet, row, column);
}

function fail(message, sheet, row, column) {
  throw new AtlasWorkbookError(message, { sheet, row, column });
}
