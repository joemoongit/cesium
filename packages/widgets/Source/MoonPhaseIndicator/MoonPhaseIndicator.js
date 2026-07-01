import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import MoonPhaseIndicatorViewModel from "./MoonPhaseIndicatorViewModel.js";

function MoonPhaseIndicator(container, scene, clock) {
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }

  container = getElement(container);

  const viewerElement =
    container.closest(".cesium-viewer") || container.parentElement;

  const labelOverlay = document.createElement("div");
  labelOverlay.className = "cesium-moonPhase-label";
  labelOverlay.style.display = "none";
  viewerElement.appendChild(labelOverlay);

  const viewModel = new MoonPhaseIndicatorViewModel(scene, clock, labelOverlay);

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-moonPhase-wrapper";

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "cesium-button cesium-toolbar-button cesium-moonPhase-button";
  button.setAttribute("data-bind", "attr: { title: tooltip }, click: command");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "cesium-moonPhase-icon");

  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  circle.setAttribute("cx", "50");
  circle.setAttribute("cy", "50");
  circle.setAttribute("r", "40");
  circle.setAttribute("fill", "#F5F3CE");

  const crescent = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  crescent.setAttribute("d", "M50,10 A40,40 0 0,0 50,90 A20,40 0 0,1 50,10Z");
  crescent.setAttribute("fill", "#1a1a2e");

  svg.appendChild(circle);
  svg.appendChild(crescent);
  button.appendChild(svg);
  wrapper.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "cesium-moonPhase-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-moonPhase-panel-visible': panelVisible }",
  );

  panel.innerHTML = `
    <div class="cesium-moonPhase-header">Moon Phase</div>
    <div class="cesium-moonPhase-viz">
      <svg viewBox="0 0 100 100" class="cesium-moonPhase-disc">
        <circle cx="50" cy="50" r="46" fill="#F5F3CE" />
        <path data-bind="attr: { d: shadowPath }" fill="#1a1a2e" />
      </svg>
    </div>
    <div class="cesium-moonPhase-info">
      <div class="cesium-moonPhase-name" data-bind="text: phaseName"></div>
      <div class="cesium-moonPhase-detail">
        <span>Illumination: </span>
        <span data-bind="text: illuminationPercent"></span>%
      </div>
      <div class="cesium-moonPhase-detail">
        <span>Elongation: </span>
        <span data-bind="text: elongationDeg"></span>&deg;
      </div>
      <div class="cesium-moonPhase-detail">
        <span>Distance: </span>
        <span><span data-bind="text: distanceKm"></span> km</span>
      </div>
      <div class="cesium-moonPhase-separator"></div>
      <div class="cesium-moonPhase-detail">
        <span>Moon Elevation: </span>
        <span data-bind="text: moonElevation"></span>
      </div>
      <div class="cesium-moonPhase-detail">
        <span data-bind="text: moonVisible ? 'Visible from here' : 'Below horizon'"></span>
        <span class="cesium-moonPhase-dot" data-bind="css: { 'cesium-moonPhase-dot-visible': moonVisible }"></span>
      </div>
      <div class="cesium-moonPhase-separator"></div>
      <div class="cesium-moonPhase-actions">
        <button type="button" class="cesium-button cesium-moonPhase-action-btn"
          data-bind="click: flyToMoonCommand">
          Fly to Moon
        </button>
        <button type="button" class="cesium-button cesium-moonPhase-action-btn"
          data-bind="click: toggleLabelCommand, css: { 'cesium-moonPhase-action-btn-active': labelVisible }">
          Label
        </button>
        <button type="button" class="cesium-button cesium-moonPhase-action-btn"
          data-bind="click: toggleOrbitCommand, css: { 'cesium-moonPhase-action-btn-active': orbitActive }">
          Orbit
        </button>
      </div>
      <div data-bind="visible: orbitActive" class="cesium-moonPhase-slider-row">
        <input type="range" min="1" max="10000" step="1"
          class="cesium-moonPhase-slider"
          data-bind="value: orbitSpeedValue, valueUpdate: 'input'" />
        <span class="cesium-moonPhase-slider-label" data-bind="text: orbitSpeedLabel"></span>
      </div>
    </div>
  `;

  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  knockout.applyBindings(viewModel, wrapper);

  this._container = container;
  this._wrapper = wrapper;
  this._viewModel = viewModel;
  this._element = button;
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

Object.defineProperties(MoonPhaseIndicator.prototype, {
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

MoonPhaseIndicator.prototype.isDestroyed = function () {
  return false;
};

MoonPhaseIndicator.prototype.destroy = function () {
  if (FeatureDetection.supportsPointerEvents()) {
    document.removeEventListener("pointerdown", this._closePanel, true);
  } else {
    document.removeEventListener("mousedown", this._closePanel, true);
    document.removeEventListener("touchstart", this._closePanel, true);
  }
  this._viewModel._stopTrackingMoon();
  this._viewModel._stopUpdating();
  knockout.cleanNode(this._wrapper);
  this._container.removeChild(this._wrapper);
  if (this._labelOverlay.parentElement) {
    this._labelOverlay.parentElement.removeChild(this._labelOverlay);
  }
  return destroyObject(this);
};

export default MoonPhaseIndicator;
