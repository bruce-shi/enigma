import { readFile } from "node:fs/promises";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) {
  console.error(
    "Usage: node scripts/check-production-health.mjs <completed-release-manifest.json>",
  );
  process.exitCode = 2;
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await check(manifest);
}

async function check(manifest) {
  const web = await getJson(`${manifest.services.webOrigin}/api/health`);
  if (!web.ok || !web.publicReleaseReady || web.releaseVersion !== manifest.version) {
    throw new Error("web health does not match the completed release manifest");
  }
  const maps = await getJson(`${manifest.services.mapOrigin}/health`);
  if (!maps.ok || maps.dataset !== manifest.services.mapDataset) {
    throw new Error("map health does not match the completed release manifest");
  }
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: operator-only release probe, never a cached Turbo task
  const entitlementToken = process.env.ENIGMA_ENTITLEMENT_HEALTH_TOKEN;
  if (entitlementToken) {
    const response = await fetch(`${manifest.services.webOrigin}/api/desktop/entitlement`, {
      headers: { authorization: `Bearer ${entitlementToken}` },
    });
    if (!response.ok) throw new Error(`entitlement health returned HTTP ${response.status}`);
  } else {
    console.warn("Entitlement health skipped: ENIGMA_ENTITLEMENT_HEALTH_TOKEN is not set.");
  }
  console.log("Production web and map health match the release manifest.");
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}
