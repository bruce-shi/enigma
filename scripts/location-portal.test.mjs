import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const assetRoot = new URL("../apps/embedded/platforms/esp-idf/assets/", import.meta.url);
const sourceUrl = new URL(
  "../apps/embedded/platforms/esp-idf/src/location_portal.rs",
  import.meta.url,
);
const cityMapSourceUrl = new URL(
  "../apps/embedded/platforms/esp-idf/src/city_maps.rs",
  import.meta.url,
);
const wifiSourceUrl = new URL(
  "../apps/embedded/platforms/esp-idf/src/wifi_access.rs",
  import.meta.url,
);
const partitionUrl = new URL("../apps/embedded/platforms/esp-idf/partitions.csv", import.meta.url);
const sdkconfigUrl = new URL(
  "../apps/embedded/platforms/esp-idf/sdkconfig.defaults",
  import.meta.url,
);
const cityMapServiceUrl = new URL("../apps/web/app/city-map.server.ts", import.meta.url);

test("embedded location portal bundles Vancouver and city-pack controls", async () => {
  const [
    html,
    script,
    map,
    richmondMap,
    vancouverDetailsGzip,
    richmondDetailsGzip,
    source,
    cityMapSource,
    wifiSource,
    partitions,
    sdkconfig,
    mapStats,
    richmondMapStats,
    service,
  ] = await Promise.all([
    readFile(new URL("location-portal.html", assetRoot), "utf8"),
    readFile(new URL("location-portal.js", assetRoot), "utf8"),
    readFile(new URL("location-map-vancouver.svg", assetRoot), "utf8"),
    readFile(new URL("location-map-richmond.svg", assetRoot), "utf8"),
    readFile(new URL("location-map-vancouver.json.gz", assetRoot)),
    readFile(new URL("location-map-richmond.json.gz", assetRoot)),
    readFile(sourceUrl, "utf8"),
    readFile(cityMapSourceUrl, "utf8"),
    readFile(wifiSourceUrl, "utf8"),
    readFile(partitionUrl, "utf8"),
    readFile(sdkconfigUrl, "utf8"),
    stat(new URL("location-map-vancouver.svg", assetRoot)),
    stat(new URL("location-map-richmond.svg", assetRoot)),
    readFile(cityMapServiceUrl, "utf8"),
  ]);

  assert.match(html, /src="\/offline-map\.svg"/);
  assert.match(html, /src="\/location-portal\.js"/);
  assert.match(html, /id="set-now"/);
  assert.match(html, /id="restore"/);
  assert.match(html, /id="maps-panel"/);
  assert.match(html, /id="wifi-tab"/);
  assert.match(html, /id="wifi-panel"/);
  assert.match(html, /id="wifi-form"/);
  assert.match(html, /id="presets"/);
  assert.match(html, /overflow-x: auto/);
  assert.match(html, />Places <span id="saved-count"/);
  assert.match(html, /id="city-form"/);
  assert.match(html, /id="map-details"/);
  assert.match(html, /Vancouver and Richmond/);
  assert.match(html, /pinch with two fingers to zoom/i);
  assert.match(html, /normal internet access/);
  assert.match(html, /© OpenStreetMap contributors · ODbL/);
  assert.doesNotMatch(script, /https?:\/\//);

  assert.match(script, /fetch\(["']\/api\/locations["']/);
  assert.match(script, /postLocation\(["']\/api\/set-location["']/);
  assert.match(script, /fetch\(["']\/api\/restore-location["']/);
  assert.match(script, /fetch\(["']\/api\/maps["']/);
  assert.match(script, /["']\/api\/wifi["']/);
  assert.match(script, /["']\/api\/maps\/install["']/);
  assert.match(script, /payload\.presets/);
  assert.match(script, /selectPanel\("wifi-panel", true\)/);
  assert.match(script, /const activePointers = new Map\(\)/);
  assert.match(script, /const beginPinch = \(\) =>/);
  assert.match(script, /const updatePinch = \(\) =>/);
  assert.match(script, /const placeLimit = mapState\.zoom < 2 \? 3 : 4/);
  assert.match(script, /--street-angle/);
  assert.match(script, /visibleStreetPlacements/);
  assert.match(script, /clipSegment/);
  assert.match(script, /const showSmallStreetNames = mapState\.zoom >= 24/);
  assert.match(script, /roadRank >= 2 \|\| showSmallStreetNames/);
  assert.match(script, /right\.roadRank - left\.roadRank/);
  assert.match(script, /showSmallStreetNames \? 10/);
  assert.match(script, /if \(mapState\.zoom >= 16\)/);
  assert.match(map, /viewBox="0 0 1200 888"/);
  assert.match(richmondMap, /viewBox="0 0 1200 917"/);
  assert.match(richmondMap, /Richmond offline street map/);
  assert.match(map, /© OpenStreetMap contributors · ODbL/);
  assert.ok(mapStats.size < 512 * 1024, "bundled Vancouver map must remain firmware-sized");
  assert.ok(richmondMapStats.size < 512 * 1024, "bundled Richmond map must remain firmware-sized");
  const vancouverDetails = JSON.parse(gunzipSync(vancouverDetailsGzip));
  const richmondDetails = JSON.parse(gunzipSync(richmondDetailsGzip));
  assert.equal(vancouverDetails.cityId, "vancouver");
  assert.equal(richmondDetails.cityId, "richmond");
  assert.ok(vancouverDetails.buildings.length > 100_000);
  assert.ok(richmondDetails.buildings.length > 10_000);
  assert.ok(vancouverDetails.streets.includes("Main Street"));
  assert.ok(richmondDetails.streets.includes("No. 3 Road"));
  assert.ok(vancouverDetails.streetPaths.length > 1_000);
  assert.ok(richmondDetails.streetPaths.length > 500);

  assert.match(source, /"\/offline-map\.svg"/);
  assert.match(source, /"\/offline-map\.json"/);
  assert.match(source, /"\/api\/restore-location"/);
  assert.match(source, /"\/api\/maps\/install"/);
  assert.match(source, /PortalLocationList/);
  assert.match(source, /internetRelayed/);
  assert.match(source, /UdpSocket::bind\(\(address, 53\)\)/);
  assert.match(source, /forward_dns/);
  assert.match(source, /is_local_name/);
  assert.match(source, /script-src 'self'/);
  assert.doesNotMatch(source, /script-src 'unsafe-inline'/);
  assert.match(cityMapSource, /include_bytes!\("\.\.\/assets\/location-map-vancouver\.svg"\)/);
  assert.match(cityMapSource, /include_bytes!\("\.\.\/assets\/location-map-richmond\.svg"\)/);
  assert.match(cityMapSource, /location-map-vancouver\.json\.gz/);
  assert.match(cityMapSource, /location-map-richmond\.json\.gz/);
  assert.match(cityMapSource, /https:\/\/enigma\.bruceshi\.com\/api\/city-map\.pack\?city=/);
  assert.match(cityMapSource, /X-Enigma-Map-Data-Sha256/);
  assert.match(cityMapSource, /ENIGMA-CITY-V3/);
  assert.match(cityMapSource, /Sha256::digest/);
  assert.match(wifiSource, /Configuration::Mixed/);
  assert.match(wifiSource, /esp_netif_set_default_netif/);
  assert.match(wifiSource, /esp_netif_napt_enable/);
  assert.match(partitions, /userdata,\s+data,\s+nvs,\s+0x820000,0x20000/);
  assert.match(partitions, /mapdata,\s+data,\s+spiffs,\s+0x840000,0x7C0000/);
  assert.match(sdkconfig, /CONFIG_LWIP_MAX_SOCKETS=24/);
  assert.match(sdkconfig, /CONFIG_LWIP_IP_FORWARD=y/);
  assert.match(sdkconfig, /CONFIG_LWIP_IPV4_NAPT=y/);
  assert.match(service, /nominatim\.openstreetmap\.org\/search/);
  assert.match(service, /overpass-api\.de\/api\/interpreter/);
  assert.match(service, /X-Enigma-Map-Name-Encoded/);
  assert.match(service, /MAX_SVG_BYTES = 1_500_000/);
  assert.match(service, /addr:housenumber/);
  assert.match(service, /cityMapPackageResponse/);
});

test("embedded location portal JavaScript parses", () => {
  const scriptPath = fileURLToPath(new URL("location-portal.js", assetRoot));
  const check = spawnSync(process.execPath, ["--check", scriptPath], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
});
