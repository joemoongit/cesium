import {
  Cartesian2,
  Cartesian3,
  defined,
  DeveloperError,
  EllipsoidPrimitive,
  getTimestamp,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Quaternion,
} from "@cesium/engine";
import knockout from "./ThirdParty/knockout.js";
import createCommand from "./createCommand.js";
import PlanetaryEphemeris from "./PlanetaryEphemeris.js";
import SceneFarPlane from "./SceneFarPlane.js";
import SceneZoomLimits from "./SceneZoomLimits.js";

const scratchFixed = new Cartesian3();
const scratchTrackFixed = new Cartesian3();
const scratchBodyFixed = new Cartesian3();
const scratchSatelliteFixed = new Cartesian3();
const scratchSatelliteBodyFixed = new Cartesian3();
const scratchApproach = new Cartesian3();
const scratchApproachSatellite = new Cartesian3();
const scratchApproachPlanet = new Cartesian3();
const scratchApproachSun = new Cartesian3();
const scratchApproachAxis = new Cartesian3();

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
// Real orbits are far too slow to watch -- Phobos takes 7.6 hours, Deimos 30, Mars 687
// days -- so the animation advances simulated time by a multiplier. One multiplier and
// one shared clock drive the planet and every moon, which is what keeps their relative
// motion astronomically correct: at any speed Phobos still laps Mars 2154 times per
// Martian year, because all three read the same simulated instant.
const DEFAULT_ORBIT_SPEED = 2000;
const MAXIMUM_ORBIT_SPEED = 10000;
// While the camera is locked onto a body, ScreenSpaceCameraController swaps in
// Ellipsoid.UNIT_SPHERE, so it measures zoom as the distance to that body's centre and
// clamps it against minimumZoomDistance -- which defaults to one metre. One drag is
// then enough to end up inside the planet. Bound both ends to the body's own radius.
const TRACK_MINIMUM_ZOOM_SCALE = 1.05;
const TRACK_MAXIMUM_ZOOM_SCALE = 5000.0;

const scratchOrbitDate = new JulianDate();
const scratchPlanetOrbitDate = new JulianDate();
const scratchLabelFixed = new Cartesian3();

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
  this._satellites = options.satellites ?? [];

  this._tickListener = undefined;
  this._trackingListener = undefined;
  this._bodyPrimitive = undefined;
  this._lastBodyPosition = undefined;
  // One slot per moon, so each keeps its own visibility, primitive and cached position.
  this._satellitePrimitives = this._satellites.map(function () {
    return undefined;
  });
  this._lastSatellitePositions = this._satellites.map(function () {
    return undefined;
  });
  this._satelliteShown = this._satellites.map(function () {
    return false;
  });

  this._satelliteLabeled = this._satellites.map(function () {
    return false;
  });
  // A per-body switch for whether it follows the shared orbit clock below, plus the
  // simulated time it was left at when switched off, so it holds its last position
  // instead of snapping back to where the real ephemeris puts it.
  this._satelliteOrbitActive = this._satellites.map(function () {
    return false;
  });
  this._satelliteOrbitFrozen = this._satellites.map(function () {
    return 0;
  });
  this._planetOrbitFrozen = 0;

  // One simulated-time offset shared by the planet and every moon. It advances whenever
  // at least one of them is animating, so bodies that are running always agree on what
  // time it is and their relative positions stay physically consistent.
  this._orbitSpeed = DEFAULT_ORBIT_SPEED;
  this._orbitAccumulatedSeconds = 0;
  this._orbitStartTimestamp = 0;
  this._orbitRunning = false;

  // One label element per moon, cloned off the planet's so it picks up the same styling.
  this._satelliteLabelOverlays = this._satellites.map(function () {
    if (!defined(labelOverlay) || !defined(labelOverlay.parentElement)) {
      return undefined;
    }
    const element = labelOverlay.cloneNode(false);
    element.textContent = "";
    element.style.display = "none";
    labelOverlay.parentElement.appendChild(element);
    return element;
  });

  /**
   * Gets the names of the planet's moons, in selection order.
   * @type {string[]}
   */
  this.satelliteNames = this._satellites.map(function (satellite) {
    return satellite.name;
  });

  /**
   * Gets whether this planet has any moons configured.
   * @type {boolean}
   */
  this.hasSatellites = this._satellites.length > 0;

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
   * Gets the index of the currently selected moon.
   * @type {number}
   * @default 0
   */
  this.selectedSatelliteIndex = 0;

  /**
   * Gets the name of the currently selected moon.
   * @type {string}
   */
  this.selectedSatelliteName = this.hasSatellites
    ? this._satellites[0].name
    : "";

  /**
   * Gets the label for the button that flies to the selected moon.
   * @type {string}
   */
  this.flyToSatelliteLabel = this.hasSatellites
    ? `Fly to ${this._satellites[0].name}`
    : "";

  /**
   * Gets the label for the button that shows or hides the selected moon.
   * @type {string}
   */
  this.satelliteToggleLabel = this.hasSatellites
    ? `Show ${this._satellites[0].name}`
    : "";

  /**
   * Gets the selected moon's orbital radius about its planet, in kilometers.
   * @type {string}
   */
  this.satelliteOrbitRadius = "---";

  /**
   * Gets the selected moon's orbital period, in hours.
   * @type {string}
   */
  this.satellitePeriod = "---";

  /**
   * Gets the selected moon's mean diameter, in kilometers.
   * @type {string}
   */
  this.satelliteDiameter = "---";

  /**
   * Gets whether the currently selected moon is drawn in the scene. Each moon keeps its
   * own setting, so this tracks whichever one is selected.
   * @type {boolean}
   * @default false
   */
  this.satelliteVisible = false;

  /**
   * Gets whether the planet is being animated around its orbit of the Sun.
   * @type {boolean}
   * @default false
   */
  this.planetOrbitActive = false;

  /**
   * Gets the largest orbit multiplier the slider offers.
   * @type {number}
   */
  this.orbitSpeedMaximum = MAXIMUM_ORBIT_SPEED;

  /**
   * Gets whether the planet or any moon is currently animating.
   * @type {boolean}
   * @default false
   */
  this.anyOrbitActive = false;

  /**
   * Gets whether the selected moon's on-screen label is shown. Each moon keeps its own
   * setting, so this tracks whichever one is selected.
   * @type {boolean}
   * @default false
   */
  this.satelliteLabelVisible = false;

  /**
   * Gets whether the selected moon is being animated around its orbit. Each moon keeps
   * its own setting, so this tracks whichever one is selected.
   * @type {boolean}
   * @default false
   */
  this.orbitActive = false;

  /**
   * Gets or sets the orbit animation multiplier, as a string for the range input.
   * @type {string}
   */
  this.orbitSpeedValue = `${DEFAULT_ORBIT_SPEED}`;

  /**
   * Gets the orbit animation multiplier, formatted for display.
   * @type {string}
   */
  this.orbitSpeedLabel = `${DEFAULT_ORBIT_SPEED.toLocaleString()}x`;

  /**
   * Gets or sets the tooltip.
   * @type {string}
   */
  this.tooltip = options.name;

  knockout.track(this, [
    "selectedSatelliteIndex",
    "selectedSatelliteName",
    "flyToSatelliteLabel",
    "satelliteToggleLabel",
    "satelliteOrbitRadius",
    "satellitePeriod",
    "satelliteDiameter",
    "satelliteVisible",
    "planetOrbitActive",
    "anyOrbitActive",
    "satelliteLabelVisible",
    "orbitActive",
    "orbitSpeedValue",
    "orbitSpeedLabel",
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

  this._selectSatelliteCommand = createCommand(function (index) {
    that.selectSatellite(index);
  });

  this._flyToSatelliteCommand = createCommand(function () {
    that._flyToSatellite();
  });

  this._toggleSatelliteBodyCommand = createCommand(function () {
    const index = that.selectedSatelliteIndex;
    if (that._satelliteShown[index]) {
      that._hideSatelliteBody(index);
    } else {
      that._showSatelliteBody(index);
    }
    that._syncUpdating();
  });

  this._togglePlanetOrbitCommand = createCommand(function () {
    if (that.planetOrbitActive) {
      // Hold the position it reached rather than jumping back to the real ephemeris.
      that._planetOrbitFrozen = that._orbitOffsetSeconds();
      that.planetOrbitActive = false;
    } else {
      that.planetOrbitActive = true;
    }
    that._syncOrbitClock();
    that._syncUpdating();
  });

  this._toggleSatelliteLabelCommand = createCommand(function () {
    const index = that.selectedSatelliteIndex;
    that._satelliteLabeled[index] = !that._satelliteLabeled[index];
    that.satelliteLabelVisible = that._satelliteLabeled[index];
    if (!that.satelliteLabelVisible) {
      that._hideSatelliteLabel(index);
    }
    that._syncUpdating();
  });

  this._toggleOrbitCommand = createCommand(function () {
    const index = that.selectedSatelliteIndex;
    if (index < 0 || index >= that._satelliteOrbitActive.length) {
      return;
    }
    if (that._satelliteOrbitActive[index]) {
      // Hold the position it reached rather than jumping back to the real ephemeris.
      that._satelliteOrbitFrozen[index] = that._orbitOffsetSeconds();
      that._satelliteOrbitActive[index] = false;
    } else {
      that._satelliteOrbitActive[index] = true;
    }
    that.orbitActive = that._satelliteOrbitActive[index];
    that._syncOrbitClock();
    that._syncUpdating();
  });

  // Banking the elapsed simulated time before the multiplier changes keeps everything
  // from jumping when the slider moves.
  knockout.getObservable(this, "orbitSpeedValue").subscribe(function (value) {
    that._bankOrbitTime();
    that._orbitSpeed = parseInt(value, 10) || 1;
    that.orbitSpeedLabel = `${that._orbitSpeed.toLocaleString()}x`;
  });

  this._returnToEarthCommand = createCommand(function () {
    that.stopTracking();
    that._scene.camera.flyHome(3);
  });
}

/**
 * Selects one of the planet's moons. This only changes which moon the panel describes
 * and which one is drawn; the camera is deliberately left exactly where it is. Only the
 * fly-to commands move the view.
 *
 * @param {number} index The index into {@link PlanetIndicatorViewModel#satelliteNames}.
 */
PlanetIndicatorViewModel.prototype.selectSatellite = function (index) {
  if (index < 0 || index >= this._satellites.length) {
    return;
  }
  if (index === this.selectedSatelliteIndex) {
    return;
  }

  this.selectedSatelliteIndex = index;
  const satellite = this._satellites[index];
  this.selectedSatelliteName = satellite.name;
  this.flyToSatelliteLabel = `Fly to ${satellite.name}`;
  this.satelliteToggleLabel = `Show ${satellite.name}`;
  // Each moon keeps its own visibility, so whichever moons are drawn stay drawn.
  this.satelliteVisible = this._satelliteShown[index];
  this.satelliteLabelVisible = this._satelliteLabeled[index];
  this.orbitActive = this._satelliteOrbitActive[index];
  this._syncUpdating();
};

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

  /**
   * Gets the command that selects a moon by index.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  selectSatelliteCommand: {
    get: function () {
      return this._selectSatelliteCommand;
    },
  },

  /**
   * Gets the command that flies the camera to the selected moon.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  flyToSatelliteCommand: {
    get: function () {
      return this._flyToSatelliteCommand;
    },
  },

  /**
   * Gets the command that toggles drawing the selected moon in the scene.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  toggleSatelliteBodyCommand: {
    get: function () {
      return this._toggleSatelliteBodyCommand;
    },
  },

  /**
   * Gets the command that starts and stops the orbit animation.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  toggleOrbitCommand: {
    get: function () {
      return this._toggleOrbitCommand;
    },
  },

  /**
   * Gets the command that toggles the selected moon's on-screen label.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  toggleSatelliteLabelCommand: {
    get: function () {
      return this._toggleSatelliteLabelCommand;
    },
  },

  /**
   * Gets the command that starts and stops the planet's orbit around the Sun.
   * @memberof PlanetIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  togglePlanetOrbitCommand: {
    get: function () {
      return this._togglePlanetOrbitCommand;
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
PlanetIndicatorViewModel.prototype._orbitOffsetSeconds = function () {
  let offset = this._orbitAccumulatedSeconds;
  if (this._orbitRunning) {
    offset +=
      ((getTimestamp() - this._orbitStartTimestamp) / 1000.0) *
      this._orbitSpeed;
  }
  return offset;
};

/**
 * Banks the simulated time accrued so far, so the multiplier or the running state can
 * change without the bodies jumping.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._bankOrbitTime = function () {
  this._orbitAccumulatedSeconds = this._orbitOffsetSeconds();
  this._orbitStartTimestamp = getTimestamp();
};

/**
 * Starts or stops the shared orbit clock to match whether anything is animating.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._syncOrbitClock = function () {
  const running =
    this.planetOrbitActive ||
    this._satelliteOrbitActive.some(function (active) {
      return active;
    });
  this.anyOrbitActive = running;
  if (running !== this._orbitRunning) {
    this._bankOrbitTime();
    this._orbitRunning = running;
  }
};

/**
 * The shared simulated time the animating bodies are evaluated at. It runs ahead of the
 * scene clock by the accumulated orbit time, so bodies can be spun around without
 * disturbing the clock, the Earth or the Sun.
 *
 * @returns {JulianDate} The simulated time.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._timeAtOffset = function (offset, result) {
  if (offset === 0) {
    return this._clock.currentTime;
  }
  return JulianDate.addSeconds(this._clock.currentTime, offset, result);
};

/**
 * The time the planet's own orbital position is evaluated at. While animating it tracks
 * the shared orbit clock; once switched off it stays at the simulated time it reached.
 *
 * @returns {JulianDate} The time to evaluate the planet's heliocentric position at.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._planetTime = function () {
  const offset = this.planetOrbitActive
    ? this._orbitOffsetSeconds()
    : this._planetOrbitFrozen;
  return this._timeAtOffset(offset, scratchPlanetOrbitDate);
};

/**
 * The time a moon's orbital phase is evaluated at. While animating it tracks the shared
 * orbit clock; once switched off it stays at the simulated time it reached.
 *
 * @param {number} index The moon's index.
 * @returns {JulianDate} The time to evaluate the moon's phase at.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._satelliteTime = function (index) {
  const offset = this._satelliteOrbitActive[index]
    ? this._orbitOffsetSeconds()
    : this._satelliteOrbitFrozen[index];
  return this._timeAtOffset(offset, scratchOrbitDate);
};

/**
 * Computes a moon's position in the Earth-fixed frame, honouring the orbit animation.
 *
 * @param {object} satellite The moon to locate.
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3|undefined} The modified result parameter.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._computeSatellitePosition = function (
  index,
  result,
) {
  const satellite = this._satellites[index];
  if (!defined(satellite)) {
    return undefined;
  }
  // The planet and the frame stay on the scene clock; only the moon's phase is animated.
  return PlanetaryEphemeris.computeSatelliteFixedPosition(
    this._planet,
    satellite,
    this._clock.currentTime,
    result,
    this._satelliteTime(index),
    this._planetTime(),
  );
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._computeFixedPosition = function (result) {
  return PlanetaryEphemeris.computeFixedPosition(
    this._planet,
    this._clock.currentTime,
    result,
    this._planetTime(),
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

  this._flyToTarget(planetPosition, this._approachRange, undefined);
};

/**
 * Flies to the currently selected moon, keeping the planet drawn behind it for scale.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._flyToSatellite = function () {
  const satellite = this._satellites[this.selectedSatelliteIndex];
  if (!defined(satellite)) {
    return;
  }

  const satellitePosition = this._computeSatellitePosition(
    this.selectedSatelliteIndex,
    scratchSatelliteFixed,
  );
  if (!defined(satellitePosition)) {
    return;
  }

  if (!this._satelliteShown[this.selectedSatelliteIndex]) {
    this._showSatelliteBody(this.selectedSatelliteIndex);
  }
  // The moons are tiny and unlit rock; without the planet filling the background
  // there is no sense of where you actually are.
  if (!this.bodyVisible) {
    this._showBody();
  }
  this._syncUpdating();

  this._flyToTarget(
    satellitePosition,
    APPROACH_RANGE_SCALE * satellite.radii.x,
    this.selectedSatelliteIndex,
    this._computeSatelliteApproachDirection(
      this.selectedSatelliteIndex,
      scratchApproach,
    ),
  );
};

/**
 * Picks where to view a moon from.
 *
 * <p>Approaching straight down the Sun line the way the planets do puts the planet
 * itself off-screen most of the time -- the moon is only ever a few thousand kilometres
 * from a body tens of degrees wide, and that body ends up behind the camera. So the
 * approach starts on the far side of the moon from the planet, which frames the moon
 * against the planet, and is then tilted toward the Sun by up to
 * {@link APPROACH_TILT} to pick up illumination. The tilt is clamped so it never
 * swings past the Sun.</p>
 *
 * @param {object} satellite The moon being viewed.
 * @param {Cartesian3} result The object onto which to store the unit direction.
 * @returns {Cartesian3|undefined} The modified result parameter, or <code>undefined</code>
 *          if the ephemeris is unavailable.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._computeSatelliteApproachDirection =
  function (index, result) {
    const date = this._clock.currentTime;
    const satellitePosition = this._computeSatellitePosition(
      index,
      scratchApproachSatellite,
    );
    const planetPosition = this._computeFixedPosition(scratchApproachPlanet);
    if (!defined(satellitePosition) || !defined(planetPosition)) {
      return undefined;
    }

    // Start on the far side of the moon from the planet, so the planet sits behind it.
    Cartesian3.subtract(satellitePosition, planetPosition, result);
    Cartesian3.normalize(result, result);

    const sunDirection = PlanetaryEphemeris.computeSunFixedDirection(
      date,
      scratchApproachSun,
    );
    if (!defined(sunDirection)) {
      return result;
    }

    const tilt = Math.min(
      APPROACH_TILT,
      Cartesian3.angleBetween(result, sunDirection),
    );
    if (tilt < CesiumMath.EPSILON6) {
      return result;
    }

    const axis = Cartesian3.cross(result, sunDirection, scratchApproachAxis);
    if (Cartesian3.magnitude(axis) < CesiumMath.EPSILON6) {
      return result;
    }
    Cartesian3.normalize(axis, axis);

    return Matrix3.multiplyByVector(
      Matrix3.fromQuaternion(
        Quaternion.fromAxisAngle(axis, tilt, scratchFlyQuaternion),
        scratchFlyRotation,
      ),
      result,
      result,
    );
  };

/**
 * Flies the camera to a body, arriving on its sunlit side.
 *
 * @param {Cartesian3} targetPosition The body's position in the Earth-fixed frame.
 * @param {number} approachRange How far from the body's center to park, in meters.
 * @param {number} [satelliteIndex] The moon to lock onto once there, or
 *        <code>undefined</code> to lock onto the planet.
 * @param {Cartesian3} [presetDirection] An already-chosen unit direction from the body
 *        toward the camera. When omitted the sunward approach used for planets applies.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._flyToTarget = function (
  targetPosition,
  approachRange,
  satelliteIndex,
  presetDirection,
) {
  // The body is lit by the Sun alone with no ambient term, so approaching from an
  // arbitrary heading can park the camera over the night side and show nothing but a
  // black disc. Come in from the sunward side instead, tilted just far enough to keep
  // the terminator in frame so the planet reads as a sphere rather than a flat circle.
  const approachDirection = Cartesian3.clone(
    presetDirection ??
      PlanetaryEphemeris.computeSunFixedDirection(
        this._clock.currentTime,
        scratchFlyDirection,
      ) ??
      Cartesian3.normalize(targetPosition, scratchFlyDirection),
    scratchFlyDirection,
  );

  if (!defined(presetDirection)) {
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
  }

  const destination = Cartesian3.add(
    targetPosition,
    Cartesian3.multiplyByScalar(
      approachDirection,
      approachRange,
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
      that.startTracking(satelliteIndex);
    },
  });
};

/**
 * Locks the camera onto a body so that it stays centered as the ephemeris advances.
 *
 * @param {number} [satelliteIndex] The moon to lock onto. Defaults to the planet itself.
 */
PlanetIndicatorViewModel.prototype.startTracking = function (satelliteIndex) {
  this.stopTracking();

  const satellite = this._satellites[satelliteIndex];
  const radius = defined(satellite) ? satellite.radii.x : this._radii.x;
  SceneZoomLimits.claim(
    this._scene,
    this,
    radius * TRACK_MINIMUM_ZOOM_SCALE,
    radius * TRACK_MAXIMUM_ZOOM_SCALE,
  );

  const that = this;
  const scene = this._scene;

  this._trackingListener = scene.postUpdate.addEventListener(function () {
    const position = defined(satelliteIndex)
      ? that._computeSatellitePosition(satelliteIndex, scratchTrackFixed)
      : that._computeFixedPosition(scratchTrackFixed);
    if (!defined(position)) {
      return;
    }
    Matrix4.fromTranslation(position, scratchTrackTransform);
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

  SceneZoomLimits.release(this._scene, this);

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

  this.bodyVisible = true;
  this._syncFarPlane();
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
  this._lastBodyPosition = undefined;
  this.bodyVisible = false;
  this._syncFarPlane();
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._showSatelliteBody = function (index) {
  const satellite = this._satellites[index];
  if (!defined(satellite) || defined(this._satellitePrimitives[index])) {
    return;
  }

  const scene = this._scene;
  const primitive = new EllipsoidPrimitive({
    radii: satellite.radii,
    material: satellite.createMaterial(),
    onlySunLighting: true,
  });
  primitive.material.translucent = false;

  scene.primitives.add(primitive);
  this._satellitePrimitives[index] = primitive;
  this._satelliteShown[index] = true;
  if (index === this.selectedSatelliteIndex) {
    this.satelliteVisible = true;
  }

  this._syncFarPlane();
  this._updateSatelliteBody();
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._hideSatelliteBody = function (index) {
  if (defined(this._satellitePrimitives[index])) {
    this._scene.primitives.remove(this._satellitePrimitives[index]);
    this._satellitePrimitives[index] = undefined;
    this._scene.requestRender();
  }
  this._lastSatellitePositions[index] = undefined;
  this._satelliteShown[index] = false;
  if (index === this.selectedSatelliteIndex) {
    this.satelliteVisible = false;
  }
  this._syncFarPlane();
};

/**
 * @returns {boolean} whether any moon is currently drawn.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._anySatelliteShown = function () {
  return this._satelliteShown.some(function (shown) {
    return shown;
  });
};

/**
 * @returns {boolean} whether any moon's label is currently shown.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._anySatelliteLabeled = function () {
  return this._satelliteLabeled.some(function (labeled) {
    return labeled;
  });
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._hideSatelliteLabel = function (index) {
  const overlay = this._satelliteLabelOverlays[index];
  if (defined(overlay)) {
    overlay.style.display = "none";
  }
};

/**
 * Positions each labelled moon's on-screen label.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._updateSatelliteLabels = function () {
  for (let i = 0; i < this._satellites.length; ++i) {
    const overlay = this._satelliteLabelOverlays[i];
    if (!defined(overlay)) {
      continue;
    }
    if (!this._satelliteLabeled[i]) {
      overlay.style.display = "none";
      continue;
    }

    const position = this._computeSatellitePosition(i, scratchLabelFixed);
    if (!defined(position)) {
      overlay.style.display = "none";
      continue;
    }

    const screenPosition = this._scene.cartesianToCanvasCoordinates(
      position,
      scratchScreenPos,
    );
    if (!defined(screenPosition)) {
      overlay.style.display = "none";
      continue;
    }

    const kilometres = Math.round(
      Cartesian3.distance(position, this._scene.camera.positionWC) / 1000.0,
    );
    overlay.style.display = "block";
    overlay.style.left = `${screenPosition.x + 14}px`;
    overlay.style.top = `${screenPosition.y - 20}px`;
    overlay.textContent = `${this._satellites[i].name} • ${kilometres.toLocaleString()} km`;
  }
};

/**
 * Holds the camera's far plane open while anything of ours is drawn, and lets go once
 * nothing is. The default far plane sits well inside the planet's orbit, so without
 * this nothing would be rendered at all.
 *
 * @private
 */
PlanetIndicatorViewModel.prototype._syncFarPlane = function () {
  if (this.bodyVisible || this._anySatelliteShown()) {
    SceneFarPlane.claim(this._scene, this, this._maximumEarthDistance);
  } else {
    SceneFarPlane.release(this._scene, this);
  }
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._updateSatelliteBody = function () {
  for (let i = 0; i < this._satellitePrimitives.length; ++i) {
    const primitive = this._satellitePrimitives[i];
    if (!defined(primitive)) {
      continue;
    }

    const position = this._computeSatellitePosition(
      i,
      scratchSatelliteBodyFixed,
    );

    primitive.show = defined(position);
    if (!defined(position)) {
      continue;
    }

    const last = this._lastSatellitePositions[i];
    const moved =
      !defined(last) ||
      !Cartesian3.equalsEpsilon(position, last, CesiumMath.EPSILON7);
    if (moved) {
      this._lastSatellitePositions[i] = Cartesian3.clone(position, last);
      Matrix4.fromTranslation(position, primitive.modelMatrix);
      this._scene.requestRender();
    }
  }
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
    this.panelVisible ||
    this.labelVisible ||
    this.bodyVisible ||
    this._anySatelliteShown() ||
    this._anySatelliteLabeled();

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

  this._updateSatelliteReadout();
  this._updateBody();
  this._updateSatelliteBody();
  this._updateSatelliteLabels();
  this._updateLabelOverlay(planetPosition);
};

/**
 * @private
 */
PlanetIndicatorViewModel.prototype._updateSatelliteReadout = function () {
  const satellite = this._satellites[this.selectedSatelliteIndex];
  if (!defined(satellite)) {
    return;
  }

  this.satelliteOrbitRadius = Math.round(
    satellite.semiMajorAxis / 1000.0,
  ).toLocaleString();
  this.satellitePeriod = (satellite.periodDays * 24.0).toFixed(1);
  // The moons are lumpy enough that a mean diameter is the only honest single number.
  this.satelliteDiameter = (
    ((satellite.radii.x + satellite.radii.y + satellite.radii.z) /
      3.0 /
      1000.0) *
    2.0
  ).toFixed(1);
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
  for (let i = 0; i < this._satellites.length; ++i) {
    this._hideSatelliteBody(i);
    this._hideSatelliteLabel(i);
    this._satelliteLabeled[i] = false;
    this._satelliteOrbitActive[i] = false;
    const overlay = this._satelliteLabelOverlays[i];
    if (defined(overlay) && defined(overlay.parentElement)) {
      overlay.parentElement.removeChild(overlay);
    }
    this._satelliteLabelOverlays[i] = undefined;
  }
  this._hideBody();
  this._hideLabelOverlay();
  this.planetOrbitActive = false;
  this._syncOrbitClock();
  this.panelVisible = false;
  this.labelVisible = false;
  this._syncUpdating();
};

export default PlanetIndicatorViewModel;
