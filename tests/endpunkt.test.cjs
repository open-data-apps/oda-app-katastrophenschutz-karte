const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const c = vm.createContext({ console, URL, window: { location: { href: "https://fixture.test/app/", pathname: "/app/" } } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), c);

// F-119: Dokumentierter Vertrag = JSON (Array, results, records, result.records), CSV oder WFS/GML.
test("dokumentierte JSON-, CSV- und WFS-Endpunkte werden akzeptiert", () => {
  for (const url of [
    "https://data.example.org/api/explore/v2.1/catalog/datasets/anlaufstellen/records?limit=100",
    "https://data.example.org/api/explore/v2.1/catalog/datasets/anlaufstellen/exports/json",
    "https://ckan.example.org/api/3/action/datastore_search?resource_id=abc",
    "https://ckan.example.org/dataset/x/resource/y/download/anlaufstellen.json",
    "https://www.bielefeld01.de/md/WFS/notfall_anlaufstellen/01?SERVICE=WFS&REQUEST=GetFeature&OUTPUTFORMAT=text/csv",
    "../assets/daten-beispiel.csv",
  ]) assert.equal(c.istKsEndpunktUnterstuetzt(url), true, url);
});

test("Datensatz- oder Webseiten-Links werden abgelehnt", () => {
  for (const url of ["https://ckan.example.org/dataset/anlaufstellen", "https://www.example.org/notfall.html"]) {
    assert.equal(c.istKsEndpunktUnterstuetzt(url), false, url);
  }
});
