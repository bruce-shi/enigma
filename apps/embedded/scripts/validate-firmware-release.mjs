import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { sha256, validateFirmwareDirectory } from "./firmware-release-lib.mjs";

const [archiveArgument, checksumArgument, version, tag, commitSha] = process.argv.slice(2);
if (!archiveArgument || !checksumArgument || !version || !tag || !commitSha) {
  throw new Error(
    "Usage: validate-firmware-release.mjs <bundle.zip> <bundle.zip.sha256> <version> <tag> <commit>",
  );
}

const archive = resolve(archiveArgument);
const checksumFile = resolve(checksumArgument);
const checksumLine = (await readFile(checksumFile, "utf8")).trim();
const checksumMatch = checksumLine.match(/^([0-9a-f]{64})\s{2}([^/\\]+)$/i);
if (!checksumMatch || checksumMatch[2] !== basename(archive)) {
  throw new Error("Firmware ZIP checksum file has an invalid format or filename");
}
if ((await sha256(archive)) !== checksumMatch[1].toLowerCase()) {
  throw new Error("Firmware ZIP SHA-256 checksum does not match");
}

const expectedEntries = new Set([
  "FLASHING.md",
  "manifest.json",
  `enigma-firmware-lichuang-esp32s3-${tag}.bin`,
  `enigma-firmware-lichuang-esp32s3-${tag}.elf`,
]);
const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
if (
  entries.length !== expectedEntries.size ||
  entries.some((entry) => !expectedEntries.has(entry))
) {
  throw new Error(`Firmware ZIP contains unexpected entries: ${entries.join(", ")}`);
}

const extractionDirectory = await mkdtemp(join(tmpdir(), "enigma-firmware-validate-"));
try {
  execFileSync("unzip", ["-q", archive, "-d", extractionDirectory], { stdio: "inherit" });
  await validateFirmwareDirectory(extractionDirectory, { version, tag, commitSha });
} finally {
  await rm(extractionDirectory, { recursive: true, force: true });
}

console.log(`Validated ${basename(archive)}`);
