import { DancesMarkdownError, parseDancesMarkdown } from "./dances-markdown.js";
import {
  expandedVillageBounds,
  localizedInfo,
  localizedName,
  sortRegionsAlphabetically
} from "./region-presentation.js";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl
} from "./vendor/maplibre-gl.mjs";

setWorkerUrl(new URL("./vendor/maplibre-gl-worker.mjs", import.meta.url).href);

(async () => {
  let regions = [];
  let contentError = null;
  try {
    if (!window.marked?.parse) throw new Error("The bundled Markdown reader could not be loaded.");
    if (!window.DOMPurify?.sanitize) throw new Error("The bundled HTML sanitizer could not be loaded.");
    const dancesUrl = new URL("./content/dances.md", import.meta.url);
    const response = await fetch(dancesUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load content/dances.md (HTTP ${response.status}).`);
    regions = sortRegionsAlphabetically(parseDancesMarkdown(await response.text()).regions);
  } catch (error) {
    contentError = error;
    console.error("Atlas content error:", error);
  }

  const markdownRenderer = window.marked?.Renderer ? new window.marked.Renderer() : null;
  if (markdownRenderer) {
    markdownRenderer.html = ({ text }) => escapeHtml(text);
    markdownRenderer.image = ({ text }) => escapeHtml(text);
  }

  const renderMarkdown = (source) => window.DOMPurify.sanitize(
    window.marked.parse(source, {
      async: false,
      renderer: markdownRenderer
    })
  );

  const villages = regions.flatMap((region) => [
    ...(region.villages || []).map((village) => ({
      ...village,
      regionId: region.id,
      regionNames: region.names,
      regionColor: region.color,
      subregionId: null,
      subregionNames: { en: "", el: "" }
    })),
    ...(region.subregions || []).flatMap((subregion) =>
      (subregion.villages || []).map((village) => ({
        ...village,
        regionId: region.id,
        regionNames: region.names,
        regionColor: region.color,
        subregionId: subregion.id,
        subregionNames: subregion.names
      }))
    )
  ]);
  const villageById = new Map(villages.map((village) => [village.id, village]));

  const els = {
    atlas: document.querySelector(".atlas"),
    villageList: document.querySelector("#village-list"),
    panelTitle: document.querySelector("#panel-title"),
    search: document.querySelector("#village-search"),
    deselectAll: document.querySelector("#deselect-all"),
    panelScroll: document.querySelector(".panel-scroll"),
    archive: document.querySelector("#archive-panel"),
    mobileArchive: document.querySelector("#mobile-archive-button"),
    desktopArchive: document.querySelector("#desktop-archive-toggle"),
    panelClose: document.querySelector("#panel-close"),
    homeButton: document.querySelector("#home-button"),
    languageOptions: document.querySelector("#language-options"),
    skipLink: document.querySelector(".skip-link")
  };

  document.querySelector("#mobile-count").textContent = String(villages.length).padStart(2, "0");

  const mapDataBounds = { south: 34, west: 18, north: 43.5, east: 35 };
  const navigationBounds = { south: 33, west: 16, north: 44, east: 38 };
  const homeViewBounds = expandedVillageBounds(villages);
  const compactMapView = window.matchMedia("(max-width: 720px)").matches;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const markerScaleMinZoom = compactMapView ? 5 : 5.6;
  const maxMapZoom = 11;
  const minimumMarkerDiameter = 9;
  const maximumMarkerDiameter = 18;
  const map = new MapLibreMap({
    container: "map",
    center: [26.1, 39.25],
    zoom: 6,
    minZoom: 0,
    maxZoom: maxMapZoom,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      glyphs: "https://vector.openstreetmap.org/styles/shortbread/fonts/{fontstack}/{range}.pbf",
      sources: {
        shortbread: {
          type: "vector",
          tiles: ["https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt"],
          minzoom: 0,
          maxzoom: 14,
          bounds: [mapDataBounds.west, mapDataBounds.south, mapDataBounds.east, mapDataBounds.north],
          attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>'
        }
      },
      layers: [
        {
          id: "land-background",
          type: "background",
          paint: { "background-color": "#edf2ec" }
        },
        {
          id: "ocean",
          type: "fill",
          source: "shortbread",
          "source-layer": "ocean",
          paint: { "fill-color": "#cfd9d5" }
        },
        {
          id: "inland-water",
          type: "fill",
          source: "shortbread",
          "source-layer": "water_polygons",
          paint: {
            "fill-color": "#cfd9d5",
            "fill-outline-color": "#c3d0ca"
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
            "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
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
            "text-halo-color": "rgba(237, 242, 236, 0.85)",
            "text-halo-width": 1.5,
            "text-halo-blur": 0.5
          }
        }
      ]
    }
  });
  map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new AttributionControl({
    compact: false,
    customAttribution: "Village data dances.md"
  }), "bottom-right");
  map.on("error", (event) => console.error("Basemap error:", event.error));

  const supportedLanguages = ["en", "el"];
  const interfaceLabels = {
    deselectAll: { en: "Deselect all", el: "Αποεπιλογή όλων" },
    region: { en: "Region", el: "Περιοχή" },
    subregion: { en: "Subregion", el: "Υποπεριοχή" },
    village: { en: "Village", el: "Χωριό" }
  };
  let mapLanguage = "en";
  try {
    const savedLanguage = localStorage.getItem("dance-atlas-language");
    if (supportedLanguages.includes(savedLanguage)) mapLanguage = savedLanguage;
  } catch {}

  function setMapLanguage(language) {
    if (!supportedLanguages.includes(language)) return;
    mapLanguage = language;
    regions = sortRegionsAlphabetically(regions, language);
    els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.language === language);
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
    els.deselectAll.textContent = interfaceLabel("deselectAll");
    els.deselectAll.lang = language;
    markerById.forEach((marker, villageId) => {
      const village = villageById.get(villageId);
      const label = villageLabel(village);
      const element = marker.getElement();
      const labelElement = element?.querySelector(".village-map-label");
      if (labelElement) {
        labelElement.textContent = label;
        labelElement.lang = language;
      }
      if (element) {
        element.title = label;
        element.setAttribute("aria-label", label);
      }
    });
    if (hasRenderedAtlas) {
      renderVillages(els.search.value);
    }
    scheduleMapLabelLayout();
    try { localStorage.setItem("dance-atlas-language", language); } catch {}
  }

  els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
    button.addEventListener("click", () => setMapLanguage(button.dataset.language));
  });

  const markerById = new Map();
  const expandedRegions = new Set();
  const expandedSubregions = new Set();
  const expandedVillages = new Set();
  const highlightedVillages = new Set();
  const mapOpenedRegions = new Map();
  const mapOpenedSubregions = new Map();
  const mapOpenedVillages = new Map();
  let hoveredTreeFolder = null;
  let hasRenderedAtlas = false;

  function markerDiameterAtZoom(zoom) {
    const progress = Math.max(
      0,
      Math.min(1, (zoom - markerScaleMinZoom) / (maxMapZoom - markerScaleMinZoom))
    );
    return minimumMarkerDiameter + (maximumMarkerDiameter - minimumMarkerDiameter) * progress;
  }

  function updateMarkerScale() {
    const diameter = markerDiameterAtZoom(map.getZoom());
    const scale = diameter / maximumMarkerDiameter;
    markerById.forEach((marker) => {
      marker.getElement()?.querySelector(".village-marker-scale")?.style.setProperty("--marker-scale", scale.toFixed(4));
    });
    scheduleMapLabelLayout();
  }

  function villageLabel(village) {
    return localizedName(village, mapLanguage);
  }

  function regionLabel(region) {
    return localizedName(region, mapLanguage);
  }

  function subregionLabel(subregion) {
    return localizedName(subregion, mapLanguage);
  }

  function interfaceLabel(key) {
    return interfaceLabels[key]?.[mapLanguage] || interfaceLabels[key]?.en || "";
  }

  let labelLayoutFrame = null;
  function scheduleMapLabelLayout() {
    if (labelLayoutFrame !== null) cancelAnimationFrame(labelLayoutFrame);
    labelLayoutFrame = requestAnimationFrame(() => {
      labelLayoutFrame = requestAnimationFrame(() => {
        labelLayoutFrame = null;
        updateMapLabelLayout();
      });
    });
  }

  function updateMapLabelLayout() {
    const items = [...markerById.values()].flatMap((marker) => {
      const element = marker.getElement();
      const label = element?.querySelector(".village-map-label");
      const dot = element?.querySelector(".village-marker");
      return label && dot ? [{
        element: label,
        label: label.getBoundingClientRect(),
        dot: dot.getBoundingClientRect()
      }] : [];
    });
    const padding = 2;
    items.forEach((item, index) => {
      const collisionFree = items.every((other, otherIndex) =>
        index === otherIndex
        || (
          !rectanglesOverlap(item.label, other.label, padding)
          && !rectanglesOverlap(item.label, other.dot, padding)
        )
      );
      item.element.classList.toggle("is-collision-free", collisionFree);
    });
  }

  function rectanglesOverlap(first, second, padding = 0) {
    return !(
      first.right + padding <= second.left
      || first.left >= second.right + padding
      || first.bottom + padding <= second.top
      || first.top >= second.bottom + padding
    );
  }

  const initialMarkerDiameter = markerDiameterAtZoom(map.getZoom());
  const initialMarkerScale = initialMarkerDiameter / maximumMarkerDiameter;
  villages.forEach((village) => {
    const label = villageLabel(village);
    const markerElement = document.createElement("button");
    markerElement.type = "button";
    markerElement.className = "village-icon";
    markerElement.title = label;
    markerElement.setAttribute("aria-label", label);

    const shell = document.createElement("span");
    shell.className = "village-marker-shell";
    const scale = document.createElement("span");
    scale.className = "village-marker-scale";
    scale.style.setProperty("--marker-scale", initialMarkerScale.toFixed(4));
    const dot = document.createElement("span");
    dot.className = "village-marker";
    dot.dataset.village = village.id;
    dot.style.setProperty("--marker-color", village.regionColor);
    const labelElement = document.createElement("span");
    labelElement.className = "village-map-label";
    labelElement.lang = mapLanguage;
    labelElement.textContent = label;
    scale.append(dot);
    shell.append(scale, labelElement);
    markerElement.append(shell);

    const marker = new Marker({ element: markerElement, anchor: "center" })
      .setLngLat(villageLngLat(village))
      .addTo(map);
    markerElement.addEventListener("click", () => selectVillage(village.id));
    markerElement.addEventListener("mouseenter", () => {
      setMarkerHoverSuppressed(village.id, false);
      setMarkerState(village.id, true);
    });
    markerElement.addEventListener("mouseleave", () => {
      setMarkerHoverSuppressed(village.id, false);
      setMarkerState(village.id, isVillageHighlightedAndVisible(village.id));
    });
    markerById.set(village.id, marker);
  });
  setMapLanguage(mapLanguage);
  map.on("zoomend", updateMarkerScale);
  map.on("moveend resize", scheduleMapLabelLayout);
  scheduleMapLabelLayout();

  let hasFitInitialMapView = false;
  function fitHomeView() {
    if (!homeViewBounds) return;
    map.setMaxBounds(null);
    map.setMinZoom(0);
    map.fitBounds(homeViewBounds, {
      padding: 0,
      maxZoom: maxMapZoom,
      duration: 0,
      retainPadding: false
    });
    const fittedBounds = map.getBounds();
    map.setMinZoom(map.getZoom());
    map.setMaxBounds([
      [
        Math.min(navigationBounds.west, fittedBounds.getWest()),
        Math.min(navigationBounds.south, fittedBounds.getSouth())
      ],
      [
        Math.max(navigationBounds.east, fittedBounds.getEast()),
        Math.max(navigationBounds.north, fittedBounds.getNorth())
      ]
    ]);
    updateMarkerScale();
  }

  function fitInitialMapView() {
    if (hasFitInitialMapView || !homeViewBounds) return;
    hasFitInitialMapView = true;
    fitHomeView();
  }

  function fitMapToVillages(targetVillages) {
    const bounds = expandedVillageBounds(targetVillages);
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: 0,
      maxZoom: maxMapZoom,
      duration: prefersReducedMotion ? 0 : 600,
      retainPadding: false
    });
  }

  function zoomToTreeItem(button) {
    const regionId = button.dataset.region;
    const subregionId = button.dataset.subregion;
    const villageId = button.dataset.village;
    const targetVillages = villages.filter((village) => {
      if (villageId) return village.id === villageId;
      if (subregionId) {
        return village.regionId === regionId && village.subregionId === subregionId;
      }
      return village.regionId === regionId;
    });
    fitMapToVillages(targetVillages);
  }

  function villageLngLat(village) {
    return [village.coordinates[1], village.coordinates[0]];
  }

  function showContentError(error) {
    const isDancesError = error instanceof DancesMarkdownError;
    const location = isDancesError && error.location ? `${error.location}: ` : "";
    els.panelTitle.textContent = "Atlas content error";
    els.panelTitle.hidden = false;
    els.archive.classList.add("has-panel-title");
    els.search.disabled = true;
    els.villageList.innerHTML = `
      <section class="content-error" role="alert">
        <p class="content-error-label">Could not read content/dances.md</p>
        <p><strong>${escapeHtml(location)}</strong>${escapeHtml(error.message || String(error))}</p>
        <p>Fix that line and reload this page. No build is required.</p>
      </section>
    `;
    document.querySelector("#mobile-count").textContent = "!";
    setArchiveOpen(true);
  }

  function renderVillages(query = "") {
    const normalized = query.trim().toLowerCase();
    const visibleRegions = regions
      .map((region) => filterRegion(region, normalized))
      .filter(Boolean);

    els.villageList.innerHTML = visibleRegions.length
      ? visibleRegions.map((region) => renderRegionTree(region, Boolean(normalized))).join("")
      : `<p class="empty-state">No village records match that search.</p>`;

    hoveredTreeFolder = null;
    updateTreeFolderMarkerColors();
    els.villageList.querySelectorAll(".tree-village").forEach((details) => {
      const id = details.dataset.village;
      const summary = details.querySelector(".tree-village-summary");
      details.addEventListener("toggle", () => syncVillageMarkerStates(details));
      summary.addEventListener("click", () => updateVillageCaretStateFromUser(details));
      summary.addEventListener("mouseenter", () => setMarkerState(id, true));
      summary.addEventListener("mouseleave", () => setMarkerState(id, isVillageHighlightedAndVisible(details)));
    });
    els.villageList.querySelectorAll(".tree-region").forEach((details) => {
      const summary = details.querySelector(":scope > .tree-region-summary");
      const folder = details.dataset.folder;
      details.addEventListener("toggle", () => syncVillageMarkerStates(details));
      summary.addEventListener("click", () => {
        updateCaretStateFromUser(details, expandedRegions, mapOpenedRegions, Boolean(normalized));
      });
      summary.addEventListener("mouseenter", () => setHoveredTreeFolder(folder));
      summary.addEventListener("mouseleave", () => clearHoveredTreeFolder(folder));
    });
    els.villageList.querySelectorAll(".tree-subregion").forEach((details) => {
      const summary = details.querySelector(":scope > .tree-subregion-summary");
      const folder = details.dataset.folder;
      details.addEventListener("toggle", () => syncVillageMarkerStates(details));
      summary.addEventListener("click", () => {
        updateCaretStateFromUser(details, expandedSubregions, mapOpenedSubregions, Boolean(normalized));
      });
      summary.addEventListener("mouseenter", () => setHoveredTreeFolder(folder));
      summary.addEventListener("mouseleave", () => clearHoveredTreeFolder(folder));
    });
    els.villageList.querySelectorAll(".tree-zoom").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        zoomToTreeItem(button);
      });
    });
    syncVillageMarkerStates(els.villageList);
  }

  function filterRegion(region, query) {
    const regionMatches = Boolean(query) && Object.values(region.names).some((name) =>
      name.toLowerCase().includes(query)
    );
    const regionVillages = villages.filter((village) =>
      village.regionId === region.id && !village.subregionId && (regionMatches || villageMatches(village, query))
    );
    const subregions = (region.subregions || []).map((subregion) => {
      const subregionMatches = regionMatches || (Boolean(query) && Object.values(subregion.names).some((name) =>
        name.toLowerCase().includes(query)
      ));
      const subregionVillages = villages.filter((village) =>
        village.regionId === region.id && village.subregionId === subregion.id && (subregionMatches || villageMatches(village, query))
      );
      if (query && !subregionMatches && !subregionVillages.length) return null;
      return { ...subregion, villages: subregionVillages };
    }).filter(Boolean);

    if (query && !regionMatches && !regionVillages.length && !subregions.length) return null;
    return { ...region, villages: regionVillages, subregions };
  }

  function villageMatches(village, query) {
    if (!query) return true;
    return [
      ...Object.values(village.names),
      ...Object.values(village.regionNames),
      ...Object.values(village.subregionNames),
      ...Object.values(village.info)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderRegionTree(region, searching) {
    const count = region.villages.length
      + region.subregions.reduce((total, subregion) => total + subregion.villages.length, 0);
    const isOpen = searching
      || expandedRegions.has(region.id)
      || mapOpenedRegions.has(region.id);
    const label = regionLabel(region);
    return `
      <details class="tree-region" data-folder="${escapeAttribute(region.id)}" style="--region-color:${escapeAttribute(region.color)}"${isOpen ? " open" : ""}>
        <summary class="tree-summary tree-region-summary">
          <span class="tree-chevron" aria-hidden="true">›</span>
          <span class="tree-swatch" aria-hidden="true"></span>
          <span class="tree-label" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(label)}</span>
          <span class="tree-kind" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(interfaceLabel("region"))}</span>
          <span class="tree-count" aria-label="${count} ${count === 1 ? "village" : "villages"}">${count}</span>
          <button class="tree-zoom" type="button" data-region="${escapeAttribute(region.id)}" aria-label="Zoom map to ${escapeAttribute(label)}">Zoom</button>
        </summary>
        <div class="tree-region-children">
          ${region.villages.length ? `<div class="tree-region-villages">${region.villages.map(renderVillageRow).join("")}</div>` : ""}
          ${region.subregions.map((subregion) => renderSubregionTree(region, subregion, searching)).join("")}
          ${region.villages.length || region.subregions.length ? "" : '<p class="tree-empty">No village records yet</p>'}
        </div>
      </details>
    `;
  }

  function renderSubregionTree(region, subregion, searching) {
    const key = `${region.id}/${subregion.id}`;
    const isOpen = searching || expandedSubregions.has(key) || mapOpenedSubregions.has(key);
    const label = subregionLabel(subregion);
    return `
      <details class="tree-subregion" data-folder="${escapeAttribute(key)}"${isOpen ? " open" : ""}>
        <summary class="tree-summary tree-subregion-summary">
          <span class="tree-chevron" aria-hidden="true">›</span>
          <span class="tree-label" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(label)}</span>
          <span class="tree-kind" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(interfaceLabel("subregion"))}</span>
          <span class="tree-count" aria-label="${subregion.villages.length} ${subregion.villages.length === 1 ? "village" : "villages"}">${subregion.villages.length}</span>
          <button class="tree-zoom" type="button" data-region="${escapeAttribute(region.id)}" data-subregion="${escapeAttribute(subregion.id)}" aria-label="Zoom map to ${escapeAttribute(label)}">Zoom</button>
        </summary>
        <div class="tree-villages">${subregion.villages.map(renderVillageRow).join("") || '<p class="tree-empty">No village records yet</p>'}</div>
      </details>
    `;
  }

  function renderVillageRow(village) {
    const isOpen = expandedVillages.has(village.id) || mapOpenedVillages.has(village.id);
    const label = villageLabel(village);
    return `
      <details class="tree-village" data-village="${escapeAttribute(village.id)}"${isOpen ? " open" : ""}>
        <summary class="tree-summary tree-village-summary">
          <span class="tree-chevron" aria-hidden="true">›</span>
          <span class="tree-village-dot" aria-hidden="true"></span>
          <span class="village-name" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(label)}</span>
          <span class="tree-kind" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(interfaceLabel("village"))}</span>
          <button class="tree-zoom" type="button" data-village="${escapeAttribute(village.id)}" aria-label="Zoom map to ${escapeAttribute(label)}">Zoom</button>
        </summary>
        <div class="tree-village-detail detail-copy" lang="${escapeAttribute(mapLanguage)}">${renderMarkdown(localizedInfo(village, mapLanguage))}</div>
      </details>
    `;
  }

  function updateCaretStateFromUser(details, state, mapOpenedState, searching) {
    if (searching) return;
    const key = details.dataset.folder;
    if (details.open) {
      state.delete(key);
      mapOpenedState.delete(key);
    } else {
      state.add(key);
    }
  }

  function updateVillageCaretStateFromUser(details) {
    const id = details.dataset.village;
    if (details.open) {
      expandedVillages.delete(id);
      mapOpenedVillages.delete(id);
      highlightedVillages.delete(id);
    } else {
      expandedVillages.add(id);
      highlightedVillages.add(id);
    }
  }

  function isVillageExpandedAndVisible(village) {
    const details = typeof village === "string"
      ? villageDetailsById(village)
      : village;
    if (!details?.open) return false;
    const region = details.closest(".tree-region");
    const subregion = details.closest(".tree-subregion");
    return Boolean(region?.open && (!subregion || subregion.open));
  }

  function isVillageHighlightedAndVisible(village) {
    const details = typeof village === "string"
      ? villageDetailsById(village)
      : village;
    return Boolean(
      details
      && highlightedVillages.has(details.dataset.village)
      && isVillageExpandedAndVisible(details)
    );
  }

  function villageDetailsById(id) {
    return [...els.villageList.querySelectorAll(".tree-village")]
      .find((item) => item.dataset.village === id);
  }

  function syncVillageMarkerStates(container) {
    const villageDetails = [
      ...(container.matches?.(".tree-village") ? [container] : []),
      ...container.querySelectorAll(".tree-village")
    ];
    villageDetails.forEach((details) => {
      setMarkerState(details.dataset.village, isVillageHighlightedAndVisible(details));
    });
  }

  function setHoveredTreeFolder(folder) {
    hoveredTreeFolder = folder;
    updateTreeFolderMarkerColors();
  }

  function clearHoveredTreeFolder(folder) {
    if (hoveredTreeFolder !== folder) return;
    hoveredTreeFolder = null;
    updateTreeFolderMarkerColors();
  }

  function updateTreeFolderMarkerColors() {
    const [regionId, subregionId] = hoveredTreeFolder?.split("/") || [];
    markerById.forEach((marker, villageId) => {
      const village = villageById.get(villageId);
      const isHighlighted = Boolean(
        regionId
        && village.regionId === regionId
        && (!subregionId || village.subregionId === subregionId)
      );
      marker
        .getElement()
        ?.querySelector(".village-marker")
        ?.classList.toggle("is-region-highlighted", isHighlighted);
    });
  }

  function addMapCaretOwner(state, key, villageId) {
    if (!state.has(key)) state.set(key, new Set());
    state.get(key).add(villageId);
  }

  function removeMapCaretOwner(state, key, villageId) {
    const owners = state.get(key);
    if (!owners) return;
    owners.delete(villageId);
    if (!owners.size) state.delete(key);
  }

  function addMapVillagePath(village) {
    addMapCaretOwner(mapOpenedRegions, village.regionId, village.id);
    if (village.subregionId) {
      addMapCaretOwner(
        mapOpenedSubregions,
        `${village.regionId}/${village.subregionId}`,
        village.id
      );
    }
    addMapCaretOwner(mapOpenedVillages, village.id, village.id);
  }

  function removeMapVillagePath(village) {
    removeMapCaretOwner(mapOpenedRegions, village.regionId, village.id);
    if (village.subregionId) {
      removeMapCaretOwner(
        mapOpenedSubregions,
        `${village.regionId}/${village.subregionId}`,
        village.id
      );
    }
    removeMapCaretOwner(mapOpenedVillages, village.id, village.id);
  }

  function resetAtlas() {
    els.search.value = "";
    expandedRegions.clear();
    expandedSubregions.clear();
    collapseVillageDetails();
    hoveredTreeFolder = null;
    updateTreeFolderMarkerColors();
    renderVillages();
    els.panelScroll.scrollTop = 0;
    fitHomeView();
  }

  function selectVillage(id) {
    const village = villageById.get(id);
    if (!village) return;
    const details = villageDetailsById(id);
    if (isVillageHighlightedAndVisible(details)) {
      highlightedVillages.delete(id);
      removeMapVillagePath(village);
      renderVillages(els.search.value);
      setMarkerState(id, false);
      setMarkerHoverSuppressed(id, true);
      return;
    }
    els.search.value = "";
    highlightedVillages.add(id);
    addMapVillagePath(village);
    setMarkerState(id, true);
    renderVillages();
    setArchiveOpen(true);
    requestAnimationFrame(() => {
      const openedDetails = villageDetailsById(id);
      openedDetails?.scrollIntoView({ block: "nearest" });
      if (mobileArchiveMedia.matches) openedDetails?.querySelector(".tree-village-summary")?.focus();
    });
  }

  function setMarkerState(id, enabled) {
    markerById.get(id)?.getElement()?.querySelector(".village-marker")?.classList.toggle("is-active", enabled);
  }

  function setMarkerHoverSuppressed(id, suppressed) {
    markerById
      .get(id)
      ?.getElement()
      ?.querySelector(".village-marker")
      ?.classList.toggle("is-hover-suppressed", suppressed);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function escapeAttribute(value = "") {
    return escapeHtml(value);
  }

  function collapseVillageDetails() {
    highlightedVillages.forEach((id) => setMarkerState(id, false));
    highlightedVillages.clear();
    expandedVillages.clear();
    mapOpenedVillages.clear();
    mapOpenedSubregions.clear();
    mapOpenedRegions.clear();
  }

  function showList() {
    collapseVillageDetails();
    renderVillages(els.search.value);
  }

  const mobileArchiveMedia = window.matchMedia("(max-width: 720px)");

  function syncArchiveAccessibility() {
    const isMobile = mobileArchiveMedia.matches;
    const isMobileOpen = isMobile && els.archive.classList.contains("is-open");
    const isDesktopCollapsed = !isMobile && els.atlas.classList.contains("is-archive-collapsed");
    els.mobileArchive.setAttribute("aria-expanded", String(isMobileOpen));
    els.desktopArchive.setAttribute("aria-expanded", String(!isDesktopCollapsed));
    els.desktopArchive.setAttribute(
      "aria-label",
      isDesktopCollapsed ? "Expand village archive" : "Collapse village archive"
    );
    els.archive.inert = (isMobile && !isMobileOpen) || isDesktopCollapsed;
    if ((isMobile && !isMobileOpen) || isDesktopCollapsed) {
      els.archive.setAttribute("aria-hidden", "true");
    } else {
      els.archive.removeAttribute("aria-hidden");
    }
  }

  function setArchiveOpen(open, { focusSearch = false, restoreFocus = false } = {}) {
    if (mobileArchiveMedia.matches) {
      els.archive.classList.toggle("is-open", open);
    } else {
      els.atlas.classList.toggle("is-archive-collapsed", !open);
    }
    syncArchiveAccessibility();
    requestAnimationFrame(() => {
      map.resize();
      scheduleMapLabelLayout();
    });
    if (open && focusSearch) requestAnimationFrame(() => els.search.focus());
    if (!open && restoreFocus) els.mobileArchive.focus();
  }

  function handleArchiveBreakpointChange() {
    if (!mobileArchiveMedia.matches) els.archive.classList.remove("is-open");
    syncArchiveAccessibility();
  }

  els.search.addEventListener("input", showList);
  els.homeButton.addEventListener("click", resetAtlas);
  els.deselectAll.addEventListener("click", resetAtlas);
  els.mobileArchive.addEventListener("click", () => setArchiveOpen(true, { focusSearch: true }));
  els.desktopArchive.addEventListener("click", () => {
    setArchiveOpen(els.atlas.classList.contains("is-archive-collapsed"));
  });
  els.panelClose.addEventListener("click", () => setArchiveOpen(false, { restoreFocus: true }));
  els.skipLink.addEventListener("click", (event) => {
    event.preventDefault();
    setArchiveOpen(true, { focusSearch: true });
  });
  mobileArchiveMedia.addEventListener("change", handleArchiveBreakpointChange);
  syncArchiveAccessibility();
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape"
      && mobileArchiveMedia.matches
      && els.archive.classList.contains("is-open")
    ) {
      setArchiveOpen(false, { restoreFocus: true });
    }
  });

  if (contentError) showContentError(contentError);
  else {
    renderVillages();
    hasRenderedAtlas = true;
  }
  const mapReady = new Promise((resolve) => {
    if (map.loaded()) resolve();
    else map.once("load", resolve);
  });
  Promise.all([Promise.resolve(document.fonts?.ready), mapReady]).then(() => requestAnimationFrame(() => {
    map.resize();
    fitInitialMapView();
    scheduleMapLabelLayout();
  }));
})();
