# Changelog

## 1.15.0 - 2026-08-11
- FIX: Späte Geolocation-Erfolgs- und Fehlercallbacks brechen nach dem Seitenwechsel ohne DOM- oder Karten-Update ab (F-43-Nachtrag)

## 1.14.0 - 2026-08-11
- FIX: Laufzeitressourcen beim Seitenwechsel freigeben (F-43): neuer Top-Level-Hook `onPageLeave(page)`, der die window-weiten `online`/`offline`-Listener (im Instanz-State gesammelt) entfernt und die Leaflet-Karte zerstört; das `disposed`-Flag macht späte Async-Renders (nach Datenabruf und `loadLeaflet`) wirkungslos

## 1.13.0 - 2026-08-07
- CHG: Bootstrap-Ziele instanzeindeutig (F-32): KPI-Kontext- und Methodik-Ziele (`#ks-kpi-kontext-<id>` und `#ks-methodik-body`) um eine Instanzkennung ergänzt — mehrere Instanzen derselben App auf einer Seite klappen ihre Panels unabhängig auf (die bestehende `instanceId`-Mechanik für die Karten-IDs bleibt unverändert)

## 1.12.0 - 2026-08-06
- FIX: Datenschutzangabe beschreibt den tatsaechlichen Stand nach dem Vendoring (Welle G)

## 1.11.0 - 2026-08-06
- FIX: Drittanbietersektion nennt keine Beim-Aufruf-Behauptung mehr (Welle G)

## 1.10.0 - 2026-08-06
- FIX: Base auf Template oda-generic 1.6.0 vereinheitlicht (Hook renderPageOverride)

## 1.9.0 - 2026-08-04
- FIX: Datenschutzhinweis "Beim Aufruf kontaktierte Drittanbieter" an das Vendoring angepasst — jetzt lokal ausgelieferte Bibliotheken (Bootstrap/Leaflet/Chart.js) sind aus der Liste entfernt, weiterhin extern geladene Dienste (Kartenkacheln, Zusatzbibliotheken) bleiben genannt

## 1.8.0 - 2026-08-04
- FIX: Bootstrap, Leaflet vendored in `app/vendor/` statt von CDN geladen (F-07 Teil 2) — Standalone-Betrieb laedt diese Bibliotheken nicht mehr extern

## 1.7.0 - 2026-08-04
- FIX: Drittanbieter (CDN, Kartendienste) in `datenschutz`-Default und README dokumentiert (F-07 Teil 1)
- FIX: Bootstrap CSS/JS auf einheitlich 5.3.8 gezogen (vorher gemischt 5.3.0/5.3.1 bzw. 5.3.0/5.3.0) (F-31)

## 1.6.0 - 2026-07-31
- CHG: toter Konfigurationsschlüssel lizenz entfernt (F-17)
- CHG: brandingCSS und brandingCSSFile als Base-Abhängigkeiten deklariert und lokal gespiegelt (F-17)
- CHG: Groß-/Kleinschreibung der Config-Schlüssel vereinheitlicht, Fallback-Ketten entfernt (F-17)
- CHG: dropdown-Default auf Feldebene verschoben statt in format (F-18)

## 1.5.0 - 2026-07-30

- **FIX:** Laufzeitfehler nach dem Laden der Konfiguration werden jetzt sichtbar gemeldet; `handleRouting()` wird `await`et und besitzt einen Fehlerpfad. Bisher blieb die Seite bei einem Fehler im Seitenaufbau stumm leer
- **FIX:** `getConfigUrl()` schneidet bei einer URL ohne abschliessenden Schraegstrich nicht mehr das letzte Verzeichnis ab; die Konfiguration wird auch unter `.../app` gefunden
- **FIX:** Klick auf einen Hash-Link, der bereits die aktive Seite bezeichnet, rendert die Seite neu (`setupSamePageLinks()`) - das Logo fuehrt damit aus Unteransichten zurueck zur Startseite
- **ENH:** `app/app-base.js` ist wieder byte-identisch zum Template `oda-generic` 1.4.0; app-spezifisches Aufraeumen laeuft ueber den neuen Hook `onPageLeave(page)` in `app/app.js`
- **FIX:** Der mitgelieferte Default der Datenquelle zeigte mit `../assets/daten-beispiel.csv` eine Ebene zu hoch und war im ODAS-Live-Betrieb nicht erreichbar; er lautet jetzt `assets/daten-beispiel.csv`. Die lokale Konfiguration behaelt die Testform `../assets/...`

## 1.4.0 - 2026-07-24

- **FIX:** Laufzeit-Fehlermeldung wird vor der Anzeige HTML-maskiert (`escapeHtmlForBase`); ein Fehlertext kann kein Markup mehr in die Seite einschleusen (XSS)
- **FIX:** Startseiten-Renderer wird nun `await`et; bei asynchronen Apps erscheint kein kurzzeitiges `[object Promise]` in `#main-content`

## 1.3.0 - 2026-07-23

- **ENH:** Datenabruf auf den Schalter `proxyAktiv` umgestellt; direkte Abrufe sind der Standard, der ODAS-Proxy wird nur noch bei `ja` verwendet
- **ENH:** Einfachen Standalone-Betrieb hinter Traefik mit derselben `odas-config/config.json` wie in der Entwicklung ergänzt
- **ENH:** Traefik-Anbindung auf das externe Netzwerk `proxynet`, den EntryPoint `websecure` und den Zertifikatsresolver `letsencrypt` festgelegt
- **FIX:** Proxy-Basispfad funktioniert jetzt auch bei URLs mit `index.html`; der Ziel-Pfad wird URL-kodiert
- **FIX:** Direkt-dann-Proxy-Fallback durch den eindeutigen Schalter ersetzt
- **DOC:** Start über `STANDALONE=true make up` dokumentiert

## 03.07.2026 (Version 1.2.0)

- ENH: Weiterführende Links (BBK + KRZN) als konfigurierbaren Abschnitt ergänzt (`weiterfuehrendeLinks`).
- ENH: Datenstand-Anzeige neben Modus-Badge implementiert (`datenStand`).
- ENH: CSS-Präfix `ks-` für App-spezifische Styles eingeführt.
- DOC: Für-wen-Abschnitt in Beschreibung und README ergänzt.

## 26.05.2026 (Version 1.0.2)

- App umbenannt in **Katastrophenschutz-Karte** (zuvor *BlackoutMap*).
- Alle App-Metadaten, Quellcode-Referenzen, Konfigurationsdateien und Dokumentationen angepasst.

## 19.05.2026 (Version 1.0.1)

- BlackoutMap (Katastrophenschutz-Karte) auf ein Einquellenmodell ueber `apiurl` vereinfacht.
- Mehrquellen-Konfiguration fuer KRZN, Bielefeld, Demo- und Tuning-Parameter aus ODAS-Konfiguration und Runtime entfernt.
- Lokale Konfiguration auf die minimale `instanz-config`-Spiegelung reduziert.
- Proxy-Fallback fuer externe Quellen beibehalten, aber ohne eigenen Instanz-Schalter.
- README und App-Metadaten auf das neue Datenmodell aktualisiert.

## 12.05.2026 (Version 1.0.0)

- ENH: BlackoutMap auf Basis von `oda-generic` umgesetzt.
- ENH: KRZN-WFS/GML-Daten mit EPSG:25832-zu-WGS84-Transformation integriert.
- ENH: Bielefeld-CSV-WFS-Export integriert.
- ENH: Leaflet-Karte, KPI-Kacheln, Filter, Detailansicht, Tabelle und Offline-Cache ergänzt.
- ENH: App-Package, lokale ODAS-Konfiguration, README, Schema, Beispieldaten und Icon app-spezifisch angepasst.
- FIX: Lokales Live-Server-Testing lädt `odas-config/config.json` bei localhost/127.0.0.1.
