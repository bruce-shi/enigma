import { readFile } from "node:fs/promises";

const development = process.argv.includes("--development");
const [configuration, releaseConfiguration, capability, infoPlist, releaseWorkflow] =
  await Promise.all([
    readJson(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
    readJson(new URL("../src-tauri/tauri.release.conf.json", import.meta.url)),
    readJson(new URL("../src-tauri/capabilities/default.json", import.meta.url)),
    readFile(new URL("../src-tauri/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"),
  ]);

const errors = [];
if (configuration.bundle?.createUpdaterArtifacts === true) {
  errors.push("development configuration must not require signed updater artifacts");
}
if (releaseConfiguration.bundle?.createUpdaterArtifacts !== true) {
  errors.push("stable release overlay must create updater artifacts");
}
for (const target of ["app", "dmg"]) {
  if (!releaseConfiguration.bundle?.targets?.includes(target)) {
    errors.push(`stable macOS release bundle target is missing: ${target}`);
  }
}
if (!releaseWorkflow.includes("includeUpdaterJson: true")) {
  errors.push("stable release workflow must include updater JSON");
}
if (releaseWorkflow.includes("uploadUpdaterJson:")) {
  errors.push("stable release workflow uses the obsolete uploadUpdaterJson input");
}
if (!configuration.bundle?.targets?.includes("dmg")) errors.push("DMG bundle target is missing");
if (!configuration.bundle?.targets?.includes("nsis")) errors.push("NSIS bundle target is missing");
if (configuration.bundle?.macOS?.minimumSystemVersion !== "12.0") {
  errors.push("macOS minimum system version must remain 12.0");
}
if (!capability.permissions?.includes("updater:default")) {
  errors.push("updater permissions are missing");
}
const stableEndpoint = configuration.plugins?.updater?.endpoints?.[0] ?? "";
if (stableEndpoint !== "https://github.com/bruce-shi/enigma/releases/latest/download/latest.json") {
  errors.push("stable updater endpoint is invalid");
}
const csp = configuration.app?.security?.csp ?? "";
for (const directive of ["object-src 'none'", "frame-src 'none'", "base-uri 'none'"]) {
  if (!csp.includes(directive)) errors.push(`CSP is missing ${directive}`);
}
if (csp.includes("*")) errors.push("CSP must not contain wildcard sources");
for (const mapboxOrigin of ["https://api.mapbox.com"]) {
  if (!csp.includes(mapboxOrigin)) errors.push(`CSP is missing Mapbox origin ${mapboxOrigin}`);
}
if (csp.includes("openfreemap.org")) errors.push("CSP still contains the retired OpenFreeMap host");
for (const forbidden of ["api.enigma", "maps.enigma", "enigma-map-gateway", "pmtiles"]) {
  if (csp.includes(forbidden)) errors.push(`CSP still contains hosted service ${forbidden}`);
}
if (!infoPlist.includes("NSLocationWhenInUseUsageDescription")) {
  errors.push("macOS location purpose string is missing");
}
if (!development) {
  if (configuration.version === "0.0.0") errors.push("release version is still 0.0.0");
  if (/REPLACE_/u.test(configuration.plugins?.updater?.pubkey ?? "")) {
    errors.push("Tauri updater public key is still a placeholder");
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    development
      ? "Desktop release configuration structure is valid; signing placeholders are allowed."
      : "Desktop release configuration is ready for signed production builds.",
  );
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
