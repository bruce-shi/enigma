import type { Coordinate } from "@enigma/contracts";
import type { Feature, FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef } from "react";

const FALLBACK_CENTER: [number, number] = [-123.1207, 49.2827];
const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_SOURCE = "enigma-route";

export function MapView({
  point,
  routePoints = [],
  onMapClick,
  center,
}: {
  point?: Coordinate;
  routePoints?: Coordinate[];
  onMapClick: (point: Coordinate) => void;
  center?: Coordinate;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const mapClickRef = useRef(onMapClick);
  mapClickRef.current = onMapClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const configuredStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim();
    const style = configuredStyle || DEFAULT_MAP_STYLE_URL;
    const initialCenter = center
      ? ([center.longitude, center.latitude] as [number, number])
      : FALLBACK_CENTER;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: initialCenter,
      zoom: center ? 12 : 3,
      style,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      "bottom-right",
    );
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeGeoJson([]) });
      map.addLayer({
        id: "enigma-route-line",
        type: "line",
        source: ROUTE_SOURCE,
        paint: { "line-color": "#4169e1", "line-width": 4, "line-opacity": 0.82 },
      });
      map.addLayer({
        id: "enigma-route-points",
        type: "circle",
        source: ROUTE_SOURCE,
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 5,
          "circle-stroke-color": "#4169e1",
          "circle-stroke-width": 2,
        },
      });
    });
    map.on("click", ({ lngLat }: maplibregl.MapMouseEvent) =>
      mapClickRef.current({ latitude: lngLat.lat, longitude: lngLat.lng }),
    );
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      map.remove();
      maplibregl.removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!center) return;
    mapRef.current?.flyTo({ center: [center.longitude, center.latitude], zoom: 12 });
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !point) return;
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
  }, [point]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      source?.setData(routeGeoJson(routePoints));
    };
    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [routePoints]);

  return <div className="enigma-map h-full min-h-[420px] w-full" ref={containerRef} />;
}

function routeGeoJson(points: Coordinate[]): FeatureCollection {
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
      ...points.map(
        (point, index): Feature => ({
          type: "Feature",
          properties: { index },
          geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        }),
      ),
    ],
  };
}
