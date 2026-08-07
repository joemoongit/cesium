import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import JupiterIndicatorViewModel from "./JupiterIndicatorViewModel.js";

/**
 * A widget for flying the camera to Jupiter. The toolbar button opens a panel showing
 * where Jupiter currently is relative to the camera, and offers a one-click flight out
 * to the planet. Because Cesium does not draw Jupiter by default, flying there also adds
 * a Jupiter body to the scene so there is something to arrive at.
 *
 * @alias JupiterIndicator
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance to use.
 * @param {Clock} clock The clock that drives the Jupiter ephemeris.
 *
 * @exception {DeveloperError} container is required.
 *
 * @example
 * // Fly to Jupiter from code.
 * viewer.jupiterIndicator.viewModel.flyToCommand();
 *
 * @see MarsIndicator
 */
function JupiterIndicator(container, scene, clock) {
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
  labelOverlay.className = "cesium-jupiterIndicator-label";
  labelOverlay.style.display = "none";
  viewerElement.appendChild(labelOverlay);

  const viewModel = new JupiterIndicatorViewModel(scene, clock, labelOverlay);

  // A banded disc: the outer circle with three cloud belts cut out of it.
  viewModel._svgPath =
    "M50,10 A40,40 0 1,1 49.99,10 Z " +
    "M17,32 A33,6 0 1,0 16.99,32 Z " +
    "M14,52 A36,5 0 1,0 13.99,52 Z " +
    "M18,68 A32,4 0 1,0 17.99,68 Z";

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-jupiterIndicator-wrapper";

  const element = document.createElement("button");
  element.type = "button";
  element.className =
    "cesium-button cesium-toolbar-button cesium-jupiterIndicator-button";
  element.setAttribute(
    "data-bind",
    "\
attr: { title: tooltip },\
click: command,\
cesiumSvgPath: { path: _svgPath, width: 100, height: 100 }",
  );
  wrapper.appendChild(element);

  const panel = document.createElement("div");
  panel.className = "cesium-jupiterIndicator-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-jupiterIndicator-panel-visible': panelVisible }",
  );
  panel.innerHTML = `
    <div class="cesium-jupiterIndicator-header">Jupiter</div>
    <div class="cesium-jupiterIndicator-viz">
      <svg viewBox="0 0 200 100" class="cesium-jupiterIndicator-horizon">
        <defs>
          <radialGradient id="cesium-jupiterDisc" cx="35%" cy="35%">
            <stop offset="0%" stop-color="#f0e4c8" />
            <stop offset="60%" stop-color="#d7b485" />
            <stop offset="100%" stop-color="#8a5f34" />
          </radialGradient>
          <linearGradient id="cesium-jupiterSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a1628" />
            <stop offset="100%" stop-color="#1a3050" />
          </linearGradient>
        </defs>
        <rect width="200" height="100" fill="url(#cesium-jupiterSky)" rx="4" />
        <line x1="0" y1="65" x2="200" y2="65" stroke="#445" stroke-width="1" stroke-dasharray="4,3" />
        <text x="6" y="62" fill="#667" font-size="8" font-family="sans-serif">horizon</text>
        <g data-bind="attr: { transform: aboveHorizon ? 'translate(0,35)' : 'translate(0,80)' }">
          <ellipse cx="100" cy="0" rx="15" ry="14" fill="url(#cesium-jupiterDisc)" />
          <ellipse cx="100" cy="-6" rx="13.2" ry="1.6" fill="#a9764a" opacity="0.55" />
          <ellipse cx="100" cy="0" rx="14.6" ry="1.8" fill="#a9764a" opacity="0.45" />
          <ellipse cx="100" cy="6" rx="13.2" ry="1.6" fill="#a9764a" opacity="0.55" />
        </g>
      </svg>
    </div>
    <div class="cesium-jupiterIndicator-info">
      <div class="cesium-jupiterIndicator-detail">
        <span>Elevation</span>
        <span data-bind="text: elevation"></span>
      </div>
      <div class="cesium-jupiterIndicator-detail">
        <span>Azimuth</span>
        <span><span data-bind="text: azimuth"></span> <span class="cesium-jupiterIndicator-dir" data-bind="text: azimuthDir"></span></span>
      </div>
      <div class="cesium-jupiterIndicator-detail">
        <span data-bind="text: aboveHorizon ? 'Above horizon' : 'Below horizon'"></span>
        <span class="cesium-jupiterIndicator-dot" data-bind="css: { 'cesium-jupiterIndicator-dot-up': aboveHorizon }"></span>
      </div>
      <div class="cesium-jupiterIndicator-separator"></div>
      <div class="cesium-jupiterIndicator-detail">
        <span>Distance</span>
        <span><span data-bind="text: distanceAU"></span> AU</span>
      </div>
      <div class="cesium-jupiterIndicator-detail">
        <span></span>
        <span><span data-bind="text: distanceKm"></span> M km</span>
      </div>
      <div class="cesium-jupiterIndicator-detail">
        <span>Light time</span>
        <span><span data-bind="text: lightTime"></span> min</span>
      </div>
      <div class="cesium-jupiterIndicator-detail">
        <span>Apparent size</span>
        <span><span data-bind="text: angularDiameter"></span>″</span>
      </div>
      <div class="cesium-jupiterIndicator-separator"></div>
      <button type="button" class="cesium-button cesium-jupiterIndicator-fly-btn" data-bind="click: flyToCommand">
        Fly to Jupiter
      </button>
      <div class="cesium-jupiterIndicator-actions">
        <button type="button" class="cesium-button cesium-jupiterIndicator-action-btn"
          data-bind="click: toggleLabelCommand, css: { 'cesium-jupiterIndicator-action-btn-active': labelVisible }">
          Label
        </button>
        <button type="button" class="cesium-button cesium-jupiterIndicator-action-btn"
          data-bind="click: toggleBodyCommand, css: { 'cesium-jupiterIndicator-action-btn-active': bodyVisible }">
          Show Jupiter
        </button>
      </div>
      <button type="button" class="cesium-button cesium-jupiterIndicator-action-btn cesium-jupiterIndicator-return-btn"
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

Object.defineProperties(JupiterIndicator.prototype, {
  /**
   * Gets the parent container.
   * @memberof JupiterIndicator.prototype
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
   * @memberof JupiterIndicator.prototype
   *
   * @type {JupiterIndicatorViewModel}
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
JupiterIndicator.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the widget.  Should be called if permanently
 * removing the widget from layout.
 */
JupiterIndicator.prototype.destroy = function () {
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

export default JupiterIndicator;
