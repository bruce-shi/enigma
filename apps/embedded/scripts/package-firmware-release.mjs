import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  createFirmwareManifest,
  sha256,
  validateFirmwareDirectory,
} from "./firmware-release-lib.mjs";

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid firmware packaging argument near ${key ?? "end of command"}`);
    }
    values[key.slice(2)] = value;
  }

  for (const required of ["version", "tag", "commit", "output-dir"]) {
    if (!values[required]) {
      throw new Error(`Missing required argument --${required}`);
    }
  }
  return values;
}

const arguments_ = parseArguments(process.argv.slice(2));
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const platformRoot = resolve(repositoryRoot, "apps/embedded/platforms/esp-idf");
const releaseRoot = resolve(platformRoot, "target/xtensa-esp32s3-espidf/release");
const sourceElf = resolve(releaseRoot, "enigma-embedded-esp-idf");
const bundleStem = `enigma-firmware-lichuang-esp32s3-${arguments_.tag}`;
const outputDirectory = resolve(arguments_["output-dir"]);
const stagingDirectory = resolve(outputDirectory, bundleStem);
const mergedImageName = `${bundleStem}.bin`;
const elfName = `${bundleStem}.elf`;
const mergedImage = resolve(stagingDirectory, mergedImageName);
const elf = resolve(stagingDirectory, elfName);
const flashingInstructions = resolve(stagingDirectory, "FLASHING.md");
const archive = resolve(outputDirectory, `${bundleStem}.zip`);

await mkdir(outputDirectory, { recursive: true });
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory);

execFileSync(
  "espflash",
  [
    "save-image",
    "--chip",
    "esp32s3",
    "--merge",
    "--skip-padding",
    "--flash-size",
    "16mb",
    "--flash-mode",
    "dio",
    "--flash-freq",
    "40mhz",
    "--bootloader",
    resolve(releaseRoot, "bootloader.bin"),
    "--partition-table",
    resolve(platformRoot, "partitions.csv"),
    "--target-app-partition",
    "factory",
    sourceElf,
    mergedImage,
  ],
  { stdio: "inherit" },
);
await cp(sourceElf, elf);

await writeFile(
  flashingInstructions,
  `# Flash Enigma firmware\n\nThis bundle targets the Lichuang ESP32-S3 board. Install espflash 4.5.0 or newer, connect the board over USB, and run this command from the extracted bundle directory:\n\n\`\`\`sh\nespflash write-bin 0x0 ${mergedImageName}\n\`\`\`\n\nThe merged image contains the bootloader, partition table, and Enigma application at their required offsets. Pairing, upstream Wi-Fi, saved locations, and active-map state live in a separate userdata partition beyond the image and survive this command. A full-chip erase still removes them. Verify the ZIP against the separately published \`.zip.sha256\` file before extracting it.\n`,
);

const manifest = await createFirmwareManifest({
  version: arguments_.version,
  tag: arguments_.tag,
  commitSha: arguments_.commit,
  payloads: [
    { role: "merged-image", path: mergedImage },
    { role: "elf", path: elf },
    { role: "flashing-instructions", path: flashingInstructions },
  ],
});
await writeFile(
  resolve(stagingDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await validateFirmwareDirectory(stagingDirectory, {
  version: arguments_.version,
  tag: arguments_.tag,
  commitSha: arguments_.commit,
});

await rm(archive, { force: true });
execFileSync(
  "zip",
  ["-X", "-q", archive, mergedImageName, elfName, "FLASHING.md", "manifest.json"],
  { cwd: stagingDirectory, stdio: "inherit" },
);

const checksum = await sha256(archive);
await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
await rm(stagingDirectory, { recursive: true, force: true });
console.log(archive);
