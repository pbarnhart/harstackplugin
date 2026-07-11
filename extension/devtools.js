// Cross-browser: Firefox exposes `browser`, Chrome exposes `chrome`.
const api = (typeof browser !== "undefined") ? browser : chrome;

api.devtools.panels.create(
  "HARstack",
  "icons/icon32.png",
  "panel.html",
  function (/* panel */) {
    // Panel created. All capture + analysis logic lives in panel.js.
  }
);
