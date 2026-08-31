import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import SolarSystemViewModel from "./SolarSystemViewModel.js";

// A ringed planet: a disc, then a ring drawn as an outer ellipse with an inner
// ellipse wound the other way to punch out its middle.
const planetPath =
  "M 45 32 A 13 13 0 1 1 19 32 A 13 13 0 1 1 45 32 z \
M 57.4 22.8 A 27 9 -20 1 1 6.6 41.2 A 27 9 -20 1 1 57.4 22.8 z \
M 53.6 24.1 A 23 6.2 -20 1 0 10.4 39.9 A 23 6.2 -20 1 0 53.6 24.1 z";

/**
 * <p>The SolarSystem widget draws the planets and Pluto at their real positions, along
 * with the path each of them takes around the Sun, and lets each one be sent around the
 * Sun or turned on its own axis at up to a million times real time.  Bodies that are
 * not orbiting stay exactly where they are right now.</p>
 *
 * @alias SolarSystem
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance to use.
 * @param {Clock} clock The clock that supplies the time the planets are drawn at.
 *
 * @exception {DeveloperError} Element with id "container" does not exist in the document.
 *
 * @example
 * // In HTML head, include a link to the SolarSystem.css stylesheet,
 * // and in the body, include: <div id="solarSystemContainer"></div>
 * // Note: This code assumes you already have a Scene and a Clock instance.
 *
 * const solarSystem = new Cesium.SolarSystem('solarSystemContainer', scene, clock);
 */
function SolarSystem(container, scene, clock) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }
  if (!defined(clock)) {
    throw new DeveloperError("clock is required.");
  }
  //>>includeEnd('debug');

  container = getElement(container);

  const viewModel = new SolarSystemViewModel(scene, clock);
  viewModel._planetPath = planetPath;

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-solarSystem-wrapper";
  container.appendChild(wrapper);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cesium-button cesium-toolbar-button";
  button.setAttribute(
    "data-bind",
    '\
attr: { title: tooltip },\
css: { "cesium-solarSystem-selected": dropDownVisible },\
click: toggleDropDown,\
cesiumSvgPath: { path: _planetPath, width: 64, height: 64 }',
  );
  wrapper.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "cesium-solarSystem-panel";
  panel.setAttribute(
    "data-bind",
    '\
css: { "cesium-solarSystem-visible": dropDownVisible,\
       "cesium-solarSystem-hidden": !dropDownVisible }',
  );
  panel.innerHTML = `<div class="cesium-solarSystem-header">
  <span class="cesium-solarSystem-title">Solar System</span>
  <span class="cesium-solarSystem-all">
    <label title="Send every planet round the Sun at once">
      <input type="checkbox" data-bind="checked: allOrbiting" />
      Orbit all
    </label>
    <label title="Turn every planet on its axis at once">
      <input type="checkbox" data-bind="checked: allSpinning" />
      Spin all
    </label>
  </span>
</div>
<div data-bind="foreach: planets">
  <div class="cesium-solarSystem-planet" data-bind="attr: { title: description }">
    <span class="cesium-solarSystem-swatch" data-bind="style: { backgroundColor: colorCss }"></span>
    <span class="cesium-solarSystem-name" data-bind="text: name"></span>
    <span class="cesium-solarSystem-distance" data-bind="text: distanceText"></span>
    <label class="cesium-solarSystem-orbit">
      <input type="checkbox" data-bind="checked: orbiting" />
      Orbit
    </label>
    <label class="cesium-solarSystem-spin">
      <input type="checkbox" data-bind="checked: spinning" />
      Spin
    </label>
    <span class="cesium-solarSystem-speeds">
      <span class="cesium-solarSystem-rate" data-bind="visible: orbiting"
            title="How much faster than real time this one goes round the Sun">
        <input class="cesium-solarSystem-speed" type="range" min="0" step="1"
               data-bind="attr: { max: $parent.speedSliderMaximum },
                          value: orbitSpeedSliderValue,
                          valueUpdate: 'input'" />
        <span class="cesium-solarSystem-speedText" data-bind="text: orbitSpeedText"></span>
      </span>
      <span class="cesium-solarSystem-rate" data-bind="visible: spinning"
            title="How much faster than real time this one turns on its axis">
        <input class="cesium-solarSystem-speed" type="range" min="0" step="1"
               data-bind="attr: { max: $parent.speedSliderMaximum },
                          value: spinSpeedSliderValue,
                          valueUpdate: 'input'" />
        <span class="cesium-solarSystem-speedText" data-bind="text: spinSpeedText"></span>
      </span>
    </span>
    <button type="button" class="cesium-button cesium-solarSystem-flyTo"
            data-bind="click: flyTo,
                       text: flyToText,
                       css: { 'cesium-solarSystem-tracking': tracking },
                       attr: { title: tracking
                         ? 'Let the camera go again'
                         : 'Fly the camera out to where this one is now, and follow it' }"></button>
  </div>
</div>
<div class="cesium-solarSystem-footer">
  <label title="Draw each planet's path around the Sun, and the Earth's">
    <input type="checkbox" data-bind="checked: showOrbits" />
    Show orbit paths
  </label>
  <button type="button" class="cesium-button" title="Put every planet back where it is right now"
          data-bind="click: resetPositions">
    Reset positions
  </button>
</div>`;
  wrapper.appendChild(panel);

  knockout.applyBindings(viewModel, wrapper);

  this._viewModel = viewModel;
  this._container = container;
  this._wrapper = wrapper;

  this._closeDropDown = function (e) {
    if (!wrapper.contains(e.target)) {
      viewModel.dropDownVisible = false;
    }
  };
  if (FeatureDetection.supportsPointerEvents()) {
    document.addEventListener("pointerdown", this._closeDropDown, true);
  } else {
    document.addEventListener("mousedown", this._closeDropDown, true);
    document.addEventListener("touchstart", this._closeDropDown, true);
  }
}

Object.defineProperties(SolarSystem.prototype, {
  /**
   * Gets the parent container.
   * @memberof SolarSystem.prototype
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
   * @memberof SolarSystem.prototype
   *
   * @type {SolarSystemViewModel}
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
SolarSystem.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the widget.  Should be called if permanently
 * removing the widget from layout.
 */
SolarSystem.prototype.destroy = function () {
  this._viewModel.destroy();

  if (FeatureDetection.supportsPointerEvents()) {
    document.removeEventListener("pointerdown", this._closeDropDown, true);
  } else {
    document.removeEventListener("mousedown", this._closeDropDown, true);
    document.removeEventListener("touchstart", this._closeDropDown, true);
  }

  knockout.cleanNode(this._wrapper);
  this._container.removeChild(this._wrapper);

  return destroyObject(this);
};
export default SolarSystem;
