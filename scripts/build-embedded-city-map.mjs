import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { buildCityMapForDefinition } from "../apps/web/app/city-map.server.ts";

const cityInputs = {
  vancouver: {
    name: "Vancouver",
    bounds: { south: 49.195, west: -123.28, north: 49.335, east: -122.99 },
  },
  richmond: {
    name: "Richmond",
    bounds: { south: 49.075, west: -123.3, north: 49.205, east: -123.04 },
  },
};

function dimensions(bounds) {
  const meanLatitude = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const geographicWidth = (bounds.east - bounds.west) * Math.cos(meanLatitude);
  const geographicHeight = bounds.north - bounds.south;
  const width = geographicWidth >= geographicHeight ? 1200 : 800;
  return { width, height: Math.round(width * (geographicHeight / geographicWidth)) };
}

const cities = Object.fromEntries(
  Object.entries(cityInputs).map(([id, city]) => [
    id,
    {
      id,
      ...city,
      ...dimensions(city.bounds),
      svgOutput: `apps/embedded/platforms/esp-idf/assets/location-map-${id}.svg`,
      detailOutput: `apps/embedded/platforms/esp-idf/assets/location-map-${id}.json.gz`,
    },
  ]),
);

const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(cities);

for (const cityId of selected) {
  const city = cities[cityId];
  if (!city) throw new Error(`Unknown city: ${cityId}`);
  const { svgOutput, detailOutput, ...definition } = city;
  const generated = await buildCityMapForDefinition(definition);
  const compressedDetails = gzipSync(generated.details, { level: 9 });
  const svgPath = resolve(svgOutput);
  const detailPath = resolve(detailOutput);
  await mkdir(dirname(svgPath), { recursive: true });
  await Promise.all([writeFile(svgPath, generated.svg), writeFile(detailPath, compressedDetails)]);
  const details = JSON.parse(generated.details);
  process.stdout.write(
    `${city.name}: ${Buffer.byteLength(generated.svg).toLocaleString()} byte SVG, ` +
      `${compressedDetails.byteLength.toLocaleString()} byte detail JSON gzip ` +
      `(${details.streets.length.toLocaleString()} streets, ` +
      `${details.buildings.length.toLocaleString()} numbered addresses)\n`,
  );
}
