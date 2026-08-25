import type { Coordinate } from "@enigma/contracts";
import type { Feature, FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { mapboxAccessTokenConfigured } from "./mapbox-access-token";
import { createMapboxStreetsStyle } from "./mapbox-style";

const FALLBACK_CENTER: [number, number] = [-123.1207, 49.2827];
const ROUTE_SOURCE = "enigma-route";

export function MapView({
  accessToken,
  point,
  routePoints = [],
  waypoints = [],
  onMapClick,
  onMapError,
  center,
}: {
  accessToken?: string;
  point?: Coordinate;
  routePoints?: Coordinate[];
  waypoints?: Coordinate[];
  onMapClick: (point: Coordinate) => void;
  onMapError?: (message?: string) => void;
  center?: Coordinate & { zoom?: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const mapClickRef = useRef(onMapClick);
  const mapErrorRef = useRef(onMapError);
  const routeDataRef = useRef(routeGeoJson(routePoints, waypoints));
  const [mapReady, setMapReady] = useState(false);
  mapClickRef.current = onMapClick;
  mapErrorRef.current = onMapError;
  routeDataRef.current = routeGeoJson(routePoints, waypoints);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapboxAccessTokenConfigured(accessToken)) {
      return;
    }
    const initialCenter = center
      ? ([center.longitude, center.latitude] as [number, number])
      : FALLBACK_CENTER;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: initialCenter,
      zoom: center ? (center.zoom ?? 12) : 3,
      style: createMapboxStreetsStyle(accessToken),
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.once("style.load", () => {
      if (mapRef.current !== map) return;
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeDataRef.current });
      map.addLayer({
        id: "enigma-route-line",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#4169e1", "line-width": 5, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "enigma-route-points",
        type: "circle",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 4,
          "circle-stroke-color": "#4169e1",
          "circle-stroke-width": 2,
        },
      });
      mapErrorRef.current?.(undefined);
      setMapReady(true);
    });
    map.on("error", ({ error }) => {
      if (mapRef.current !== map) return;
      mapErrorRef.current?.(
        error instanceof Error ? error.message : "Mapbox could not load the map",
      );
    });
    map.on("click", ({ lngLat }: maplibregl.MapMouseEvent) =>
      mapClickRef.current({ latitude: lngLat.lat, longitude: lngLat.lng }),
    );
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      if (mapRef.current === map) {
        mapRef.current = null;
        setMapReady(false);
      }
    };
  }, [accessToken]);

  useEffect(() => {
    if (!center || !mapReady) return;
    mapRef.current?.flyTo({
      center: [center.longitude, center.latitude],
      zoom: center.zoom ?? 12,
    });
  }, [center, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !point || !mapReady) return;
    if (!markerRef.current) {
      const marker = new maplibregl.Marker({ color: "#4169e1", draggable: true })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
      marker.on("dragend", () => {
        const next = marker.getLngLat();
        mapClickRef.current({ latitude: next.lat, longitude: next.lng });
      });
      markerRef.current = marker;
    }
    markerRef.current.setLngLat([point.longitude, point.latitude]);
  }, [mapReady, point]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeGeoJson(routePoints, waypoints));
  }, [mapReady, routePoints, waypoints]);

  if (!mapboxAccessTokenConfigured(accessToken)) {
    return (
      <div className="flex h-full min-h-[420px] w-full items-center justify-center bg-surface-tertiary p-8 text-center">
        <div className="max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-lg">
          <p className="font-semibold">Mapbox setup required</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add a public <code>pk.</code> token in Settings to load maps, place search, and road
            routing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="enigma-map relative isolate h-full min-h-[420px] w-full">
      <div className="absolute inset-0 z-0">
        <div className="h-full w-full" ref={containerRef} />
      </div>
      {!mapReady && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-surface-tertiary/80 text-sm font-medium text-muted-foreground"
        >
          Loading Mapbox Streets…
        </div>
      )}
      <a
        aria-label="Mapbox"
        className="absolute bottom-1 left-1 z-20 block h-[23px] w-[88px]"
        href="https://www.mapbox.com/about/maps/"
        rel="noreferrer"
        target="_blank"
      >
        <MapboxLogo />
      </a>
    </div>
  );
}

function MapboxLogo() {
  return (
    <svg aria-hidden fillRule="evenodd" viewBox="0 0 88 23">
      <g fill="#fff" stroke="#000" strokeOpacity="0.3" strokeWidth="1.5">
        <path d="M11.5 2.25a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5Zm-4.503 13.733S6.17 10.18 9.23 7.11a4.4 4.4 0 0 1 6.66 6.66C12.72 16.93 7 16 7 16l-.003-.017Zm8.303-5.483-2-.8-.8-2-.8 2-2 .8 2 .8.8 2 .8-2 2-.8Z" />
        <path d="M25 8h1.86v.9a2.65 2.65 0 0 1 4.79.45 2.7 2.7 0 0 1 2.44-1.56A2.82 2.82 0 0 1 37 10.57V16h-1.85v-4.82c0-.98-.74-1.71-1.62-1.71-.9 0-1.59.88-1.59 1.9V16h-1.86v-4.82c0-.98-.74-1.71-1.62-1.71-.89 0-1.6.86-1.6 1.9V16H25V8Zm20.14 0H47v8h-1.86v-1a3.7 3.7 0 0 1-2.73 1.19c-2.17 0-3.94-1.87-3.94-4.19s1.77-4.19 3.94-4.19A3.7 3.7 0 0 1 45.14 9V8Zm-2.4 6.5a2.45 2.45 0 0 0 2.41-2.47v-.08a2.42 2.42 0 1 0-2.41 2.55ZM49 8h1.86v1a3.7 3.7 0 0 1 2.73-1.18c2.17 0 3.95 1.85 3.95 4.17s-1.77 4.19-3.94 4.19A3.7 3.7 0 0 1 50.86 15v4H49V8Zm4.26 6.51a2.52 2.52 0 1 0-.02-5.04 2.52 2.52 0 0 0 .02 5.04ZM59 5h1.86v4a3.7 3.7 0 0 1 2.73-1.19c2.17 0 3.95 1.87 3.95 4.19s-1.77 4.18-3.95 4.18A3.7 3.7 0 0 1 60.86 15v1H59V5Zm4.27 9.5a2.52 2.52 0 1 0 0-5.03 2.52 2.52 0 0 0 0 5.03Zm9.87-6.68a4.18 4.18 0 1 1 0 8.36 4.18 4.18 0 1 1 0-8.36Zm-.02 6.69a2.52 2.52 0 1 0 0-5.03 2.52 2.52 0 0 0 0 5.03ZM78.45 8h2.13l1.41 2.54L83.4 8h2.12l-2.41 3.96L85.55 16h-2.13L82 13.41 80.58 16h-2.13l2.44-4.02L78.45 8Z" />
      </g>
    </svg>
  );
}

function routeGeoJson(points: Coordinate[], waypoints: Coordinate[]): FeatureCollection {
  const route: Feature[] =
    points.length > 1
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: points.map((point) => [point.longitude, point.latitude]),
            },
          },
        ]
      : [];
  return {
    type: "FeatureCollection",
    features: [
      ...route,
      ...waypoints.map(
        (point, index): Feature => ({
          type: "Feature",
          properties: { index },
          geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        }),
      ),
    ],
  };
}
