import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFirmwareManifest,
  validateFirmwareDirectory,
} from "../apps/embedded/scripts/firmware-release-lib.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "enigma-firmware-test-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  const mergedImage = join(directory, "firmware.bin");
  const elf = join(directory, "firmware.elf");
  const instructions = join(directory, "FLASHING.md");
  await writeFile(mergedImage, "merged image");
  await writeFile(elf, "elf image");
  await writeFile(instructions, "espflash write-bin 0x0 firmware.bin\n");
  const manifest = await createFirmwareManifest({
    version: "0.1.0",
    tag: "v0.1.0",
    commitSha: "a".repeat(40),
    payloads: [
      { role: "merged-image", path: mergedImage },
      { role: "elf", path: elf },
      { role: "flashing-instructions", path: instructions },
    ],
  });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  return { directory, mergedImage };
}

test("validates a complete firmware manifest", async (t) => {
  const { directory } = await fixture(t);
  const manifest = await validateFirmwareDirectory(directory, {
    version: "0.1.0",
    tag: "v0.1.0",
    commitSha: "a".repeat(40),
  });
  assert.equal(manifest.flashAddress, "0x0");
});

test("rejects a payload whose hash changed", async (t) => {
  const { directory, mergedImage } = await fixture(t);
  await writeFile(mergedImage, "tampered");
  await assert.rejects(() => validateFirmwareDirectory(directory), /SHA-256 mismatch/);
});
