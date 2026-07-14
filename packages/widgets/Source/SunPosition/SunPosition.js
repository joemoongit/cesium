import {
  defined,
  destroyObject,
  DeveloperError,
  getElement,
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  Matrix3,
  PolylineCollection,
  Simon1994PlanetaryPositions,
  Transforms,
  Math as CesiumMath,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

const scratchSun = new Cartesian3();
const scratchFixed = new Cartesian3();
const scratchMatrix = new Matrix3();
const scratchCarto = new Cartographic();

/**
 * Compute the subsolar point (the geographic location where the Sun is directly
 * overhead) for the given time, using the Sun's inertial position rotated into
 * the Earth-fixed frame.
 * @private
 */
function computeSubsolarPoint(time) {
  const sunInertial =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      time,
      scratchSun,
    );
  const toFixed =
    Transforms.computeIcrfToFixedMatrix(time, scratchMatrix) ??
    Transforms.computeTemeToPseudoFixedMatrix(time, scratchMatrix);
  const sunFixed = Matrix3.multiplyByVector(toFixed, sunInertial, scratchFixed);
  const carto = Ellipsoid.WGS84.cartesianToCartographic(sunFixed, scratchCarto);
  return {
    longitude: carto.longitude,
    latitude: carto.latitude,
    longitudeDegrees: CesiumMath.toDegrees(carto.longitude),
    latitudeDegrees: CesiumMath.toDegrees(carto.latitude),
  };
}

/**
 * Build the ring of positions on the ellipsoid that are exactly 90° of angular
 * distance from the subsolar point — the day/night terminator.
 * @private
 */
function computeTerminatorPositions(subsolar) {
  const dir = Cartesian3.normalize(
    Cartesian3.fromRadians(
      subsolar.longitude,
      subsolar.latitude,
      0.0,
      Ellipsoid.WGS84,
      new Cartesian3(),
    ),
    new Cartesian3(),
  );
  const seed =
    Math.abs(dir.z) < 0.9 ? Cartesian3.UNIT_Z : Cartesian3.UNIT_X;
  const u = Cartesian3.normalize(
    Cartesian3.cross(dir, seed, new Cartesian3()),
    new Cartesian3(),
  );
  const v = Cartesian3.normalize(
    Cartesian3.cross(dir, u, new Cartesian3()),
    new Cartesian3(),
  );
  const radius = Ellipsoid.WGS84.maximumRadius;
  const positions = [];
  const count = 120;
  for (let i = 0; i <= count; i++) {
    const theta = (i / count) * CesiumMath.TWO_PI;
    const c = Math.cos(theta) * radius;
    const s = Math.sin(theta) * radius;
    positions.push(
      new Cartesian3(
        c * u.x + s * v.x,
        c * u.y + s * v.y,
        c * u.z + s * v.z,
      ),
    );
  }
  return positions;
}

/**
 * A toolbar widget that reports the current subsolar point (where the Sun is
 * directly overhead) and can draw the day/night terminator on the globe.
 *
 * @alias SunPosition
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance to use.
 * @param {Clock} [clock] The clock that drives the current time; defaults to scene.clock.
 */
function SunPosition(container, scene, clock) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }
  //>>includeEnd('debug');

  container = getElement(container);
  clock = clock ?? scene.clock;

  const that = this;
  this._scene = scene;
  this._clock = clock;
  this._terminatorPrimitive = undefined;

  // Best-effort load of the high-accuracy Earth orientation data; until it is
  // available computeIcrfToFixedMatrix falls back to the TEME approximation.
  if (defined(Transforms.preloadIcrfFixed)) {
    try {
      Transforms.preloadIcrfFixed({
        start: clock.startTime ?? clock.currentTime,
        stop: clock.stopTime ?? clock.currentTime,
      });
    } catch (e) {
      // ignore — the fallback matrix keeps the read-outs finite.
    }
  }

  const tooltip = knockout.observable("Sun position");
  const panelVisible = knockout.observable(false);
  const subsolarLatitude = knockout.observable("");
  const subsolarLongitude = knockout.observable("");
  const terminatorActive = knockout.observable(false);

  function refreshReadouts() {
    const subsolar = computeSubsolarPoint(clock.currentTime);
    subsolarLatitude(`${subsolar.latitudeDegrees.toFixed(2)}°`);
    subsolarLongitude(`${subsolar.longitudeDegrees.toFixed(2)}°`);
    return subsolar;
  }

  function drawTerminator() {
    that._removeTerminator();
    const subsolar = computeSubsolarPoint(clock.currentTime);
    const collection = new PolylineCollection();
    collection.add({
      positions: computeTerminatorPositions(subsolar),
      width: 2.0,
      material: undefined,
    });
    scene.primitives.add(collection);
    that._terminatorPrimitive = collection;
  }

  const toggleCommand = createCommand(function () {
    panelVisible(!panelVisible());
    if (panelVisible()) {
      refreshReadouts();
    }
  });

  const terminatorCommand = createCommand(function () {
    if (terminatorActive()) {
      that._removeTerminator();
      terminatorActive(false);
    } else {
      drawTerminator();
      terminatorActive(true);
    }
  });

  this._viewModel = {
    tooltip: tooltip,
    panelVisible: panelVisible,
    subsolarLatitude: subsolarLatitude,
    subsolarLongitude: subsolarLongitude,
    terminatorActive: terminatorActive,
    toggleCommand: toggleCommand,
    terminatorCommand: terminatorCommand,
  };

  // Keep the read-outs (and terminator) in sync as the clock advances.
  this._refresh = function () {
    refreshReadouts();
    if (terminatorActive()) {
      drawTerminator();
    }
  };
  this._removeTickListener = clock.onTick.addEventListener(this._refresh);

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-sunPosition-wrapper";

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "cesium-button cesium-toolbar-button cesium-sunPosition-button";
  button.textContent = "☀";
  button.setAttribute(
    "data-bind",
    "attr: { title: tooltip }, click: toggleCommand",
  );
  wrapper.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "cesium-sunPosition-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-sunPosition-panel-visible': panelVisible }",
  );
  panel.innerHTML = `
    <div class="cesium-sunPosition-header">Subsolar point</div>
    <div class="cesium-sunPosition-row">
      <span>Latitude:</span>
      <span data-bind="text: subsolarLatitude"></span>
    </div>
    <div class="cesium-sunPosition-row">
      <span>Longitude:</span>
      <span data-bind="text: subsolarLongitude"></span>
    </div>`;

  const terminatorButton = document.createElement("button");
  terminatorButton.type = "button";
  terminatorButton.className =
    "cesium-button cesium-sunPosition-terminatorButton";
  terminatorButton.textContent = "Day/Night Terminator";
  terminatorButton.setAttribute("data-bind", "click: terminatorCommand");
  panel.appendChild(terminatorButton);

  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  knockout.applyBindings(this._viewModel, wrapper);

  this._container = container;
  this._element = wrapper;

  refreshReadouts();
}

Object.defineProperties(SunPosition.prototype, {
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

SunPosition.prototype._removeTerminator = function () {
  if (defined(this._terminatorPrimitive)) {
    this._scene.primitives.remove(this._terminatorPrimitive);
    this._terminatorPrimitive = undefined;
  }
};

SunPosition.prototype.isDestroyed = function () {
  return false;
};

SunPosition.prototype.destroy = function () {
  this._removeTerminator();
  if (defined(this._removeTickListener)) {
    this._removeTickListener();
  }
  knockout.cleanNode(this._element);
  this._container.removeChild(this._element);
  return destroyObject(this);
};

export default SunPosition;
