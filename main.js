(function () {
  const config = window.APP_CONFIG;
  const rawPlants = Array.isArray(window.POWER_PLANTS) ? window.POWER_PLANTS : [];
  const topology = window.UK_REGIONS_TOPOLOGY;
  const BNG_DEF =
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +units=m +no_defs";

  if (typeof proj4 === "function") {
    proj4.defs("EPSG:27700", BNG_DEF);
  }

  const ALL = config.dataLabels.all;
  const regionNameMap = new Map([
    ["East of England", "Eastern"],
    ["Yorkshire and The Humber", "Yorkshire and Humber"],
  ]);
  const regionSelectionMap = new Map([
    ["East Midlands", { country: "England", region: "East Midlands" }],
    ["Eastern", { country: "England", region: "Eastern" }],
    ["London", { country: "England", region: "London" }],
    ["North East", { country: "England", region: "North East" }],
    ["North West", { country: "England", region: "North West" }],
    ["South East", { country: "England", region: "South East" }],
    ["South West", { country: "England", region: "South West" }],
    ["West Midlands", { country: "England", region: "West Midlands" }],
    ["Yorkshire and Humber", { country: "England", region: "Yorkshire and Humber" }],
    ["Scotland", { country: "Scotland", region: "Scotland (Land)" }],
    ["Wales", { country: "Wales", region: "Wales (Land)" }],
    ["Northern Ireland", { country: "Northern Ireland", region: "Northern Ireland (Land)" }],
  ]);
  const mapRegionByFilterRegion = new Map([
    ["East Midlands", "East Midlands"],
    ["Eastern", "Eastern"],
    ["London", "London"],
    ["North East", "North East"],
    ["North West", "North West"],
    ["South East", "South East"],
    ["South West", "South West"],
    ["West Midlands", "West Midlands"],
    ["Yorkshire and Humber", "Yorkshire and Humber"],
    ["Scotland (Land)", "Scotland"],
    ["Wales (Land)", "Wales"],
    ["Northern Ireland (Land)", "Northern Ireland"],
  ]);
  const countries = ["England", "Scotland", "Wales", "Northern Ireland"];
  const regionsByCountry = new Map([
    [
      "England",
      [
        "East Midlands",
        "Eastern",
        "London",
        "North East",
        "North West",
        "South East",
        "South West",
        "West Midlands",
        "Yorkshire and Humber",
        "Offshore",
      ],
    ],
    ["Scotland", ["Scotland (Land)", "Offshore"]],
    ["Wales", ["Wales (Land)", "Offshore"]],
    ["Northern Ireland", ["Northern Ireland (Land)", "Offshore"]],
  ]);
  const allRegionEntries = [];
  const regionEntryByKey = new Map();
  regionsByCountry.forEach((regions, country) => {
    regions.forEach((region) => {
      const key = buildGeographyKey(country, region);
      const entry = {
        key,
        country,
        region,
        label: region === "Offshore" ? `${country} Offshore` : region,
      };
      allRegionEntries.push(entry);
      regionEntryByKey.set(key, entry);
    });
  });

  const labelEligibleRegions = new Set(config.regionLabelNames);
  const sourceOrder = [
    "Wind",
    "Solid biomass",
    "Hydro",
    "Biogas",
    "Solar photovoltaics",
    "Energy from waste",
    "Other",
  ];
  const labelPositionOverrides = new Map([
    ["Northern Ireland", { x: -22, y: 0 }],
    ["Wales", { x: -20, y: 12 }],
    ["North West", { x: -20, y: -8 }],
    ["Yorkshire and Humber", { x: 26, y: 8 }],
    ["West Midlands", { x: 6, y: 2 }],
    ["East Midlands", { x: 22, y: 2 }],
    ["London", { x: 6, y: -4 }],
    ["South East", { x: 18, y: 20 }],
    ["North East", { x: 18, y: -10 }],
  ]);

  const sourceBySubcategory = new Map();
  const filterChainByTechnology = new Map();

  const svg = d3.select("#map");
  const tooltip = d3.select("#tooltip");
  const mapCard = document.querySelector(".map-card");
  const emptyState = document.getElementById("empty-state");

  const width = svg.node().clientWidth || 1000;
  const height = svg.node().clientHeight || 760;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const root = svg.append("g");
  const mapLayer = root.append("g").attr("class", "map-layer");
  const regionLayer = root.append("g").attr("class", "region-layer");
  const labelLayer = root.append("g").attr("class", "label-layer");
  const plantsLayer = root.append("g").attr("class", "plants-layer");

  const filters = {
    source: document.getElementById("source-filter"),
    subcategory: document.getElementById("subcategory-filter"),
    technology: document.getElementById("technology-filter"),
    status: document.getElementById("status-filter"),
  };

  const geographyEls = {
    countryButtons: document.getElementById("country-buttons"),
    regionButtons: document.getElementById("region-buttons"),
    selectionChips: document.getElementById("selection-chips"),
    selectionState: document.getElementById("selection-state"),
    showAll: document.getElementById("show-all-button"),
    showLand: document.getElementById("show-land-button"),
    showOffshore: document.getElementById("show-offshore-button"),
    reset: document.getElementById("reset-button"),
  };

  const summaryEls = {
    visibleCount: document.getElementById("visible-count"),
    sourceCount: document.getElementById("source-count"),
    regionCount: document.getElementById("region-count"),
  };

  const state = {
    hoveredMapRegion: null,
    selectedCountries: new Set(),
    selectedRegions: new Set(),
  };

  const regionObject = topology.objects[Object.keys(topology.objects)[0]];
  const regionFeatures = topojson
    .feature(topology, regionObject)
    .features.map((feature) => {
      const mapRegion = normalizeMapRegionName(feature.properties.AREANM);
      const selection = regionSelectionMap.get(mapRegion);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          AREANM: mapRegion,
          filterCountry: selection ? selection.country : null,
          filterRegion: selection ? selection.region : null,
        },
      };
    });

  const countryFeatures = buildCountryFeatures(regionObject.geometries);
  const projection = d3.geoMercator().fitExtent(
    [
      [72, 54],
      [width - 72, height - 54],
    ],
    { type: "FeatureCollection", features: countryFeatures }
  );
  const path = d3.geoPath(projection);

  const plants = rawPlants
    .map(normalizePlant)
    .filter((plant) => plant.lon !== null && plant.lat !== null);
  buildRenewableRelationships(plants);
  const regionSummaries = buildRegionSummaries(plants);
  const palette = buildPalette(plants, config.basePalette, config.subcategoryShadeRange);
  const legendEntries = buildLegendEntries();

  renderBaseMap();
  renderLegend();
  initFilterOptions();
  renderCountryButtons();
  renderRegionButtons();
  renderSelectionChips();
  renderPlants(plants);

  filters.source.addEventListener("change", () => {
    if (filters.source.value === ALL) {
      filters.subcategory.value = ALL;
      filters.technology.value = ALL;
    }
    syncRenewableOptions();
    updateView();
  });

  filters.subcategory.addEventListener("change", () => {
    if (filters.subcategory.value === ALL) {
      filters.technology.value = ALL;
    } else {
      syncSourceFromSubcategory();
    }
    syncRenewableOptions();
    updateView();
  });

  filters.technology.addEventListener("change", () => {
    syncRenewableChainFromTechnology();
    syncRenewableOptions();
    updateView();
  });

  filters.status.addEventListener("change", () => {
    syncRenewableOptions();
    updateView();
  });

  geographyEls.showAll.addEventListener("click", () => {
    selectAllGeography();
    updateView();
  });

  geographyEls.showLand.addEventListener("click", () => {
    selectLandOnlyGeography();
    updateView();
  });

  geographyEls.showOffshore.addEventListener("click", () => {
    selectOffshoreOnlyGeography();
    updateView();
  });

  geographyEls.reset.addEventListener("click", () => {
    clearAllSelections();
    updateView();
  });

  const zoom = d3
    .zoom()
    .scaleExtent([1, 16])
    .translateExtent([
      [0, 0],
      [width, height],
    ])
    .on("zoom", (event) => {
      root.attr("transform", event.transform);
      labelLayer
        .selectAll(".region-label")
        .style("font-size", `${12 / event.transform.k}px`);
      updatePointScale(event.transform.k);
    });

  svg.call(zoom);
  updateView();

  function normalizeMapRegionName(name) {
    return regionNameMap.get(name) || name;
  }

  function normalizePlant(row) {
    const source = String(row["Renewable Source"] ?? "").trim();
    const subcategory = String(row["Subcategory"] ?? "").trim();
    const technology = String(row["Technology Type"] ?? "").trim();
    const country = String(row["Country"] ?? "").trim();
    const region = String(row["Region"] ?? "").trim();
    const status = String(row["Status"] ?? "").trim();
    const x = parseCoordinate(row["X-coordinate"]);
    const y = parseCoordinate(row["Y-coordinate"]);
    const lonLat =
      Number.isFinite(x) && Number.isFinite(y) ? convertBngToWgs84(x, y) : null;

    return {
      id: row["Ref ID"],
      source,
      subcategory,
      technology,
      country,
      region,
      status,
      x,
      y,
      lon: lonLat ? lonLat[0] : null,
      lat: lonLat ? lonLat[1] : null,
    };
  }

  function parseCoordinate(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function convertBngToWgs84(easting, northing) {
    if (typeof proj4 !== "function") return null;
    const [lon, lat] = proj4("EPSG:27700", "EPSG:4326", [easting, northing]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  }

  function buildCountryFeatures(regionGeometries) {
    return countries
      .map((country) => ({
        name: country,
        geometries: regionGeometries.filter((geometry) => {
          const regionName = normalizeMapRegionName(geometry.properties.AREANM);
          const selection = regionSelectionMap.get(regionName);
          return selection && selection.country === country;
        }),
      }))
      .filter((item) => item.geometries.length)
      .map((item) => ({
        type: "Feature",
        properties: { name: item.name },
        geometry: topojson.merge(topology, item.geometries),
      }));
  }

  function buildRegionSummaries(data) {
    const summaries = new Map();

    regionSelectionMap.forEach((selection, mapRegion) => {
      const matchingPlants = data.filter(
        (plant) => plant.country === selection.country && plant.region === selection.region
      );
      const sourceCounts = sourceOrder
        .map((source) => ({
          source,
          count: matchingPlants.filter((plant) => plant.source === source).length,
        }))
        .filter((item) => item.count > 0);

      summaries.set(mapRegion, {
        total: matchingPlants.length,
        sourceCounts,
      });
    });

    return summaries;
  }

  function buildRenewableRelationships(data) {
    data.forEach((plant) => {
      if (!sourceBySubcategory.has(plant.subcategory)) {
        sourceBySubcategory.set(plant.subcategory, plant.source);
      }

      if (!filterChainByTechnology.has(plant.technology)) {
        filterChainByTechnology.set(plant.technology, {
          source: plant.source,
          subcategory: plant.subcategory,
        });
      }
    });
  }

  function buildPalette(data, basePalette, shadeRange) {
    const grouped = d3.group(
      data,
      (d) => d.source,
      (d) => d.subcategory
    );
    const paletteMap = new Map();

    for (const [source, subgroupMap] of grouped) {
      const baseColor = basePalette[source] || "#537188";
      const subcategories = Array.from(subgroupMap.keys()).sort(d3.ascending);
      const steps = Math.max(subcategories.length - 1, 1);

      subcategories.forEach((subcategory, index) => {
        const t =
          subcategories.length === 1
            ? 0.7
            : d3.interpolateNumber(shadeRange[0], shadeRange[1])(index / steps);
        const color = d3.interpolateLab("#ffffff", baseColor)(t);
        paletteMap.set(`${source}|||${subcategory}`, color);
      });
    }

    return {
      get(source, subcategory) {
        return paletteMap.get(`${source}|||${subcategory}`) || basePalette[source] || "#537188";
      },
      groupedEntries() {
        return Array.from(grouped.keys()).map((source) => ({
          source,
          baseColor: basePalette[source] || "#537188",
          subcategories: Array.from(grouped.get(source).keys())
            .sort(d3.ascending)
            .map((subcategory) => ({
              name: subcategory,
              color: paletteMap.get(`${source}|||${subcategory}`),
            })),
        }));
      },
    };
  }

  function buildLegendEntries() {
    const groupedEntries = palette.groupedEntries();
    const entriesBySource = new Map(groupedEntries.map((entry) => [entry.source, entry]));

    return sourceOrder
      .map((source) => entriesBySource.get(source))
      .filter(Boolean)
      .map((entry) => {
        const subcategories =
          entry.subcategories.length === 1 &&
          entry.subcategories[0].name.toLowerCase() === entry.source.toLowerCase()
            ? []
            : entry.subcategories;

        return {
          ...entry,
          subcategories,
        };
      });
  }

  function renderBaseMap() {
    mapLayer
      .selectAll(".country")
      .data(countryFeatures)
      .join("path")
      .attr("class", "country")
      .attr("d", path);

    regionLayer
      .selectAll(".region-shape")
      .data(regionFeatures)
      .join("path")
      .attr("class", "region-shape")
      .attr("d", path)
      .on("mouseenter", (event, d) => {
        state.hoveredMapRegion = d.properties.AREANM;
        updateRegionVisualState();
        showRegionTooltip(event, d);
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", () => {
        state.hoveredMapRegion = null;
        updateRegionVisualState();
        hideTooltip();
      })
      .on("click", (_, d) => {
        const selection = regionSelectionMap.get(d.properties.AREANM);
        if (!selection) return;
        toggleRegionSelection(buildGeographyKey(selection.country, selection.region));
        updateView();
      });

    labelLayer
      .selectAll(".region-label")
      .data(regionFeatures)
      .join("text")
      .attr("class", (d) =>
        labelEligibleRegions.has(d.properties.AREANM) ? "region-label" : "region-label hidden"
      )
      .attr("x", (d) => {
        const centroid = path.centroid(d);
        const override = labelPositionOverrides.get(d.properties.AREANM);
        return centroid[0] + (override ? override.x : 0);
      })
      .attr("y", (d) => {
        const centroid = path.centroid(d);
        const override = labelPositionOverrides.get(d.properties.AREANM);
        return centroid[1] + (override ? override.y : 0);
      })
      .text((d) => d.properties.AREANM);
  }

  function renderLegend() {
    const legend = d3.select("#legend-content");
    const sourceBlocks = legend
      .selectAll(".legend-source")
      .data(legendEntries)
      .join("div")
      .attr("class", "legend-source");

    const title = sourceBlocks.append("div").attr("class", "legend-source-title");
    title.append("span").attr("class", "legend-swatch").style("background", (d) => d.baseColor);
    title
      .append("span")
      .attr("class", "legend-label")
      .html((d) => `${d.source} <span class="legend-count" data-kind="source" data-key="${d.source}"></span>`);

    sourceBlocks
      .append("div")
      .attr("class", "legend-subcategories")
      .classed("is-hidden", (d) => d.subcategories.length === 0)
      .selectAll(".legend-item")
      .data((d) => d.subcategories)
      .join("div")
      .attr("class", "legend-item")
      .each(function (d) {
        const item = d3.select(this);
        item.append("span").attr("class", "legend-swatch").style("background", d.color);
        item
          .append("span")
          .attr("class", "legend-label")
          .html(
            `${d.name} <span class="legend-count" data-kind="subcategory" data-key="${d.name}"></span>`
          );
      });
  }

  function initFilterOptions() {
    populateSelect(
      filters.source,
      sourceOrder.filter((source) => plants.some((plant) => plant.source === source))
    );
    populateSelect(filters.subcategory, uniqueValues(plants, "subcategory"));
    populateSelect(filters.technology, uniqueValues(plants, "technology"));
    populateSelect(filters.status, uniqueValues(plants, "status"));
    syncRenewableOptions();
  }

  function populateSelect(select, values) {
    const data = [ALL, ...values];
    d3.select(select)
      .selectAll("option")
      .data(data)
      .join("option")
      .attr("value", (d) => d)
      .text((d) => d);
    select.value = ALL;
  }

  function uniqueValues(data, key) {
    return Array.from(new Set(data.map((d) => d[key]).filter(Boolean))).sort(d3.ascending);
  }

  function renderCountryButtons() {
    d3.select(geographyEls.countryButtons)
      .selectAll(".filter-pill")
      .data(countries)
      .join("button")
      .attr("type", "button")
      .attr("class", "filter-pill")
      .text((d) => d)
      .on("click", (_, country) => {
        toggleCountrySelection(country);
        updateView();
      });
  }

  function renderRegionButtons() {
    d3.select(geographyEls.regionButtons)
      .selectAll(".filter-pill")
      .data(allRegionEntries, (d) => d.key)
      .join("button")
      .attr("type", "button")
      .attr("class", "filter-pill")
      .text((d) => d.label)
      .on("click", (_, entry) => {
        if (!isRegionEnabled(entry)) return;
        toggleRegionSelection(entry.key);
        updateView();
      });
  }

  function renderSelectionChips() {
    const coveredRegions = new Set();
    state.selectedCountries.forEach((country) => {
      (regionsByCountry.get(country) || []).forEach((region) =>
        coveredRegions.add(buildGeographyKey(country, region))
      );
    });

    const chipData = [
      ...Array.from(state.selectedCountries).sort(d3.ascending).map((country) => ({
        type: "country",
        value: country,
        label: country,
      })),
      ...Array.from(state.selectedRegions)
        .filter((key) => !coveredRegions.has(key))
        .sort(d3.ascending)
        .map((key) => ({
          type: "region",
          value: key,
          label: regionEntryByKey.get(key).label,
        })),
    ];

    const chipList = d3.select(geographyEls.selectionChips);
    chipList.classed("is-empty", chipData.length === 0);

    const chips = chipList
      .selectAll(".selection-chip")
      .data(chipData, (d) => `${d.type}:${d.value}`)
      .join((enter) => {
        const chip = enter.append("div").attr("class", "selection-chip");
        chip.append("span");
        chip.append("button").attr("type", "button").text("×");
        return chip;
      });

    chips.select("span").text((d) => d.label);
    chips.select("button").on("click", (_, d) => {
      if (d.type === "country") {
        removeCountrySelection(d.value);
      } else {
        removeRegionSelection(d.value);
      }
      updateView();
    });
  }

  function renderPlants(data) {
    plantsLayer
      .selectAll(".plant-point")
      .data(data, (d) => d.id)
      .join("circle")
      .attr("class", "plant-point")
      .attr("r", config.pointRadius)
      .attr("cx", (d) => projection([d.lon, d.lat])[0])
      .attr("cy", (d) => projection([d.lon, d.lat])[1])
      .attr("fill", (d) => palette.get(d.source, d.subcategory))
      .attr("opacity", config.pointOpacity)
      .on("mouseenter", showPlantTooltip)
      .on("mousemove", moveTooltip)
      .on("click", (_, plant) => {
        filters.source.value = plant.source;
        filters.subcategory.value = plant.subcategory;
        filters.technology.value = plant.technology;
        syncRenewableOptions();
        updateView();
      })
      .on("mouseleave", hideTooltip);

    updatePointScale(1);
  }

  function toggleCountrySelection(country) {
    if (state.selectedCountries.has(country)) {
      removeCountrySelection(country);
      return;
    }

    (regionsByCountry.get(country) || []).forEach((region) =>
      state.selectedRegions.add(buildGeographyKey(country, region))
    );
    refreshSelectedCountries();
  }

  function removeCountrySelection(country) {
    (regionsByCountry.get(country) || []).forEach((region) =>
      state.selectedRegions.delete(buildGeographyKey(country, region))
    );
    refreshSelectedCountries();
  }

  function toggleRegionSelection(regionKey) {
    if (state.selectedRegions.has(regionKey)) {
      removeRegionSelection(regionKey);
      return;
    }

    state.selectedRegions.add(regionKey);
    refreshSelectedCountries();
  }

  function removeRegionSelection(regionKey) {
    state.selectedRegions.delete(regionKey);
    refreshSelectedCountries();
  }

  function refreshSelectedCountries() {
    state.selectedCountries = new Set(
      countries.filter((country) =>
        (regionsByCountry.get(country) || []).every((region) =>
          state.selectedRegions.has(buildGeographyKey(country, region))
        )
      )
    );
  }

  function clearAllSelections() {
    state.selectedCountries.clear();
    state.selectedRegions.clear();
    filters.source.value = ALL;
    filters.subcategory.value = ALL;
    filters.technology.value = ALL;
    filters.status.value = ALL;
    hideTooltip();
  }

  function selectAllGeography() {
    state.selectedRegions = new Set(allRegionEntries.map((entry) => entry.key));
    refreshSelectedCountries();
  }

  function selectLandOnlyGeography() {
    state.selectedRegions = new Set(
      allRegionEntries.filter((entry) => entry.region !== "Offshore").map((entry) => entry.key)
    );
    refreshSelectedCountries();
  }

  function selectOffshoreOnlyGeography() {
    state.selectedRegions = new Set(
      allRegionEntries.filter((entry) => entry.region === "Offshore").map((entry) => entry.key)
    );
    refreshSelectedCountries();
  }

  function hasGeographySelection() {
    return state.selectedRegions.size > 0;
  }

  function isAllGeographySelected() {
    return state.selectedRegions.size === allRegionEntries.length;
  }

  function getActiveCountryScope() {
    if (state.selectedCountries.size > 0) {
      return new Set(state.selectedCountries);
    }

    if (state.selectedRegions.size > 0) {
      return new Set(
        Array.from(state.selectedRegions).map((key) => regionEntryByKey.get(key).country)
      );
    }

    return new Set(countries);
  }

  function isRegionEnabled(entry) {
    if (!entry) return false;
    if (!hasGeographySelection()) {
      return true;
    }
    return getActiveCountryScope().has(entry.country);
  }

  function getScopedPlants() {
    return plants.filter(
      (plant) =>
        matchesGeographySelection(plant) &&
        (filters.status.value === ALL || plant.status === filters.status.value)
    );
  }

  function hasActivePlantFilters() {
    return (
      filters.source.value !== ALL ||
      filters.subcategory.value !== ALL ||
      filters.technology.value !== ALL ||
      filters.status.value !== ALL
    );
  }

  function matchesGeographySelection(plant) {
    if (!hasGeographySelection()) {
      return true;
    }
    return state.selectedRegions.has(buildGeographyKey(plant.country, plant.region));
  }

  function syncRenewableOptions() {
    const scopedPlants = getScopedPlants();
    let source = filters.source.value;
    let subcategory = filters.subcategory.value;
    let technology = filters.technology.value;

    const validSources = new Set(scopedPlants.map((plant) => plant.source));
    if (source !== ALL && !validSources.has(source)) {
      source = ALL;
      filters.source.value = ALL;
      filters.subcategory.value = ALL;
      filters.technology.value = ALL;
    }

    const bySource =
      source === ALL ? scopedPlants : scopedPlants.filter((plant) => plant.source === source);
    const validSubcategories = new Set(bySource.map((plant) => plant.subcategory));
    if (subcategory !== ALL && !validSubcategories.has(subcategory)) {
      subcategory = ALL;
      filters.subcategory.value = ALL;
      filters.technology.value = ALL;
    }

    const bySubcategory =
      subcategory === ALL
        ? bySource
        : bySource.filter((plant) => plant.subcategory === subcategory);
    const validTechnologies = new Set(bySubcategory.map((plant) => plant.technology));
    if (technology !== ALL && !validTechnologies.has(technology)) {
      filters.technology.value = ALL;
    }

    d3.select(filters.source)
      .selectAll("option")
      .property("disabled", (value) => value !== ALL && !validSources.has(value));
    d3.select(filters.subcategory)
      .selectAll("option")
      .property("disabled", (value) => value !== ALL && !validSubcategories.has(value));
    d3.select(filters.technology)
      .selectAll("option")
      .property("disabled", (value) => value !== ALL && !validTechnologies.has(value));
  }

  function syncSourceFromSubcategory() {
    const source = sourceBySubcategory.get(filters.subcategory.value);
    if (source) {
      filters.source.value = source;
    }
  }

  function syncRenewableChainFromTechnology() {
    const chain = filterChainByTechnology.get(filters.technology.value);
    if (chain) {
      filters.source.value = chain.source;
      filters.subcategory.value = chain.subcategory;
    }
  }

  function updateView() {
    const activeFilters = {
      source: filters.source.value,
      subcategory: filters.subcategory.value,
      technology: filters.technology.value,
      status: filters.status.value,
    };

    const shouldShowPlants = hasGeographySelection() || hasActivePlantFilters();
    const visiblePlants = shouldShowPlants
      ? plants.filter((plant) => matchesFilters(plant, activeFilters))
      : [];

    plantsLayer
      .selectAll(".plant-point")
      .classed("dimmed", (d) => !shouldShowPlants || !matchesFilters(d, activeFilters))
      .attr("display", (d) =>
        shouldShowPlants && matchesFilters(d, activeFilters) ? null : "none"
      );

    summaryEls.visibleCount.textContent = d3.format(",")(visiblePlants.length);
    summaryEls.sourceCount.textContent = uniqueValues(visiblePlants, "source").length;
    summaryEls.regionCount.textContent = uniqueValues(visiblePlants, "region").length;

    updateSelectionStateText();
    updateCountryButtonState();
    updateRegionButtonState();
    renderSelectionChips();
    updateRegionVisualState();
    updateEmptyState(shouldShowPlants);
    syncRenewableOptions();
    updateLegendCounts(visiblePlants);
  }

  function updateEmptyState(shouldShowPlants) {
    if (!emptyState) return;
    emptyState.classList.toggle("is-hidden", shouldShowPlants);
  }

  function matchesFilters(plant, activeFilters) {
    return (
      matchesGeographySelection(plant) &&
      (activeFilters.source === ALL || plant.source === activeFilters.source) &&
      (activeFilters.subcategory === ALL || plant.subcategory === activeFilters.subcategory) &&
      (activeFilters.technology === ALL || plant.technology === activeFilters.technology) &&
      (activeFilters.status === ALL || plant.status === activeFilters.status)
    );
  }

  function updateSelectionStateText() {
    if (!hasGeographySelection()) {
      geographyEls.selectionState.textContent = hasActivePlantFilters()
        ? "No area selected. Showing all UK plants that match the active renewable filters."
        : "No area selected. Choose areas or use renewable filters to show plants.";
      return;
    }

    if (isAllGeographySelected()) {
      geographyEls.selectionState.textContent =
        "Show all active. Every country and region is currently selected.";
      return;
    }

    geographyEls.selectionState.textContent = `${state.selectedRegions.size} region${
      state.selectedRegions.size === 1 ? "" : "s"
    } selected across ${getActiveCountryScope().size} countr${
      getActiveCountryScope().size === 1 ? "y" : "ies"
    }.`;
  }

  function updateCountryButtonState() {
    d3.select(geographyEls.countryButtons)
      .selectAll(".filter-pill")
      .classed("is-active", (country) => state.selectedCountries.has(country));
  }

  function updateRegionButtonState() {
    d3.select(geographyEls.regionButtons)
      .selectAll(".filter-pill")
      .classed("is-active", (entry) => state.selectedRegions.has(entry.key))
      .classed("is-disabled", (entry) => !isRegionEnabled(entry));
  }

  function updateRegionVisualState() {
    const selectedMapRegions = new Set(
      Array.from(state.selectedRegions)
        .map((key) => regionEntryByKey.get(key))
        .filter((entry) => entry.region !== "Offshore")
        .map((entry) => mapRegionByFilterRegion.get(entry.region))
        .filter(Boolean)
    );

    regionLayer.selectAll(".region-shape").each(function (d) {
      const region = d3.select(this);
      const isSelected = selectedMapRegions.has(d.properties.AREANM);
      const isHovered = state.hoveredMapRegion === d.properties.AREANM;
      const isDimmed = selectedMapRegions.size > 0 ? !isSelected : false;

      region
        .classed("is-selected", isSelected)
        .classed("is-hovered", isHovered)
        .classed("is-dimmed", isDimmed);
    });

    labelLayer.selectAll(".region-label").each(function (d) {
      const label = d3.select(this);
      const isSelected = selectedMapRegions.has(d.properties.AREANM);
      const isDimmed = selectedMapRegions.size > 0 ? !isSelected : false;
      label.classed("is-selected", isSelected).classed("is-dimmed", isDimmed);
    });
  }

  function showRegionTooltip(event, feature) {
    const summary = regionSummaries.get(feature.properties.AREANM);
    const rows = summary.sourceCounts
      .map(
        (item) => `
          <div class="tooltip-row">
            <span class="tooltip-key">
              <span class="tooltip-swatch" style="background:${config.basePalette[item.source]};"></span>
              ${item.source}
            </span>
            <span>${d3.format(",")(item.count)}</span>
          </div>
        `
      )
      .join("");

    tooltip
      .style("opacity", 1)
      .html(`
        <strong>${feature.properties.AREANM}</strong>
        <div class="tooltip-row">
          <span class="tooltip-key">Total plants</span>
          <span>${d3.format(",")(summary.total)}</span>
        </div>
        ${rows || '<div class="muted">No plants in this region.</div>'}
      `);
    moveTooltip(event);
  }

  function showPlantTooltip(event, plant) {
    tooltip
      .style("opacity", 1)
      .html(`
        <strong>Ref ID ${plant.id}</strong>
        <div>${plant.source} <span class="muted">/</span> ${plant.subcategory}</div>
        <div>${plant.technology}</div>
        <div>${plant.country} <span class="muted">/</span> ${plant.region}</div>
        <div>Status: ${plant.status}</div>
        <div class="muted">BNG: ${d3.format(",")(plant.x)}, ${d3.format(",")(plant.y)}</div>
      `);
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const bounds = mapCard.getBoundingClientRect();
    const tooltipNode = tooltip.node();
    const rawLeft = event.clientX - bounds.left + 14;
    const rawTop = event.clientY - bounds.top + 14;
    const tooltipWidth = tooltipNode ? tooltipNode.offsetWidth : 260;
    const tooltipHeight = tooltipNode ? tooltipNode.offsetHeight : 160;
    const maxLeft = Math.max(12, bounds.width - tooltipWidth - 12);
    const maxTop = Math.max(12, bounds.height - tooltipHeight - 12);
    const left = Math.min(Math.max(12, rawLeft), maxLeft);
    const top = Math.min(Math.max(12, rawTop), maxTop);
    tooltip.style("left", `${left}px`).style("top", `${top}px`);
  }

  function hideTooltip() {
    tooltip.style("opacity", 0);
  }

  function updatePointScale(zoomLevel) {
    const radius = Math.max(0.3, config.pointRadius / Math.pow(zoomLevel, 1.7));
    const strokeWidth = Math.max(0.015, 0.22 / Math.pow(zoomLevel, 1.75));

    plantsLayer
      .selectAll(".plant-point")
      .attr("r", radius)
      .attr("stroke-width", strokeWidth);
  }

  function updateLegendCounts(visiblePlants) {
    const sourceCounts = d3.rollup(
      visiblePlants,
      (items) => items.length,
      (d) => d.source
    );
    const subcategoryCounts = d3.rollup(
      visiblePlants,
      (items) => items.length,
      (d) => d.subcategory
    );

    d3.selectAll(".legend-count").text(function () {
      const node = this;
      const kind = node.dataset.kind;
      const key = node.dataset.key;
      const count = kind === "source" ? sourceCounts.get(key) : subcategoryCounts.get(key);
      return count ? `(${d3.format(",")(count)})` : "(0)";
    });
  }

  function buildGeographyKey(country, region) {
    return `${country}|||${region}`;
  }
})();
