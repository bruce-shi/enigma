(() => {
  const form = document.querySelector("#location-form");
  const name = document.querySelector("#name");
  const latitude = document.querySelector("#latitude");
  const longitude = document.querySelector("#longitude");
  const capture = document.querySelector("#capture");
  const save = document.querySelector("#save");
  const setNow = document.querySelector("#set-now");
  const restore = document.querySelector("#restore");
  const manual = document.querySelector("#manual");
  const reload = document.querySelector("#reload");
  const locations = document.querySelector("#locations");
  const presets = document.querySelector("#presets");
  const status = document.querySelector("#status");
  const savedCount = document.querySelector("#saved-count");
  const mapFrame = document.querySelector("#map-frame");
  const mapSurface = document.querySelector("#map-surface");
  const mapLayer = document.querySelector("#map-layer");
  const mapDetailsLayer = document.querySelector("#map-details");
  const mapMarker = document.querySelector("#map-marker");
  const savedPins = document.querySelector("#saved-pins");
  const mapReadout = document.querySelector("#map-readout");
  const mapHelp = document.querySelector("#map-help");
  const zoomIn = document.querySelector("#zoom-in");
  const zoomOut = document.querySelector("#zoom-out");
  const centerMap = document.querySelector("#center-map");
  const mapSummary = document.querySelector("#map-summary");
  const mapList = document.querySelector("#map-list");
  const wifiForm = document.querySelector("#wifi-form");
  const wifiSsid = document.querySelector("#wifi-ssid");
  const wifiPassword = document.querySelector("#wifi-password");
  const wifiConnect = document.querySelector("#wifi-connect");
  const wifiSummary = document.querySelector("#wifi-summary");
  const cityForm = document.querySelector("#city-form");
  const cityQuery = document.querySelector("#city-query");
  const cityDownload = document.querySelector("#city-download");
  const openWifi = document.querySelector("#open-wifi");
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  let mapDefinition = {
    id: "vancouver",
    name: "Vancouver",
    bounds: { west: -123.28, south: 49.195, east: -122.99, north: 49.335 },
    width: 1200,
    height: 888,
  };
  const mapState = { latitude: 49.265, longitude: -123.135, zoom: 1 };
  let selectedPoint;
  let selectedAddress = "";
  let mapDetails;
  let mapDetailsRequest = 0;
  let drag;
  const activePointers = new Map();
  let pinch;
  let upstreamConnected = false;

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const show = (message, error = false) => {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("error", error);
  };
  const coordinatesReady = () => {
    const lat = Number(latitude.value);
    const lon = Number(longitude.value);
    return (
      latitude.value !== "" &&
      longitude.value !== "" &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  };
  const currentLocation = () => ({
    name: name.value.trim(),
    latitude: latitude.value.trim(),
    longitude: longitude.value.trim(),
  });
  const refresh = () => {
    const disabled = !coordinatesReady() || !name.value.trim();
    save.disabled = disabled;
    setNow.disabled = disabled;
  };
  const locationBody = (location) =>
    new URLSearchParams({
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
    });

  const selectPanel = (panelId, focus = false) => {
    tabs.forEach((tab) => {
      const selected = tab.getAttribute("aria-controls") === panelId;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.querySelector(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
    if (panelId === "new-panel") window.requestAnimationFrame(renderMap);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectPanel(tab.getAttribute("aria-controls")));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : tabs.length - 1;
      const next = tabs[(index + offset) % tabs.length];
      selectPanel(next.getAttribute("aria-controls"), true);
    });
  });

  const mapMetrics = () => {
    const rect = mapFrame.getBoundingClientRect();
    const scale =
      Math.max(rect.width / mapDefinition.width, rect.height / mapDefinition.height) *
      mapState.zoom;
    return { rect, width: mapDefinition.width * scale, height: mapDefinition.height * scale };
  };
  const placePin = (pin, point) => {
    const { west, south, east, north } = mapDefinition.bounds;
    pin.style.left = `${(((point.longitude - west) / (east - west)) * 100).toFixed(5)}%`;
    pin.style.top = `${(((north - point.latitude) / (north - south)) * 100).toFixed(5)}%`;
  };
  const placeDetailLabel = (label, latitude, longitude) => {
    const { west, south, east, north } = mapDefinition.bounds;
    label.style.left = `${(((longitude - west) / (east - west)) * 100).toFixed(5)}%`;
    label.style.top = `${(((north - latitude) / (north - south)) * 100).toFixed(5)}%`;
  };
  const placeProjectedDetailLabel = (label, x, y) => {
    label.style.left = `${((x / mapDefinition.width) * 100).toFixed(5)}%`;
    label.style.top = `${((y / mapDefinition.height) * 100).toFixed(5)}%`;
  };
  const visibleMapBounds = () => {
    const metrics = mapMetrics();
    const { west, south, east, north } = mapDefinition.bounds;
    const longitudeRadius = ((metrics.rect.width / metrics.width) * (east - west)) / 2;
    const latitudeRadius = ((metrics.rect.height / metrics.height) * (north - south)) / 2;
    return {
      west: mapState.longitude - longitudeRadius,
      east: mapState.longitude + longitudeRadius,
      south: mapState.latitude - latitudeRadius,
      north: mapState.latitude + latitudeRadius,
    };
  };
  const detailIsVisible = (latitude, longitude, bounds) =>
    latitude >= bounds.south &&
    latitude <= bounds.north &&
    longitude >= bounds.west &&
    longitude <= bounds.east;
  const projectedVisibleBounds = (bounds) => ({
    left:
      ((bounds.west - mapDefinition.bounds.west) /
        (mapDefinition.bounds.east - mapDefinition.bounds.west)) *
      mapDefinition.width,
    right:
      ((bounds.east - mapDefinition.bounds.west) /
        (mapDefinition.bounds.east - mapDefinition.bounds.west)) *
      mapDefinition.width,
    top:
      ((mapDefinition.bounds.north - bounds.north) /
        (mapDefinition.bounds.north - mapDefinition.bounds.south)) *
      mapDefinition.height,
    bottom:
      ((mapDefinition.bounds.north - bounds.south) /
        (mapDefinition.bounds.north - mapDefinition.bounds.south)) *
      mapDefinition.height,
  });
  const clipSegment = (startX, startY, endX, endY, bounds) => {
    const dx = endX - startX;
    const dy = endY - startY;
    let startAmount = 0;
    let endAmount = 1;
    for (const [direction, distance] of [
      [-dx, startX - bounds.left],
      [dx, bounds.right - startX],
      [-dy, startY - bounds.top],
      [dy, bounds.bottom - startY],
    ]) {
      if (direction === 0) {
        if (distance < 0) return;
        continue;
      }
      const amount = distance / direction;
      if (direction < 0) {
        if (amount > endAmount) return;
        startAmount = Math.max(startAmount, amount);
      } else {
        if (amount < startAmount) return;
        endAmount = Math.min(endAmount, amount);
      }
    }
    return {
      startX: startX + startAmount * dx,
      startY: startY + startAmount * dy,
      endX: startX + endAmount * dx,
      endY: startY + endAmount * dy,
    };
  };
  const visibleStreetPlacements = (geographicBounds) => {
    const projectedBounds = projectedVisibleBounds(geographicBounds);
    const centerX = (projectedBounds.left + projectedBounds.right) / 2;
    const centerY = (projectedBounds.top + projectedBounds.bottom) / 2;
    const placements = new Map();
    for (const [
      streetIndex,
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      points,
    ] of mapDetails.streetPaths ?? []) {
      if (
        maximumX < projectedBounds.left ||
        minimumX > projectedBounds.right ||
        maximumY < projectedBounds.top ||
        minimumY > projectedBounds.bottom
      ) {
        continue;
      }
      for (let index = 2; index < points.length; index += 2) {
        const startX = points[index - 2];
        const startY = points[index - 1];
        const endX = points[index];
        const endY = points[index + 1];
        if (
          startX === undefined ||
          startY === undefined ||
          endX === undefined ||
          endY === undefined
        ) {
          continue;
        }
        const clipped = clipSegment(startX, startY, endX, endY, projectedBounds);
        if (!clipped) continue;
        const x = (clipped.startX + clipped.endX) / 2;
        const y = (clipped.startY + clipped.endY) / 2;
        const distance = Math.hypot(x - centerX, y - centerY);
        const current = placements.get(streetIndex);
        if (current && current.distance <= distance) continue;
        let angle = (Math.atan2(endY - startY, endX - startX) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle <= -90) angle += 180;
        placements.set(streetIndex, { streetIndex, x, y, angle, distance });
      }
    }
    return [...placements.values()].sort((left, right) => left.distance - right.distance);
  };
  const renderDetailLabels = () => {
    mapDetailsLayer.replaceChildren();
    if (!mapDetails || mapDetails.cityId !== mapDefinition.id) return;
    const bounds = visibleMapBounds();
    const metrics = mapMetrics();
    const fragment = document.createDocumentFragment();
    if (mapState.zoom < 6 && Array.isArray(mapDetails.places)) {
      const placeLimit = mapState.zoom < 2 ? 3 : 4;
      const placeRadius = mapState.zoom < 2 ? 1.1 : 0.82;
      mapDetails.places
        .map(([placeName, kind, placeLatitude, placeLongitude]) => {
          const x =
            ((placeLongitude - mapState.longitude) /
              (mapDefinition.bounds.east - mapDefinition.bounds.west)) *
            metrics.width;
          const y =
            ((mapState.latitude - placeLatitude) /
              (mapDefinition.bounds.north - mapDefinition.bounds.south)) *
            metrics.height;
          return {
            placeName,
            kind,
            placeLatitude,
            placeLongitude,
            centerDistance: Math.hypot(
              x / Math.max(1, metrics.rect.width / 2),
              y / Math.max(1, metrics.rect.height / 2),
            ),
          };
        })
        .filter(
          ({ kind, placeLatitude, placeLongitude, centerDistance }) =>
            centerDistance <= placeRadius &&
            detailIsVisible(placeLatitude, placeLongitude, bounds) &&
            (mapState.zoom >= 2 || kind === "city" || kind === "town"),
        )
        .sort((left, right) => {
          const leftRank = left.kind === "city" || left.kind === "town" ? 0 : 1;
          const rightRank = right.kind === "city" || right.kind === "town" ? 0 : 1;
          return mapState.zoom < 2
            ? leftRank - rightRank || left.centerDistance - right.centerDistance
            : left.centerDistance - right.centerDistance;
        })
        .slice(0, placeLimit)
        .forEach(({ placeName, kind, placeLatitude, placeLongitude }) => {
          const label = document.createElement("span");
          label.className = `map-detail ${kind === "city" || kind === "town" ? "city-name" : "place-name"}`;
          label.textContent = placeName;
          placeDetailLabel(label, placeLatitude, placeLongitude);
          fragment.append(label);
        });
    }
    const showSmallStreetNames = mapState.zoom >= 24;
    const streetCandidates = (
      mapDetails.streetPaths?.length
        ? visibleStreetPlacements(bounds)
        : mapDetails.streetLabels
            .filter(([, latitude, longitude]) => detailIsVisible(latitude, longitude, bounds))
            .map(([streetIndex, latitude, longitude, angle = 0]) => ({
              streetIndex,
              x:
                ((longitude - mapDefinition.bounds.west) /
                  (mapDefinition.bounds.east - mapDefinition.bounds.west)) *
                mapDefinition.width,
              y:
                ((mapDefinition.bounds.north - latitude) /
                  (mapDefinition.bounds.north - mapDefinition.bounds.south)) *
                mapDefinition.height,
              angle,
              distance: Math.hypot(longitude - mapState.longitude, latitude - mapState.latitude),
            }))
    )
      .map((candidate) => ({
        ...candidate,
        roadRank: Number(mapDetails.streetClasses?.[candidate.streetIndex] ?? 2),
      }))
      .filter(({ roadRank }) => roadRank >= 2 || showSmallStreetNames)
      .sort((left, right) => right.roadRank - left.roadRank || left.distance - right.distance)
      .slice(0, showSmallStreetNames ? 10 : mapState.zoom < 2.5 ? 4 : 6);
    for (const { streetIndex, x, y, angle, roadRank } of streetCandidates) {
      const street = mapDetails.streets[streetIndex];
      if (!street) continue;
      const label = document.createElement("span");
      label.className = `map-detail street-name ${roadRank >= 2 ? "main-street" : "small-street"}`;
      label.textContent = street;
      label.style.setProperty("--street-angle", `${clamp(Number(angle), -90, 90)}deg`);
      placeProjectedDetailLabel(label, x, y);
      fragment.append(label);
    }
    if (mapState.zoom >= 16) {
      const visibleBuildings = [];
      for (const building of mapDetails.buildings) {
        const [, , buildingLatitude, buildingLongitude] = building;
        if (detailIsVisible(buildingLatitude, buildingLongitude, bounds)) {
          visibleBuildings.push(building);
        }
      }
      visibleBuildings.sort(
        (left, right) =>
          Math.hypot(left[2] - mapState.latitude, left[3] - mapState.longitude) -
          Math.hypot(right[2] - mapState.latitude, right[3] - mapState.longitude),
      );
      const occupied = [];
      const buildingLimit = mapState.zoom >= 24 ? 100 : 60;
      for (const [number, streetIndex, buildingLatitude, buildingLongitude] of visibleBuildings) {
        const x =
          ((buildingLongitude - mapDefinition.bounds.west) /
            (mapDefinition.bounds.east - mapDefinition.bounds.west)) *
          metrics.width;
        const y =
          ((mapDefinition.bounds.north - buildingLatitude) /
            (mapDefinition.bounds.north - mapDefinition.bounds.south)) *
          metrics.height;
        const horizontalClearance = Math.max(18, number.length * 5);
        if (
          occupied.some(
            (point) => Math.abs(point.x - x) < horizontalClearance && Math.abs(point.y - y) < 13,
          )
        ) {
          continue;
        }
        const label = document.createElement("span");
        label.className = "map-detail building-number";
        label.textContent = number;
        const street = mapDetails.streets[streetIndex];
        label.title = street ? `${number} ${street}` : number;
        placeDetailLabel(label, buildingLatitude, buildingLongitude);
        fragment.append(label);
        occupied.push({ x, y });
        if (occupied.length >= buildingLimit) break;
      }
    }
    mapDetailsLayer.append(fragment);
  };
  const nearestBuilding = (point) => {
    if (!mapDetails?.buildings?.length) return;
    const metrics = mapMetrics();
    const longitudePerPixel =
      (mapDefinition.bounds.east - mapDefinition.bounds.west) / metrics.width;
    const latitudePerPixel =
      (mapDefinition.bounds.north - mapDefinition.bounds.south) / metrics.height;
    let nearest;
    let nearestDistance = 32 * 32;
    for (const building of mapDetails.buildings) {
      const [number, streetIndex, buildingLatitude, buildingLongitude] = building;
      const x = (buildingLongitude - point.longitude) / longitudePerPixel;
      const y = (buildingLatitude - point.latitude) / latitudePerPixel;
      const distance = x * x + y * y;
      if (distance >= nearestDistance) continue;
      const street = mapDetails.streets[streetIndex];
      nearest = street ? `${number} ${street}` : number;
      nearestDistance = distance;
    }
    return nearest;
  };
  const pointInMap = (point) => {
    const { west, south, east, north } = mapDefinition.bounds;
    return (
      point.latitude >= south &&
      point.latitude <= north &&
      point.longitude >= west &&
      point.longitude <= east
    );
  };
  const renderMap = () => {
    const metrics = mapMetrics();
    if (!metrics.rect.width || !metrics.rect.height) return;
    const { west, south, east, north } = mapDefinition.bounds;
    const longitudeSpan = east - west;
    const latitudeSpan = north - south;
    const halfLongitude = (metrics.rect.width / metrics.width) * longitudeSpan * 0.5;
    const halfLatitude = (metrics.rect.height / metrics.height) * latitudeSpan * 0.5;
    mapState.longitude =
      halfLongitude >= longitudeSpan * 0.5
        ? (west + east) * 0.5
        : clamp(mapState.longitude, west + halfLongitude, east - halfLongitude);
    mapState.latitude =
      halfLatitude >= latitudeSpan * 0.5
        ? (south + north) * 0.5
        : clamp(mapState.latitude, south + halfLatitude, north - halfLatitude);
    const left =
      metrics.rect.width / 2 - ((mapState.longitude - west) / longitudeSpan) * metrics.width;
    const top =
      metrics.rect.height / 2 - ((north - mapState.latitude) / latitudeSpan) * metrics.height;
    mapLayer.style.width = `${metrics.width}px`;
    mapLayer.style.height = `${metrics.height}px`;
    mapLayer.style.left = `${left}px`;
    mapLayer.style.top = `${top}px`;
    if (selectedPoint && pointInMap(selectedPoint)) placePin(mapMarker, selectedPoint);
    mapMarker.hidden = !selectedPoint || !pointInMap(selectedPoint);
    mapReadout.textContent = selectedPoint
      ? (selectedAddress ? `${selectedAddress} · ` : "") +
        selectedPoint.latitude.toFixed(6) +
        ", " +
        selectedPoint.longitude.toFixed(6) +
        " · " +
        mapState.zoom.toFixed(1) +
        "x"
      : `Tap ${mapDefinition.name} to choose a point · ${mapState.zoom.toFixed(1)}x`;
  };
  const renderSavedPins = (storedLocations) => {
    savedPins.replaceChildren();
    storedLocations.forEach((location) => {
      const point = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
      const pin = document.createElement("span");
      pin.className = "saved-pin";
      if (!pointInMap(point)) return;
      pin.title = location.name;
      placePin(pin, point);
      savedPins.append(pin);
    });
  };
  const choosePoint = (nextLatitude, nextLongitude, options = {}) => {
    const point = {
      latitude: clamp(Number(nextLatitude), -90, 90),
      longitude: clamp(Number(nextLongitude), -180, 180),
    };
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
    selectedPoint = point;
    selectedAddress = options.address ?? "";
    latitude.value = point.latitude.toFixed(6);
    longitude.value = point.longitude.toFixed(6);
    mapMarker.hidden = !pointInMap(point);
    if (options.name) name.value = options.name;
    if (options.zoom) mapState.zoom = clamp(options.zoom, 1, 32);
    if (options.center) {
      if (pointInMap(point)) {
        mapState.latitude = point.latitude;
        mapState.longitude = point.longitude;
      }
    }
    refresh();
    renderMap();
    renderDetailLabels();
  };
  const coordinateAt = (clientX, clientY) => {
    const metrics = mapMetrics();
    const { west, south, east, north } = mapDefinition.bounds;
    const left =
      metrics.rect.width / 2 - ((mapState.longitude - west) / (east - west)) * metrics.width;
    const top =
      metrics.rect.height / 2 - ((north - mapState.latitude) / (north - south)) * metrics.height;
    const x = clientX - metrics.rect.left - left;
    const y = clientY - metrics.rect.top - top;
    return {
      latitude: clamp(north - (y / metrics.height) * (north - south), south, north),
      longitude: clamp(west + (x / metrics.width) * (east - west), west, east),
    };
  };
  const zoomMap = (factor) => {
    mapState.zoom = clamp(mapState.zoom * factor, 1, 32);
    renderMap();
    renderDetailLabels();
  };

  const pointerPosition = (event) => ({ x: event.clientX, y: event.clientY });
  const startDrag = (pointerId, position, moved = false) => {
    const metrics = mapMetrics();
    drag = {
      id: pointerId,
      startX: position.x,
      startY: position.y,
      latitude: mapState.latitude,
      longitude: mapState.longitude,
      width: metrics.width,
      height: metrics.height,
      moved,
    };
  };
  const beginPinch = () => {
    if (activePointers.size < 2) return false;
    const [[firstId, first], [secondId, second]] = Array.from(activePointers.entries());
    const midpoint = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    pinch = {
      ids: [firstId, secondId],
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      zoom: mapState.zoom,
      anchor: coordinateAt(midpoint.x, midpoint.y),
    };
    drag = undefined;
    return true;
  };
  const updatePinch = () => {
    if (!pinch) return false;
    const first = activePointers.get(pinch.ids[0]);
    const second = activePointers.get(pinch.ids[1]);
    if (!first || !second) return false;
    const midpoint = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    mapState.zoom = clamp(pinch.zoom * (distance / pinch.distance), 1, 32);
    const metrics = mapMetrics();
    const horizontalOffset = midpoint.x - metrics.rect.left - metrics.rect.width / 2;
    const verticalOffset = midpoint.y - metrics.rect.top - metrics.rect.height / 2;
    mapState.longitude =
      pinch.anchor.longitude -
      (horizontalOffset / metrics.width) * (mapDefinition.bounds.east - mapDefinition.bounds.west);
    mapState.latitude =
      pinch.anchor.latitude +
      (verticalOffset / metrics.height) * (mapDefinition.bounds.north - mapDefinition.bounds.south);
    renderMap();
    return true;
  };

  mapFrame.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".map-controls")) return;
    event.preventDefault();
    const position = pointerPosition(event);
    activePointers.set(event.pointerId, position);
    mapFrame.setPointerCapture(event.pointerId);
    if (activePointers.size === 1) {
      startDrag(event.pointerId, position);
    } else if (activePointers.size === 2) {
      beginPinch();
    }
  });
  mapFrame.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, pointerPosition(event));
    if (pinch) {
      updatePinch();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    mapState.longitude =
      drag.longitude - (dx / drag.width) * (mapDefinition.bounds.east - mapDefinition.bounds.west);
    mapState.latitude =
      drag.latitude +
      (dy / drag.height) * (mapDefinition.bounds.north - mapDefinition.bounds.south);
    renderMap();
  });
  const finishPointer = (event) => {
    if (!activePointers.has(event.pointerId)) return;
    const endedPinchPointer = pinch?.ids.includes(event.pointerId) === true;
    activePointers.delete(event.pointerId);
    if (mapFrame.hasPointerCapture(event.pointerId)) {
      mapFrame.releasePointerCapture(event.pointerId);
    }
    if (pinch && !endedPinchPointer) return;
    if (endedPinchPointer) {
      pinch = undefined;
      drag = undefined;
      if (activePointers.size >= 2) {
        beginPinch();
      } else if (activePointers.size === 1) {
        const [[pointerId, position]] = activePointers.entries();
        startDrag(pointerId, position, true);
      } else {
        renderDetailLabels();
      }
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && event.type === "pointerup") {
      const point = coordinateAt(event.clientX, event.clientY);
      const overview = mapState.zoom < 3;
      const address = nearestBuilding(point);
      choosePoint(point.latitude, point.longitude, {
        address,
        center: overview,
        name:
          name.value === "Current location" || name.value === "Map point"
            ? (address ?? "Map point")
            : undefined,
        zoom: overview ? 4 : undefined,
      });
      show(
        address
          ? `${address} selected. Save it or set it on the iPhone.`
          : "Map point selected. Save it or set it on the iPhone.",
      );
    }
    drag = undefined;
    renderDetailLabels();
  };
  mapFrame.addEventListener("pointerup", finishPointer);
  mapFrame.addEventListener("pointercancel", finishPointer);
  mapFrame.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomMap(event.deltaY < 0 ? 1.4 : 1 / 1.4);
    },
    { passive: false },
  );
  mapSurface.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomMap(1.5);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomMap(1 / 1.5);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choosePoint(mapState.latitude, mapState.longitude);
      show("Map center selected. Save it or set it on the iPhone.");
      return;
    }
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const metrics = mapMetrics();
    mapState.longitude +=
      direction[0] * (40 / metrics.width) * (mapDefinition.bounds.east - mapDefinition.bounds.west);
    mapState.latitude +=
      direction[1] *
      (40 / metrics.height) *
      (mapDefinition.bounds.north - mapDefinition.bounds.south);
    renderMap();
    renderDetailLabels();
  });
  zoomIn.addEventListener("click", () => zoomMap(1.6));
  zoomOut.addEventListener("click", () => zoomMap(1 / 1.6));
  centerMap.addEventListener("click", () => {
    if (selectedPoint && pointInMap(selectedPoint)) {
      mapState.latitude = selectedPoint.latitude;
      mapState.longitude = selectedPoint.longitude;
      mapState.zoom = Math.max(mapState.zoom, 8);
    } else {
      mapState.latitude = (mapDefinition.bounds.south + mapDefinition.bounds.north) * 0.5;
      mapState.longitude = (mapDefinition.bounds.west + mapDefinition.bounds.east) * 0.5;
      mapState.zoom = 1;
    }
    renderMap();
    renderDetailLabels();
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      renderMap();
      renderDetailLabels();
    }).observe(mapFrame);
  } else {
    window.addEventListener("resize", () => {
      renderMap();
      renderDetailLabels();
    });
  }

  const postLocation = async (path, location) => {
    return postForm(path, locationBody(location));
  };
  const responseMessage = async (response) => {
    const message = await response.text();
    return response.headers.get("Content-Type")?.startsWith("text/plain") && message
      ? message
      : `HTTP ${response.status}`;
  };
  const postForm = async (path, body) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    const message = await responseMessage(response);
    if (!response.ok) throw new Error(message);
    return message;
  };
  const loadMapDetails = async (cityId) => {
    const request = ++mapDetailsRequest;
    mapDetails = undefined;
    mapDetailsLayer.replaceChildren();
    try {
      const response = await fetch(
        `/offline-map.json?city=${encodeURIComponent(cityId)}&v=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const details = await response.json();
      if (
        details?.version !== 1 ||
        details.cityId !== cityId ||
        !Array.isArray(details.streets) ||
        (details.streetClasses !== undefined && !Array.isArray(details.streetClasses)) ||
        !Array.isArray(details.streetLabels) ||
        (details.streetPaths !== undefined && !Array.isArray(details.streetPaths)) ||
        !Array.isArray(details.buildings)
      ) {
        throw new Error("invalid detail index");
      }
      if (request !== mapDetailsRequest) return;
      mapDetails = details;
      renderDetailLabels();
    } catch (error) {
      if (request !== mapDetailsRequest) return;
      mapHelp.textContent = `${mapDefinition.name} is available, but its street/building detail index could not be loaded: ${error.message}`;
    }
  };
  const applyActiveMap = (nextMap) => {
    if (!nextMap?.bounds || !nextMap.width || !nextMap.height) return;
    const changed = mapDefinition.id !== nextMap.id;
    mapDefinition = nextMap;
    mapHelp.textContent = `${nextMap.name} is stored on the board with offline street names and numbered-address details. Pinch with two fingers or use the controls to zoom in and reveal them.`;
    mapSurface.setAttribute(
      "aria-label",
      `Choose a point on the offline ${nextMap.name} map. Drag to pan, pinch with two fingers to zoom, or use the adjacent zoom controls.`,
    );
    if (changed) {
      mapState.latitude = (nextMap.bounds.south + nextMap.bounds.north) * 0.5;
      mapState.longitude = (nextMap.bounds.west + nextMap.bounds.east) * 0.5;
      mapState.zoom = 1;
      mapLayer.querySelector("img").src =
        `/offline-map.svg?city=${encodeURIComponent(nextMap.id)}&v=${Date.now()}`;
    }
    renderMap();
    if (changed || mapDetails?.cityId !== nextMap.id) void loadMapDetails(nextMap.id);
  };
  const loadMaps = async () => {
    try {
      const response = await fetch("/api/maps", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = await response.json();
      applyActiveMap(payload.active);
      upstreamConnected = payload.wifi?.connected === true;
      wifiSummary.textContent =
        payload.wifi?.internetRelayed === true
          ? `Connected to ${payload.wifi.ssid}. Enigma-XXXX now has internet access, and city-map downloads are enabled.`
          : "Not connected upstream. The local Enigma hotspot is still available.";
      cityDownload.disabled = !upstreamConnected || !cityQuery.value.trim();
      mapSummary.textContent = `${payload.active.name} is active. One downloaded city can be stored alongside bundled Vancouver and Richmond.${upstreamConnected ? "" : " Connect the board in the Wi-Fi tab before downloading."}`;
      mapList.replaceChildren();
      const maps = Array.isArray(payload.maps) ? payload.maps : [];
      maps.forEach((entry) => {
        const city = entry.map;
        const card = document.createElement("div");
        card.className = "map-card";
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = city.name;
        const description = document.createElement("small");
        const size = `${(city.bytes / 1024).toFixed(0)} KiB with detail index`;
        description.textContent = city.bundled
          ? `Bundled · ${size}`
          : entry.installed
            ? `Downloaded · ${size}`
            : `Available download · ${size}`;
        details.append(title, description);
        const button = document.createElement("button");
        button.type = "button";
        if (entry.active) {
          button.className = "secondary active-map";
          button.textContent = "Active";
          button.disabled = true;
        } else if (entry.installed) {
          button.className = "secondary";
          button.textContent = "Use";
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              show(await postForm("/api/maps/activate", new URLSearchParams({ city: city.id })));
              await loadMaps();
              await loadLocations();
            } catch (error) {
              show(`Map switch failed: ${error.message}`, true);
              button.disabled = false;
            }
          });
        }
        card.append(details, button);
        mapList.append(card);
      });
      if (!maps.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No city maps are available.";
        mapList.append(empty);
      }
    } catch (error) {
      mapSummary.textContent = `Could not load city maps: ${error.message}`;
    }
  };

  wifiForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    wifiConnect.disabled = true;
    show(`Connecting the board to ${wifiSsid.value}...`);
    try {
      show(
        await postForm(
          "/api/wifi",
          new URLSearchParams({ ssid: wifiSsid.value, password: wifiPassword.value }),
        ),
      );
      wifiPassword.value = "";
      await loadMaps();
    } catch (error) {
      show(
        `Connection status was not returned: ${error.message}. If the hotspot changed channel, reconnect and refresh.`,
        true,
      );
    } finally {
      wifiConnect.disabled = false;
    }
  });
  cityQuery.addEventListener("input", () => {
    cityDownload.disabled = !cityQuery.value.trim() || !upstreamConnected;
  });
  openWifi.addEventListener("click", () => selectPanel("wifi-panel", true));
  cityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = cityQuery.value.trim();
    if (!query) return;
    cityDownload.disabled = true;
    show(`Generating and downloading ${query}... This can take about a minute.`);
    try {
      show(await postForm("/api/maps/install", new URLSearchParams({ city: query })));
      await loadMaps();
      await loadLocations();
      selectPanel("new-panel");
    } catch (error) {
      show(`Download failed: ${error.message}`, true);
      await loadMaps();
    }
  });
  const renderLocationList = (container, entries, emptyMessage) => {
    container.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = emptyMessage;
      container.append(empty);
      return;
    }
    entries.forEach((location) => {
      const card = document.createElement("div");
      card.className = "location-card";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = location.name;
      const coordinates = document.createElement("small");
      coordinates.textContent = `${location.latitude}, ${location.longitude}`;
      details.append(title, coordinates);

      const actions = document.createElement("div");
      actions.className = "location-actions";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "secondary";
      view.textContent = "View";
      view.addEventListener("click", () => {
        choosePoint(Number(location.latitude), Number(location.longitude), {
          center: true,
          name: location.name,
          zoom: 10,
        });
        selectPanel("new-panel");
        show(
          pointInMap({
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
          })
            ? `${location.name} is selected on the map.`
            : `${location.name} is outside the active ${mapDefinition.name} map; its exact coordinates are still selected.`,
        );
      });
      const set = document.createElement("button");
      set.type = "button";
      set.textContent = "Set";
      set.addEventListener("click", async () => {
        set.disabled = true;
        show(`Setting ${location.name} on the iPhone...`);
        try {
          show(await postLocation("/api/set-location", location));
          await loadLocations();
        } catch (error) {
          show(`Set failed: ${error.message}`, true);
        } finally {
          set.disabled = false;
        }
      });
      actions.append(view, set);
      card.append(details, actions);
      container.append(card);
    });
  };
  const loadLocations = async () => {
    reload.disabled = true;
    try {
      const response = await fetch("/api/locations", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = await response.json();
      const storedLocations = Array.isArray(payload.locations) ? payload.locations : [];
      const presetLocations = Array.isArray(payload.presets) ? payload.presets : [];
      savedCount.textContent = storedLocations.length + presetLocations.length;
      savedCount.hidden = false;
      renderSavedPins([...storedLocations, ...presetLocations]);
      renderLocationList(
        locations,
        storedLocations,
        "No saved locations yet. Choose a point on the map and save it.",
      );
      renderLocationList(presets, presetLocations, "No predefined locations in this firmware.");
    } catch (error) {
      locations.replaceChildren();
      presets.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = `Could not load board locations: ${error.message}`;
      locations.append(empty);
    } finally {
      reload.disabled = false;
    }
  };

  capture.addEventListener("click", () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      show(
        "Location access needs the trusted HTTPS portal. Finish the certificate setup, then reload.",
        true,
      );
      return;
    }
    capture.disabled = true;
    show("Getting a precise GPS fix...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        choosePoint(coords.latitude, coords.longitude, {
          center: true,
          name: "Current location",
          zoom: 16,
        });
        capture.disabled = false;
        show(`Location captured (accuracy about ${Math.round(coords.accuracy)} m).`);
      },
      (error) => {
        capture.disabled = false;
        const hint =
          error.code === 1
            ? "Allow location access for enigma.test in Safari settings."
            : "Move somewhere with a clearer GPS signal and try again.";
        show(`Could not get the current location. ${hint}`, true);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });

  manual.addEventListener("click", () => {
    latitude.readOnly = false;
    longitude.readOnly = false;
    manual.disabled = true;
    manual.textContent = "Coordinate fields unlocked";
    latitude.focus();
    show("Coordinate fields unlocked. Use decimal degrees.");
  });
  name.addEventListener("input", refresh);
  [latitude, longitude].forEach((input) => {
    input.addEventListener("input", () => {
      refresh();
      if (coordinatesReady()) {
        choosePoint(Number(latitude.value), Number(longitude.value));
      }
    });
    input.addEventListener("change", () => {
      if (coordinatesReady()) {
        choosePoint(Number(latitude.value), Number(longitude.value), {
          center: true,
          zoom: Math.max(mapState.zoom, 8),
        });
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    refresh();
    if (save.disabled) {
      show("Choose valid coordinates first.", true);
      return;
    }
    save.disabled = true;
    show("Saving to the board...");
    try {
      show(await postLocation("/api/locations", currentLocation()));
      await loadLocations();
      selectPanel("saved-panel");
    } catch (error) {
      show(`Save failed: ${error.message}`, true);
    } finally {
      refresh();
    }
  });
  setNow.addEventListener("click", async () => {
    refresh();
    if (setNow.disabled) {
      show("Choose valid coordinates first.", true);
      return;
    }
    setNow.disabled = true;
    show("Setting the selected point on the iPhone...");
    try {
      show(await postLocation("/api/set-location", currentLocation()));
      await loadLocations();
    } catch (error) {
      show(`Set failed: ${error.message}`, true);
    } finally {
      refresh();
    }
  });
  restore.addEventListener("click", async () => {
    restore.disabled = true;
    show("Restoring real GPS on the iPhone...");
    try {
      const response = await fetch("/api/restore-location", { method: "POST" });
      const message = await responseMessage(response);
      if (!response.ok) throw new Error(message);
      show(message);
    } catch (error) {
      show(`Restore failed: ${error.message}`, true);
    } finally {
      restore.disabled = false;
    }
  });
  reload.addEventListener("click", loadLocations);

  refresh();
  renderMap();
  loadMaps().finally(loadLocations);
})();
