import type { LoaderFunctionArgs } from "react-router";
import {
  buildCityMap,
  CityMapError,
  cityMapDetailsResponse,
  cityMapPackageResponse,
  cityMapResponse,
  normalizeCityQuery,
} from "../city-map.server";

const errorResponse = (error: unknown) => {
  const status = error instanceof CityMapError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Could not generate city map";
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const requestUrl = new URL(request.url);
    const city = normalizeCityQuery(requestUrl.searchParams.get("city"));
    const cacheUrl = new URL(requestUrl.origin + requestUrl.pathname);
    cacheUrl.searchParams.set("city", city.toLocaleLowerCase("en-US"));
    const cacheKey = new Request(cacheUrl, { method: "GET" });
    let cache: Cache | undefined;
    try {
      cache = await caches.open("enigma-city-maps-v2");
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // Local runtimes may not expose a persistent edge cache.
    }

    const generated = await buildCityMap(city);
    const response = requestUrl.pathname.endsWith(".json")
      ? await cityMapDetailsResponse(generated.definition, generated.details)
      : requestUrl.pathname.endsWith(".pack")
        ? await cityMapPackageResponse(generated.definition, generated.svg, generated.details)
        : await cityMapResponse(generated.definition, generated.svg);
    try {
      await cache?.put(cacheKey, response.clone());
    } catch {
      // A successful map response must not depend on cache availability.
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
