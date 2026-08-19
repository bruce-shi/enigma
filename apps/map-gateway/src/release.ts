export interface DatasetMetadata {
  version: string;
  pmtilesBytes: number;
  style: unknown;
  assets: string[];
}

export function validateDatasetMetadata(metadata: DatasetMetadata): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}$/u.test(metadata.version)) {
    errors.push("dataset version must use YYYY-MM");
  }
  if (metadata.pmtilesBytes < 127) {
    errors.push("global.pmtiles is too small to contain a valid PMTiles header");
  }
  if (!metadata.style || typeof metadata.style !== "object" || Array.isArray(metadata.style)) {
    errors.push("style.json must contain a MapLibre style object");
    return errors;
  }
  const style = metadata.style as Record<string, unknown>;
  if (style.version !== 8) errors.push("style.json must use MapLibre style version 8");
  const serialized = JSON.stringify(style);
  if (!serialized.includes("{{PMTILES_URL}}")) {
    errors.push("style.json must reference {{PMTILES_URL}}");
  }
  if (!serialized.includes("{{ASSET_ORIGIN}}")) {
    errors.push("style.json must reference {{ASSET_ORIGIN}}");
  }
  if (!serialized.includes("OpenStreetMap")) {
    errors.push("style.json must include OpenStreetMap attribution");
  }
  if (serialized.includes("http://"))
    errors.push("style.json must not reference insecure HTTP URLs");
  if (!metadata.assets.some((path) => path.startsWith("fonts/"))) {
    errors.push("dataset assets must include at least one fonts/ object");
  }
  if (!metadata.assets.some((path) => path.startsWith("sprites/"))) {
    errors.push("dataset assets must include at least one sprites/ object");
  }
  return errors;
}

export function datasetObjectKey(version: string, relativePath: string): string {
  if (!/^\d{4}-\d{2}$/u.test(version)) throw new Error("dataset version must use YYYY-MM");
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..")) {
    throw new Error("dataset path must be a safe relative path");
  }
  return `basemap/${version}/${relativePath}`;
}
