import { AtlasParseError, parseAtlas } from "./atlas-parser.js";

(async () => {
  let regions = [];
  let contentError = null;
  try {
    if (!window.marked?.parse) throw new Error("The bundled Markdown reader could not be loaded.");
    const atlasUrl = new URL("./content/atlas.md", import.meta.url);
    atlasUrl.searchParams.set("loaded", Date.now().toString());
    const response = await fetch(atlasUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load content/atlas.md (HTTP ${response.status}).`);
    regions = parseAtlas(await response.text()).regions;
  } catch (error) {
    contentError = error;
    console.error("Dance Atlas content error:", error);
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
    regionList: document.querySelector("#region-list"),
    villageList: document.querySelector("#village-list"),
    villageDetail: document.querySelector("#village-detail"),
    panelTitle: document.querySelector("#panel-title"),
    search: document.querySelector("#village-search"),
    archive: document.querySelector("#archive-panel"),
    mobileArchive: document.querySelector("#mobile-archive-button"),
    panelClose: document.querySelector("#panel-close"),
    aboutButton: document.querySelector("#about-button"),
    aboutDrawer: document.querySelector("#about-drawer"),
    aboutClose: document.querySelector("#about-close"),
    scrim: document.querySelector("#drawer-scrim"),
    languageOptions: document.querySelector("#language-options")
  };

  document.querySelector("#mobile-count").textContent = String(villages.length).padStart(2, "0");

  const mapDataBounds = { south: 34, west: 18, north: 43.5, east: 34.5 };
  const minNativeZoom = 5;
  const maxNativeZoom = 9;
  const map = L.map("map", {
    center: [39.25, 26.1],
    zoom: 6,
    minZoom: minNativeZoom,
    maxZoom: 11,
    maxBoundsViscosity: 1,
    zoomControl: false,
    attributionControl: true
  });

  const supportedLanguages = ["en", "el"];
  let mapLanguage = "en";
  try {
    const savedLanguage = localStorage.getItem("dance-atlas-language");
    if (supportedLanguages.includes(savedLanguage)) mapLanguage = savedLanguage;
  } catch {}

  const basemap = L.tileLayer(`assets/map/${mapLanguage}/{z}/{x}/{y}.webp`, {
    minNativeZoom,
    maxNativeZoom,
    maxZoom: 11,
    noWrap: true,
    bounds: [[mapDataBounds.south, mapDataBounds.west], [mapDataBounds.north, mapDataBounds.east]],
    attribution: 'Map geometry <a href="https://www.naturalearthdata.com/">Natural Earth</a> · Place labels Dance Atlas archive'
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Match camera limits to the full Web Mercator tiles emitted around the data bounds.
  function tileCoverageAtZoom(zoom) {
    const scale = 2 ** zoom;
    const longitudeToTile = (longitude) => ((longitude + 180) / 360) * scale;
    const latitudeToTile = (latitude) => {
      const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
      return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale;
    };
    const tileToLongitude = (x) => (x / scale) * 360 - 180;
    const tileToLatitude = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180 / Math.PI;
    const minX = Math.floor(longitudeToTile(mapDataBounds.west));
    const maxX = Math.floor(longitudeToTile(mapDataBounds.east - 1e-8));
    const minY = Math.floor(latitudeToTile(mapDataBounds.north));
    const maxY = Math.floor(latitudeToTile(mapDataBounds.south + 1e-8));

    return {
      bounds: L.latLngBounds(
        [tileToLatitude(maxY + 1), tileToLongitude(minX)],
        [tileToLatitude(minY), tileToLongitude(maxX + 1)]
      ),
      width: (maxX - minX + 1) * 256,
      height: (maxY - minY + 1) * 256
    };
  }

  function updateMapLimits() {
    const viewport = map.getSize();
    let minimumZoom = maxNativeZoom;
    for (let zoom = minNativeZoom; zoom <= maxNativeZoom; zoom += 1) {
      const coverage = tileCoverageAtZoom(zoom);
      if (coverage.width >= viewport.x && coverage.height >= viewport.y) {
        minimumZoom = zoom;
        break;
      }
    }

    map.setMinZoom(minimumZoom);
    if (map.getZoom() < minimumZoom) map.setZoom(minimumZoom, { animate: false });
    const coverage = tileCoverageAtZoom(Math.min(map.getZoom(), maxNativeZoom));
    map.setMaxBounds(coverage.bounds);
    map.panInsideBounds(coverage.bounds, { animate: false });
  }

  map.on("zoomend resize", updateMapLimits);
  updateMapLimits();

  function setMapLanguage(language) {
    if (!supportedLanguages.includes(language)) return;
    mapLanguage = language;
    basemap.setUrl(`assets/map/${language}/{z}/{x}/{y}.webp`);
    els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.language === language);
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
    try { localStorage.setItem("dance-atlas-language", language); } catch {}
  }

  els.languageOptions.querySelectorAll(".language-button").forEach((button) => {
    button.addEventListener("click", () => setMapLanguage(button.dataset.language));
  });
  setMapLanguage(mapLanguage);

  els.regionList.addEventListener("wheel", (event) => {
    if (els.regionList.scrollWidth <= els.regionList.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const atStart = els.regionList.scrollLeft <= 0;
    const atEnd = els.regionList.scrollLeft + els.regionList.clientWidth >= els.regionList.scrollWidth - 1;
    if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? els.regionList.clientWidth : 1;
    els.regionList.scrollLeft += delta * unit;
  }, { passive: false });

  const markerById = new Map();
  const expandedRegions = new Set();
  const expandedSubregions = new Set();
  let activeRegion = null;
  let activeVillage = null;

  villages.forEach((village) => {
    const icon = L.divIcon({
      className: "village-icon",
      html: `<div class="village-marker" data-village="${escapeAttribute(village.id)}" style="--marker-color:${escapeAttribute(village.regionColor)}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    const marker = L.marker(village.coordinates, { icon, title: village.name, keyboard: true }).addTo(map);
    marker.bindTooltip(village.name, { className: "village-tooltip", direction: "top", offset: [0, -8] });
    marker.on("click", () => selectVillage(village.id, true));
    marker.on("mouseover", () => setMarkerState(village.id, true));
    marker.on("mouseout", () => setMarkerState(village.id, activeVillage === village.id));
    markerById.set(village.id, marker);
  });

  function renderRegions() {
    els.regionList.innerHTML = `
      <button class="region-chip is-active" data-region="all" style="--region-color:#e16b55" role="listitem">All regions</button>
      ${regions.map((region) => `<button class="region-chip" data-region="${escapeAttribute(region.id)}" style="--region-color:${escapeAttribute(region.color)}" role="listitem">${escapeHtml(region.name)}</button>`).join("")}
    `;
    els.regionList.querySelectorAll(".region-chip").forEach((button) => {
      const id = button.dataset.region === "all" ? null : button.dataset.region;
      button.addEventListener("mouseenter", () => previewRegion(id));
      button.addEventListener("mouseleave", () => previewRegion(activeRegion));
      button.addEventListener("click", () => selectRegion(id, true));
    });
  }

  function showContentError(error) {
    const isAtlasError = error instanceof AtlasParseError;
    const lineLabel = isAtlasError ? `Line ${error.line}: ` : "";
    const sourceLine = isAtlasError && error.sourceLine
      ? `<pre><code>${escapeHtml(error.sourceLine)}</code></pre>`
      : "";
    els.panelTitle.textContent = "Atlas content error";
    els.search.disabled = true;
    els.regionList.innerHTML = "";
    els.villageList.innerHTML = `
      <section class="content-error" role="alert">
        <p class="content-error-label">Could not read content/atlas.md</p>
        <p><strong>${escapeHtml(lineLabel)}</strong>${escapeHtml(error.message || String(error))}</p>
        ${sourceLine}
        <p>Fix that line and reload this page. No build is required.</p>
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
      button.addEventListener("click", () => selectVillage(button.dataset.village, true));
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
    return [village.name, village.regionName, village.subregionName, village.info]
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
          <span class="tree-label">${escapeHtml(region.name)}</span>
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
        <span class="village-name">${escapeHtml(village.name)}</span>
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
      <h3>${escapeHtml(village.name)}</h3>
      <div class="detail-copy">${village.infoHtml}</div>
    `;
    els.villageDetail.querySelector(".detail-back").addEventListener("click", showList);
  }

  function selectRegion(id, moveMap = false) {
    activeRegion = id;
    activeVillage = null;
    if (id) expandedRegions.add(id);
    els.panelTitle.textContent = id ? regions.find((region) => region.id === id).name : "All villages";
    els.regionList.querySelectorAll(".region-chip").forEach((chip) => chip.classList.toggle("is-active", (chip.dataset.region === "all" ? null : chip.dataset.region) === id));
    previewRegion(id);
    showList();

    if (moveMap) {
      const region = regions.find((item) => item.id === id);
      if (region?.bounds) map.flyToBounds(region.bounds, { padding: [45, 45], maxZoom: 9, duration: .8 });
      else if (!id) map.flyTo([39.25, 26.1], 6, { duration: .8 });
    }
  }

  function previewRegion(id) {
    markerById.forEach((marker, villageId) => {
      const village = villageById.get(villageId);
      marker.getElement()?.querySelector(".village-marker")?.classList.toggle("is-muted", Boolean(id) && village.regionId !== id);
    });
  }

  function selectVillage(id, moveMap = false) {
    const village = villageById.get(id);
    if (!village) return;
    activeVillage = id;
    setMarkerState(id, true);
    renderDetail(village);
    els.villageList.hidden = true;
    els.villageDetail.hidden = false;
    els.panelTitle.hidden = true;
    els.archive.classList.add("is-detail", "is-open");
    if (moveMap) map.flyTo(village.coordinates, Math.max(map.getZoom(), 9), { duration: .7 });
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
    els.panelTitle.hidden = false;
    els.panelTitle.textContent = activeRegion ? regions.find((region) => region.id === activeRegion).name : "All villages";
    renderVillages(els.search.value);
  }

  function setAbout(open) {
    els.aboutDrawer.classList.toggle("is-open", open);
    els.scrim.classList.toggle("is-open", open);
    els.aboutDrawer.setAttribute("aria-hidden", String(!open));
    els.aboutButton.setAttribute("aria-expanded", String(open));
  }

  els.search.addEventListener("input", showList);
  els.mobileArchive.addEventListener("click", () => els.archive.classList.add("is-open"));
  els.panelClose.addEventListener("click", () => els.archive.classList.remove("is-open"));
  els.aboutButton.addEventListener("click", () => setAbout(true));
  els.aboutClose.addEventListener("click", () => setAbout(false));
  els.scrim.addEventListener("click", () => setAbout(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { setAbout(false); els.archive.classList.remove("is-open"); } });

  if (contentError) showContentError(contentError);
  else {
    renderRegions();
    renderVillages();
  }
  window.addEventListener("load", () => map.invalidateSize());
})();
