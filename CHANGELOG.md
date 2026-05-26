# Changelog

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
