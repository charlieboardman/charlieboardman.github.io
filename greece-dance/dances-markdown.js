export class DancesMarkdownError extends Error {
  constructor(message, { line = null, field = "" } = {}) {
    super(message);
    this.name = "DancesMarkdownError";
    this.line = line;
    this.field = field;
  }

  get location() {
    const parts = ["dances.md"];
    if (this.line !== null) parts.push(`line ${this.line}`);
    if (this.field) parts.push(`field “${this.field}”`);
    return parts.join(", ");
  }
}

const REGION_FIELDS = new Set(["greek_name", "color"]);
const VILLAGE_FIELDS = new Set([
  "greek_name", "latitude", "longitude", "subregion", "subregion_greek_name"
]);

export function parseDancesMarkdown(source) {
  if (typeof source !== "string") {
    throw new DancesMarkdownError("The dances content must be text.");
  }

  const normalizedSource = source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const lines = stripComments(normalizedSource).split("\n");
  const regions = [];
  const places = [];
  const regionIds = new Set();
  const placeIds = new Set();
  let currentRegion = null;
  let currentVillage = null;
  let currentInfoLanguage = null;
  let infoFence = null;

  const finishVillage = () => {
    if (!currentVillage) return;
    const greekName = requiredField(currentVillage, "greek_name");
    const latitude = coordinateField(currentVillage, "latitude", -90, 90);
    const longitude = coordinateField(currentVillage, "longitude", -180, 180);
    const subregion = optionalField(currentVillage, "subregion");
    const subregionGreekName = optionalField(currentVillage, "subregion_greek_name");
    if (Boolean(subregion) !== Boolean(subregionGreekName)) {
      const missing = subregion ? "subregion_greek_name" : "subregion";
      fail(`${missing} is required when its companion subregion field is present.`, currentVillage.line, missing);
    }

    const idParts = [currentRegion.id];
    if (subregion) idParts.push(slug(subregion));
    idParts.push(slug(currentVillage.name));
    const id = idParts.join("--");
    if (placeIds.has(id)) {
      fail(`Another village produces the same generated key “${id}”.`, currentVillage.line);
    }
    placeIds.add(id);

    const village = {
      id,
      name: currentVillage.name,
      names: { en: currentVillage.name, el: greekName },
      coordinates: [latitude, longitude],
      info: {
        en: currentVillage.infoLines.en.join("\n").trim(),
        el: currentVillage.infoLines.el.join("\n").trim()
      }
    };

    if (subregion) {
      let group = currentRegion._subregions.get(subregion);
      if (!group) {
        const subregionId = slug(subregion);
        if (currentRegion.subregions.some((item) => item.id === subregionId)) {
          fail(
            `Subregion “${subregion}” produces the same generated key as another subregion in ${currentRegion.name}.`,
            currentVillage.line,
            "subregion"
          );
        }
        group = {
          id: subregionId,
          name: subregion,
          names: { en: subregion, el: subregionGreekName },
          villages: []
        };
        currentRegion._subregions.set(subregion, group);
        currentRegion.subregions.push(group);
      } else if (group.names.el !== subregionGreekName) {
        fail(
          `Use the same subregion_greek_name for every village in “${subregion}”.`,
          fieldLine(currentVillage, "subregion_greek_name"),
          "subregion_greek_name"
        );
      }
      group.villages.push(village);
    } else {
      currentRegion.villages.push(village);
    }

    places.push({
      ...village,
      lat: latitude,
      lon: longitude,
      regionId: currentRegion.id,
      subregionName: subregion,
      subregionNames: subregion
        ? { en: subregion, el: subregionGreekName }
        : { en: "", el: "" }
    });
    currentVillage = null;
    currentInfoLanguage = null;
    infoFence = null;
  };

  const finishRegion = () => {
    finishVillage();
    if (!currentRegion) return;
    currentRegion.names.el = requiredField(currentRegion, "greek_name");
    currentRegion.color = requiredField(currentRegion, "color").toLowerCase();
    if (!/^#[0-9a-f]{6}$/u.test(currentRegion.color)) {
      fail(
        "color must be a six-digit hex value such as #e5a83f.",
        fieldLine(currentRegion, "color"),
        "color"
      );
    }
    delete currentRegion._fields;
    delete currentRegion._subregions;
    delete currentRegion.line;
    currentRegion = null;
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine;
    if (currentInfoLanguage) {
      if (infoFence) {
        currentVillage.infoLines[currentInfoLanguage].push(line);
        const closingFence = /^\s{0,3}(`{3,}|~{3,})\s*$/u.exec(line);
        if (
          closingFence
          && closingFence[1][0] === infoFence.character
          && closingFence[1].length >= infoFence.length
        ) {
          infoFence = null;
        }
        return;
      }

      const openingFence = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (openingFence) {
        infoFence = {
          character: openingFence[1][0],
          length: openingFence[1].length
        };
        currentVillage.infoLines[currentInfoLanguage].push(line);
        return;
      }
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);

    if (heading?.[1] === "#") {
      finishRegion();
      const name = heading[2].trim();
      const id = slug(name);
      if (regionIds.has(id)) {
        fail(`Another region produces the same generated key “${id}”.`, lineNumber);
      }
      regionIds.add(id);
      currentRegion = {
        id,
        name,
        names: { en: name, el: "" },
        color: "",
        villages: [],
        subregions: [],
        _fields: new Map(),
        _subregions: new Map(),
        line: lineNumber
      };
      regions.push(currentRegion);
      return;
    }

    if (heading?.[1] === "##") {
      if (!currentRegion) fail("A village must appear beneath a region heading.", lineNumber);
      finishVillage();
      currentVillage = {
        name: heading[2].trim(),
        line: lineNumber,
        _fields: new Map(),
        _infoSections: new Map(),
        infoLines: { en: [], el: [] }
      };
      return;
    }

    const infoHeading = heading?.[1] === "###"
      ? { info: "en", info_greek: "el" }[heading[2].trim().toLowerCase()]
      : null;
    if (infoHeading) {
      if (!currentVillage) fail("An info section must appear beneath a village heading.", lineNumber);
      const sectionName = infoHeading === "en" ? "info" : "info_greek";
      if (currentVillage._infoSections.has(infoHeading)) {
        fail(`A village can only have one ${sectionName} section.`, lineNumber);
      }
      currentVillage._infoSections.set(infoHeading, lineNumber);
      currentInfoLanguage = infoHeading;
      infoFence = null;
      return;
    }

    if (currentInfoLanguage) {
      currentVillage.infoLines[currentInfoLanguage].push(line);
      return;
    }

    if (!line.trim()) return;
    if (heading) {
      fail(
        "Only region (#), village (##), info (### info), and Greek info (### info_greek) headings are allowed here.",
        lineNumber
      );
    }

    const property = /^([a-z_]+)\s*=(.*)$/u.exec(line);
    if (!property) {
      fail("Expected a heading, a key=value field, or an HTML comment.", lineNumber);
    }
    const [, key, rawValue] = property;
    const record = currentVillage || currentRegion;
    if (!record) fail("Fields must appear beneath a region or village heading.", lineNumber, key);
    const allowedFields = currentVillage ? VILLAGE_FIELDS : REGION_FIELDS;
    if (!allowedFields.has(key)) {
      fail(`Unknown ${currentVillage ? "village" : "region"} field “${key}”.`, lineNumber, key);
    }
    if (record._fields.has(key)) fail(`Duplicate field “${key}”.`, lineNumber, key);
    record._fields.set(key, { value: rawValue.trim(), line: lineNumber });
  });

  finishRegion();
  if (!regions.length) throw new DancesMarkdownError("Add at least one region heading.");
  return { regions, places };
}

export function stripComments(source) {
  let result = "";
  let inComment = false;
  let commentLine = null;
  let line = 1;

  for (let index = 0; index < source.length;) {
    if (!inComment && source.startsWith("<!--", index)) {
      inComment = true;
      commentLine = line;
      index += 4;
      continue;
    }
    if (inComment && source.startsWith("-->", index)) {
      inComment = false;
      commentLine = null;
      index += 3;
      continue;
    }

    const character = source[index];
    if (character === "\n") {
      result += "\n";
      line += 1;
    } else if (!inComment) {
      result += character;
    }
    index += 1;
  }

  if (inComment) fail("This HTML comment is not closed with -->.", commentLine);
  return result;
}

function requiredField(record, key) {
  const value = optionalField(record, key);
  if (!value) fail("This field is required.", record.line, key);
  return value;
}

function optionalField(record, key) {
  return record._fields.get(key)?.value || "";
}

function fieldLine(record, key) {
  return record._fields.get(key)?.line || record.line;
}

function coordinateField(record, key, minimum, maximum) {
  const value = requiredField(record, key);
  const number = Number(value);
  if (!Number.isFinite(number)) fail("This field must be a number.", fieldLine(record, key), key);
  if (number < minimum || number > maximum) {
    fail(`${key} must be between ${minimum} and ${maximum}.`, fieldLine(record, key), key);
  }
  return number;
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "item";
}

function fail(message, line, field = "") {
  throw new DancesMarkdownError(message, { line, field });
}
