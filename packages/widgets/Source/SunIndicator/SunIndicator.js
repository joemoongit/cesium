import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import SunIndicatorViewModel from "./SunIndicatorViewModel.js";

function SunIndicator(container, scene, clock) {
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }

  container = getElement(container);

  const viewerElement =
    container.closest(".cesium-viewer") || container.parentElement;

  const labelOverlay = document.createElement("div");
  labelOverlay.className = "cesium-sunIndicator-label";
  labelOverlay.style.display = "none";
  viewerElement.appendChild(labelOverlay);

  const viewModel = new SunIndicatorViewModel(scene, clock, labelOverlay);

  viewModel._svgPath =
    "M50,28 A22,22 0 1,1 49.99,28 Z " +
    "M48,2 L52,2 L52,14 L48,14 Z " +
    "M48,86 L52,86 L52,98 L48,98 Z " +
    "M2,48 L14,48 L14,52 L2,52 Z " +
    "M86,48 L98,48 L98,52 L86,52 Z " +
    "M15,18 L18,15 L26,23 L23,26 Z " +
    "M74,77 L77,74 L85,82 L82,85 Z " +
    "M82,15 L85,18 L77,26 L74,23 Z " +
    "M15,82 L18,85 L26,77 L23,74 Z";

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-sunIndicator-wrapper";

  const element = document.createElement("button");
  element.type = "button";
  element.className =
    "cesium-button cesium-toolbar-button cesium-sunIndicator-button";
  element.setAttribute(
    "data-bind",
    "\
attr: { title: tooltip },\
click: command,\
cesiumSvgPath: { path: _svgPath, width: 100, height: 100 }",
  );

  wrapper.appendChild(element);

  const panel = document.createElement("div");
  panel.className = "cesium-sunIndicator-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-sunIndicator-panel-visible': panelVisible }",
  );

  panel.innerHTML = `
    <div class="cesium-sunIndicator-header">Sun Info</div>
    <div class="cesium-sunIndicator-viz">
      <svg viewBox="0 0 200 100" class="cesium-sunIndicator-horizon">
        <defs>
          <radialGradient id="cesium-sunDiscGlow">
            <stop offset="0%" stop-color="#FFF7A0" />
            <stop offset="50%" stop-color="#FFD040" />
            <stop offset="100%" stop-color="#FF8C00" />
          </radialGradient>
          <linearGradient id="cesium-skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a1628" />
            <stop offset="100%" stop-color="#1a3050" />
          </linearGradient>
        </defs>
        <rect width="200" height="100" fill="url(#cesium-skyGrad)" rx="4" />
        <line x1="0" y1="65" x2="200" y2="65" stroke="#445" stroke-width="1" stroke-dasharray="4,3" />
        <text x="6" y="62" fill="#667" font-size="8" font-family="sans-serif">horizon</text>
        <circle cx="100" r="14" fill="url(#cesium-sunDiscGlow)" data-bind="attr: { cy: sunAboveHorizon ? 35 : 80 }" />
      </svg>
    </div>
    <div class="cesium-sunIndicator-info">
      <div class="cesium-sunIndicator-detail">
        <span>Elevation: </span>
        <span data-bind="text: sunElevation"></span>
      </div>
      <div class="cesium-sunIndicator-detail">
        <span>Azimuth: </span>
        <span><span data-bind="text: sunAzimuth"></span> <span data-bind="text: sunAzimuthDir" class="cesium-sunIndicator-dir"></span></span>
      </div>
      <div class="cesium-sunIndicator-detail">
        <span data-bind="text: sunAboveHorizon ? 'Daytime' : 'Nighttime'"></span>
        <span class="cesium-sunIndicator-dot" data-bind="css: { 'cesium-sunIndicator-dot-day': sunAboveHorizon }"></span>
      </div>
      <div class="cesium-sunIndicator-separator"></div>
      <div class="cesium-sunIndicator-detail">
        <span>Distance: </span>
        <span><span data-bind="text: distanceAU"></span> AU</span>
      </div>
      <div class="cesium-sunIndicator-detail">
        <span></span>
        <span><span data-bind="text: distanceKm"></span> M km</span>
      </div>
      <div class="cesium-sunIndicator-separator"></div>
      <div class="cesium-sunIndicator-actions">
        <button type="button" class="cesium-button cesium-sunIndicator-action-btn"
          data-bind="click: flyToSunCommand">
          Fly to Sun
        </button>
        <button type="button" class="cesium-button cesium-sunIndicator-action-btn"
          data-bind="click: toggleLabelCommand, css: { 'cesium-sunIndicator-action-btn-active': labelVisible }">
          Label
        </button>
        <button type="button" class="cesium-button cesium-sunIndicator-action-btn"
          data-bind="click: toggleOrbitCommand, css: { 'cesium-sunIndicator-action-btn-active': orbitActive }">
          10000x
        </button>
      </div>
    </div>
  `;

  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  knockout.applyBindings(viewModel, wrapper);

  this._container = container;
  this._wrapper = wrapper;
  this._viewModel = viewModel;
  this._element = element;
  this._labelOverlay = labelOverlay;

  this._closePanel = function (e) {
    if (!wrapper.contains(e.target)) {
      viewModel.panelVisible = false;
      if (!viewModel.labelVisible && viewModel._tickListener) {
        viewModel._stopUpdating();
      }
    }
  };

  if (FeatureDetection.supportsPointerEvents()) {
    document.addEventListener("pointerdown", this._closePanel, true);
  } else {
    document.addEventListener("mousedown", this._closePanel, true);
    document.addEventListener("touchstart", this._closePanel, true);
  }
}

Object.defineProperties(SunIndicator.prototype, {
  container: {
    get: function () {
      return this._container;
    },
  },
  viewModel: {
    get: function () {
      return this._viewModel;
    },
  },
});

SunIndicator.prototype.isDestroyed = function () {
  return false;
};

SunIndicator.prototype.destroy = function () {
  if (FeatureDetection.supportsPointerEvents()) {
    document.removeEventListener("pointerdown", this._closePanel, true);
  } else {
    document.removeEventListener("mousedown", this._closePanel, true);
    document.removeEventListener("touchstart", this._closePanel, true);
  }
  this._viewModel._stopTrackingSun();
  this._viewModel._stopUpdating();
  knockout.cleanNode(this._wrapper);
  this._container.removeChild(this._wrapper);
  if (this._labelOverlay.parentElement) {
    this._labelOverlay.parentElement.removeChild(this._labelOverlay);
  }
  return destroyObject(this);
};

export default SunIndicator;
