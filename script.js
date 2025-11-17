// GPS Speedometer telemetry with functional state modules per feature set.

const EARTH_RADIUS_M = 6371000;
const QUARTER_MILE_M = 402.336;
const ZERO_TO_SIXTY_TARGET_MS = 26.8224; // 60 mph in m/s
const LOCAL_STORAGE_PREFIX = "wb_speedometer_";

const elements = {
  lat: byId("lat"),
  lon: byId("lon"),
  heading: byId("heading"),
  speed: byId("speed"),
  speedMph: byId("speed-mph"),
  speedKph: byId("speed-kph"),
  speedKnots: byId("speed-knots"),
  speedMin: byId("speed-min"),
  speedMax: byId("speed-max"),
  speedAvg: byId("speed-avg"),
  accel: byId("accel"),
  decel: byId("decel"),
  peakAccel: byId("peak-accel"),
  peakDecel: byId("peak-decel"),
  distanceTotal: byId("distance-total"),
  sessionDuration: byId("session-duration"),
  quarterStatus: byId("quarter-status"),
  quarterLast: byId("quarter-last"),
  quarterBest: byId("quarter-best"),
  zeroSixtyLast: byId("zero-sixty-last"),
  zeroSixtyBest: byId("zero-sixty-best"),
  startButton: byId("start"),
  resetButton: byId("reset-stats"),
  mirrorKph: byId("mirror-speed-kph"),
  mirrorMph: byId("mirror-speed-mph"),
};

const displayElements = {
  container: document.querySelector("[data-display-carousel]"),
  track: byId("display-track"),
  label: byId("display-label"),
  indicator: byId("display-indicator"),
  prevButton: byId("display-prev"),
  nextButton: byId("display-next"),
  uploadInput: byId("display-upload"),
  uploadList: byId("custom-display-list"),
};

const speedStatsStore = createSpeedStatsStore();
const accelerationStore = createAccelerationStore();
const distanceStore = createDistanceStore();
const quarterMileTracker = createQuarterMileTracker();
const zeroSixtyTracker = createZeroSixtyTracker();

let watchId = null;
let lastPosition = null;
let sessionStart = null;
let sessionTimer = null;
let isTracking = false;
const customDisplayFrames = new Set();
const customDisplayMeta = [];
const telemetryState = createDefaultTelemetrySnapshot();

restorePersistedReadouts();
bindControls();
const carousel = createDisplayCarousel(displayElements);
createDisplayUploadManager(displayElements, (frame, meta) => {
  registerCustomDisplayFrame(frame, meta, displayElements.uploadList);
  carousel.refreshPages();
});
updateCustomDisplayList(displayElements.uploadList, customDisplayMeta);
initializeViewportScaling();

function byId(id) {
  return document.getElementById(id);
}

function bindControls() {
  elements.startButton?.addEventListener("click", toggleTracking);
  elements.resetButton?.addEventListener("click", resetAllStores);
  updateStartButtonState();
}

function toggleTracking() {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

function updateStartButtonState() {
  if (!elements.startButton) {
    return;
  }
  elements.startButton.disabled = false;
  elements.startButton.textContent = isTracking ? "Stop Tracking" : "Start Tracking";
  elements.startButton.classList.toggle("button--stop", isTracking);
}

function startTracking() {
  if (!navigator.geolocation) {
    window.alert("Geolocation is not supported on this device.");
    return;
  }

  if (isTracking) {
    return;
  }

  isTracking = true;
  updateStartButtonState();

  sessionStart = Date.now();
  updateSessionClock();
  sessionTimer = window.setInterval(updateSessionClock, 1000);

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
  isTracking = false;
  updateStartButtonState();
}

function resetAllStores() {
  speedStatsStore.reset();
  const accelState = accelerationStore.reset();
  const distance = distanceStore.reset();
  const quarterState = quarterMileTracker.reset();
  const zeroSixtyState = zeroSixtyTracker.reset();

  const speedData = renderSpeed(null);
  const statsData = renderSpeedStats(speedStatsStore.get());
  const accelerationData = renderAcceleration(accelState);
  const distanceData = renderDistance(distance);
  const quarterData = renderQuarterMile(quarterState);
  const zeroData = renderZeroSixty(zeroSixtyState);

  elements.heading.textContent = "--";
  elements.lat.textContent = "--";
  elements.lon.textContent = "--";
  elements.sessionDuration.textContent = "00:00:00";

  lastPosition = null;
  sessionStart = Date.now();
  updateSessionClock();

  pushTelemetry({
    lat: null,
    lon: null,
    heading: null,
    ...speedData,
    ...statsData,
    ...accelerationData,
    ...distanceData,
    ...quarterData,
    ...zeroData,
    measurementTimestamp: null,
  });
}

function handlePosition(position) {
  const { latitude, longitude, heading, speed } = position.coords;
  const timestampSeconds = position.timestamp / 1000;
  const headingValue = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null;

  elements.lat.textContent = formatCoordinate(latitude, "lat");
  elements.lon.textContent = formatCoordinate(longitude, "lon");
  elements.heading.textContent = formatHeading(heading);

  const locationSnapshot = { lat: latitude, lon: longitude, time: timestampSeconds };
  const distanceDelta = computeTravelDelta(locationSnapshot);
  const totalDistance = distanceStore.update(distanceDelta);
  const distanceData = renderDistance(totalDistance);

  const speedValue = resolveSpeed(speed, distanceDelta, locationSnapshot);
  const speedData = renderSpeed(speedValue);

  const stats = speedStatsStore.update(speedValue);
  const statsData = renderSpeedStats(stats);

  const acceleration = accelerationStore.update(speedValue, timestampSeconds);
  const accelerationData = renderAcceleration(acceleration);

  const quarterState = quarterMileTracker.update(totalDistance, speedValue, timestampSeconds);
  const quarterData = renderQuarterMile(quarterState);

  const zeroSixtyState = zeroSixtyTracker.update(speedValue, timestampSeconds);
  const zeroData = renderZeroSixty(zeroSixtyState);

  lastPosition = locationSnapshot;

  pushTelemetry({
    lat: Number.isFinite(latitude) ? latitude : null,
    lon: Number.isFinite(longitude) ? longitude : null,
    heading: headingValue,
    gpsTimestamp: timestampSeconds,
    ...speedData,
    ...statsData,
    ...accelerationData,
    ...distanceData,
    ...quarterData,
    ...zeroData,
  });
}

function handleError(err) {
  window.alert(`Geolocation error: ${err.message}`);
  stopTracking();
}

function restorePersistedReadouts() {
  const speedData = renderSpeed(null);
  const statsData = renderSpeedStats(speedStatsStore.get());
  const accelerationData = renderAcceleration(accelerationStore.get());
  const distanceData = renderDistance(distanceStore.get());
  const quarterData = renderQuarterMile(quarterMileTracker.get());
  const zeroData = renderZeroSixty(zeroSixtyTracker.get());

  pushTelemetry({
    lat: null,
    lon: null,
    heading: null,
    ...speedData,
    ...statsData,
    ...accelerationData,
    ...distanceData,
    ...quarterData,
    ...zeroData,
    measurementTimestamp: null,
  });
}

function updateSessionClock() {
  let elapsedSeconds = 0;
  if (sessionStart) {
    elapsedSeconds = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
  }
  elements.sessionDuration.textContent = formatClock(elapsedSeconds);
  if (telemetryState.sessionSeconds !== elapsedSeconds) {
    pushTelemetry({ sessionSeconds: elapsedSeconds });
  }
}

function resolveSpeed(rawSpeed, distanceDelta, snapshot) {
  if (Number.isFinite(rawSpeed)) {
    return rawSpeed;
  }

  if (!lastPosition) {
    return null;
  }

  const dt = snapshot.time - lastPosition.time;
  if (!dt || dt <= 0) {
    return null;
  }

  if (!Number.isFinite(distanceDelta)) {
    return null;
  }

  return distanceDelta / dt;
}

function computeTravelDelta(current) {
  if (!lastPosition) {
    return 0;
  }

  const dLat = toRadians(current.lat - lastPosition.lat);
  const dLon = toRadians(current.lon - lastPosition.lon);
  const lat1 = toRadians(lastPosition.lat);
  const lat2 = toRadians(current.lat);

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function formatCoordinate(value, axis) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(6)}° ${suffix}`;
}

function formatHeading(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const normalized = ((value % 360) + 360) % 360;
  const cardinal = headingToCardinal(normalized);
  return `${normalized.toFixed(1)}° ${cardinal}`;
}

function headingToCardinal(heading) {
  const headings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
  const index = Math.round(heading / 45);
  return headings[index];
}

function renderSpeed(speed) {
  if (!Number.isFinite(speed)) {
    elements.speed.textContent = "--";
    elements.speedMph.textContent = "--";
    elements.speedKph.textContent = "--";
    elements.speedKnots.textContent = "--";
    updateMirrorSpeedDisplay(null, null);
    return { speed: null, speedMph: null, speedKph: null, speedKnots: null };
  }

  const mph = speed * 2.236936;
  const kph = speed * 3.6;
  const knots = speed * 1.943844;
  elements.speed.textContent = speed.toFixed(2);
  elements.speedMph.textContent = mph.toFixed(2);
  elements.speedKph.textContent = kph.toFixed(2);
  elements.speedKnots.textContent = knots.toFixed(2);
  updateMirrorSpeedDisplay(kph, mph);
  return { speed, speedMph: mph, speedKph: kph, speedKnots: knots };
}

function updateMirrorSpeedDisplay(kph, mph) {
  if (elements.mirrorKph) {
    elements.mirrorKph.textContent = Number.isFinite(kph) ? Math.round(kph).toString() : "--";
  }
  if (elements.mirrorMph) {
    elements.mirrorMph.textContent = Number.isFinite(mph) ? Math.round(mph).toString() : "--";
  }
}

function renderSpeedStats(stats) {
  elements.speedMin.textContent = formatNullable(stats.min);
  elements.speedMax.textContent = formatNullable(stats.max);
  elements.speedAvg.textContent = formatNullable(stats.average);
  return { speedMin: stats.min, speedMax: stats.max, speedAvg: stats.average };
}

function renderAcceleration(state) {
  elements.accel.textContent = formatNullable(state.current, value => `${value.toFixed(2)} m/s^2`);
  elements.decel.textContent = formatNullable(state.currentDecel, value => `${value.toFixed(2)} m/s^2`);
  elements.peakAccel.textContent = formatNullable(state.peakAccel, value => `${value.toFixed(2)} m/s^2`);
  elements.peakDecel.textContent = formatNullable(state.peakDecel, value => `${value.toFixed(2)} m/s^2`);
  return {
    accelCurrent: Number.isFinite(state.current) ? state.current : null,
    decelCurrent: Number.isFinite(state.currentDecel) ? state.currentDecel : null,
    peakAccel: state.peakAccel,
    peakDecel: state.peakDecel,
  };
}

function renderDistance(totalMeters) {
  const km = totalMeters / 1000;
  const miles = totalMeters / 1609.344;
  elements.distanceTotal.textContent = `${km.toFixed(2)} km / ${miles.toFixed(2)} mi`;
  return { distanceMeters: totalMeters, distanceKm: km, distanceMiles: miles };
}

function renderQuarterMile(state) {
  elements.quarterStatus.textContent = state.status;
  elements.quarterLast.textContent = formatNullable(state.lastTime, formatSeconds);
  elements.quarterBest.textContent = formatNullable(state.bestTime, formatSeconds);
  return { quarterStatus: state.status, quarterLast: state.lastTime, quarterBest: state.bestTime };
}

function renderZeroSixty(state) {
  elements.zeroSixtyLast.textContent = formatNullable(state.lastTime, formatSeconds);
  elements.zeroSixtyBest.textContent = formatNullable(state.bestTime, formatSeconds);
  return { zeroSixtyLast: state.lastTime, zeroSixtyBest: state.bestTime };
}

function formatNullable(value, mapper = defaultNumberFormatter) {
  if (!Number.isFinite(value) || value === null) {
    return "--";
  }
  return mapper(value);
}

function defaultNumberFormatter(value) {
  return value.toFixed(2);
}

function formatSeconds(value) {
  return `${value.toFixed(2)} s`;
}

function formatClock(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(value) {
  return value.toString().padStart(2, "0");
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function loadState(key, fallback) {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    if (!raw) {
      return { ...fallback };
    }
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch (err) {
    console.warn("Unable to read state", err);
    return { ...fallback };
  }
}

function persistState(key, value) {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.warn("Unable to persist state", err);
  }
}

function createSpeedStatsStore() {
  const defaults = { count: 0, total: 0, min: null, max: null };
  let state = loadState("speed_stats", defaults);

  function update(speed) {
    if (!Number.isFinite(speed)) {
      return get();
    }
    state.count += 1;
    state.total += speed;
    state.min = state.min === null ? speed : Math.min(state.min, speed);
    state.max = state.max === null ? speed : Math.max(state.max, speed);
    persistState("speed_stats", state);
    return get();
  }

  function reset() {
    state = { ...defaults };
    persistState("speed_stats", state);
  }

  function get() {
    const average = state.count ? state.total / state.count : null;
    return { min: state.min, max: state.max, average };
  }

  return { update, reset, get };
}

function createAccelerationStore() {
  const defaults = { lastSpeed: null, lastTime: null, peakAccel: null, peakDecel: null };
  let state = loadState("acceleration", defaults);
  let current = null;

  function update(speed, timestamp) {
    if (Number.isFinite(speed) && Number.isFinite(timestamp) && state.lastSpeed !== null && state.lastTime !== null) {
      const dt = timestamp - state.lastTime;
      if (dt > 0) {
        current = (speed - state.lastSpeed) / dt;
        if (Number.isFinite(current)) {
          if (current > 0) {
            state.peakAccel = state.peakAccel === null ? current : Math.max(state.peakAccel, current);
          }
          if (current < 0) {
            const magnitude = Math.abs(current);
            state.peakDecel = state.peakDecel === null ? magnitude : Math.max(state.peakDecel, magnitude);
          }
        }
      }
    } else {
      current = null;
    }

    if (Number.isFinite(speed) && Number.isFinite(timestamp)) {
      state.lastSpeed = speed;
      state.lastTime = timestamp;
      persistState("acceleration", state);
    }

    return get();
  }

  function reset() {
    state = { ...defaults };
    current = null;
    persistState("acceleration", state);
    return get();
  }

  function get() {
    const decel = current && current < 0 ? Math.abs(current) : (current === 0 ? 0 : null);
    return {
      current: Number.isFinite(current) ? current : null,
      currentDecel: Number.isFinite(decel) ? decel : null,
      peakAccel: state.peakAccel,
      peakDecel: state.peakDecel,
    };
  }

  return { update, reset, get };
}

function createDistanceStore() {
  const defaults = { total: 0 };
  let state = loadState("distance", defaults);

  function update(delta) {
    if (Number.isFinite(delta) && delta > 0) {
      state.total += delta;
      persistState("distance", state);
    }
    return state.total;
  }

  function reset() {
    state = { ...defaults };
    persistState("distance", state);
    return state.total;
  }

  function get() {
    return state.total;
  }

  return { update, reset, get };
}

function createQuarterMileTracker() {
  const defaults = { bestTime: null, lastTime: null };
  let state = loadState("quartermile", defaults);
  let runStart = null;
  let status = "Standby";

  function update(totalDistance, speed, timestamp) {
    if (shouldArmRun(speed) && !runStart) {
      runStart = { distance: totalDistance, time: timestamp };
      status = "Running";
      return get();
    }

    if (!runStart) {
      status = "Standby";
      return get();
    }

    const covered = totalDistance - runStart.distance;
    if (covered >= QUARTER_MILE_M) {
      const elapsed = timestamp - runStart.time;
      if (Number.isFinite(elapsed) && elapsed > 0) {
        state.lastTime = elapsed;
        if (state.bestTime === null || elapsed < state.bestTime) {
          state.bestTime = elapsed;
        }
        persistState("quartermile", state);
        status = "Completed";
      } else {
        status = "Standby";
      }
      runStart = null;
      return get();
    }

    if (speed !== null && Number.isFinite(speed) && speed < 0.5) {
      status = "Standby";
      runStart = null;
    } else {
      const remaining = QUARTER_MILE_M - covered;
      status = remaining > 0 ? `Running (${remaining.toFixed(1)} m left)` : "Running";
    }

    return get();
  }

  function reset() {
    state = { ...defaults };
    persistState("quartermile", state);
    runStart = null;
    status = "Standby";
    return get();
  }

  function get() {
    return { status, lastTime: state.lastTime, bestTime: state.bestTime };
  }

  return { update, reset, get };
}

function shouldArmRun(speed) {
  return Number.isFinite(speed) && speed >= 1.0;
}

function createZeroSixtyTracker() {
  const defaults = { bestTime: null, lastTime: null };
  let state = loadState("zero_sixty", defaults);
  let phase = "idle";
  let startTime = null;

  function update(speed, timestamp) {
    if (!Number.isFinite(speed) || !Number.isFinite(timestamp)) {
      return get();
    }

    switch (phase) {
      case "idle":
        if (speed <= 0.5) {
          phase = "armed";
        }
        break;
      case "armed":
        if (speed > 0.5) {
          phase = "running";
          startTime = timestamp;
        }
        break;
      case "running":
        if (speed >= ZERO_TO_SIXTY_TARGET_MS) {
          const elapsed = timestamp - startTime;
          if (elapsed > 0) {
            state.lastTime = elapsed;
            if (state.bestTime === null || elapsed < state.bestTime) {
              state.bestTime = elapsed;
            }
            persistState("zero_sixty", state);
            phase = "cooldown";
          } else {
            phase = "idle";
          }
        } else if (speed <= 0.5) {
          phase = "armed";
        }
        break;
      case "cooldown":
        if (speed <= 0.5) {
          phase = "armed";
        }
        break;
      default:
        phase = "idle";
    }

    return get();
  }

  function reset() {
    state = { ...defaults };
    persistState("zero_sixty", state);
    phase = "idle";
    startTime = null;
    return get();
  }

  function get() {
    return { lastTime: state.lastTime, bestTime: state.bestTime };
  }

  return { update, reset, get };
}

function createDefaultTelemetrySnapshot() {
  return {
    lat: null,
    lon: null,
    heading: null,
    gpsTimestamp: null,
    sessionSeconds: 0,
    speed: null,
    speedMph: null,
    speedKph: null,
    speedKnots: null,
    speedMin: null,
    speedMax: null,
    speedAvg: null,
    accelCurrent: null,
    decelCurrent: null,
    peakAccel: null,
    peakDecel: null,
    distanceMeters: 0,
    distanceKm: 0,
    distanceMiles: 0,
    quarterStatus: "Standby",
    quarterLast: null,
    quarterBest: null,
    zeroSixtyLast: null,
    zeroSixtyBest: null,
    updatedAt: Date.now(),
  };
}

function pushTelemetry(update) {
  if (!update || typeof update !== "object") {
    return;
  }
  Object.assign(telemetryState, update);
  telemetryState.updatedAt = Date.now();
  broadcastTelemetry();
}

function broadcastTelemetry() {
  if (!customDisplayFrames.size) {
    return;
  }
  const snapshot = { ...telemetryState };
  customDisplayFrames.forEach(frame => sendTelemetryToFrame(frame, snapshot));
}

function sendTelemetryToFrame(frame, payload) {
  try {
    frame.contentWindow?.postMessage({ type: "telemetry", payload }, "*");
  } catch (err) {
    console.warn("Unable to send telemetry to custom display", err);
  }
}

function registerCustomDisplayFrame(frame, meta, listElement) {
  if (!frame) {
    return;
  }
  customDisplayFrames.add(frame);
  customDisplayMeta.push(meta);
  updateCustomDisplayList(listElement, customDisplayMeta);
  const dispatch = () => sendTelemetryToFrame(frame, { ...telemetryState });
  frame.addEventListener("load", dispatch);
  dispatch();
}

function updateCustomDisplayList(listElement, displays) {
  if (!listElement) {
    return;
  }
  listElement.innerHTML = "";
  if (!displays.length) {
    const empty = document.createElement("li");
    empty.textContent = "No custom displays loaded yet.";
    listElement.appendChild(empty);
    return;
  }
  displays.forEach(display => {
    const li = document.createElement("li");
    const parts = [];
    if (display.sources?.html) parts.push("HTML");
    if (display.sources?.css) parts.push("CSS");
    if (display.sources?.js) parts.push("JS");
    const suffix = parts.length ? ` (${parts.join(" + ")})` : "";
    li.textContent = `${display.label}${suffix}`;
    listElement.appendChild(li);
  });
}

function createDisplayCarousel(elements) {
  const { container, track, label, indicator, prevButton, nextButton } = elements;
  if (!container || !track) {
    return { refreshPages: () => {} };
  }

  const state = {
    index: 0,
    pages: [],
    width: container.getBoundingClientRect().width,
    pointerId: null,
    startX: 0,
    deltaX: 0,
    activePointers: new Set(),
    isMultiTouch: false,
  };

  const observer = new MutationObserver(refreshPages);
  observer.observe(track, { childList: true });

  window.addEventListener("resize", () => {
    state.width = container.getBoundingClientRect().width;
    applyTransform();
  });

  prevButton?.addEventListener("click", () => goTo(state.index - 1));
  nextButton?.addEventListener("click", () => goTo(state.index + 1));

  track.addEventListener("pointerdown", pointerDown);
  track.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
  track.addEventListener("pointercancel", pointerUp);

  function refreshPages() {
    state.pages = Array.from(track.children);
    if (!state.pages.length) {
      state.index = 0;
    } else if (state.index >= state.pages.length) {
      state.index = state.pages.length - 1;
    }
    updateControls();
    applyTransform();
  }

  function goTo(targetIndex) {
    if (!state.pages.length) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(targetIndex, state.pages.length - 1));
    if (nextIndex === state.index) {
      track.style.transition = "";
      applyTransform();
      return;
    }
    state.index = nextIndex;
    track.style.transition = "";
    applyTransform();
    updateControls();
  }

  function updateControls() {
    if (label) {
      const active = state.pages[state.index];
      label.textContent = active?.dataset.label || `Display ${state.index + 1}`;
    }
    if (indicator) {
      const total = Math.max(state.pages.length, 1);
      indicator.textContent = `${Math.min(state.index + 1, total)} / ${total}`;
    }
    if (prevButton) {
      prevButton.disabled = state.index <= 0;
    }
    if (nextButton) {
      nextButton.disabled = !state.pages.length || state.index >= state.pages.length - 1;
    }
  }

  function pointerDown(event) {
    if (event.pointerType === "mouse" && event.buttons !== 1) {
      return;
    }

    state.activePointers.add(event.pointerId);

    if (event.pointerType === "touch" && state.activePointers.size > 1) {
      state.isMultiTouch = true;
      cancelSwipe();
      return;
    }

    if (state.isMultiTouch) {
      return;
    }

    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.deltaX = 0;
    track.style.transition = "none";
    track.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (state.isMultiTouch || event.pointerId !== state.pointerId) {
      return;
    }
    state.deltaX = event.clientX - state.startX;
    applyTransform(state.deltaX);
  }

  function pointerUp(event) {
    state.activePointers.delete(event.pointerId);
    if (!state.activePointers.size) {
      state.isMultiTouch = false;
    }
    if (event.pointerId !== state.pointerId) {
      if (!state.activePointers.has(state.pointerId)) {
        state.pointerId = null;
        state.deltaX = 0;
      }
      return;
    }
    track.releasePointerCapture?.(event.pointerId);
    track.style.transition = "";
    if (!state.isMultiTouch) {
      finishSwipe();
    } else {
      applyTransform();
    }
    state.pointerId = null;
    state.deltaX = 0;
  }

  function finishSwipe() {
    const threshold = Math.min(120, state.width * 0.2);
    if (Math.abs(state.deltaX) > threshold) {
      if (state.deltaX < 0) {
        goTo(state.index + 1);
      } else {
        goTo(state.index - 1);
      }
    } else {
      applyTransform();
    }
    state.deltaX = 0;
  }

  function applyTransform(extra = 0) {
    state.width = container.getBoundingClientRect().width || 1;
    const offset = -state.index * state.width + extra;
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function cancelSwipe() {
    if (state.pointerId !== null) {
      track.releasePointerCapture?.(state.pointerId);
    }
    state.pointerId = null;
    state.deltaX = 0;
    track.style.transition = "";
    applyTransform();
  }

  refreshPages();

  return { refreshPages, goTo };
}

function createDisplayUploadManager(elements, onDisplayReady) {
  const { uploadInput, track } = elements;
  if (!uploadInput || !track) {
    return;
  }

  uploadInput.addEventListener("change", async event => {
    const files = Array.from(event.target.files || []);
    uploadInput.value = "";
    if (!files.length) {
      return;
    }

    const groups = groupFilesByBasename(files);
    let processed = 0;
    for (const group of groups.values()) {
      if (!group.html && !group.js) {
        continue;
      }
      const label = formatDisplayLabel(group.baseName);
      try {
        const content = await readGroupFiles(group);
        const page = document.createElement("article");
        page.className = "display-page display-page--external";
        page.dataset.label = label;
        const frame = document.createElement("iframe");
        frame.title = `${label} display`;
        frame.loading = "lazy";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.srcdoc = composeModuleDocument(content);
        page.appendChild(frame);
        track.appendChild(page);
        const sources = {
          html: group.html?.name ?? null,
          css: group.css?.name ?? null,
          js: group.js?.name ?? null,
        };
        onDisplayReady?.(frame, { label, sources });
        processed += 1;
      } catch (err) {
        console.error("Unable to load custom display", err);
        window.alert(`Unable to load display "${label}": ${err.message}`);
      }
    }

    if (!processed) {
      window.alert("No display files were processed. Please include at least one .html or .js file per display.");
    }
  });
}

function groupFilesByBasename(files) {
  const groups = new Map();
  files.forEach(file => {
    const match = /\.([^.]+)$/i.exec(file.name);
    if (!match) {
      return;
    }
    const ext = match[1].toLowerCase();
    if (!["html", "htm", "css", "js"].includes(ext)) {
      return;
    }
    const baseName = file.name.slice(0, -match[0].length) || file.name;
    const key = baseName.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { baseName });
    }
    const bucket = groups.get(key);
    if (ext === "html" || ext === "htm") {
      bucket.html = file;
    } else {
      bucket[ext] = file;
    }
  });
  return groups;
}

async function readGroupFiles(group) {
  const hasHtml = Boolean(group.html);
  const hasCss = Boolean(group.css);
  const hasJs = Boolean(group.js);
  if (!hasHtml && !hasJs) {
    throw new Error("A display must include an HTML or JS file.");
  }
  const html = hasHtml ? await readFile(group.html) : "";
  if (hasHtml && !html.trim()) {
    throw new Error("HTML file is empty.");
  }
  const css = hasCss ? await readFile(group.css) : "";
  const js = hasJs ? await readFile(group.js) : "";
  return { html, css, js, hasHtml, hasCss, hasJs };
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsText(file);
  });
}

function formatDisplayLabel(baseName) {
  if (!baseName) {
    return "Custom Display";
  }
  return baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function composeModuleDocument(parts) {
  const hasHtml = Boolean(parts.hasHtml && parts.html.trim());
  const fallbackMarkup = `
    <div class="display-host__root" data-display-root>
      <p class="display-host__hint">Use <code>registerDisplay()</code> in your script to render this surface.</p>
    </div>
  `;
  const fallbackStyles = `
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #050a11;
        color: #f3f7ff;
        display: flex;
        align-items: stretch;
        justify-content: center;
      }
      .display-host__root {
        width: 100%;
        min-height: 100vh;
        padding: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .display-host__hint {
        max-width: 28rem;
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.6;
        opacity: 0.7;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .display-host__hint code {
        font-family: inherit;
        color: #4be1ff;
      }
    </style>
  `;
  const htmlBlock = hasHtml ? parts.html : fallbackMarkup;
  const cssBlock = parts.css ? `<style>${parts.css}</style>` : "";
  const baseStyles = hasHtml ? "" : fallbackStyles;
  const bridgeScript = `
    (function() {
      const listeners = new Set();
      const root = document.querySelector('[data-display-root]') || document.body;

      function safeInvoke(listener, payload) {
        try {
          listener(payload);
        } catch (err) {
          console.error('[display] telemetry listener error', err);
        }
      }

      function dispatchTelemetry(payload) {
        window.currentTelemetry = payload;
        try {
          window.dispatchEvent(new CustomEvent('telemetry-update', { detail: payload }));
        } catch (err) {
          if (typeof document !== 'undefined' && document.createEvent) {
            const fallback = document.createEvent('CustomEvent');
            fallback.initCustomEvent('telemetry-update', false, false, payload);
            window.dispatchEvent(fallback);
          }
        }
        listeners.forEach(listener => safeInvoke(listener, payload));
      }

      function addTelemetryListener(listener) {
        if (typeof listener !== 'function') {
          return function noop() {};
        }
        listeners.add(listener);
        if (window.currentTelemetry) {
          safeInvoke(listener, window.currentTelemetry);
        }
        return function unsubscribe() {
          listeners.delete(listener);
        };
      }

      function currentTelemetry() {
        return window.currentTelemetry || null;
      }

      function clearRoot() {
        if (root) {
          root.innerHTML = '';
        }
      }

      function mount(node) {
        if (!root) {
          return;
        }
        clearRoot();
        if (!node) {
          return;
        }
        if (typeof node === 'string') {
          root.innerHTML = node;
          return;
        }
        const isElement = typeof Element !== 'undefined' && node instanceof Element;
        const isFragment = typeof DocumentFragment !== 'undefined' && node instanceof DocumentFragment;
        if (isElement || isFragment) {
          root.appendChild(node);
        }
      }

      const baseApi = {
        get root() {
          return root;
        },
        get telemetry() {
          return currentTelemetry();
        },
        getTelemetry: currentTelemetry,
        onTelemetry: addTelemetryListener,
        mount,
        clear: clearRoot,
      };

      window.DisplayHost = baseApi;

      window.registerDisplay = function registerDisplay(factory) {
        if (typeof factory !== 'function') {
          console.warn('[display] registerDisplay expected a function');
          return;
        }
        const api = {
          root,
          telemetry: currentTelemetry(),
          getTelemetry: currentTelemetry,
          onTelemetry: addTelemetryListener,
          mount,
          clear: clearRoot,
        };
        try {
          const teardown = factory(api);
          if (typeof teardown === 'function') {
            window.addEventListener('pagehide', function handlePageHide() {
              try {
                teardown();
              } catch (err) {
                console.error('[display] teardown error', err);
              }
            }, { once: true });
          }
        } catch (err) {
          console.error('[display] registerDisplay factory failed', err);
        }
      };

      window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== 'telemetry') {
          return;
        }
        dispatchTelemetry(event.data.payload);
      });
    })();
  `;
  const bridge = `<script>${escapeScriptContent(bridgeScript)}<\/script>`;
  const jsBlock = parts.js ? `<script>${escapeScriptContent(parts.js)}<\/script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${baseStyles}${cssBlock}</head><body>${htmlBlock}${bridge}${jsBlock}</body></html>`;
}

function escapeScriptContent(content = "") {
  return content.replace(/<\/script/gi, "<\\/script");
}

function initializeViewportScaling() {
  const stage = document.querySelector("[data-app-stage]");
  const surface = document.querySelector("[data-app-surface]");
  if (!stage || !surface) {
    return;
  }

  const state = { orientation: null };

  function readBaseDimensions() {
    const styles = window.getComputedStyle(stage);
    const widthVar = styles.getPropertyValue("--surface-width").trim();
    const heightVar = styles.getPropertyValue("--surface-height").trim();
    const width = parseFloat(widthVar);
    const height = parseFloat(heightVar);
    const fallback = surface.getBoundingClientRect();
    return {
      width: Number.isFinite(width) ? width : fallback.width || 1,
      height: Number.isFinite(height) ? height : fallback.height || 1,
    };
  }

  function applyScale() {
    const orientation = window.innerWidth >= window.innerHeight ? "landscape" : "portrait";
    if (state.orientation !== orientation) {
      state.orientation = orientation;
      stage.dataset.orientation = orientation;
    }

    const bounds = stage.getBoundingClientRect();
    const availableWidth = Math.max(bounds.width, 1);
    const availableHeight = Math.max(bounds.height, 1);
    const { width, height } = readBaseDimensions();
    const rawScale = Math.min(availableWidth / width, availableHeight / height);
    const safeScale = Math.max(0.35, Math.min(rawScale, 1.75));
    document.documentElement.style.setProperty("--app-scale", safeScale.toFixed(4));
  }

  const handleResize = debounce(applyScale, 75);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(applyScale, 140);
  });

  applyScale();
}

function debounce(fn, wait = 100) {
  let timeoutId = null;
  return function debounced(...args) {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      fn.apply(this, args);
    }, wait);
  };
}
