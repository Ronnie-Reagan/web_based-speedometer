/**
 * Custom Display Example
 * ----------------------
 * Drop this file into the custom display upload flow alongside a matching HTML
 * file (and optional CSS) to create a fully custom screen.
 *
 * Recommended folder layout when developing locally:
 *   my-track-layout/
 *     my-track-layout.html
 *     my-track-layout.css
 *     my-track-layout.js  <-- this file (rename as you like)
 *
 * When you are happy with the results, select the HTML/CSS/JS files together
 * with the dashboard's upload input. Files that share the same base filename
 * (e.g. `my-track-layout.*`) are bundled into a single swipeable display.
 *
 * Key API surface exposed by the host app:
 *   - The parent iFrame posts telemetry payloads via `window.postMessage`.
 *   - This script listens for the forwarded `telemetry-update` CustomEvent.
 *   - The most recent payload is also exposed as `window.currentTelemetry`.
 *
 * Telemetry shape (partial list – inspect event.detail for the full object):
 *   {
 *     lat, lon, heading, gpsTimestamp,
 *     speed, speedMph, speedKph, speedKnots,
 *     speedMin, speedMax, speedAvg,
 *     accelCurrent, decelCurrent, peakAccel, peakDecel,
 *     distanceMeters, distanceKm, distanceMiles,
 *     quarterStatus, quarterLast, quarterBest,
 *     zeroSixtyLast, zeroSixtyBest,
 *     sessionSeconds, updatedAt
 *   }
 *
 * Tips:
 *   • Keep DOM queries scoped to your own markup to avoid collisions.
 *   • Debounce expensive rendering logic if you add charts/visualizations.
 *   • Guard every read with null/undefined checks; GPS may be unavailable.
 *   • Provide graceful fallbacks for desktop vs. mobile by using CSS media
 *     queries inside your custom stylesheet.
 */

(() => {
  const speedMeter = document.querySelector("[data-field='speed']");
  const speedUnits = document.querySelector("[data-field='speed-units']");
  const accelMeter = document.querySelector("[data-field='accel']");
  const statusLabel = document.querySelector("[data-field='quarter-status']");
  const zeroSixtyLabel = document.querySelector("[data-field='zero-sixty']");
  const coordsLabel = document.querySelector("[data-field='coords']");
  const updatedLabel = document.querySelector("[data-field='updated']");

  /**
   * Entry point – subscribe to telemetry events pushed by the parent page.
   */
  window.addEventListener("telemetry-update", event => {
    const payload = event.detail;
    if (!payload) {
      return;
    }
    renderTelemetry(payload);
  });

  /**
   * Render immediately if we already have cached telemetry.
   * This happens when you reload a custom display after the host has begun
   * tracking. Skipping this step would leave your UI blank until the next GPS
   * sample arrives.
   */
  if (window.currentTelemetry) {
    renderTelemetry(window.currentTelemetry);
  }

  /**
   * renderTelemetry
   * ---------------
   * Update your DOM nodes with the latest data. Consider keeping this function
   * tiny and delegating to helpers if you plan to maintain multiple widgets.
   */
  function renderTelemetry(data) {
    updateSpeed(data);
    updateAcceleration(data);
    updateStatus(data);
    updateCoordinates(data);
    updateTimestamp(data);
  }

  function updateSpeed(data) {
    const speed = toNumber(data.speedKnots ?? data.speedMph ?? data.speed);
    const units = data.speedKnots != null ? "kn" : data.speedMph != null ? "mph" : "m/s";

    if (speedMeter) {
      speedMeter.textContent = Number.isFinite(speed) ? speed.toFixed(1) : "--";
      speedMeter.classList.toggle("is-live", Number.isFinite(speed));
    }
    if (speedUnits) {
      speedUnits.textContent = units;
    }
  }

  function updateAcceleration(data) {
    if (!accelMeter) {
      return;
    }
    const accel = toNumber(data.accelCurrent);
    const decel = toNumber(data.decelCurrent);
    if (Number.isFinite(accel) && Math.abs(accel) > 0.01) {
      accelMeter.textContent = `${accel.toFixed(2)} m/s²`;
      accelMeter.dataset.state = "accel";
    } else if (Number.isFinite(decel) && Math.abs(decel) > 0.01) {
      accelMeter.textContent = `${decel.toFixed(2)} m/s²`;
      accelMeter.dataset.state = "decel";
    } else {
      accelMeter.textContent = "--";
      accelMeter.dataset.state = "idle";
    }
  }

  function updateStatus(data) {
    if (statusLabel) {
      const status = data.quarterStatus || "Standby";
      const last = formatMaybeSeconds(data.quarterLast);
      const best = formatMaybeSeconds(data.quarterBest);
      statusLabel.innerHTML =
        `<strong>${status}</strong><br>Last: ${last} &nbsp;|&nbsp; Best: ${best}`;
    }

    if (zeroSixtyLabel) {
      const last = formatMaybeSeconds(data.zeroSixtyLast);
      const best = formatMaybeSeconds(data.zeroSixtyBest);
      zeroSixtyLabel.textContent = `0-60 mph • Last ${last} / Best ${best}`;
    }
  }

  function updateCoordinates(data) {
    if (!coordsLabel) {
      return;
    }
    const lat = toNumber(data.lat);
    const lon = toNumber(data.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      coordsLabel.textContent = "GPS unavailable";
      return;
    }

    coordsLabel.textContent = `${formatCoordinate(lat, "lat")} • ${formatCoordinate(lon, "lon")}`;
  }

  function updateTimestamp(data) {
    if (!updatedLabel) {
      return;
    }
    const updatedAt = data.updatedAt || Date.now();
    updatedLabel.textContent = `Updated ${new Date(updatedAt).toLocaleTimeString()}`;
  }

  // ---------------------------------------------------------------------------
  // Helper utilities – feel free to copy/paste into other custom displays.
  // ---------------------------------------------------------------------------

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatMaybeSeconds(value) {
    const num = toNumber(value);
    return Number.isFinite(num) ? `${num.toFixed(2)} s` : "--";
  }

  function formatCoordinate(value, axis) {
    const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
    return `${Math.abs(value).toFixed(4)}° ${suffix}`;
  }
})();
