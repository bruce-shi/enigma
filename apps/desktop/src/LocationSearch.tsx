import type { Coordinate } from "@enigma/contracts";
import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type LocationSuggestion,
  mapboxSearchConfigured,
  retrieveLocation,
  suggestLocations,
} from "./location-search";

const VANCOUVER: Coordinate = { latitude: 49.2827, longitude: -123.1207 };

export function LocationSearch({
  center,
  onCenter,
}: {
  center?: Coordinate;
  onCenter: (coordinate: Coordinate) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const sessionToken = useRef(createSessionToken());
  const language = globalThis.navigator.language.split("-")[0] || "en";
  const configured = mapboxSearchConfigured();

  useEffect(() => {
    if (!configured) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(undefined);
      void suggestLocations({
        query: trimmed,
        sessionToken: sessionToken.current,
        proximity: center ?? VANCOUVER,
        language,
        signal: controller.signal,
      })
        .then((next) => {
          setSuggestions(next);
          setActiveIndex(0);
          setOpen(true);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setError(cause instanceof Error ? cause.message : "Location search failed");
          setOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [center, configured, language, query]);

  const choose = async (suggestion: LocationSuggestion) => {
    setLoading(true);
    setError(undefined);
    try {
      const coordinate = await retrieveLocation({
        id: suggestion.id,
        sessionToken: sessionToken.current,
        language,
      });
      setQuery(suggestion.name);
      setOpen(false);
      onCenter(coordinate);
      sessionToken.current = createSessionToken();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Location search failed");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const showResults = configured && open && query.trim().length >= 3;

  return (
    <search
      className="relative w-[min(22rem,calc(100vw-2rem))]"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-lg">
        <Search aria-hidden="true" className="text-muted-foreground" size={17} />
        <input
          aria-autocomplete="list"
          aria-controls={showResults ? "location-search-results" : undefined}
          aria-expanded={showResults}
          aria-label="Search locations"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          disabled={!configured}
          maxLength={256}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length >= 3) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (!suggestions.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const suggestion = suggestions[activeIndex];
              if (suggestion) void choose(suggestion);
            }
          }}
          placeholder={
            configured ? "Search address or place" : "Add a Mapbox public token to enable search"
          }
          role="combobox"
          value={query}
        />
        {loading && <LoaderCircle aria-label="Searching" className="animate-spin" size={17} />}
      </div>

      {showResults && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.4rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
          id="location-search-results"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-surface-tertiary ${
                index === activeIndex ? "bg-surface-tertiary" : ""
              }`}
              key={suggestion.id}
              onClick={() => void choose(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className="block font-medium">{suggestion.name}</span>
              {suggestion.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {suggestion.description}
                </span>
              )}
            </button>
          ))}
          {!loading && !error && suggestions.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">No locations found</p>
          )}
          {error && <p className="px-3 py-3 text-sm text-danger">{error}</p>}
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            Search by Mapbox · select to center, then click the map
          </p>
        </div>
      )}
      {!configured && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          Set VITE_MAPBOX_ACCESS_TOKEN in apps/desktop/.env.local
        </p>
      )}
    </search>
  );
}

function createSessionToken(): string {
  if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
