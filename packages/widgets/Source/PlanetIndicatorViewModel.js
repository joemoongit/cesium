import {
  Cartesian2,
  Cartesian3,
  defined,
  DeveloperError,
  EllipsoidPrimitive,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Quaternion,
} from "@cesium/engine";
import knockout from "./ThirdParty/knockout.js";
import createCommand from "./createCommand.js";
import PlanetaryEphemeris from "./PlanetaryEphemeris.js";
import SceneFarPlane from "./SceneFarPlane.js";

const scratchFixed = new Cartesian3();
const scratchTrackFixed = new Cartesian3();
const scratchBodyFixed = new Cartesian3();
const scratchDirection = new Cartesian3();
const scratchUp = new Cartesian3();
const scratchEast = new Cartesian3();
const scratchNorth = new Cartesian3();
const scratchHorizontal = new Cartesian3();
const scratchScreenPos = new Cartesian2();
const scratchTrackTransform = new Matrix4();
const scratchFlyDirection = new Cartesian3();
const scratchFlyAxis = new Cartesian3();
const scratchFlyOffset = new Cartesian3();
const scratchFlyDestination = new Cartesian3();
const scratchFlyLook = new Cartesian3();
const scratchFlyRight = new Cartesian3();
const scratchFlyUp = new Cartesian3();
const scratchFlyQuaternion = new Quaternion();
const scratchFlyRotation = new Matrix3();

// Where the camera parks on arrival, as a multiple of the body's equatorial radius. At
// 2.5 radii the body spans a little under 50 degrees, filling most of the default fov.
const APPROACH_RANGE_SCALE = 2.5;
// How far off the Sun line to approach, trading a sliver of the disc for visible relief.
const APPROACH_TILT = CesiumMath.toRadians(25.0);

/**
 * The shared view model behind the individual planet widgets. It owns everything that
 * does not vary from one planet to the next: the readout that tracks where the planet
 * is, the optional body drawn into the scene, and the flight out to it.
 *
 * @alias PlanetIndicatorViewModel
 * @constructor
 *
 * @param {Scene} scene The scene instance to use.
 * @param {Clock} clock The clock that drives the ephemeris.
 * @param {Element} labelOverlay The DOM element used to draw the on-screen label.
 * @param {object} options Per-planet configuration.
 * @param {string} options.name The planet's display name.
 * @param {object} options.planet The element table from {@link PlanetaryEphemeris}.
 * @param {Cartesian3} options.radii The body's radii, in meters.
 * @param {Function} options.createMaterial Returns a fresh {@link Material} for the body.
 * @param {number} options.maximumEarthDistance The farthest the planet ever gets from
 *        the Earth, in meters. Used to size the camera's far plane.
 *
 * @exception {DeveloperError} scene is required.
 * @exception {DeveloperError} clock is required.
 *
 * @private
 */
function PlanetIndicatorViewModel(scene, clock, labelOverlay, options) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }
  if (!defined(clock)) {
    throw new DeveloperError("clock is required.");
  }
  //>>includeEnd('debug');

  this._scene = scene;
  this._clock = clock;
  this._labelOverlay = labelOverlay;
  this._name = options.name;
  this._planet = options.planet;
  this._radii = options.radii;
  this._createMaterial = options.createMaterial;
  this._maximumEarthDistance = options.maximumEarthDistance;
  this._approachRange = APPROACH_RANGE_SCALE * options.radii.x;

  this._tickListener = undefined;
  this._trackingListener = undefined;
  this._bodyPrimitive = undefined;
  this._lastBodyPosition = undefined;

  /**
   * Gets the distance from the Earth to the planet, in astronomical units.
   * @type {string}
   */
  this.distanceAU = "---";

  /**
   * Gets the distance from the Earth to the planet, in millions of kilometers.
   * @type {string}
   */
  this.distanceKm = "---";

  /**
   * Gets the one-way light travel time to the planet, in minutes.
   * @type {string}
   */
  this.lightTime = "---";

  /**
   * Gets the elevation of the planet above the local horizon at the camera, in degrees.
   * @type {string}
   */
  this.elevation = "---";

  /**
   * Gets the azimuth of the planet at the camera, in degrees clockwise from north.
   * @type {string}
   */
  this.azimuth = "---";

  /**
   * Gets the compass point matching {@link PlanetIndicatorViewModel#azimuth}.
   * @type {string}
   */
  this.azimuthDir = "";

  /**
   * Gets the apparent angular diameter of the planet's disc, in arcseconds.
   * @type {string}
   */
  this.angularDiameter = "---";

  /**
   * Gets whether the planet is currently above the local horizon at the camera.
   * @type {boolean}
   */
  this.aboveHorizon = false;

  /**
   * Gets or sets whether the info panel is visible.
   * @type {boolean}
   * @default false
   */
  this.panelVisible = false;

  /**
   * Gets or sets whether the on-screen label is visible.
   * @type {boolean}
   * @default false
   */
  this.labelVisible = false;

  /**
   * Gets or sets whether the planet body is drawn in the scene.
   * @type {boolean}
   * @default false
   */
  this.bodyVisible = false;

  /**
   * Gets or sets whether the camera is locked onto the planet.
   * @type {boolean}
   * @default false
   */
  this.tracking = false;

  /**
   * Gets or sets the tooltip.
   * @type {string}
   */
  this.tooltip = options.name;

  knockout.track(this, [
    "distanceAU",
    "distanceKm",
    "lightTime",
    "elevation",
    "azimuth",
    "azimuthDir",
    "angularDiameter",
    "aboveHorizon",
    "panelVisible",
    "labelVisible",
    "bodyVisible",
    "tracking",
    "tooltip",
  ]);

  const that = this;

  this._command = createCommand(function () {
    that.panelVisible = !that.panelVisible;
    that._syncUpdating();
  });

  this._flyToCommand = createCommand(function () {
    that._flyToPlanet();
  });

  this._toggleLabelCommand = createCommand(function () {
    that.labelVisible = !that.labelVisible;
    if (!that.labelVisible) {
      that._hideLabelOverlay();
    }
    that._syncUpdating();
  });

  this._toggleBodyCommand = createCommand(function () {
    if (that.bodyVisible) {
      that._hideBody();
    } else {
      that._showBody();
    }
    that._syncUpdating();
  });

  this._returnToEarthCommand = createCommand(function () {
    that.stopTracking();
    that._scene.camera.flyHome(3);
  });
}

Object.defineProperties(PlanetIndicatorViewModel.prototype, {
  /**
   * Gets the scene.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Scene}
   * @readonly
   */
  scene: {
    get: function () {
      return this._scene;
    },
  },

  /**
   * Gets the command that toggles the info panel.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  command: {
    get: function () {
      return this._command;
    },
  },

  /**
   * Gets the command that flies the camera to the planet.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  flyToCommand: {
    get: function () {
      return this._flyToCommand;
    },
  },

  /**
   * Gets the command that toggles the on-screen label.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  toggleLabelCommand: {
    get: function () {
      return this._toggleLabelCommand;
    },
  },

  /**
   * Gets the command that toggles drawing the planet body in the scene.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  toggleBodyCommand: {
    get: function () {
      return this._toggleBodyCommand;
    },
  },

  /**
   * Gets the command that releases the camera from the planet and flies it home.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  returnToEarthCommand: {
    get: function () {
      return this._returnToEarthCommand;
    },
  },
});

/**
 * Computes the position of the planet in the Earth-centered, Earth-fixed frame at the
 * current clock time.
 *
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3|undefined} The modified result parameter, or <code>undefined</code>
 *          if the inertial-to-fixed transform is unavailable.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._computeFixedPosition = function (result) {
  return PlanetaryEphemeris.computeFixedPosition(
    this._planet,
    this._clock.currentTime,
    result,
  );
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._flyToPlanet = function () {
  const planetPosition = this._computeFixedPosition(scratchFixed);
  if (!defined(planetPosition)) {
    return;
  }

  // Without a body to look at, arriving is indistinguishable from empty space.
  if (!this.bodyVisible) {
    this._showBody();
  }
  this._syncUpdating();

  // The body is lit by the Sun alone with no ambient term, so approaching from an
  // arbitrary heading can park the camera over the night side and show nothing but a
  // black disc. Come in from the sunward side instead, tilted just far enough to keep
  // the terminator in frame so the planet reads as a sphere rather than a flat circle.
  const approachDirection = Cartesian3.clone(
    PlanetaryEphemeris.computeSunFixedDirection(
      this._clock.currentTime,
      scratchFlyDirection,
    ) ?? Cartesian3.normalize(planetPosition, scratchFlyDirection),
    scratchFlyDirection,
  );

  let axis = Cartesian3.cross(
    approachDirection,
    Cartesian3.UNIT_Z,
    scratchFlyAxis,
  );
  if (Cartesian3.magnitude(axis) < CesiumMath.EPSILON6) {
    axis = Cartesian3.cross(
      approachDirection,
      Cartesian3.UNIT_X,
      scratchFlyAxis,
    );
  }
  Cartesian3.normalize(axis, axis);
  Matrix3.multiplyByVector(
    Matrix3.fromQuaternion(
      Quaternion.fromAxisAngle(axis, APPROACH_TILT, scratchFlyQuaternion),
      scratchFlyRotation,
    ),
    approachDirection,
    approachDirection,
  );

  const destination = Cartesian3.add(
    planetPosition,
    Cartesian3.multiplyByScalar(
      approachDirection,
      this._approachRange,
      scratchFlyOffset,
    ),
    scratchFlyDestination,
  );

  const direction = Cartesian3.negate(approachDirection, scratchFlyLook);
  let right = Cartesian3.cross(direction, Cartesian3.UNIT_Z, scratchFlyRight);
  if (Cartesian3.magnitude(right) < CesiumMath.EPSILON6) {
    right = Cartesian3.cross(direction, Cartesian3.UNIT_X, scratchFlyRight);
  }
  Cartesian3.normalize(right, right);
  const up = Cartesian3.normalize(
    Cartesian3.cross(right, direction, scratchFlyUp),
    scratchFlyUp,
  );

  const that = this;
  this._scene.camera.flyTo({
    destination: destination,
    orientation: {
      direction: direction,
      up: up,
    },
    duration: 4,
    complete: function () {
      that.startTracking();
    },
  });
};

/**
 * Locks the camera onto the planet so that it stays centered as the ephemeris advances.
 */
PlanetIndicatorViewModel.prototype.startTracking = function () {
  this.stopTracking();

  const that = this;
  const scene = this._scene;

  this._trackingListener = scene.postUpdate.addEventListener(function () {
    const planetPosition = that._computeFixedPosition(scratchTrackFixed);
    if (!defined(planetPosition)) {
      return;
    }
    Matrix4.fromTranslation(planetPosition, scratchTrackTransform);
    scene.camera.lookAtTransform(scratchTrackTransform);
  });
  this.tracking = true;
};

/**
 * Releases the camera from the planet, leaving it where it is.
 */
PlanetIndicatorViewModel.prototype.stopTracking = function () {
  if (defined(this._trackingListener)) {
    this._trackingListener();
    this._trackingListener = undefined;
    this._scene.camera.lookAtTransform(Matrix4.IDENTITY);
  }
  this.tracking = false;
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._showBody = function () {
  if (defined(this._bodyPrimitive)) {
    return;
  }

  const scene = this._scene;
  const primitive = new EllipsoidPrimitive({
    radii: this._radii,
    material: this._createMaterial(),
    onlySunLighting: true,
  });
  primitive.material.translucent = false;

  scene.primitives.add(primitive);
  this._bodyPrimitive = primitive;

  // The default far plane sits well inside the planet's orbit, so nothing would be drawn.
  SceneFarPlane.claim(scene, this, this._maximumEarthDistance);

  this.bodyVisible = true;
  this._updateBody();
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._hideBody = function () {
  if (defined(this._bodyPrimitive)) {
    this._scene.primitives.remove(this._bodyPrimitive);
    this._bodyPrimitive = undefined;
    this._scene.requestRender();
  }
  SceneFarPlane.release(this._scene, this);
  this._lastBodyPosition = undefined;
  this.bodyVisible = false;
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._updateBody = function () {
  const primitive = this._bodyPrimitive;
  if (!defined(primitive)) {
    return;
  }

  const planetPosition = this._computeFixedPosition(scratchBodyFixed);
  primitive.show = defined(planetPosition);
  if (!defined(planetPosition)) {
    return;
  }

  // Under requestRenderMode the scene only redraws on demand, so ask for a frame
  // whenever the planet actually moves. A paused clock leaves the position untouched,
  // which keeps the scene idle exactly as requestRenderMode intends.
  const moved =
    !defined(this._lastBodyPosition) ||
    !Cartesian3.equalsEpsilon(
      planetPosition,
      this._lastBodyPosition,
      CesiumMath.EPSILON7,
    );
  if (moved) {
    this._lastBodyPosition = Cartesian3.clone(
      planetPosition,
      this._lastBodyPosition,
    );
    Matrix4.fromTranslation(planetPosition, primitive.modelMatrix);
    this._scene.requestRender();
  }
};

/**
 * Starts or stops the per-tick update depending on what the widget currently needs.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._syncUpdating = function () {
  const needsUpdate =
    this.panelVisible || this.labelVisible || this.bodyVisible;

  if (needsUpdate) {
    if (!defined(this._tickListener)) {
      const that = this;
      this._tickListener = this._clock.onTick.addEventListener(function () {
        that._update();
      });
    }
    // Refresh right away rather than waiting on the next tick, so newly enabled
    // pieces of the widget are populated the moment they are switched on.
    this._update();
  } else if (defined(this._tickListener)) {
    this._tickListener();
    this._tickListener = undefined;
  }
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._update = function () {
  const planetPosition = this._computeFixedPosition(scratchFixed);
  if (!defined(planetPosition)) {
    this.distanceAU = "---";
    this.distanceKm = "---";
    this.lightTime = "---";
    this.elevation = "---";
    this.azimuth = "---";
    this.azimuthDir = "";
    this.angularDiameter = "---";
    this.aboveHorizon = false;
    this._hideLabelOverlay();
    return;
  }

  const geocentricDistance = Cartesian3.magnitude(planetPosition);
  this.distanceAU = (geocentricDistance / PlanetaryEphemeris.AU_METERS).toFixed(
    4,
  );
  this.distanceKm = (geocentricDistance / 1.0e9).toFixed(1);
  this.lightTime = (
    geocentricDistance /
    PlanetaryEphemeris.SPEED_OF_LIGHT /
    60.0
  ).toFixed(1);

  const cameraPosition = this._scene.camera.positionWC;
  Cartesian3.subtract(planetPosition, cameraPosition, scratchDirection);
  const cameraDistance = Cartesian3.magnitude(scratchDirection);
  Cartesian3.divideByScalar(scratchDirection, cameraDistance, scratchDirection);

  this.angularDiameter = (
    CesiumMath.toDegrees(2.0 * Math.atan(this._radii.x / cameraDistance)) *
    3600.0
  ).toFixed(1);

  // Local east-north-up at the camera, built directly so this also works in orbit.
  Cartesian3.normalize(cameraPosition, scratchUp);
  Cartesian3.cross(Cartesian3.UNIT_Z, scratchUp, scratchEast);
  let eastMagnitude = Cartesian3.magnitude(scratchEast);
  if (eastMagnitude < CesiumMath.EPSILON6) {
    Cartesian3.cross(Cartesian3.UNIT_X, scratchUp, scratchEast);
    eastMagnitude = Cartesian3.magnitude(scratchEast);
  }
  Cartesian3.divideByScalar(scratchEast, eastMagnitude, scratchEast);
  Cartesian3.cross(scratchUp, scratchEast, scratchNorth);

  const upComponent = Cartesian3.dot(scratchDirection, scratchUp);
  const elevationDegrees = CesiumMath.toDegrees(Math.asin(upComponent));
  this.elevation = `${elevationDegrees.toFixed(1)}°`;
  this.aboveHorizon = elevationDegrees > 0.0;

  Cartesian3.multiplyByScalar(scratchUp, upComponent, scratchHorizontal);
  Cartesian3.subtract(scratchDirection, scratchHorizontal, scratchHorizontal);
  const azimuthDegrees = PlanetaryEphemeris.normalizeDegrees(
    CesiumMath.toDegrees(
      Math.atan2(
        Cartesian3.dot(scratchHorizontal, scratchEast),
        Cartesian3.dot(scratchHorizontal, scratchNorth),
      ),
    ),
  );
  this.azimuth = `${azimuthDegrees.toFixed(1)}°`;
  this.azimuthDir = PlanetaryEphemeris.compassLabel(azimuthDegrees);

  this._updateBody();
  this._updateLabelOverlay(planetPosition);
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._hideLabelOverlay = function () {
  if (defined(this._labelOverlay)) {
    this._labelOverlay.style.display = "none";
  }
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._updateLabelOverlay = function (
  planetPosition,
) {
  const overlay = this._labelOverlay;
  if (!defined(overlay)) {
    return;
  }
  if (!this.labelVisible) {
    overlay.style.display = "none";
    return;
  }

  const screenPosition = this._scene.cartesianToCanvasCoordinates(
    planetPosition,
    scratchScreenPos,
  );
  if (!defined(screenPosition)) {
    overlay.style.display = "none";
    return;
  }

  overlay.style.display = "block";
  overlay.style.left = `${screenPosition.x + 14}px`;
  overlay.style.top = `${screenPosition.y - 20}px`;
  overlay.textContent = `${this._name} • ${this.distanceAU} AU • ${this.lightTime} light-min`;
};

/**
 * Removes the planet body from the scene and stops all listeners. Should be called if
 * permanently removing the view model.
 */
PlanetIndicatorViewModel.prototype.destroy = function () {
  this.stopTracking();
  this._hideBody();
  this._hideLabelOverlay();
  this.panelVisible = false;
  this.labelVisible = false;
  this._syncUpdating();
};

export default PlanetIndicatorViewModel;
