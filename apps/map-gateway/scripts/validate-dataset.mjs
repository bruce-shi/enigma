import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { datasetObjectKey, validateDatasetMetadata } from "../src/release.ts";

const [directoryArgument, version] = process.argv.slice(2);
if (!directoryArgument || !version) {
  console.error("Usage: node scripts/validate-dataset.mjs <dataset-directory> <YYYY-MM>");
  process.exitCode = 2;
} else {
  await validate(resolve(directoryArgument), version);
}

async function validate(directory, datasetVersion) {
  const pmtilesPath = resolve(directory, "global.pmtiles");
  const stylePath = resolve(directory, "style.json");
  const assetsDirectory = resolve(directory, "assets");
  const [pmtilesStat, styleSource, assetFiles] = await Promise.all([
    stat(pmtilesPath),
    readFile(stylePath, "utf8"),
    walk(assetsDirectory),
  ]).catch((error) => {
    console.error(`Dataset is incomplete: ${error.message}`);
    process.exitCode = 1;
    return [];
  });
  if (!pmtilesStat || styleSource === undefined || !assetFiles) return;
  let style;
  try {
    style = JSON.parse(styleSource);
  } catch (error) {
    console.error(`style.json is invalid JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const assets = assetFiles.map((path) => relative(assetsDirectory, path).split(sep).join("/"));
  const errors = validateDatasetMetadata({
    version: datasetVersion,
    pmtilesBytes: pmtilesStat.size,
    style,
    assets,
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const files = [pmtilesPath, stylePath, ...assetFiles];
  const objects = [];
  for (const path of files) {
    const relativePath = relative(directory, path).split(sep).join("/");
    const contents = await readFile(path);
    objects.push({
      key: datasetObjectKey(datasetVersion, relativePath),
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
  console.log(JSON.stringify({ schemaVersion: 1, version: datasetVersion, objects }, null, 2));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
