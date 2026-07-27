import { AtlasWorkbookError, parseAtlasWorkbook } from "./atlas-workbook.js";
import { regionDisplayName, sortRegionsAlphabetically } from "./region-presentation.js";

(async () => {
  let regions = [];
  let contentError = null;
  try {
    if (!window.XLSX?.read) throw new Error("The bundled spreadsheet reader could not be loaded.");
    if (!window.marked?.parse) throw new Error("The bundled Markdown reader could not be loaded.");
    const atlasUrl = new URL("./content/atlas.xlsx", import.meta.url);
    atlasUrl.searchParams.set("loaded", Date.now().toString());
    const response = await fetch(atlasUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load content/atlas.xlsx (HTTP ${response.status}).`);
    const workbook = window.XLSX.read(await response.arrayBuffer(), { type: "array" });
    regions = sortRegionsAlphabetically(parseAtlasWorkbook(workbook, window.XLSX).regions);
  } catch (error) {
    contentError = error;
    console.error("Atlas content error:", error);
  }

  const markdownRenderer = window.marked?.Renderer ? new window.marked.Renderer() : null;
  if (markdownRenderer) {
    markdownRenderer.html = ({ text }) => escapeHtml(text);
    markdownRenderer.image = ({ text }) => escapeHtml(text);
  }

  const renderMarkdown = (source) => window.marked.parse(source, {
    async: false,
    renderer: markdownRenderer
  });

  const villages = regions.flatMap((region) => [
    ...(region.villages || []).map((village) => ({
      ...village,
      infoHtml: renderMarkdown(village.info),
      regionId: region.id,
      regionName: region.name,
      regionColor: region.color,
      subregionId: null,
      subregionName: ""
    })),
    ...(region.subregions || []).flatMap((subregion) =>
      (subregion.villages || []).map((village) => ({
        ...village,
        infoHtml: renderMarkdown(village.info),
        regionId: region.id,
        regionName: region.name,
        regionColor: region.color,
        subregionId: subregion.id,
        subregionName: subregion.name
      }))
    )
  ]);
  const villageById = new Map(villages.map((village) => [village.id, village]));

  const els = {
    mapStage: document.querySelector(".map-stage"),
    regionTray: document.querySelector(".region-tray"),
    regionList: document.querySelector("#region-list"),
    villageList: document.querySelector("#village-list"),
    villageDetail: document.querySelector("#village-detail"),
    panelTitle: document.querySelector("#panel-title"),
    search: document.querySelector("#village-search"),
    archive: document.querySelector("#archive-panel"),
    mobileArchive: document.querySelector("#mobile-archive-button"),
    panelClose: document.querySelector("#panel-close"),
    homeButton: document.querySelector("#home-button"),
    languageOptions: document.querySelector("#language-options")
  };

  document.querySelector("#mobile-count").textContent = String(villages.length).padStart(2, "0");

  const mapDataBounds = { south: 34, west: 18, north: 43.5, east: 34.5 };
  const minNativeZoom = 5;
  const maxNativeZoom = 9;
  const maxMapZoom = 11;
  const minimumMarkerDiameter = 9;
  const maximumMarkerDiameter = 18;
  const map = L.map("map", {
    center: [39.25, 26.1],
    zoom: 6,
    zoomSnap: 0.1,
    minZoom: minNativeZoom,
    maxZoom: maxMapZoom,
    zoomControl: false,
    attributionControl: true
  });
  let initialMapView = {
    center: [map.getCenter().lat, map.getCenter().lng],
    zoom: map.getZoom()
  };

  const supportedLanguages = ["en", "el"];
  let mapLanguage = "en";
  try {
    const savedLanguage = localStorage.getItem("dance-atlas-language");
    if (supportedLanguages.includes(savedLanguage)) mapLanguage = savedLanguage;
  } catch {}

  const basemap = L.tileLayer("assets/map/{z}/{x}/{y}.webp", {
    minNativeZoom,
    maxNativeZoom,
    maxZoom: maxMapZoom,
    noWrap: true,
    bounds: [[mapDataBounds.south, mapDataBounds.west], [mapDataBounds.north, mapDataBounds.east]],
    attribution: 'Map geometry <a href="https://www.naturalearthdata.com/">Natural Earth</a> · Village data atlas.xlsx'
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  function tileCoverageCenterLongitude(zoom) {
    const scale = 2 ** zoom;
    const longitudeToTile = (longitude) => ((longitude + 180) / 360) * scale;
    const tileToLongitude = (x) => (x / scale) * 360 - 180;
    const minX = Math.floor(longitudeToTile(mapDataBounds.west));
    const maxX = Math.floor(longitudeToTile(mapDataBounds.east - 1e-8));
    return (tileToLongitude(minX) + tileToLongitude(maxX + 1)) / 2;
  }

  function setMapLanguage(language) {
    if (!supportedLanguages.includes(language)) return;
    mapLanguage = language;
    els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.language === language);
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
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
      if (activeVillage) renderDetail(villageById.get(activeVillage));
      else renderVillages(els.search.value);
    }
    scheduleMapLabelLayout();
    try { localStorage.setItem("dance-atlas-language", language); } catch {}
  }

  els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
    button.addEventListener("click", () => setMapLanguage(button.dataset.language));
  });

  function updateRegionTrayHeight() {
    const chips = [...els.regionList.querySelectorAll(".region-chip")];
    chips.forEach((chip) => chip.classList.remove("is-last-row"));
    if (chips.length) {
      const lastRowTop = Math.max(...chips.map((chip) => chip.offsetTop));
      chips
        .filter((chip) => chip.offsetTop === lastRowTop)
        .forEach((chip) => chip.classList.add("is-last-row"));
    }
    const height = Math.ceil(els.regionTray.getBoundingClientRect().height);
    els.mapStage.style.setProperty("--region-tray-height", `${height}px`);
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(updateRegionTrayHeight).observe(els.regionTray);
  } else {
    window.addEventListener("resize", updateRegionTrayHeight);
  }
  updateRegionTrayHeight();

  const markerById = new Map();
  const expandedRegions = new Set();
  const expandedSubregions = new Set();
  let activeRegion = null;
  let activeVillage = null;
  let hasRenderedAtlas = false;

  function markerDiameterAtZoom(zoom) {
    const progress = Math.max(0, Math.min(1, (zoom - minNativeZoom) / (maxMapZoom - minNativeZoom)));
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
    return village.names[mapLanguage] || village.names.en || village.names.el;
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
    const icon = L.divIcon({
      className: "village-icon",
      html: `
        <div class="village-marker-shell">
          <div class="village-marker-scale" style="--marker-scale:${initialMarkerScale.toFixed(4)}">
            <div class="village-marker" data-village="${escapeAttribute(village.id)}" style="--marker-color:${escapeAttribute(village.regionColor)}"></div>
          </div>
          <span class="village-map-label" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(label)}</span>
        </div>
      `,
      iconSize: [maximumMarkerDiameter, maximumMarkerDiameter],
      iconAnchor: [maximumMarkerDiameter / 2, maximumMarkerDiameter / 2]
    });
    const marker = L.marker(village.coordinates, { icon, title: label, alt: label, keyboard: true }).addTo(map);
    marker.on("click", () => selectVillage(village.id));
    marker.on("mouseover", () => setMarkerState(village.id, true));
    marker.on("mouseout", () => setMarkerState(village.id, activeVillage === village.id));
    markerById.set(village.id, marker);
  });
  setMapLanguage(mapLanguage);
  map.on("zoomend", updateMarkerScale);
  map.on("moveend resize", scheduleMapLabelLayout);
  scheduleMapLabelLayout();

  let hasFitInitialMapView = false;
  function fitInitialMapView() {
    if (hasFitInitialMapView || !villages.length) return;
    hasFitInitialMapView = true;
    const villageBounds = L.latLngBounds(villages.map((village) => village.coordinates));
    const horizontalPadding = window.matchMedia("(max-width: 720px)").matches ? 24 : 48;
    map.fitBounds(villageBounds, {
      paddingTopLeft: [horizontalPadding, 20],
      paddingBottomRight: [horizontalPadding, Math.ceil(els.regionTray.getBoundingClientRect().height) + 12],
      animate: false
    });
    const tileZoom = Math.max(minNativeZoom, Math.min(maxNativeZoom, Math.round(map.getZoom())));
    const fittedCenter = map.getCenter();
    const fittedZoom = map.getZoom();
    const villagePoints = villages.map((village) => map.project(village.coordinates, fittedZoom));
    const viewportWidth = map.getSize().x;
    const minimumCenterX = Math.max(...villagePoints.map((point) => point.x)) - (viewportWidth / 2) + horizontalPadding;
    const maximumCenterX = Math.min(...villagePoints.map((point) => point.x)) + (viewportWidth / 2) - horizontalPadding;
    const coverageCenter = map.project(
      [fittedCenter.lat, tileCoverageCenterLongitude(tileZoom)],
      fittedZoom
    );
    coverageCenter.x = Math.max(minimumCenterX, Math.min(maximumCenterX, coverageCenter.x));
    const centeredView = map.unproject(coverageCenter, fittedZoom);
    map.setView(
      centeredView,
      fittedZoom,
      { animate: false }
    );
    const initialCenter = map.getCenter();
    initialMapView = {
      center: [initialCenter.lat, initialCenter.lng],
      zoom: map.getZoom()
    };
  }

  function renderRegions() {
    els.regionList.innerHTML = `
      ${regions.map((region) => `<button class="region-chip" data-region="${escapeAttribute(region.id)}" style="--region-color:${escapeAttribute(region.color)}" role="listitem" title="${escapeAttribute(region.name)}" aria-pressed="false"><span class="region-chip-label">${escapeHtml(regionDisplayName(region.name))}</span></button>`).join("")}
    `;
    els.regionList.querySelectorAll(".region-chip").forEach((button) => {
      const id = button.dataset.region;
      button.addEventListener("mouseenter", () => previewRegion(id));
      button.addEventListener("mouseleave", () => previewRegion(activeRegion));
      button.addEventListener("click", () => selectRegion(activeRegion === id ? null : id));
    });
    requestAnimationFrame(updateRegionTrayHeight);
  }

  function showContentError(error) {
    const isAtlasError = error instanceof AtlasWorkbookError;
    const location = isAtlasError && error.location ? `${error.location}: ` : "";
    els.panelTitle.textContent = "Atlas content error";
    els.search.disabled = true;
    els.regionList.innerHTML = "";
    els.villageList.innerHTML = `
      <section class="content-error" role="alert">
        <p class="content-error-label">Could not read content/atlas.xlsx</p>
        <p><strong>${escapeHtml(location)}</strong>${escapeHtml(error.message || String(error))}</p>
        <p>Fix that cell and reload this page. No build is required.</p>
      </section>
    `;
    document.querySelector("#mobile-count").textContent = "!";
    els.archive.classList.add("is-open");
  }

  function renderVillages(query = "") {
    const normalized = query.trim().toLowerCase();
    const visibleRegions = regions
      .filter((region) => !activeRegion || region.id === activeRegion)
      .map((region) => filterRegion(region, normalized))
      .filter(Boolean);

    els.villageList.innerHTML = visibleRegions.length
      ? visibleRegions.map((region) => renderRegionTree(region, Boolean(normalized))).join("")
      : `<p class="empty-state">No village records match that search.</p>`;

    els.villageList.querySelectorAll(".tree-village").forEach((button) => {
      button.addEventListener("click", () => selectVillage(button.dataset.village));
      button.addEventListener("mouseenter", () => setMarkerState(button.dataset.village, true));
      button.addEventListener("mouseleave", () => setMarkerState(button.dataset.village, activeVillage === button.dataset.village));
    });
    els.villageList.querySelectorAll(".tree-region").forEach((details) => {
      details.addEventListener("toggle", () => updateExpandedState(details, expandedRegions, normalized));
    });
    els.villageList.querySelectorAll(".tree-subregion").forEach((details) => {
      details.addEventListener("toggle", () => updateExpandedState(details, expandedSubregions, normalized));
    });
  }

  function filterRegion(region, query) {
    const regionMatches = Boolean(query) && region.name.toLowerCase().includes(query);
    const regionVillages = villages.filter((village) =>
      village.regionId === region.id && !village.subregionId && (regionMatches || villageMatches(village, query))
    );
    const subregions = (region.subregions || []).map((subregion) => {
      const subregionMatches = regionMatches || (Boolean(query) && subregion.name.toLowerCase().includes(query));
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
    return [...Object.values(village.names), village.regionName, village.subregionName, village.info]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderRegionTree(region, searching) {
    const count = region.villages.length
      + region.subregions.reduce((total, subregion) => total + subregion.villages.length, 0);
    const isOpen = searching || activeRegion === region.id || expandedRegions.has(region.id);
    return `
      <details class="tree-region" data-folder="${escapeAttribute(region.id)}" style="--region-color:${escapeAttribute(region.color)}"${isOpen ? " open" : ""}>
        <summary class="tree-summary tree-region-summary">
          <span class="tree-chevron" aria-hidden="true">›</span>
          <span class="tree-swatch" aria-hidden="true"></span>
          <span class="tree-label">${escapeHtml(regionDisplayName(region.name))}</span>
          <span class="tree-count" aria-label="${count} ${count === 1 ? "village" : "villages"}">${count}</span>
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
    const isOpen = searching || expandedSubregions.has(key);
    return `
      <details class="tree-subregion" data-folder="${escapeAttribute(key)}"${isOpen ? " open" : ""}>
        <summary class="tree-summary tree-subregion-summary">
          <span class="tree-chevron" aria-hidden="true">›</span>
          <span class="tree-label">${escapeHtml(subregion.name)}</span>
          <span class="tree-count" aria-label="${subregion.villages.length} ${subregion.villages.length === 1 ? "village" : "villages"}">${subregion.villages.length}</span>
        </summary>
        <div class="tree-villages">${subregion.villages.map(renderVillageRow).join("") || '<p class="tree-empty">No village records yet</p>'}</div>
      </details>
    `;
  }

  function renderVillageRow(village) {
    return `
      <button class="tree-village ${activeVillage === village.id ? "is-active" : ""}" data-village="${escapeAttribute(village.id)}">
        <span class="tree-village-dot" aria-hidden="true"></span>
        <span class="village-name" lang="${escapeAttribute(mapLanguage)}">${escapeHtml(villageLabel(village))}</span>
        <span class="village-arrow" aria-hidden="true">→</span>
      </button>
    `;
  }

  function updateExpandedState(details, state, searching) {
    if (searching) return;
    if (details.open) state.add(details.dataset.folder);
    else state.delete(details.dataset.folder);
  }

  function renderDetail(village) {
    els.villageDetail.innerHTML = `
      <button class="detail-back" type="button">← Back to village index</button>
      <h3 lang="${escapeAttribute(mapLanguage)}">${escapeHtml(villageLabel(village))}</h3>
      <div class="detail-copy">${village.infoHtml}</div>
    `;
    els.villageDetail.querySelector(".detail-back").addEventListener("click", showList);
  }

  function selectRegion(id) {
    activeRegion = id;
    activeVillage = null;
    if (id) expandedRegions.add(id);
    els.regionList.querySelectorAll(".region-chip").forEach((chip) => {
      const isActive = chip.dataset.region === id;
      chip.classList.toggle("is-active", isActive);
      chip.setAttribute("aria-pressed", String(isActive));
    });
    previewRegion(id);
    showList();
  }

  function goHome() {
    selectRegion(null);
    map.setView(initialMapView.center, initialMapView.zoom, { animate: false });
  }

  function previewRegion(id) {
    markerById.forEach((marker, villageId) => {
      const village = villageById.get(villageId);
      marker.getElement()?.querySelector(".village-marker")?.classList.toggle("is-muted", Boolean(id) && village.regionId !== id);
    });
  }

  function selectVillage(id) {
    const village = villageById.get(id);
    if (!village) return;
    activeVillage = id;
    setMarkerState(id, true);
    renderDetail(village);
    els.villageList.hidden = true;
    els.villageDetail.hidden = false;
    els.panelTitle.hidden = true;
    els.archive.classList.add("is-detail", "is-open");
  }

  function setMarkerState(id, enabled) {
    markerById.get(id)?.getElement()?.querySelector(".village-marker")?.classList.toggle("is-active", enabled);
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

  function showList() {
    if (activeVillage) setMarkerState(activeVillage, false);
    activeVillage = null;
    els.villageDetail.hidden = true;
    els.villageList.hidden = false;
    els.archive.classList.remove("is-detail");
    const selectedRegion = activeRegion ? regions.find((region) => region.id === activeRegion) : null;
    const panelTitle = selectedRegion ? regionDisplayName(selectedRegion.name) : "";
    els.panelTitle.textContent = panelTitle;
    els.panelTitle.hidden = !panelTitle;
    els.archive.classList.toggle("has-panel-title", Boolean(panelTitle));
    renderVillages(els.search.value);
  }

  els.search.addEventListener("input", showList);
  els.homeButton.addEventListener("click", goHome);
  els.mobileArchive.addEventListener("click", () => els.archive.classList.add("is-open"));
  els.panelClose.addEventListener("click", () => els.archive.classList.remove("is-open"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") els.archive.classList.remove("is-open");
  });

  if (contentError) showContentError(contentError);
  else {
    renderRegions();
    renderVillages();
    hasRenderedAtlas = true;
  }
  Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(() => {
    map.invalidateSize({ pan: false });
    fitInitialMapView();
    scheduleMapLabelLayout();
  }));
})();
