import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const FIRMWARE_BOARD = "lichuang-esp32s3";
export const FIRMWARE_CHIP = "esp32s3";
export const FLASH_ADDRESS = "0x0";
export const MANIFEST_SCHEMA_VERSION = 1;

export async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

export async function createFirmwareManifest({ version, tag, commitSha, payloads }) {
  if (tag !== `v${version}`) {
    throw new Error(`Firmware tag ${tag} does not match version v${version}`);
  }
  if (!/^[0-9a-f]{40,64}$/i.test(commitSha)) {
    throw new Error("Firmware commit SHA must contain 40 to 64 hexadecimal characters");
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    productVersion: version,
    tag,
    commitSha,
    board: FIRMWARE_BOARD,
    chip: FIRMWARE_CHIP,
    flashAddress: FLASH_ADDRESS,
    files: await Promise.all(
      payloads.map(async ({ role, path }) => ({
        role,
        filename: basename(path),
        sha256: await sha256(path),
      })),
    ),
  };
}

export async function validateFirmwareDirectory(directory, expected = {}) {
  const manifestPath = resolve(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported firmware manifest schema: ${manifest.schemaVersion}`);
  }
  if (manifest.board !== FIRMWARE_BOARD || manifest.chip !== FIRMWARE_CHIP) {
    throw new Error(`Unexpected firmware target: ${manifest.board}/${manifest.chip}`);
  }
  if (manifest.flashAddress !== FLASH_ADDRESS) {
    throw new Error(`Unexpected firmware flash address: ${manifest.flashAddress}`);
  }
  if (expected.version && manifest.productVersion !== expected.version) {
    throw new Error(
      `Firmware version ${manifest.productVersion} does not match ${expected.version}`,
    );
  }
  if (expected.tag && manifest.tag !== expected.tag) {
    throw new Error(`Firmware tag ${manifest.tag} does not match ${expected.tag}`);
  }
  if (expected.commitSha && manifest.commitSha !== expected.commitSha) {
    throw new Error(`Firmware commit ${manifest.commitSha} does not match ${expected.commitSha}`);
  }
  if (manifest.tag !== `v${manifest.productVersion}`) {
    throw new Error("Firmware tag and product version disagree");
  }
  if (!/^[0-9a-f]{40,64}$/i.test(manifest.commitSha)) {
    throw new Error("Firmware manifest has an invalid commit SHA");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 3) {
    throw new Error("Firmware manifest must describe exactly three payload files");
  }

  const roles = new Set();
  for (const file of manifest.files) {
    if (!["merged-image", "elf", "flashing-instructions"].includes(file.role)) {
      throw new Error(`Unexpected firmware file role: ${file.role}`);
    }
    if (roles.has(file.role)) {
      throw new Error(`Duplicate firmware file role: ${file.role}`);
    }
    roles.add(file.role);
    if (basename(file.filename) !== file.filename) {
      throw new Error(`Firmware filename must not include a path: ${file.filename}`);
    }
    const actualHash = await sha256(resolve(directory, file.filename));
    if (actualHash !== file.sha256) {
      throw new Error(`SHA-256 mismatch for ${file.filename}`);
    }
  }

  const mergedImage = manifest.files.find((file) => file.role === "merged-image");
  const instructions = await readFile(resolve(directory, "FLASHING.md"), "utf8");
  const flashCommand = `espflash write-bin ${FLASH_ADDRESS} ${mergedImage.filename}`;
  if (!instructions.includes(flashCommand)) {
    throw new Error(`FLASHING.md must include: ${flashCommand}`);
  }

  return manifest;
}
