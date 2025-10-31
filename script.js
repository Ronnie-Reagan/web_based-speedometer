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

restorePersistedReadouts();
bindControls();

function byId(id) {
  return document.getElementById(id);
}

function bindControls() {
  elements.startButton?.addEventListener("click", startTracking);
  elements.resetButton?.addEventListener("click", resetAllStores);
}

function startTracking() {
  if (!navigator.geolocation) {
    window.alert("Geolocation is not supported on this device.");
    return;
  }

  if (watchId !== null) {
    return;
  }

  elements.startButton.disabled = true;
  elements.startButton.textContent = "Tracking…";

  sessionStart = Date.now();
  updateSessionClock();
  sessionTimer = window.setInterval(updateSessionClock, 1000);

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function resetAllStores() {
  speedStatsStore.reset();
  const accelState = accelerationStore.reset();
  const distance = distanceStore.reset();
  const quarterState = quarterMileTracker.reset();
  const zeroSixtyState = zeroSixtyTracker.reset();

  renderSpeedStats(speedStatsStore.get());
  renderAcceleration(accelState);
  renderDistance(distance);
  renderQuarterMile(quarterState);
  renderZeroSixty(zeroSixtyState);

  elements.heading.textContent = "--";
  elements.lat.textContent = "--";
  elements.lon.textContent = "--";
  elements.speed.textContent = "--";
  elements.speedMph.textContent = "--";
  elements.speedKph.textContent = "--";
  elements.speedKnots.textContent = "--";
  elements.sessionDuration.textContent = "00:00:00";

  lastPosition = null;
  sessionStart = Date.now();
  updateSessionClock();
}

function handlePosition(position) {
  const { latitude, longitude, heading, speed } = position.coords;
  const timestampSeconds = position.timestamp / 1000;

  elements.lat.textContent = formatCoordinate(latitude, "lat");
  elements.lon.textContent = formatCoordinate(longitude, "lon");
  elements.heading.textContent = formatHeading(heading);

  const locationSnapshot = { lat: latitude, lon: longitude, time: timestampSeconds };
  const distanceDelta = computeTravelDelta(locationSnapshot);
  const totalDistance = distanceStore.update(distanceDelta);
  renderDistance(totalDistance);

  const speedValue = resolveSpeed(speed, distanceDelta, locationSnapshot);
  renderSpeed(speedValue);

  const stats = speedStatsStore.update(speedValue);
  renderSpeedStats(stats);

  const acceleration = accelerationStore.update(speedValue, timestampSeconds);
  renderAcceleration(acceleration);

  const quarterState = quarterMileTracker.update(totalDistance, speedValue, timestampSeconds);
  renderQuarterMile(quarterState);

  const zeroSixtyState = zeroSixtyTracker.update(speedValue, timestampSeconds);
  renderZeroSixty(zeroSixtyState);

  lastPosition = locationSnapshot;
}

function handleError(err) {
  window.alert(`Geolocation error: ${err.message}`);
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  elements.startButton.disabled = false;
  elements.startButton.textContent = "Start Tracking";
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
}

function restorePersistedReadouts() {
  renderSpeedStats(speedStatsStore.get());
  renderAcceleration(accelerationStore.get());
  renderDistance(distanceStore.get());
  renderQuarterMile(quarterMileTracker.get());
  renderZeroSixty(zeroSixtyTracker.get());
}

function updateSessionClock() {
  if (!sessionStart) {
    elements.sessionDuration.textContent = "00:00:00";
    return;
  }

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
  elements.sessionDuration.textContent = formatClock(elapsedSeconds);
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
    return;
  }

  elements.speed.textContent = speed.toFixed(2);
  elements.speedMph.textContent = (speed * 2.236936).toFixed(2);
  elements.speedKph.textContent = (speed * 3.6).toFixed(2);
  elements.speedKnots.textContent = (speed * 1.943844).toFixed(2);
}

function renderSpeedStats(stats) {
  elements.speedMin.textContent = formatNullable(stats.min);
  elements.speedMax.textContent = formatNullable(stats.max);
  elements.speedAvg.textContent = formatNullable(stats.average);
}

function renderAcceleration(state) {
  elements.accel.textContent = formatNullable(state.current, value => `${value.toFixed(2)} m/s^2`);
  elements.decel.textContent = formatNullable(state.currentDecel, value => `${value.toFixed(2)} m/s^2`);
  elements.peakAccel.textContent = formatNullable(state.peakAccel, value => `${value.toFixed(2)} m/s^2`);
  elements.peakDecel.textContent = formatNullable(state.peakDecel, value => `${value.toFixed(2)} m/s^2`);
}

function renderDistance(totalMeters) {
  const km = totalMeters / 1000;
  const miles = totalMeters / 1609.344;
  elements.distanceTotal.textContent = `${km.toFixed(2)} km / ${miles.toFixed(2)} mi`;
}

function renderQuarterMile(state) {
  elements.quarterStatus.textContent = state.status;
  elements.quarterLast.textContent = formatNullable(state.lastTime, formatSeconds);
  elements.quarterBest.textContent = formatNullable(state.bestTime, formatSeconds);
}

function renderZeroSixty(state) {
  elements.zeroSixtyLast.textContent = formatNullable(state.lastTime, formatSeconds);
  elements.zeroSixtyBest.textContent = formatNullable(state.bestTime, formatSeconds);
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
