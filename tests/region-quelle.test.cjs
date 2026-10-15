// Quelle ohne Region-/Typ-Spalte (Bielefeld-WFS-CSV): Region "Unbekannt", Quelle = Hostname,
// Region-/Typ-Filter und KPI "Regionen" ohne Aussage entfallen. app() treibt eine vm-Sandbox
// mit Stub-DOM und gemocktem fetch; ausgewertet wird das gerenderte HTML.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const URL_BIELEFELD =
  "https://www.bielefeld01.de/md/WFS/notfall_anlaufstellen/01?SERVICE=WFS&OUTPUTFORMAT=text/csv";
const CSV_OHNE_REGION = [
  "WKT;gid;name;adresse",
  '"POINT (466500 5764000)";1;Notfall-Anlaufstelle Mitte;Am Stadtholz 18, 33609 Bielefeld',
  '"POINT (467500 5765000)";2;Notfall-Anlaufstelle Nord;Nordstr. 1, 33602 Bielefeld',
].join("\n");
const CSV_MIT_REGION = [
  "id;name;adresse;typ;region;latitude;longitude",
  "a;Leuchtturm Nord;Weg 1;Leuchtturm;Bielefeld;52.03;8.55",
  "b;Notrufstelle Süd;Weg 2;Notrufstelle;Kleve;51.62;6.29",
].join("\n");

async function lade(url, csv, extra = {}) {
  const els = new Map();
  const elem = (id) => {
    if (!els.has(id)) {
      els.set(id, { id, innerHTML: "", textContent: "", value: "", disabled: false, style: {},
        parentElement: { hidden: false }, classList: { add() {}, remove() {} },
        addEventListener() {}, appendChild() {}, setAttribute() {}, querySelectorAll: () => [] });
    }
    return els.get(id);
  };
  const root = { innerHTML: "" };
  const c = vm.createContext({
    console, AbortController, navigator: { onLine: true }, URL, URLSearchParams, setTimeout, clearTimeout,
    location: { href: "https://fixture.test/app/" },
    fetch: async () => ({ ok: true, text: async () => csv }),
    localStorage: { getItem: () => null, setItem() {} },
    window: { location: { href: "https://fixture.test/app/", pathname: "/app/" }, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, getElementById: elem, createElement: () => elem("x"), head: { appendChild() {} }, querySelector: () => null },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), c);
  c.app({ apiurls: [{ name: "anlaufstellen", url }], proxyAktiv: "nein", ...extra }, root);
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  const get = (suffix) => elem(`katastrophenschutz-karte-${[...els.keys()].map((k) => k.match(/katastrophenschutz-karte-(\d+)-/)).find(Boolean)[1]}-${suffix}`);
  return { get, root };
}

test("CSV ohne Region-/Typ-Spalte: Region Unbekannt, Quelle = Hostname, Ein-Wert-Filter ausgeblendet", async () => {
  const { get } = await lade(URL_BIELEFELD, CSV_OHNE_REGION);
  const detail = get("detail").innerHTML;
  assert.match(detail, /Unbekannt/);
  assert.match(detail, /www\.bielefeld01\.de/);
  assert.doesNotMatch(detail, />CSV</);
  assert.equal(get("region").parentElement.hidden, true);
  assert.equal(get("type").parentElement.hidden, true);
  assert.match(get("kpis").innerHTML, /fw-bold text-info">–</);
});

test("CSV mit mehreren Regionen und Typen: Filter bleiben sichtbar, KPI zählt Regionen", async () => {
  const { get } = await lade("https://fixture.test/daten.csv", CSV_MIT_REGION);
  assert.equal(get("region").parentElement.hidden, false);
  assert.equal(get("type").parentElement.hidden, false);
  assert.match(get("kpis").innerHTML, /fw-bold text-info">2</);
});

test("Statuszeile: Datenstand und Standorthinweis sind getrennt", async () => {
  const { get } = await lade(URL_BIELEFELD, CSV_OHNE_REGION, { datenStand: "Stand 2026-10" });
  assert.match(get("status").innerHTML, /<small class="text-muted ms-2 me-2">Stand 2026-10<\/small>Standort noch nicht gesetzt/);
});
