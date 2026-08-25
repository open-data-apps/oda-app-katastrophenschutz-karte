/*
 * Katastrophenschutz-Karte
 * ODAS-App für offizielle Notfall-Anlaufstellen, Notrufstellen,
 * Infopunkte und Leuchttürme aus genau einer konfigurierten Datenquelle.
 */
let ksInstanzZaehler = 0;

// F-43: Registrierte Instanzen (Container -> State), damit der Top-Level-Hook
// onPageLeave() alle gemounteten Instanzen aufraeumen kann. Die Base ruft den
// Hook global ohne Container-Parameter auf; eine iterierbare Map ist daher das
// zur App passende Muster (schulwegsicherheit-Portfoliomuster).
const katastrophenInstances = new Map();

const KATASTROPHEN_TABLE_LIMIT = 500;
const KATASTROPHEN_MAX_RECORDS = 10000;

function isOdasProxyEnabled(configdata = {}) {
  return String(configdata.proxyAktiv || "").trim().toLowerCase() === "ja";
}

function extractPathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname + parsedUrl.search;
  } catch (_error) {
    return String(url || "");
  }
}

function getOdasAppBasePath(pathname) {
  let appPath =
    pathname === undefined
      ? typeof window !== "undefined"
        ? window.location.pathname
        : "/"
      : String(pathname || "/");

  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }

  return appPath.replace(/\/+$/, "");
}

function getOdasProxyEndpoint(targetUrl, pathname) {
  const appPath = getOdasAppBasePath(pathname);
  return `${appPath}/odp-data?path=${encodeURIComponent(targetUrl)}`;
}

async function fetchViaOdasProxy(targetUrl) {
  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}`);
  }

  const proxyData = await response.json();
  if (!proxyData || typeof proxyData.content !== "string") {
    throw new Error("ODAS-Proxy-Antwort enthält keinen content-String.");
  }

  return proxyData.content;
}

async function fetchOdasResource(targetUrl, configdata = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl);
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle.`,
    );
  }
}

/**
 * Löst eine benannte Datenressource aus configdata.apiurls auf.
 * Neue apiurls-Form (typ: "array"); das frühere skalare apiurl wird nicht mehr gelesen.
 * @returns {string} getrimmte URL, oder "" für den Zustand "keine Quelle konfiguriert"
 */
function getOdasApiUrl(configdata, name) {
  const liste = Array.isArray(configdata && configdata.apiurls) ? configdata.apiurls : [];
  const treffer = liste.find((eintrag) => eintrag && eintrag.name === name);
  return String((treffer && treffer.url) || "").trim();
}

async function fetchOdasJson(targetUrl, configdata = {}) {
  const rawContent = await fetchOdasResource(targetUrl, configdata);
  try {
    return JSON.parse(rawContent);
  } catch (_error) {
    throw new Error(
      `Die konfigurierte Daten-URL liefert kein JSON, sondern ${describeNonJsonPayload(rawContent)}. ` +
        "Bitte in der Instanzkonfiguration den API-Endpunkt der Datenquelle eintragen, " +
        "nicht den Datensatz- oder Download-Link.",
    );
  }
}

function describeNonJsonPayload(rawContent) {
  const text = String(rawContent == null ? "" : rawContent).trim();
  if (!text) return "eine leere Antwort";
  if (text.startsWith("<")) return "eine HTML-Seite";
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/[,;]/.test(firstLine)) return "eine CSV- oder Textdatei";
  return "unlesbaren Inhalt";
}

/*
 * Template-Hook (oda-generic 1.4.0). Die Base ruft ihn vor dem Rendern der neuen
 * Seite auf. Diese App haelt window-weite online/offline-Listener und eine
 * Leaflet-Karte; der Hook entfernt die Listener und die Karte und macht späte
 * Async-Renders durch das disposed-Flag wirkungslos.
 */
function onPageLeave(page) {
  katastrophenInstances.forEach((state, container) => {
    state.disposed = true;
    (state.listeners || []).forEach(([element, type, fn]) =>
      element.removeEventListener(type, fn),
    );
    state.listeners = [];
    if (state.map) {
      try {
        state.map.remove();
      } catch (error) {
        console.warn("Fehler beim Entfernen der Leaflet-Karte:", error);
      }
      state.map = null;
    }
    state.markerLayer = null;
    state.userLayer = null;
    katastrophenInstances.delete(container);
  });
}

function app(configdata, enclosingHtmlDivElement) {
  const ksUid = "i" + ++ksInstanzZaehler;
  // F-71: instanceId leitet sich aus demselben modul-globalen Zaehler wie
  // ksUid ab (nicht Math.random()), damit IDs zwischen Instanzen deterministisch
  // eindeutig und nicht nur "wahrscheinlich" eindeutig sind.
  const instanceId = "katastrophenschutz-karte-" + ksInstanzZaehler;
  const storageKey = "katastrophenschutz.cache.v1";
  const appConfig = buildAppConfig(configdata || {});
  const state = {
    allRecords: [],
    filteredRecords: [],
    selectedId: "",
    userLocation: null,
    loadWarnings: [],
    skippedRecords: 0,
    isOffline: !navigator.onLine,
    map: null,
    markerLayer: null,
    userLayer: null,
    currentRegion: "",
    currentType: "",
    currentSearch: "",
    currentRadius: "",
    sortMode: "distance",
    listeners: [],
    disposed: false,
  };

  katastrophenInstances.set(enclosingHtmlDivElement, state);

  const quelle = appConfig.apiUrl;
  if (!quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle)) {
    enclosingHtmlDivElement.innerHTML =
      '<div class="alert alert-info" role="alert">Es ist keine Datenquelle konfiguriert.</div>';
    return null;
  }

  renderLoading();

  const handleOnline = () => {
    state.isOffline = false;
    updateStatus();
  };
  const handleOffline = () => {
    state.isOffline = true;
    updateStatus();
  };
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  state.listeners.push(
    [window, "online", handleOnline],
    [window, "offline", handleOffline],
  );

  loadAllData()
    .then((records) => {
      if (state.disposed) return;
      if (!records.length) {
        const cached = readCache();
        if (cached.records.length) {
          state.isOffline = true;
          state.loadWarnings.push(
            "Aktuelle Datenquelle lieferte keine Standorte. Es werden zwischengespeicherte Daten angezeigt.",
          );
          state.allRecords = cached.records;
          renderShell();
          bindEvents();
          updateAll();
          renderMapWhenReady();
          return;
        }
        renderEmpty();
        return;
      }
      if (state.skippedRecords > 0) {
        // F-73: Verworfene Datensaetze ohne gueltige Koordinaten werden
        // gezaehlt und als Hinweis angezeigt statt kommentarlos zu verschwinden.
        state.loadWarnings.push(
          `${state.skippedRecords} von ${records.length + state.skippedRecords} Standorten ohne gültige Koordinaten wurden nicht auf der Karte angezeigt.`,
        );
      }
      state.allRecords = records;
      saveCache(records, "Automatisch nach Live-Abruf gespeichert");
      renderShell();
      bindEvents();
      updateAll();
      renderMapWhenReady();
    })
    .catch((error) => {
      if (state.disposed) return;
      const cached = readCache();
      if (cached.records.length) {
        state.isOffline = true;
        state.loadWarnings.push(
          "Live-Daten konnten nicht geladen werden. Es werden zwischengespeicherte Daten angezeigt.",
        );
        state.allRecords = cached.records;
        renderShell();
        bindEvents();
        updateAll();
        renderMapWhenReady();
        return;
      }

      renderError(error);
    });

  return null;

  function renderLoading() {
    enclosingHtmlDivElement.innerHTML = `
      <div class="d-flex align-items-center justify-content-center py-5">
        <div class="text-center">
          <div class="spinner-border text-primary mb-3" role="status" aria-hidden="true"></div>
          <h2 class="h5 mb-1">${escapeHtml(appConfig.title)}</h2>
          <p class="text-muted mb-0">Notfall-Anlaufstellen werden geladen ...</p>
        </div>
      </div>
    `;
  }

  function renderEmpty() {
    enclosingHtmlDivElement.innerHTML = `
      <div class="alert alert-info mt-4" role="alert">
        <h2 class="h5 alert-heading">${escapeHtml(appConfig.title)}</h2>
        <p class="mb-0">Die Datenquelle enthält derzeit keine auswertbaren Standorte.</p>
      </div>
    `;
  }

  function renderError(error) {
    enclosingHtmlDivElement.innerHTML = `
      <div class="alert alert-danger mt-4" role="alert">
        <h2 class="h5 alert-heading">Daten konnten nicht geladen werden</h2>
        <p class="mb-2">${escapeHtml(error.message || String(error))}</p>
        <p class="mb-0 small">Bitte prüfen Sie den konfigurierten Endpunkt in <code>apiurls.anlaufstellen</code> sowie die Einstellung von <code>proxyAktiv</code> in der Instanz-Konfiguration.</p>
      </div>
    `;
  }

  function renderShell() {
    enclosingHtmlDivElement.innerHTML = `
      <div id="${instanceId}">
        <div id="${instanceId}-kpis" class="row g-3 mb-3"></div>

        <div class="card border-secondary mb-3">
          <div class="card-body">
            <div class="d-flex flex-wrap align-items-end gap-3">
              <div>
                <label for="${instanceId}-region" class="form-label small fw-semibold mb-1">Region</label>
                <select id="${instanceId}-region" class="form-select form-select-sm" style="min-width:170px">
                  <option value="">Alle Regionen</option>
                </select>
              </div>
              <div>
                <label for="${instanceId}-type" class="form-label small fw-semibold mb-1">Typ</label>
                <select id="${instanceId}-type" class="form-select form-select-sm" style="min-width:170px">
                  <option value="">Alle Typen</option>
                  <option value="leuchtturm">Leuchtturm</option>
                  <option value="notrufstelle">Notrufstelle</option>
                  <option value="infopunkt">Notfall-Infopunkt</option>
                  <option value="anlaufstelle">Allgemeine Anlaufstelle</option>
                </select>
              </div>
              <div class="flex-grow-1" style="min-width:220px">
                <label for="${instanceId}-search" class="form-label small fw-semibold mb-1">Suche</label>
                <input id="${instanceId}-search" class="form-control form-control-sm" type="search" placeholder="Name, Ort oder Adresse suchen">
              </div>
              <div>
                <label for="${instanceId}-radius" class="form-label small fw-semibold mb-1">Radius</label>
                <select id="${instanceId}-radius" class="form-select form-select-sm" style="min-width:130px">
                  <option value="">Alle</option>
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                  <option value="25">25 km</option>
                </select>
              </div>
              <button id="${instanceId}-locate" class="btn btn-sm btn-outline-primary" type="button">Standort verwenden</button>
              <button id="${instanceId}-nearest" class="btn btn-sm btn-primary" type="button" disabled>Nächste Anlaufstelle</button>
              <button id="${instanceId}-cache" class="btn btn-sm btn-outline-secondary" type="button">Offline speichern</button>
            </div>
            <div id="${instanceId}-status" class="small text-muted mt-3"></div>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-lg-8">
            <div class="card border-secondary h-100">
              <div class="card-body">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                  <div>
                    <h2 class="h6 fw-semibold mb-0">${escapeHtml(appConfig.title)}</h2>
                    <span class="small text-muted">Karte der offiziellen Notfall-Anlaufstellen</span>
                  </div>
                  <span id="${instanceId}-map-count" class="badge bg-secondary"></span>
                </div>
                <div id="${instanceId}-map" style="height:480px; border-radius:8px; overflow:hidden; z-index:0"></div>
              </div>
            </div>
          </div>
          <div class="col-lg-4">
            <div id="${instanceId}-detail" class="card border-secondary h-100"></div>
          </div>
        </div>

        <div class="card border-secondary mb-3">
          <div class="card-body p-0">
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 p-3 border-bottom">
              <div>
                <h2 class="h6 fw-semibold mb-0">Anlaufstellen</h2>
                <span class="small text-muted">Sortiert nach Entfernung, sobald ein Standort gesetzt ist</span>
              </div>
              <span id="${instanceId}-table-count" class="badge bg-secondary"></span>
            </div>
            <div style="max-height:420px; overflow:auto">
              <table class="table table-sm table-hover align-middle mb-0">
                <thead class="table-dark sticky-top">
                  <tr>
                    <th>Name</th>
                    <th>Typ</th>
                    <th>Adresse</th>
                    <th>Region</th>
                    <th class="text-end">Entfernung</th>
                  </tr>
                </thead>
                <tbody id="${instanceId}-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-lg-6">
            <div class="card border-secondary h-100">
              <div class="card-body">
                <h2 class="h6 fw-semibold">Offline-Verwaltung</h2>
                <p class="small text-muted mb-2">Die zuletzt geladenen Standortdaten werden im Browser gespeichert und bei Verbindungsproblemen automatisch verwendet.</p>
                <dl class="row small mb-0">
                  <dt class="col-5">Letzter Speicherstand</dt>
                  <dd id="${instanceId}-cache-time" class="col-7 mb-1">-</dd>
                  <dt class="col-5">Gespeicherte Standorte</dt>
                  <dd id="${instanceId}-cache-count" class="col-7 mb-0">-</dd>
                </dl>
              </div>
            </div>
          </div>
          <div class="col-lg-6">
            <div class="card border-secondary h-100">
              <div class="card-body">
                <h2 class="h6 fw-semibold">Blackout-Checkliste</h2>
                <ul class="small mb-0">
                  <li>Ruhe bewahren und lokale Hinweise der Kommune beachten.</li>
                  <li>Radio mit Batterien oder Kurbelradio bereithalten.</li>
                  <li>Nachbarn unterstützen, besonders hilfsbedürftige Personen.</li>
                  <li>Notruf 112 nur bei akuter Gefahr wählen.</li>
                  <li>Nächste offizielle Anlaufstelle aufsuchen, wenn Telefon oder Internet ausfallen.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        ${renderWeitereInfos(configdata)}
        ${renderMethodikbox(configdata)}
        <div class="small text-muted mt-3">
          Datenbasis: ein konfigurierbarer Endpunkt über <code>apiurls.anlaufstellen</code> · Karte © OpenStreetMap contributors.
        </div>
      </div>
    `;

    renderRegionOptions();
    updateCacheInfo();
  }

  function bindEvents() {
    byId("region").addEventListener("change", (event) => {
      state.currentRegion = event.target.value;
      state.selectedId = "";
      updateAll();
    });
    byId("type").addEventListener("change", (event) => {
      state.currentType = event.target.value;
      state.selectedId = "";
      updateAll();
    });
    byId("search").addEventListener("input", (event) => {
      state.currentSearch = event.target.value.trim().toLowerCase();
      state.selectedId = "";
      updateAll();
    });
    byId("radius").addEventListener("change", (event) => {
      state.currentRadius = event.target.value;
      updateAll();
    });
    byId("locate").addEventListener("click", requestUserLocation);
    byId("nearest").addEventListener("click", selectNearestRecord);
    byId("cache").addEventListener("click", () => {
      saveCache(state.allRecords, "Manuell gespeichert");
      updateCacheInfo();
      updateStatus("Daten wurden für den Offline-Fall gespeichert.");
    });
  }

  function updateAll() {
    applyDistances();
    state.filteredRecords = getFilteredRecords();
    renderKpis();
    renderTable();
    renderDetail(getSelectedRecord());
    renderMapMarkers();
    updateStatus();
    updateCacheInfo();
  }

  function renderKpis() {
    const total = state.filteredRecords.length;
    const regions = new Set(state.filteredRecords.map((item) => item.region)).size;
    const types = new Set(state.filteredRecords.map((item) => item.category)).size;
    const withCoords = state.filteredRecords.filter(hasCoordinates).length;
    const nearest = getNearestRecord(state.filteredRecords);
    const nearestText =
      nearest && Number.isFinite(nearest.distanceKm)
        ? `${formatDistance(nearest.distanceKm)}`
        : "-";

    byId("kpis").innerHTML = `
      <div class="col-6 col-lg-3">
        <div class="card border-primary h-100">
          <div class="card-body text-center py-3">
            <div class="fs-3 fw-bold text-primary">${formatNumber(total)}</div>
            <div class="text-muted small">Standorte</div>\n              ${kpiContext(configdata.kpiKontext1, "1")}
          </div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="card border-info h-100">
          <div class="card-body text-center py-3">
            <div class="fs-3 fw-bold text-info">${regions}</div>
            <div class="text-muted small">Regionen</div>\n              ${kpiContext(configdata.kpiKontext2, "2")}
          </div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="card border-warning h-100">
          <div class="card-body text-center py-3">
            <div class="fs-3 fw-bold text-warning">${types}</div>
            <div class="text-muted small">Typgruppen</div>\n              ${kpiContext(configdata.kpiKontext3, "3")}
          </div>
        </div>
      </div>
      <div class="col-6 col-lg-3">
        <div class="card border-success h-100">
          <div class="card-body text-center py-3">
            <div class="fs-3 fw-bold text-success">${nearestText}</div>
            <div class="text-muted small">Nächste Stelle</div>\n              ${kpiContext(configdata.kpiKontext4, "4")}
          </div>
        </div>
      </div>
    `;

    const mapCount = byId("map-count");
    if (mapCount) {
      mapCount.textContent = `${formatNumber(withCoords)} mit Koordinaten`;
    }
    const nearestButton = byId("nearest");
    if (nearestButton) {
      nearestButton.disabled = !nearest;
    }
  }

  function renderRegionOptions() {
    const regions = [...new Set(state.allRecords.map((item) => item.region))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "de"));
    byId("region").innerHTML =
      `<option value="">Alle Regionen</option>` +
      regions
        .map(
          (region) =>
            `<option value="${escapeAttribute(region)}">${escapeHtml(region)}</option>`,
        )
        .join("");
  }

  function renderTable() {
    const tbody = byId("table-body");
    const rows = state.filteredRecords.slice(0, KATASTROPHEN_TABLE_LIMIT);
    byId("table-count").textContent = `${formatNumber(state.filteredRecords.length)} Treffer${
      state.filteredRecords.length > rows.length ? " · Top " + rows.length : ""
    }`;

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-4">Keine Anlaufstellen für die aktuelle Auswahl.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = rows
      .map((record) => {
        const active = record.id === state.selectedId ? "table-primary" : "";
        return `
          <tr class="${active}" data-id="${escapeAttribute(record.id)}" style="cursor:pointer">
            <td>
              <span class="fw-semibold">${escapeHtml(record.name)}</span>
              <div class="small text-muted">${escapeHtml(record.sourceLabel)}</div>
            </td>
            <td>${renderTypeBadge(record)}</td>
            <td>${escapeHtml(record.address || "-")}</td>
            <td>${escapeHtml(record.region || "-")}</td>
            <td class="text-end">${formatDistance(record.distanceKm)}</td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => {
        selectRecord(row.dataset.id, true);
      });
    });
  }

  function renderDetail(record) {
    const detail = byId("detail");
    if (!record) {
      detail.innerHTML = `
        <div class="card-body">
          <h2 class="h6 fw-semibold">Details</h2>
          <p class="text-muted small mb-0">Wählen Sie eine Anlaufstelle in der Karte oder Tabelle aus.</p>
        </div>
      `;
      return;
    }

    const mapsUrl = hasCoordinates(record)
      ? `https://www.google.com/maps/dir/?api=1&destination=${record.latitude},${record.longitude}`
      : "";
    const services = inferServices(record)
      .map((service) => `<li>${escapeHtml(service)}</li>`)
      .join("");

    detail.innerHTML = `
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <h2 class="h6 fw-semibold mb-0">${escapeHtml(record.name)}</h2>
          ${renderTypeBadge(record)}
        </div>
        <p class="small text-muted mb-2">${escapeHtml(record.address || "Adresse nicht angegeben")}</p>
        <dl class="row small mb-3">
          <dt class="col-5">Region</dt>
          <dd class="col-7 mb-1">${escapeHtml(record.region || "-")}</dd>
          <dt class="col-5">Entfernung</dt>
          <dd class="col-7 mb-1">${formatDistance(record.distanceKm)}</dd>
          <dt class="col-5">Gehzeit</dt>
          <dd class="col-7 mb-1">${formatWalkingTime(record.distanceKm)}</dd>
          <dt class="col-5">Quelle</dt>
          <dd class="col-7 mb-0">${escapeHtml(record.sourceLabel)}</dd>
        </dl>
        <h3 class="h6 fw-semibold">Verfügbare Dienste</h3>
        <ul class="small mb-3">${services}</ul>
        <div class="d-grid gap-2">
          ${
            mapsUrl
              ? `<a class="btn btn-primary btn-sm" href="${mapsUrl}" target="_blank" rel="noopener">Navigation starten</a>`
              : `<button class="btn btn-primary btn-sm" type="button" disabled>Navigation nicht verfügbar</button>`
          }
          <a class="btn btn-outline-danger btn-sm" href="tel:112">Notruf 112 anrufen</a>
        </div>
      </div>
    `;
  }

  function renderMapWhenReady() {
    loadLeaflet()
      .then(() => {
        if (state.disposed) return;
        initialiseMap();
        renderMapMarkers();
      })
      .catch((error) => {
        if (state.disposed) return;
        const mapEl = byId("map");
        if (mapEl) {
          mapEl.innerHTML = `
            <div class="alert alert-warning m-3" role="alert">
              Leaflet konnte nicht geladen werden: ${escapeHtml(error.message || String(error))}
            </div>
          `;
        }
      });
  }

  function initialiseMap() {
    if (state.map || !window.L) return;
    const mapElement = byId("map");
    if (!mapElement) return;
    // F-71: L.map() erhaelt eine Element-Referenz statt einer String-ID,
    // damit Leaflet nicht intern per document.getElementById auf die
    // instanzabhaengige ID angewiesen ist.
    state.map = L.map(mapElement, {
      scrollWheelZoom: true,
      preferCanvas: true,
    }).setView([51.52, 7.1], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);
    state.markerLayer = L.layerGroup().addTo(state.map);
    state.userLayer = L.layerGroup().addTo(state.map);
  }

  function renderMapMarkers() {
    if (!state.map || !state.markerLayer || !window.L) return;
    state.markerLayer.clearLayers();
    state.userLayer.clearLayers();

    const recordsWithCoordinates = state.filteredRecords.filter(hasCoordinates);
    recordsWithCoordinates.forEach((record) => {
      const marker = L.circleMarker([record.latitude, record.longitude], {
        radius: 7,
        color: getTypeColor(record.category),
        fillColor: getTypeColor(record.category),
        fillOpacity: 0.78,
        weight: 2,
      });
      marker.bindPopup(`
        <strong>${escapeHtml(record.name)}</strong><br>
        ${escapeHtml(record.address || "")}<br>
        <span>${escapeHtml(record.typeLabel)}</span>
      `);
      marker.on("click", () => selectRecord(record.id, false));
      marker.addTo(state.markerLayer);
    });

    if (state.userLocation) {
      L.circleMarker([state.userLocation.latitude, state.userLocation.longitude], {
        radius: 8,
        color: "#0d6efd",
        fillColor: "#0d6efd",
        fillOpacity: 0.3,
        weight: 3,
      })
        .bindPopup("Ihr Standort")
        .addTo(state.userLayer);
    }

    const boundsItems = recordsWithCoordinates
      .slice(0, 500)
      .map((record) => [record.latitude, record.longitude]);
    if (state.userLocation) {
      boundsItems.push([state.userLocation.latitude, state.userLocation.longitude]);
    }
    if (boundsItems.length) {
      state.map.fitBounds(L.latLngBounds(boundsItems), { padding: [24, 24] });
    }
  }

  function updateStatus(message) {
    const status = byId("status");
    if (!status) return;
    const warningText = state.loadWarnings.length
      ? ` · Hinweise: ${state.loadWarnings.map(escapeHtml).join(" | ")}`
      : "";
    const offlineBadge = state.isOffline
      ? '<span class="badge bg-danger me-2">Offline-Modus</span>'
      : '<span class="badge bg-success me-2">Live-Modus</span>';
    const standHtml = appConfig.datenStand
      ? '<small class="text-muted ms-2">' + escapeHtml(appConfig.datenStand) + '</small>'
      : "";
    const locationText = state.userLocation
      ? `Standort gesetzt (${state.userLocation.latitude.toFixed(4)}, ${state.userLocation.longitude.toFixed(4)})`
      : "Standort noch nicht gesetzt";
    status.innerHTML = `${offlineBadge}${standHtml}${escapeHtml(message || locationText)}${warningText}`;
  }

  function updateCacheInfo() {
    const cached = readCache();
    const timeEl = byId("cache-time");
    const countEl = byId("cache-count");
    if (!timeEl || !countEl) return;
    timeEl.textContent = cached.savedAt
      ? new Date(cached.savedAt).toLocaleString("de-DE")
      : "-";
    countEl.textContent = cached.records.length
      ? `${formatNumber(cached.records.length)} Standorte`
      : "-";
  }

  function requestUserLocation() {
    const button = byId("locate");
    button.disabled = true;
    button.textContent = "Standort wird ermittelt ...";
    if (!navigator.geolocation) {
      button.disabled = false;
      button.textContent = "Standort verwenden";
      updateStatus("Geolocation wird von diesem Browser nicht unterstützt.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (state.disposed) return;
        state.userLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        button.disabled = false;
        button.textContent = "Standort aktualisieren";
        updateAll();
      },
      (error) => {
        if (state.disposed) return;
        button.disabled = false;
        button.textContent = "Standort verwenden";
        updateStatus("Standort konnte nicht ermittelt werden: " + error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  }

  function selectNearestRecord() {
    const nearest = getNearestRecord(state.filteredRecords);
    if (nearest) {
      selectRecord(nearest.id, true);
    }
  }

  function selectRecord(id, moveMap) {
    state.selectedId = id;
    const record = state.allRecords.find((item) => item.id === id);
    renderDetail(record);
    renderTable();
    if (moveMap && state.map && record && hasCoordinates(record)) {
      state.map.setView([record.latitude, record.longitude], Math.max(state.map.getZoom(), 14));
    }
  }

  function getSelectedRecord() {
    if (state.selectedId) {
      const selected = state.allRecords.find((item) => item.id === state.selectedId);
      if (selected) return selected;
    }
    return state.filteredRecords[0] || null;
  }

  function getNearestRecord(records) {
    if (!state.userLocation) return null;
    return records
      .filter((item) => Number.isFinite(item.distanceKm))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  }

  function getFilteredRecords() {
    const radius = Number(state.currentRadius);
    return state.allRecords
      .filter((record) => {
        if (state.currentRegion && record.region !== state.currentRegion) return false;
        if (state.currentType && record.category !== state.currentType) return false;
        if (radius && Number.isFinite(radius)) {
          if (!Number.isFinite(record.distanceKm) || record.distanceKm > radius) return false;
        }
        if (state.currentSearch) {
          const haystack = [
            record.name,
            record.address,
            record.region,
            record.typeLabel,
            record.sourceLabel,
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(state.currentSearch)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (state.userLocation) {
          const distanceA = Number.isFinite(a.distanceKm) ? a.distanceKm : Infinity;
          const distanceB = Number.isFinite(b.distanceKm) ? b.distanceKm : Infinity;
          if (distanceA !== distanceB) return distanceA - distanceB;
        }
        return `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, "de");
      });
  }

  function applyDistances() {
    if (!state.userLocation) {
      state.allRecords.forEach((record) => {
        record.distanceKm = null;
      });
      return;
    }
    state.allRecords.forEach((record) => {
      record.distanceKm = hasCoordinates(record)
        ? haversineKm(
            state.userLocation.latitude,
            state.userLocation.longitude,
            record.latitude,
            record.longitude,
          )
        : null;
    });
  }

  async function loadAllData() {
    if (
      !appConfig.apiUrl ||
      /^\{\{.*\}\}$/.test(appConfig.apiUrl) ||
      /^<.*>$/.test(appConfig.apiUrl)
    ) {
      throw new Error("Keine Datenquelle konfiguriert (apiurls.anlaufstellen fehlt).");
    }

    const records = await loadGenericSource(appConfig.apiUrl);
    return dedupeRecords(records).slice(0, KATASTROPHEN_MAX_RECORDS);
  }

  async function loadGenericSource(url) {
    const text = await fetchTextWithProxyFallback(url);
    const trimmed = text.trim();
    if (trimmed.startsWith("<")) {
      return parseKrznGml(trimmed, {
        key: "generic-wfs",
        label: "WFS",
        typeName: "generic",
      });
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const json = JSON.parse(trimmed);
      return normalizeJsonRecords(json, "API", "api");
    }
    return parseCsv(text, "CSV", "csv");
  }

  // Datenabruf: direkt oder ueber den ODAS-Proxy (proxyAktiv)
  async function fetchTextWithProxyFallback(url) {
    try {
      return await fetchOdasResource(url, configdata);
    } catch (error) {
      throw new Error(
        `Abruf fehlgeschlagen (${shortenUrl(url)}): ${error.message}`,
      );
    }
  }

  function parseKrznGml(xmlText, layer) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserError = firstElementByLocalName(doc, ["parsererror", "exceptiontext"]);
    if (parserError) {
      throw new Error(
        `${layer.label}: GML konnte nicht gelesen werden (${cleanText(parserError.textContent)})`,
      );
    }

    const members = Array.from(doc.getElementsByTagName("*")).filter((element) =>
      ["member", "featuremember"].includes(normalizeKey(element.localName)),
    );
    const featureRoots = members.length
      ? members.map((member) => firstFeatureChild(member) || member)
      : Array.from(doc.getElementsByTagName("*")).filter((element) =>
          normalizeKey(element.localName).includes("notfallanlaufstellen"),
        );

    return featureRoots
      .map((feature, index) => normalizeKrznFeature(feature, layer, index))
      .filter(Boolean);
  }

  function normalizeKrznFeature(feature, layer, index) {
    const pair = extractCoordinatePair(feature);
    if (!pair) return null;
    const kind = getTextByLocalNames(feature, [
      "art_anlaufstelle",
      "art",
      "type",
      "typ",
    ]);
    const callName = getTextByLocalNames(feature, [
      "funkrufname",
      "name",
      "bezeichnung",
      "titel",
    ]);
    const site = getTextByLocalNames(feature, ["standort", "einrichtung"]);
    const nipType = getTextByLocalNames(feature, ["art_nip", "kategorie"]);
    const street = getTextByLocalNames(feature, ["strasse", "straße"]);
    const houseNumber = getTextByLocalNames(feature, ["hausnr", "hausnummer"]);
    const houseNumberSuffix = getTextByLocalNames(feature, ["hausnrzusatz"]);
    const zip = getTextByLocalNames(feature, ["plz"]);
    const city = getTextByLocalNames(feature, ["kommune", "ort"]);
    const district = getTextByLocalNames(feature, ["ortsteil"]);
    const primaryName =
      callName && normalizeKey(callName) !== normalizeKey(kind) ? callName : site;
    const name = [kind, primaryName].filter(Boolean).join(" ") || `${layer.label} Anlaufstelle`;
    const streetLine = [street, [houseNumber, houseNumberSuffix].filter(Boolean).join("")].filter(Boolean).join(" ");
    const cityLine = [zip, city].filter(Boolean).join(" ");
    const address = [streetLine, cityLine, district].filter(Boolean).join(", ");
    const type = [kind, nipType, site].filter(Boolean).join(" ") || inferTypeFromName(name);
    const id =
      feature.getAttribute("gml:id") ||
      feature.getAttribute("fid") ||
      `${layer.key}-${index}-${name}-${address}`;

    return normalizeRecord({
      id,
      name,
      address,
      type,
      region: layer.label,
      latitude: pair.latitude,
      longitude: pair.longitude,
      sourceLabel: "KRZN WFS",
      sourceKey: layer.key,
    });
  }

  function parseCsv(csvText, regionLabel, sourceKey) {
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) return [];
    const headers = rows[0].map((header) => cleanText(header));
    const records = [];
    for (let index = 1; index < rows.length; index++) {
      const row = rows[index];
      if (!row.some((cell) => cleanText(cell))) continue;
      const raw = {};
      headers.forEach((header, headerIndex) => {
        raw[header] = row[headerIndex] || "";
      });
      const coords = extractCoordinatesFromObject(raw);
      const name =
        getValue(raw, ["name", "bezeichnung", "titel", "standort", "einrichtung"]) ||
        "Notfall-Anlaufstelle";
      const address =
        getValue(raw, ["address", "adresse", "anschrift", "strasse", "straße"]) ||
        buildAddress(raw);
      const type =
        getValue(raw, ["type", "typ", "art", "kategorie", "funktion"]) ||
        inferTypeFromName(name);
      const region =
        getValue(raw, ["region", "kommune", "stadt", "ort", "bezirk"]) || regionLabel;

      records.push(
        normalizeRecord({
          id:
            getValue(raw, ["id", "fid", "objectid", "uuid"]) ||
            `${sourceKey}-${index}-${name}-${address}`,
          name,
          address,
          type,
          region,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
          sourceLabel: regionLabel,
          sourceKey,
        }),
      );
    }
    const withCoordinates = records.filter(hasCoordinates);
    // F-73: Datensaetze ohne gueltige Koordinaten werden gezaehlt statt
    // kommentarlos verworfen zu werden.
    state.skippedRecords += records.length - withCoordinates.length;
    return withCoordinates;
  }

  function normalizeJsonRecords(json, sourceLabel, sourceKey) {
    const records = Array.isArray(json)
      ? json
      : Array.isArray(json.results)
        ? json.results
        : Array.isArray(json.records)
          ? json.records
          : Array.isArray(json.result && json.result.records)
            ? json.result.records
            : [];
    const normalized = records.map((raw, index) => {
      const record = raw.fields || raw;
      const coords = extractCoordinatesFromObject(record);
      return normalizeRecord({
        id:
          getValue(record, ["id", "fid", "objectid", "uuid"]) ||
          `${sourceKey}-${index}`,
        name:
          getValue(record, ["name", "bezeichnung", "titel", "standort"]) ||
          "Notfall-Anlaufstelle",
        address:
          getValue(record, ["address", "adresse", "anschrift", "strasse", "straße"]) ||
          buildAddress(record),
        type:
          getValue(record, ["type", "typ", "art", "kategorie"]) ||
          inferTypeFromName(JSON.stringify(record)),
        region: getValue(record, ["region", "kommune", "stadt", "ort"]) || sourceLabel,
        latitude: coords ? coords.latitude : null,
        longitude: coords ? coords.longitude : null,
        sourceLabel,
        sourceKey,
      });
    });
    const withCoordinates = normalized.filter(hasCoordinates);
    // F-73: Datensaetze ohne gueltige Koordinaten werden gezaehlt statt
    // kommentarlos verworfen zu werden.
    state.skippedRecords += normalized.length - withCoordinates.length;
    return withCoordinates;
  }

  function normalizeRecord(input) {
    const category = classifyType(`${input.name} ${input.type}`);
    return {
      id: String(input.id || `${input.sourceKey}-${input.name}`).trim(),
      name: cleanText(input.name) || "Notfall-Anlaufstelle",
      address: cleanText(input.address),
      typeLabel: cleanText(input.type) || getCategoryLabel(category),
      category,
      region: cleanText(input.region) || "Unbekannt",
      latitude: parseNumber(input.latitude),
      longitude: parseNumber(input.longitude),
      sourceLabel: cleanText(input.sourceLabel) || "Datenquelle",
      sourceKey: cleanText(input.sourceKey) || "source",
      distanceKm: null,
    };
  }

  function dedupeRecords(records) {
    const map = new Map();
    records.forEach((record) => {
      if (!hasCoordinates(record)) return;
      const key = [
        record.name.toLowerCase(),
        record.address.toLowerCase(),
        record.latitude.toFixed(5),
        record.longitude.toFixed(5),
      ].join("|");
      if (!map.has(key)) {
        map.set(key, record);
      }
    });
    return [...map.values()];
  }

  function extractCoordinatePair(root) {
    const posText = getTextByLocalNames(root, ["pos", "coordinates", "koord", "koordinaten"]);
    if (posText) {
      const numbers = posText.match(/-?\d+(?:[.,]\d+)?/g);
      if (numbers && numbers.length >= 2) {
        return normalizeCoordinatePair(parseNumber(numbers[0]), parseNumber(numbers[1]));
      }
    }
    return null;
  }

  function extractCoordinatesFromObject(raw) {
    const geo = getValue(raw, [
      "geo_point_2d",
      "geopoint",
      "geopunkt",
      "koordinaten",
      "coordinates",
      "geometry",
      "wkt",
    ]);
    if (geo) {
      if (typeof geo === "object") {
        const lat = geo.lat || geo.latitude;
        const lon = geo.lon || geo.lng || geo.longitude;
        if (lat && lon) return normalizeCoordinatePair(parseNumber(lon), parseNumber(lat));
      }
      const numbers = String(geo).match(/-?\d+(?:[.,]\d+)?/g);
      if (numbers && numbers.length >= 2) {
        return normalizeCoordinatePair(parseNumber(numbers[0]), parseNumber(numbers[1]));
      }
    }

    const lon =
      getValue(raw, ["longitude", "lon", "lng", "x", "rechtswert"]) ||
      getValue(raw, ["laenge", "längengrad"]);
    const lat =
      getValue(raw, ["latitude", "lat", "y", "hochwert"]) ||
      getValue(raw, ["breite", "breitengrad"]);
    if (lon && lat) {
      return normalizeCoordinatePair(parseNumber(lon), parseNumber(lat));
    }
    return null;
  }

  function normalizeCoordinatePair(first, second) {
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
      return { longitude: first, latitude: second };
    }
    if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
      return { longitude: second, latitude: first };
    }
    const converted = epsg25832ToWgs84(first, second);
    return {
      longitude: converted.longitude,
      latitude: converted.latitude,
    };
  }

  function epsg25832ToWgs84(easting, northing) {
    const a = 6378137;
    const f = 1 / 298.257222101;
    const k0 = 0.9996;
    const lon0 = (9 * Math.PI) / 180;
    const e2 = f * (2 - f);
    const ePrime2 = e2 / (1 - e2);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const x = easting - 500000;
    const m = northing / k0;
    const mu =
      m /
      (a *
        (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
    const phi1 =
      mu +
      ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) *
        Math.sin(4 * mu) +
      ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
      ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);
    const sinPhi1 = Math.sin(phi1);
    const cosPhi1 = Math.cos(phi1);
    const tanPhi1 = Math.tan(phi1);
    const n1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
    const r1 =
      (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
    const t1 = tanPhi1 * tanPhi1;
    const c1 = ePrime2 * cosPhi1 * cosPhi1;
    const d = x / (n1 * k0);
    const lat =
      phi1 -
      ((n1 * tanPhi1) / r1) *
        ((d * d) / 2 -
          ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ePrime2) *
            Math.pow(d, 4)) /
            24 +
          ((61 +
            90 * t1 +
            298 * c1 +
            45 * t1 * t1 -
            252 * ePrime2 -
            3 * c1 * c1) *
            Math.pow(d, 6)) /
            720);
    const lon =
      lon0 +
      (d -
        ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
        ((5 -
          2 * c1 +
          28 * t1 -
          3 * c1 * c1 +
          8 * ePrime2 +
          24 * t1 * t1) *
          Math.pow(d, 5)) /
          120) /
        cosPhi1;
    return {
      latitude: (lat * 180) / Math.PI,
      longitude: (lon * 180) / Math.PI,
    };
  }

  function parseCsvRows(text) {
    const delimiter = detectCsvDelimiter(text);
    const rows = [];
    let current = "";
    let row = [];
    let inQuotes = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        row.push(current);
        current = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") index++;
        row.push(current);
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  function detectCsvDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const semicolons = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    return semicolons >= commas ? ";" : ",";
  }

  function firstFeatureChild(member) {
    return Array.from(member.children).find((child) => {
      const key = normalizeKey(child.localName);
      return key !== "boundedby" && key !== "featuremember";
    });
  }

  function firstElementByLocalName(root, names) {
    const normalizedNames = names.map(normalizeKey);
    return Array.from(root.getElementsByTagName("*")).find((element) =>
      normalizedNames.includes(normalizeKey(element.localName)),
    );
  }

  function getTextByLocalNames(root, names) {
    const element = firstElementByLocalName(root, names);
    return element ? cleanText(element.textContent) : "";
  }

  function getValue(record, aliases) {
    const keys = Object.keys(record || {});
    for (const alias of aliases) {
      const match = keys.find((key) => normalizeKey(key) === normalizeKey(alias));
      if (match && record[match] !== undefined && record[match] !== null) {
        const value = record[match];
        if (typeof value === "object") return value;
        const cleaned = cleanText(value);
        if (cleaned) return cleaned;
      }
    }
    for (const alias of aliases) {
      const match = keys.find((key) =>
        normalizeKey(key).includes(normalizeKey(alias)),
      );
      if (match && record[match] !== undefined && record[match] !== null) {
        const value = record[match];
        if (typeof value === "object") return value;
        const cleaned = cleanText(value);
        if (cleaned) return cleaned;
      }
    }
    return "";
  }

  function buildAddress(record) {
    const street = getValue(record, ["strasse", "straße", "street"]);
    const number = getValue(record, ["hausnummer", "hausnr", "number"]);
    const zip = getValue(record, ["plz", "postcode"]);
    const city = getValue(record, ["ort", "stadt", "kommune", "city"]);
    return [street && `${street} ${number}`.trim(), [zip, city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
  }

  function inferTypeFromName(text) {
    const category = classifyType(text);
    return getCategoryLabel(category);
  }

  function classifyType(text) {
    const value = normalizeKey(text);
    if (value.includes("leuchtturm")) return "leuchtturm";
    if (value.includes("notruf")) return "notrufstelle";
    if (value.includes("info")) return "infopunkt";
    return "anlaufstelle";
  }

  function inferServices(record) {
    const base = ["Informationen zum Strom- oder Kommunikationsausfall"];
    if (record.category === "leuchtturm") {
      return ["Notstromgestützte Anlaufstelle", "Notruf-Weiterleitung", ...base];
    }
    if (record.category === "notrufstelle") {
      return ["Notruf absetzen oder weiterleiten", "Kontakt zur Feuerwehr", ...base];
    }
    if (record.category === "infopunkt") {
      return ["Offizielle Lageinformationen", "Hinweise der Kommune", ...base];
    }
    return ["Allgemeine Anlaufstelle für Bürger", ...base];
  }

  function renderTypeBadge(record) {
    const badgeClass =
      record.category === "leuchtturm"
        ? "bg-danger"
        : record.category === "notrufstelle"
          ? "bg-warning text-dark"
          : record.category === "infopunkt"
            ? "bg-info text-dark"
            : "bg-primary";
    return `<span class="badge ${badgeClass}">${escapeHtml(record.typeLabel || getCategoryLabel(record.category))}</span>`;
  }

  function getCategoryLabel(category) {
    return (
      {
        leuchtturm: "Leuchtturm",
        notrufstelle: "Notrufstelle",
        infopunkt: "Notfall-Infopunkt",
        anlaufstelle: "Anlaufstelle",
      }[category] || "Anlaufstelle"
    );
  }

  function getTypeColor(category) {
    return (
      {
        leuchtturm: "#dc3545",
        notrufstelle: "#fd7e14",
        infopunkt: "#ffc107",
        anlaufstelle: "#0d6efd",
      }[category] || "#0d6efd"
    );
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (window.katasMapLeafletPromise) return window.katasMapLeafletPromise;
    window.katasMapLeafletPromise = new Promise((resolve, reject) => {
      if (!document.getElementById("katastrophen-leaflet-css")) {
        const link = document.createElement("link");
        link.id = "katastrophen-leaflet-css";
        link.rel = "stylesheet";
        link.href = "vendor/leaflet/leaflet.css";
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.id = "katastrophen-leaflet-js";
      script.src = "vendor/leaflet/leaflet.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Leaflet-Skript konnte nicht geladen werden."));
      document.head.appendChild(script);
    });
    return window.katasMapLeafletPromise;
  }

  function saveCache(records, note) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          note,
          records,
        }),
      );
    } catch (error) {
      state.loadWarnings.push("Offline-Speicher konnte nicht geschrieben werden.");
    }
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { savedAt: "", records: [] };
      const parsed = JSON.parse(raw);
      return {
        savedAt: parsed.savedAt || "",
        records: Array.isArray(parsed.records) ? parsed.records : [],
      };
    } catch (error) {
      return { savedAt: "", records: [] };
    }
  }

  function hasCoordinates(record) {
    return (
      record &&
      Number.isFinite(record.latitude) &&
      Number.isFinite(record.longitude) &&
      Math.abs(record.latitude) <= 90 &&
      Math.abs(record.longitude) <= 180
    );
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const radius = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function parseNumber(value) {
    if (typeof value === "number") return value;
    if (value === undefined || value === null) return NaN;
    return Number(String(value).trim().replace(",", "."));
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("de-DE");
  }

  function formatDistance(value) {
    if (!Number.isFinite(value)) return "-";
    if (value < 1) return `${Math.round(value * 1000)} m`;
    return `${value.toFixed(1).replace(".", ",")} km`;
  }

  function formatWalkingTime(value) {
    if (!Number.isFinite(value)) return "-";
    const minutes = Math.max(1, Math.round((value / 4.5) * 60));
    return `${minutes} Min. zu Fuß`;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function shortenUrl(url) {
    return url.length > 90 ? `${url.slice(0, 87)}...` : url;
  }

  function byId(suffix) {
    return document.getElementById(`${instanceId}-${suffix}`);
  }

  function buildAppConfig(raw) {
    return {
      title: raw.titel || raw.title || "Katastrophenschutz-Karte",
      apiUrl: getOdasApiUrl(raw, "anlaufstellen"),
      datenStand: String(raw.datenStand || "").trim(),
      weiterfuehrendeLinks: raw.weiterfuehrendeLinks || "",
    };
  }


  /* ── Schale 4: KPI Kontext ── */
  function kpiContext(kontext, id) {
    var text = String(kontext || "").trim();
    if (!text) return "";
    var targetId = "ks-kpi-kontext-" + id + "-" + ksUid;
    return (
      '<button class="ks-kpi-info-toggle collapsed" type="button" ' +
      'data-bs-toggle="collapse" data-bs-target="#' + targetId + '" ' +
      'aria-expanded="false" aria-controls="' + targetId + '" ' +
      'aria-label="Erklärung zu diesem Wert">' +
      '<span class="ks-kpi-info-icon" aria-hidden="true">ⓘ</span>' +
      "</button>" +
      '<div id="' + targetId + '" class="collapse">' +
      '<div class="ks-kpi-kontext">' + escapeHtml(text) + "</div>" +
      "</div>"
    );
  }

  /* ── Schale 4: Methodikbox ── */
  function renderMethodikbox(cfg) {
    var hinweis = ((cfg && cfg.datenquelleHinweis) || "").trim();
    var stand = ((cfg && cfg.datenStand) || "").trim();
    if (!hinweis && !stand) return "";
    var standHtml = stand
      ? '<p class="text-muted small mb-2">' + escapeHtml(stand) + "</p>"
      : "";
    return (
      '<section class="ks-methodik mt-3">' +
      '<button class="ks-methodik-toggle collapsed" type="button" ' +
      'data-bs-toggle="collapse" data-bs-target="#ks-methodik-body-' + ksUid + '" ' +
      'aria-expanded="false" aria-controls="ks-methodik-body-' + ksUid + '">' +
      '<h2 class="h5 mb-0">Methodik &amp; Datenquelle</h2>' +
      '<span class="ks-methodik-chevron" aria-hidden="true">&#9662;</span>' +
      "</button>" +
      '<div id="ks-methodik-body-' + ksUid + '" class="collapse">' +
      '<div class="ks-methodik-content">' +
      standHtml +
      hinweis +
      "</div></div></section>"
    );
  }

  function renderWeitereInfos(cfg) {
    var links = String((cfg && cfg.weiterfuehrendeLinks) || "").trim();
    if (!links) return "";
    return (
      '<section class="ks-section ks-weitere-infos mt-3">' +
      "<h3>Weitere Informationen</h3>" +
      "<div>" +
      links +
      "</div>" +
      "</section>"
    );
  }
}

function addToHead() {
  return;
}
