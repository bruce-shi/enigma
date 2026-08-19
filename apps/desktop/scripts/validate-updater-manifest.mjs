import { readFile } from "node:fs/promises";

const [channel, manifestPath, ...flags] = process.argv.slice(2);
const allowPlaceholders = flags.includes("--allow-placeholders");
if (!channel || !manifestPath || !["stable", "beta"].includes(channel)) {
  console.error(
    "Usage: node scripts/validate-updater-manifest.mjs <stable|beta> <manifest.json> [--allow-placeholders]",
  );
  process.exitCode = 2;
} else {
  await validateManifest(channel, manifestPath, allowPlaceholders);
}

async function validateManifest(expectedChannel, path, placeholdersAllowed) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(`Updater manifest is not valid JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = [];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version ?? "")) {
    errors.push("version must be valid SemVer");
  }
  if (expectedChannel === "stable" && String(manifest.version).includes("-")) {
    errors.push("stable manifest must not use a prerelease version");
  }
  if (expectedChannel === "beta" && !String(manifest.version).includes("-")) {
    errors.push("beta manifest must use a prerelease version");
  }
  if (Number.isNaN(Date.parse(manifest.pub_date ?? ""))) {
    errors.push("pub_date must be an RFC 3339 timestamp");
  }
  const requiredTargets = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];
  for (const target of requiredTargets) {
    const entry = manifest.platforms?.[target];
    if (!entry) {
      errors.push(`missing platform ${target}`);
      continue;
    }
    try {
      const url = new URL(entry.url);
      if (url.protocol !== "https:") errors.push(`${target} URL must use HTTPS`);
      if (!url.pathname.includes(`/updater/${expectedChannel}/`)) {
        errors.push(`${target} URL must stay inside the ${expectedChannel} channel`);
      }
      if (url.search || url.hash || url.username || url.password) {
        errors.push(`${target} URL must not contain credentials, query parameters, or fragments`);
      }
    } catch {
      errors.push(`${target} URL is invalid`);
    }
    if (typeof entry.signature !== "string" || entry.signature.length < 16) {
      errors.push(`${target} signature is missing`);
    }
    if (!placeholdersAllowed && /REPLACE_/u.test(`${entry.url}${entry.signature}`)) {
      errors.push(`${target} still contains release placeholders`);
    }
  }
  if (!placeholdersAllowed && /REPLACE_/u.test(manifest.notes ?? "")) {
    errors.push("release notes still contain a placeholder");
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${expectedChannel} updater manifest for ${manifest.version}`);
}
