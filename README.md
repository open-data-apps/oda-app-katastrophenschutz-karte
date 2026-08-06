# Katastrophenschutz-Karte

Die App **Katastrophenschutz-Karte** visualisiert offizielle Notfall-Anlaufstellen, Notrufstellen, Notfall-Infopunkte und Leuchttuerme aus genau einer konfigurierten Datenquelle.

Die App ist fuer die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht und entspricht dem ODAS-Modell einer konfigurierbaren Open Data App.

---

## Für wen ist diese App?

Diese App zeigt offizielle Notfall-Anlaufstellen für Krisensituationen. Sie richtet sich an Bürger:innen, die für den Ernstfall vorsorgen möchten — inklusive Blackout-Checkliste und Navigation zur nächsten Anlaufstelle.

---

## Funktionen

Die App ist eine Single Page Application mit:

- Logo-Anzeige
- Menue
- Seiten fuer Impressum, Datenschutz, Beschreibung, Kontakt und Hauptinhalt
- Kennzahlen fuer Standorte, Regionen, Typgruppen und naechste Stelle
- Interaktive Leaflet-Karte mit Typ-Markierung und Standortbezug
- Filter fuer Region, Typ, Suchbegriff und Radius
- Detailansicht mit Adresse, Quelle, Entfernung und Navigationslink
- Sortierbarer Trefferliste mit Offline-Cache der zuletzt geladenen Daten
- Blackout-Checkliste als statische Hilfsinformation

---

## Datenformat

Die App verarbeitet genau **einen** Endpunkt aus `apiurl`.

Unterstuetzte Formate:

- **CSV** mit Kopfzeile und Feldern fuer Name, Adresse, Region und Koordinaten
- **JSON** als Array oder Objekt mit `results`, `records` oder `result.records`
- **WFS/GML** als direkter GetFeature-Endpunkt mit Geometrien, die in WGS84 oder EPSG:25832 lesbar sind

Bei externen Quellen versucht die App zuerst den Direktabruf. Wenn das im ODAS-Betrieb scheitert, folgt automatisch ein Abruf ueber den ODAS-Proxy.

### Standardquelle

Standardmaessig verwendet die App die gebuendelte Datei:

- `assets/daten-beispiel.csv`

Damit funktionieren lokale Entwicklung und ODAS-Tests ohne weitere Datenquellenkonfiguration.

---

## Kompatible Datensaetze

Die App erwartet einen Datensatz, aus dem sich mindestens diese Informationen gewinnen lassen:

| Feld | Bedeutung |
| --- | --- |
| `id` | Eindeutige Kennung |
| `name` | Anzeigename der Stelle |
| `address` / `adresse` | Adresse oder anschriftnahe Information |
| `type` / `typ` | Rohbezeichnung des Einrichtungstyps |
| `region` / `kommune` / `stadt` | Regionale Zuordnung |
| `latitude` / `longitude` oder Geometrie | Koordinaten fuer Karte und Distanzberechnung |

Das normalisierte Zielschema liegt in `assets/schema.json`.

---

## Konfiguration

Wichtige Instanz-Parameter:

| Parameter | Beschreibung | Pflicht |
| --- | --- | --- |
| `titel` | Titel in der App | ja |
| `seitentitel` | Browser-Tab-Titel | ja |
| `urlDaten` | Referenz-URL zum Datensatz im ODP | ja |
| `apiurl` | Direkter JSON-, CSV- oder WFS/GML-Endpunkt | ja |

Weitere App-Details wie Tabellenlimit, Offline-Strategie oder Proxy-Fallback werden intern in `app/app.js` gesteuert und nicht mehr ueber Instanz-Config gepflegt.

---

## Lokale Entwicklung

Die ODAS-Live-Server-Validierung laeuft gegen:

```text
http://127.0.0.1:5501/app/
```

Fuer lokale Tests wird die Konfiguration aus `odas-config/config.json` geladen. In der ODAS-Plattform kommt die Konfiguration zur Laufzeit aus der App-Instanz.

Die Standard-`apiurl` zeigt lokal auf `../assets/daten-beispiel.csv`, damit die App ohne weitere Vorarbeiten startet.

---

## Wichtige Dateien

| Datei | Beschreibung |
| --- | --- |
| `app/app.js` | Hauptlogik: Datenladen, Normalisierung, Filter, Karte, Tabelle, Detailansicht, Offline-Cache |
| `app-package.json` | ODAS-App-Metadaten und minimale Instanz-Konfiguration |
| `assets/schema.json` | Frictionless Data Schema fuer normalisierte Standortdaten |
| `assets/daten-beispiel.csv` | Gebuendelte Standardquelle fuer Entwicklung und Tests |
| `assets/odas-app-icon.svg` | App-Icon |
| `odas-config/config.json` | Lokale Entwicklungs-Konfiguration |

---

## Betriebsarten

Die App kann lokal, eigenstaendig hinter einem Traefik-Reverse-Proxy oder ueber den ODAS
betrieben werden.

### Datenabruf: `proxyAktiv`

| Wert   | Bedeutung                                                                   |
| ------ | --------------------------------------------------------------------------- |
| `nein` | Direkter Abruf der Daten-URL. Standard fuer Entwicklung und Standalone.      |
| `ja`   | Abruf ueber den ODAS-Proxy `…/odp-data`. Nur im ODAS-Live-System verfuegbar. |

Bei `nein` muss die Datenquelle CORS freigeben.

### Standalone-Betrieb

Voraussetzung: ein laufender Traefik mit dem externen Docker-Netzwerk `proxynet`,
dem EntryPoint `websecure` und dem Zertifikatsresolver `letsencrypt`.

1. In `docker-compose.standalone.yml` den Platzhalter `app1.example.com` durch den
   echten FQDN ersetzen.
2. In `odas-config/config.json` `proxyAktiv` auf `nein` belassen.
3. Starten:

```bash
STANDALONE=true make up
STANDALONE=true make logs
STANDALONE=true make down
```

Im Standalone-Betrieb entfaellt die lokale Portfreigabe; Traefik terminiert TLS und
leitet auf den internen Nginx-Port 80 weiter. Die Konfiguration wird aus derselben
`odas-config/config.json` gelesen wie in der Entwicklung und von Nginx unter `/config`
ausgeliefert.

### Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden folgende externe Server kontaktiert:

- `tile.openstreetmap.org` — Kartenkacheln (OpenStreetMap)
- `google.com/maps` — externer Routen-/Kartenlink (öffnet erst bei Klick in einem neuen Tab)

Diese Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne Internetzugang ist derzeit nicht möglich. Bootstrap, Leaflet und Chart.js werden seit Version 1.9.0 lokal aus `app/vendor/` ausgeliefert und nicht mehr extern geladen.

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung.

## Autor

© 2026, Ondics GmbH
