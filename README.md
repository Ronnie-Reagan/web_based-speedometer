# Click [**Here**](https://ronnie-reagan.github.io/web_based-speedometer) for the website.

## Understanding the Interface
_Notice: The website is under active development so some details may be changed._

---

### Overview
- Posistion
    - Displays your currently reported geo-location in lat/lon and heading
- Trip Summary
    - Tracks your total tracked distance and the time spent tracking **this** session

---

### Speed
- Instant Speed
    - Displays your speed in m/s, kph, mph and knots
- Historical
    - Min, Max and Avg. speed in m/s

---

### Performance
- Acceleration
    - Accel, decel with peaks in m/s^2
- Performance Timers
    - Quarter mile tracking (under construction; currently tracks rolling runs automatically)
    - 0-60 mph speeds (last/best)

---

### HUD Mirror
- Displays a HUD style display for viewing on your windsheild by laying your phone on your dash
    - KPH/MPH display with high contrast colouring for ease display on reflection

---

## Custom display starter kit

The `custom-display-example.*` files demonstrate how to build a swipeable display that plugs into the host dashboard:

1. Open the app and tap **Upload Display Files**.
2. Select `custom-display-example.html`, `custom-display-example.css`, and `custom-display-example.js` together (they must share the same base name).
3. Swipe through the dashboard to find the new “Track Companion” screen; edit the files to experiment with your own layout.

The JavaScript example is heavily commented to help you listen for the `telemetry-update` event and render speed/acceleration/timer data. Use it as a boilerplate for client-mode experiments.
