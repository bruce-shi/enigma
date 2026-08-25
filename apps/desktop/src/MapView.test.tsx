// @vitest-environment jsdom

import type { FeatureCollection } from "geojson";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockSource = {
  data: FeatureCollection;
  setData: (data: FeatureCollection) => void;
};

type MockMap = {
  emit: (event: string, payload?: unknown) => void;
  source: (id: string) => MockSource | undefined;
};

const mapInstances = vi.hoisted(() => [] as MockMap[]);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("maplibre-gl", () => {
  class FakeMap {
    private readonly handlers = new globalThis.Map<string, Array<(payload: unknown) => void>>();

    private readonly sources = new globalThis.Map<string, MockSource>();

    constructor() {
      mapInstances.push(this);
    }

    addControl() {}

    addLayer() {}

    addSource(id: string, source: { data: FeatureCollection }) {
      this.sources.set(id, {
        data: source.data,
        setData: (data) => {
          const current = this.sources.get(id);
          if (current) current.data = data;
        },
      });
    }

    emit(event: string, payload?: unknown) {
      const handlers = this.handlers.get(event) ?? [];
      this.handlers.delete(event);
      for (const handler of handlers) handler(payload);
    }

    flyTo() {}

    getSource(id: string) {
      return this.sources.get(id);
    }

    on(event: string, handler: (payload: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    once(event: string, handler: (payload: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    remove() {}

    source(id: string) {
      return this.sources.get(id);
    }
  }

  class Marker {
    addTo() {
      return this;
    }

    getLngLat() {
      return { lat: 0, lng: 0 };
    }

    on() {
      return this;
    }

    remove() {}

    setLngLat() {
      return this;
    }
  }

  return {
    AttributionControl: class {},
    Map: FakeMap,
    Marker,
    NavigationControl: class {},
  };
});

import { MapView } from "./MapView";

afterEach(() => {
  mapInstances.length = 0;
  document.body.replaceChildren();
});

describe("MapView", () => {
  it("hydrates the active map source with route data after a stale StrictMode map loads", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const points = [
      { latitude: 49.25, longitude: -123.12 },
      { latitude: 49.26, longitude: -123.11 },
    ];

    await act(async () => {
      root.render(
        <StrictMode>
          <MapView
            accessToken="pk.test"
            onMapClick={() => undefined}
            routePoints={points}
            waypoints={points}
          />
        </StrictMode>,
      );
    });

    expect(mapInstances).toHaveLength(2);
    await act(async () => mapInstances[0]?.emit("style.load"));
    await act(async () => mapInstances[1]?.emit("style.load"));

    const data = mapInstances[1]?.source("enigma-route")?.data;
    expect(data?.features).toHaveLength(3);
    expect(data?.features[0]?.geometry.type).toBe("LineString");

    await act(async () => root.unmount());
  });
});
