import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readTomlVersion(source, section) {
  const sectionPattern = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`^\\[${sectionPattern}\\][\\s\\S]*?^version\\s*=\\s*"([^"]+)"`, "m"),
  );

  if (!match) {
    throw new Error(`Could not find a version in TOML section [${section}]`);
  }

  return match[1];
}

export function validateReleaseVersions(sources, tag) {
  const entries = Object.entries(sources);
  const authoritativeVersion = sources["package.json"];

  if (!authoritativeVersion || !SEMVER.test(authoritativeVersion)) {
    throw new Error(
      `Root package.json has an invalid SemVer version: ${authoritativeVersion ?? "missing"}`,
    );
  }

  const mismatches = entries.filter(([, version]) => version !== authoritativeVersion);
  if (mismatches.length > 0) {
    const details = entries.map(([source, version]) => `  ${source}: ${version}`).join("\n");
    throw new Error(`Release versions are not synchronized:\n${details}`);
  }

  if (tag && tag !== `v${authoritativeVersion}`) {
    throw new Error(
      `Release tag ${tag} does not match authoritative version v${authoritativeVersion}`,
    );
  }

  return authoritativeVersion;
}

export async function readReleaseVersions(repositoryRoot = process.cwd()) {
  const [rootPackage, desktopPackage, tauriConfig, cargoWorkspace, espIdfCargo] = await Promise.all(
    [
      readFile(resolve(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(resolve(repositoryRoot, "apps/desktop/package.json"), "utf8").then(JSON.parse),
      readFile(resolve(repositoryRoot, "apps/desktop/src-tauri/tauri.conf.json"), "utf8").then(
        JSON.parse,
      ),
      readFile(resolve(repositoryRoot, "Cargo.toml"), "utf8"),
      readFile(resolve(repositoryRoot, "apps/embedded/platforms/esp-idf/Cargo.toml"), "utf8"),
    ],
  );

  return {
    "package.json": rootPackage.version,
    "apps/desktop/package.json": desktopPackage.version,
    "apps/desktop/src-tauri/tauri.conf.json": tauriConfig.version,
    "Cargo.toml [workspace.package]": readTomlVersion(cargoWorkspace, "workspace.package"),
    "apps/embedded/platforms/esp-idf/Cargo.toml [package]": readTomlVersion(espIdfCargo, "package"),
  };
}

function parseTag(arguments_) {
  const tagIndex = arguments_.indexOf("--tag");
  if (tagIndex === -1) {
    const inlineTag = arguments_.find((argument) => argument.startsWith("--tag="));
    return inlineTag?.slice("--tag=".length) || undefined;
  }

  const tag = arguments_[tagIndex + 1];
  if (!tag) {
    throw new Error("--tag requires a value");
  }
  return tag;
}

async function main() {
  const sources = await readReleaseVersions();
  const version = validateReleaseVersions(sources, parseTag(process.argv.slice(2)));
  console.log(
    `Release version ${version} is synchronized across ${Object.keys(sources).length} sources.`,
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
