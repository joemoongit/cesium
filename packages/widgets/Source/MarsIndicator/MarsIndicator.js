import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import MarsIndicatorViewModel from "./MarsIndicatorViewModel.js";

/**
 * A widget for flying the camera to Mars. The toolbar button opens a panel showing where
 * Mars currently is relative to the camera, and offers a one-click flight out to the
 * planet. Because Cesium does not draw Mars by default, flying there also adds a Mars
 * body to the scene so there is something to arrive at.
 *
 * @alias MarsIndicator
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance to use.
 * @param {Clock} clock The clock that drives the Mars ephemeris.
 *
 * @exception {DeveloperError} container is required.
 *
 * @example
 * // Fly to Mars from code.
 * viewer.marsIndicator.viewModel.flyToMarsCommand();
 */
function MarsIndicator(container, scene, clock) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  //>>includeEnd('debug');

  container = getElement(container);

  // The label is positioned over the whole canvas, so it cannot live inside the toolbar.
  const viewerElement =
    container.closest(".cesium-viewer") ?? container.parentElement;

  const labelOverlay = document.createElement("div");
  labelOverlay.className = "cesium-marsIndicator-label";
  labelOverlay.style.display = "none";
  viewerElement.appendChild(labelOverlay);

  const viewModel = new MarsIndicatorViewModel(scene, clock, labelOverlay);

  // A rust-colored disc pocked with three craters.
  viewModel._svgPath =
    "M50,10 A40,40 0 1,1 49.99,10 Z " +
    "M38,30 A8,8 0 1,0 37.99,30 Z " +
    "M64,54 A6,6 0 1,0 63.99,54 Z " +
    "M44,68 A4,4 0 1,0 43.99,68 Z";

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-marsIndicator-wrapper";

  const element = document.createElement("button");
  element.type = "button";
  element.className =
    "cesium-button cesium-toolbar-button cesium-marsIndicator-button";
  element.setAttribute(
    "data-bind",
    "\
attr: { title: tooltip },\
click: command,\
cesiumSvgPath: { path: _svgPath, width: 100, height: 100 }",
  );
  wrapper.appendChild(element);

  const panel = document.createElement("div");
  panel.className = "cesium-marsIndicator-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-marsIndicator-panel-visible': panelVisible }",
  );
  panel.innerHTML = `
    <div class="cesium-marsIndicator-header">Mars</div>
    <div class="cesium-marsIndicator-viz">
      <svg viewBox="0 0 200 100" class="cesium-marsIndicator-horizon">
        <defs>
          <radialGradient id="cesium-marsDisc" cx="35%" cy="35%">
            <stop offset="0%" stop-color="#e8703a" />
            <stop offset="60%" stop-color="#c1440e" />
            <stop offset="100%" stop-color="#6b2208" />
          </radialGradient>
          <linearGradient id="cesium-marsSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a1628" />
            <stop offset="100%" stop-color="#1a3050" />
          </linearGradient>
        </defs>
        <rect width="200" height="100" fill="url(#cesium-marsSky)" rx="4" />
        <line x1="0" y1="65" x2="200" y2="65" stroke="#445" stroke-width="1" stroke-dasharray="4,3" />
        <text x="6" y="62" fill="#667" font-size="8" font-family="sans-serif">horizon</text>
        <circle cx="100" r="13" fill="url(#cesium-marsDisc)" data-bind="attr: { cy: aboveHorizon ? 35 : 80 }" />
      </svg>
    </div>
    <div class="cesium-marsIndicator-info">
      <div class="cesium-marsIndicator-detail">
        <span>Elevation</span>
        <span data-bind="text: elevation"></span>
      </div>
      <div class="cesium-marsIndicator-detail">
        <span>Azimuth</span>
        <span><span data-bind="text: azimuth"></span> <span class="cesium-marsIndicator-dir" data-bind="text: azimuthDir"></span></span>
      </div>
      <div class="cesium-marsIndicator-detail">
        <span data-bind="text: aboveHorizon ? 'Above horizon' : 'Below horizon'"></span>
        <span class="cesium-marsIndicator-dot" data-bind="css: { 'cesium-marsIndicator-dot-up': aboveHorizon }"></span>
      </div>
      <div class="cesium-marsIndicator-separator"></div>
      <div class="cesium-marsIndicator-detail">
        <span>Distance</span>
        <span><span data-bind="text: distanceAU"></span> AU</span>
      </div>
      <div class="cesium-marsIndicator-detail">
        <span></span>
        <span><span data-bind="text: distanceKm"></span> M km</span>
      </div>
      <div class="cesium-marsIndicator-detail">
        <span>Light time</span>
        <span><span data-bind="text: lightTime"></span> min</span>
      </div>
      <div class="cesium-marsIndicator-detail">
        <span>Apparent size</span>
        <span><span data-bind="text: angularDiameter"></span>″</span>
      </div>
      <div class="cesium-marsIndicator-separator"></div>
      <button type="button" class="cesium-button cesium-marsIndicator-fly-btn" data-bind="click: flyToCommand">
        Fly to Mars
      </button>
      <div class="cesium-marsIndicator-actions">
        <button type="button" class="cesium-button cesium-marsIndicator-action-btn"
          data-bind="click: toggleLabelCommand, css: { 'cesium-marsIndicator-action-btn-active': labelVisible }">
          Label
        </button>
        <button type="button" class="cesium-button cesium-marsIndicator-action-btn"
          data-bind="click: toggleBodyCommand, css: { 'cesium-marsIndicator-action-btn-active': bodyVisible }">
          Show Mars
        </button>
      </div>
      <div data-bind="visible: hasSatellites">
        <div class="cesium-marsIndicator-separator"></div>
        <div class="cesium-marsIndicator-moons-title">Moons</div>
        <div class="cesium-marsIndicator-moon-tabs">
          <button type="button" class="cesium-button cesium-marsIndicator-moon-tab"
            data-bind="text: satelliteNames[0],
                       click: function () { $data.selectSatelliteCommand(0); },
                       css: { 'cesium-marsIndicator-moon-tab-active': selectedSatelliteIndex === 0 }">
          </button>
          <button type="button" class="cesium-button cesium-marsIndicator-moon-tab"
            data-bind="text: satelliteNames[1],
                       click: function () { $data.selectSatelliteCommand(1); },
                       css: { 'cesium-marsIndicator-moon-tab-active': selectedSatelliteIndex === 1 }">
          </button>
        </div>
        <div class="cesium-marsIndicator-detail">
          <span>Orbit radius</span>
          <span><span data-bind="text: satelliteOrbitRadius"></span> km</span>
        </div>
        <div class="cesium-marsIndicator-detail">
          <span>Period</span>
          <span><span data-bind="text: satellitePeriod"></span> h</span>
        </div>
        <div class="cesium-marsIndicator-detail">
          <span>Mean diameter</span>
          <span><span data-bind="text: satelliteDiameter"></span> km</span>
        </div>
        <button type="button" class="cesium-button cesium-marsIndicator-fly-btn cesium-marsIndicator-moon-fly-btn"
          data-bind="text: flyToSatelliteLabel, click: flyToSatelliteCommand">
        </button>
        <div class="cesium-marsIndicator-actions">
          <button type="button" class="cesium-button cesium-marsIndicator-action-btn"
            data-bind="text: satelliteToggleLabel,
                       click: toggleSatelliteBodyCommand,
                       css: { 'cesium-marsIndicator-action-btn-active': satelliteVisible }">
          </button>
        </div>
      </div>
      <button type="button" class="cesium-button cesium-marsIndicator-action-btn cesium-marsIndicator-return-btn"
        data-bind="visible: tracking, click: returnToEarthCommand">
        Return to Earth
      </button>
    </div>
  `;
  wrapper.appendChild(panel);

  container.appendChild(wrapper);

  knockout.applyBindings(viewModel, wrapper);

  this._container = container;
  this._wrapper = wrapper;
  this._element = element;
  this._viewModel = viewModel;
  this._labelOverlay = labelOverlay;

  this._closePanel = function (e) {
    if (!wrapper.contains(e.target)) {
      viewModel.panelVisible = false;
      viewModel._syncUpdating();
    }
  };

  if (FeatureDetection.supportsPointerEvents()) {
    document.addEventListener("pointerdown", this._closePanel, true);
  } else {
    document.addEventListener("mousedown", this._closePanel, true);
    document.addEventListener("touchstart", this._closePanel, true);
  }
}

Object.defineProperties(MarsIndicator.prototype, {
  /**
   * Gets the parent container.
   * @memberof MarsIndicator.prototype
   *
   * @type {Element}
   */
  container: {
    get: function () {
      return this._container;
    },
  },

  /**
   * Gets the view model.
   * @memberof MarsIndicator.prototype
   *
   * @type {MarsIndicatorViewModel}
   */
  viewModel: {
    get: function () {
      return this._viewModel;
    },
  },
});

/**
 * @returns {boolean} true if the object has been destroyed, false otherwise.
 */
MarsIndicator.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the widget.  Should be called if permanently
 * removing the widget from layout.
 */
MarsIndicator.prototype.destroy = function () {
  if (FeatureDetection.supportsPointerEvents()) {
    document.removeEventListener("pointerdown", this._closePanel, true);
  } else {
    document.removeEventListener("mousedown", this._closePanel, true);
    document.removeEventListener("touchstart", this._closePanel, true);
  }

  this._viewModel.destroy();

  knockout.cleanNode(this._wrapper);
  this._container.removeChild(this._wrapper);
  if (defined(this._labelOverlay.parentElement)) {
    this._labelOverlay.parentElement.removeChild(this._labelOverlay);
  }

  return destroyObject(this);
};

export default MarsIndicator;
