import { readFile } from "node:fs/promises";

const [manifestPath, ...flags] = process.argv.slice(2);
const allowPlaceholders = flags.includes("--allow-placeholders");
if (!manifestPath) {
  console.error(
    "Usage: node scripts/validate-public-release.mjs <manifest.json> [--allow-placeholders]",
  );
  process.exitCode = 2;
} else {
  await validate(manifestPath, allowPlaceholders);
}

async function validate(path, placeholdersAllowed) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(`Public release manifest is invalid JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.version ?? "")) {
    errors.push("stable release version must be non-prerelease SemVer");
  }
  if (!placeholdersAllowed && !/^[a-f0-9]{40}$/u.test(manifest.gitCommit ?? "")) {
    errors.push("gitCommit must be the exact 40-character release commit");
  }
  if (manifest.channel !== "stable") errors.push("public V1 channel must be stable");
  if (Number.isNaN(Date.parse(manifest.publishedAt ?? ""))) {
    errors.push("publishedAt must be an RFC 3339 timestamp");
  }

  const requiredCompatibility = [
    "macos:17:usb",
    "macos:18:usb",
    "macos:26:usb",
    "macos:27:usb",
    "macos:27:network",
    "windows:17:usb",
    "windows:18:usb",
    "windows:26:usb",
    "windows:27:usb",
  ];
  const compatibility = new Map(
    (manifest.compatibility ?? []).map((entry) => [
      `${entry.host}:${entry.iosVersion}:${entry.transport}`,
      entry,
    ]),
  );
  for (const key of requiredCompatibility) {
    const entry = compatibility.get(key);
    if (!entry) errors.push(`missing compatibility result ${key}`);
    else if (
      !placeholdersAllowed &&
      (entry.result !== "pass" ||
        typeof entry.iosBuild !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._() -]{2,79}$/u.test(entry.iosBuild) ||
        /PENDING|REPLACE/u.test(entry.iosBuild))
    ) {
      errors.push(`compatibility result ${key} is not a recorded pass with an exact build`);
    }
  }

  for (const target of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    const artifact = manifest.artifacts?.[target];
    if (!artifact) {
      errors.push(`missing artifact ${target}`);
      continue;
    }
    validateHttpsUrl(artifact.url, `${target} artifact`, errors, "releases.enigma.example");
    if (typeof artifact.url === "string" && !artifact.url.includes("/stable/")) {
      errors.push(`${target} artifact URL must stay inside the stable channel`);
    }
    if (!placeholdersAllowed && !/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? "")) {
      errors.push(`${target} SHA-256 is missing or invalid`);
    }
    if (
      !placeholdersAllowed &&
      (typeof artifact.updaterSignature !== "string" ||
        artifact.updaterSignature.length < 16 ||
        /REPLACE/u.test(artifact.updaterSignature))
    ) {
      errors.push(`${target} updater signature is missing or still a placeholder`);
    }
    if (!placeholdersAllowed && artifact.codeSigned !== true) {
      errors.push(`${target} is not recorded as code signed`);
    }
    if (!placeholdersAllowed && target.startsWith("darwin-") && artifact.notarized !== true) {
      errors.push(`${target} is not recorded as notarized`);
    }
  }

  validateHttpsUrl(manifest.services?.webOrigin, "web origin", errors, "enigma.example");
  validateHttpsUrl(manifest.services?.mapOrigin, "map origin", errors, "maps.enigma.example");
  if (!placeholdersAllowed) {
    if (manifest.billingEnabled !== true) errors.push("billing is not enabled");
    if (manifest.restoreVerified !== true) errors.push("production restore is not verified");
    if (!/^\d{4}-\d{2}$/u.test(manifest.services?.mapDataset ?? "")) {
      errors.push("service evidence mapDataset must be an exact YYYY-MM version");
    }
    for (const field of [
      "webVerifiedAt",
      "mapVerifiedAt",
      "entitlementVerifiedAt",
      "stripeWebhookVerifiedAt",
      "emailDeliverabilityVerifiedAt",
    ]) {
      const value = manifest.services?.[field] ?? "";
      if (Number.isNaN(Date.parse(value)) || /PENDING|REPLACE/u.test(value)) {
        errors.push(`service evidence ${field} must be an RFC 3339 timestamp`);
      }
    }
    if (/PENDING|REPLACE/u.test(JSON.stringify(manifest))) {
      errors.push("manifest still contains placeholders");
    }
  }
  if (manifest.monitoringRunbook !== "docs/support-runbook.md") {
    errors.push("monitoringRunbook must reference docs/support-runbook.md");
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    placeholdersAllowed
      ? "Public V1 manifest structure is valid; release evidence placeholders remain allowed."
      : `Public V1 manifest ${manifest.version} is complete.`,
  );
}

function validateHttpsUrl(value, label, errors, expectedHost) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      errors.push(`${label} must be a credential-free, query-free HTTPS URL`);
    }
    if (url.hostname !== expectedHost) errors.push(`${label} must use ${expectedHost}`);
  } catch {
    errors.push(`${label} URL is invalid`);
  }
}
