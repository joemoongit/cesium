import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  ClockStep,
  Color,
  defined,
  destroyObject,
  DeveloperError,
  DistanceDisplayCondition,
  EllipsoidPrimitive,
  getTimestamp,
  HeadingPitchRange,
  JulianDate,
  LabelCollection,
  LabelStyle,
  Material,
  Matrix3,
  Matrix4,
  Math as CesiumMath,
  PointPrimitiveCollection,
  PolylineCollection,
  SceneMode,
  Simon1994PlanetaryPositions,
  Transforms,
  VerticalOrigin,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";
import PlanetaryEphemeris from "../PlanetaryEphemeris.js";

const ORBIT_SAMPLES = 180;

const MINIMUM_SPEED = 1;
const MAXIMUM_SPEED = 100000;
// The slider is logarithmic so that the slow end, where the planets still look like
// they are keeping real time, is not crammed into the first pixel of travel.
const SPEED_SLIDER_MAXIMUM = 100;
const SPEED_DECADES = Math.log10(MAXIMUM_SPEED);
const DEFAULT_SPEED_SLIDER_VALUE = 60; // 1000x

// Ignore steps longer than this, so a backgrounded tab does not fling the planets
// through several orbits the moment it is brought back to the front.
const MAXIMUM_STEP_SECONDS = 1.0;

const DISTANCE_UPDATE_INTERVAL = 250;
// Hide a planet's marker once the body itself covers enough of the screen to see.
const MARKER_MINIMUM_DISTANCE_SCALE = 40.0;
const FAR_PLANE_PADDING = 1.15;

const FLY_TO_DURATION = 3.0;
const FLY_TO_RANGE_SCALE = 6.0;
// Keep the camera outside the planet while it is locked onto it.
const TRACK_MINIMUM_ZOOM_SCALE = 1.5;

// Moving the orbit collection makes it rebuild its vertex arrays, so it is left alone
// until the frame it is drawn in has turned far enough for the drift to show. A
// hundredth of a degree is well under a pixel at any sane field of view.
const ORBIT_ROTATION_EPSILON = CesiumMath.toRadians(0.01);
const ORBIT_TRANSLATION_EPSILON = 1.0e-5;

const scratchDate = new JulianDate();
const scratchIcrfToFixed = new Matrix3();
const scratchSunInertial = new Cartesian3();
const scratchSunFixed = new Cartesian3();
const scratchHeliocentric = new Cartesian3();
const scratchInertial = new Cartesian3();
const scratchFixed = new Cartesian3();
const scratchBoundingSphere = new BoundingSphere();
const scratchOffset = new HeadingPitchRange(0.0, -CesiumMath.PI_OVER_SIX, 0.0);
const scratchFlyToDate = new JulianDate();
const scratchFlyToIcrfToFixed = new Matrix3();
const scratchFlyToSun = new Cartesian3();
const scratchFlyToPosition = new Cartesian3();
const scratchTrackingTransform = new Matrix4();
const scratchTrackingOffset = new Cartesian3();

// The colors are eyeballed from spacecraft imagery; they only have to make the
// planets tellable apart against a black sky.
const PLANET_STYLES = {
  Mercury: "#a9a29a",
  Venus: "#e6c67a",
  Mars: "#c1440e",
  Jupiter: "#d8ca9d",
  Saturn: "#ead6b8",
  Uranus: "#a7e0e8",
  Neptune: "#4b70dd",
  Pluto: "#c8a68a",
};

// The Earth's own orbit is drawn as well, in the blue it is usually given.
const EARTH_ORBIT_STYLE = "#6ba6e8";
const ORBIT_ALPHA = 0.35;

/**
 * Converts a slider position into an orbit speed.
 *
 * @param {number} sliderValue The slider position, in the range [0, SPEED_SLIDER_MAXIMUM].
 * @returns {number} The speed, as a multiple of real time.
 *
 * @private
 */
function sliderValueToSpeed(sliderValue) {
  // The range input hands back a string, and an empty one if it has been cleared.
  const value = Number(sliderValue);
  const clamped = CesiumMath.clamp(
    isNaN(value) ? 0.0 : value,
    0.0,
    SPEED_SLIDER_MAXIMUM,
  );
  const speed = Math.pow(
    10.0,
    (SPEED_DECADES * clamped) / SPEED_SLIDER_MAXIMUM,
  );
  return CesiumMath.clamp(Math.round(speed), MINIMUM_SPEED, MAXIMUM_SPEED);
}

/**
 * Describes how long a planet takes to go around the Sun, in whichever unit reads
 * best for that planet.
 *
 * @param {object} body One of the {@link PlanetaryEphemeris} element tables.
 * @returns {string} The description, for example <code>"88 days"</code>.
 *
 * @private
 */
function describeOrbitalPeriod(body) {
  const days = PlanetaryEphemeris.computeOrbitalPeriod(body);
  if (days < 500.0) {
    return `${days.toFixed(1)} days`;
  }
  return `${(days / 365.25).toFixed(1)} years`;
}

/**
 * Evaluates the rotation from the inertial frame the ephemeris works in to the Earth
 * fixed frame Cesium draws in.
 *
 * @param {JulianDate} time The time to evaluate the rotation at.
 * @param {Matrix3} result The object onto which to store the result.
 * @returns {Matrix3} The modified result parameter.
 *
 * @private
 */
function computeIcrfToFixed(time, result) {
  if (!defined(Transforms.computeIcrfToFixedMatrix(time, result))) {
    Transforms.computeTemeToPseudoFixedMatrix(time, result);
  }
  return result;
}

/**
 * Computes where a body is drawn, in the Earth fixed frame.
 *
 * @param {object} body One of the {@link PlanetaryEphemeris} element tables.
 * @param {JulianDate} time The current time.
 * @param {number} offsetSeconds How far ahead of the current time the body has been carried.
 * @param {Matrix3} icrfToFixed The rotation into the fixed frame at <code>time</code>.
 * @param {Cartesian3} sunInertial The Sun's position relative to the Earth at <code>time</code>.
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3} The modified result parameter.
 *
 * @private
 */
function computeFixedPosition(
  body,
  time,
  offsetSeconds,
  icrfToFixed,
  sunInertial,
  result,
) {
  PlanetaryEphemeris.computeHeliocentricPosition(
    body,
    JulianDate.addSeconds(time, offsetSeconds, scratchDate),
    scratchHeliocentric,
  );
  // Only the body is advanced by its own offset; the Earth stays on the clock, so a
  // body that is not orbiting is drawn exactly where it really is.
  Cartesian3.add(scratchHeliocentric, sunInertial, scratchInertial);
  return Matrix3.multiplyByVector(icrfToFixed, scratchInertial, result);
}

/**
 * How fast the clock is running, in simulation seconds per second of wall clock. Used
 * to work out where a planet will have got to by the time a camera flight lands.
 *
 * @param {Clock} clock The clock.
 * @returns {number} The rate.
 *
 * @private
 */
function computeClockRate(clock) {
  if (!clock.shouldAnimate) {
    return 0.0;
  }
  if (clock.clockStep === ClockStep.SYSTEM_CLOCK) {
    return 1.0;
  }
  // TICK_DEPENDENT advances by the multiplier once a frame rather than once a second,
  // so this only approximates it, which is close enough over a three second flight.
  return clock.multiplier;
}

/**
 * Draws one body's path around the Sun. The samples are taken relative to the Sun so
 * that the whole collection can be carried along by its model matrix.
 *
 * @param {SolarSystemViewModel} owner The widget view model the orbit belongs to.
 * @param {object} body One of the {@link PlanetaryEphemeris} element tables.
 * @param {Color} color The color to draw the path in.
 * @returns {number} The orbit's aphelion distance, in meters.
 *
 * @private
 */
function addOrbit(owner, body, color) {
  const positions = PlanetaryEphemeris.computeOrbitSamples(
    body,
    owner._clock.currentTime,
    ORBIT_SAMPLES,
  );

  owner._orbits.add({
    positions: positions,
    width: 1.0,
    material: Material.fromType(Material.ColorType, {
      color: Color.fromAlpha(color, ORBIT_ALPHA),
    }),
  });

  return positions.reduce(function (radius, position) {
    return Math.max(radius, Cartesian3.magnitude(position));
  }, 0.0);
}

/**
 * Builds the per-planet view model shown as one row of the widget, along with the
 * primitives that draw the planet.
 *
 * @param {SolarSystemViewModel} owner The widget view model the planet belongs to.
 * @param {object} body One of the {@link PlanetaryEphemeris} element tables.
 * @returns {object} The planet view model.
 *
 * @private
 */
function createPlanetViewModel(owner, body) {
  const scene = owner._scene;
  const color = Color.fromCssColorString(PLANET_STYLES[body.name]);
  const markerDistance = body.radii.x * MARKER_MINIMUM_DISTANCE_SCALE;

  const planet = {
    /**
     * The planet's name.
     * @type {string}
     */
    name: body.name,

    /**
     * The planet's color, as a CSS string, so the widget can key its row to what is
     * drawn in the scene.
     * @type {string}
     */
    colorCss: PLANET_STYLES[body.name],

    /**
     * A description of the planet's orbit, used as the row's tooltip.
     * @type {string}
     */
    description: `${body.name}${
      PlanetaryEphemeris.DWARF_PLANETS.indexOf(body) !== -1
        ? ", a dwarf planet,"
        : ""
    } orbits the Sun once every ${describeOrbitalPeriod(body)}.`,

    /**
     * Whether the planet is currently being carried around the Sun. This property is
     * observable.
     * @type {boolean}
     * @default false
     */
    orbiting: false,

    /**
     * The position of this planet's speed slider. This property is observable.
     * @type {number}
     * @default 60
     */
    speedSliderValue: DEFAULT_SPEED_SLIDER_VALUE,

    /**
     * The planet's distance from the Earth, formatted for display. This property is
     * observable.
     * @type {string}
     */
    distanceText: "",

    /**
     * Where the planet was last drawn, in the Earth fixed frame. This is where the
     * planet has been carried to, which is not where it really is once it has been
     * set orbiting.
     * @type {Cartesian3}
     */
    position: new Cartesian3(),

    /**
     * Whether the camera is locked onto the planet, following it wherever it goes.
     * This property is observable.
     * @type {boolean}
     * @default false
     */
    tracking: false,
  };

  knockout.track(planet, [
    "orbiting",
    "speedSliderValue",
    "distanceText",
    "tracking",
  ]);

  /**
   * The label on the button that flies out to the planet. This property is observable.
   * @type {string}
   */
  knockout.defineProperty(planet, "flyToText", function () {
    return planet.tracking ? "Release" : "Fly to";
  });

  /**
   * How much faster than real time the planet is orbiting. This property is observable.
   *
   * <p>The top of the range covers a year of orbital motion every five minutes, so a
   * planet left running for a few hours ends up outside the 1800 AD - 2050 AD interval
   * the elements are fit to and its position drifts from the real thing. Resetting
   * brings it back.</p>
   *
   * @type {number}
   */
  knockout.defineProperty(planet, "speed", function () {
    return sliderValueToSpeed(planet.speedSliderValue);
  });

  /**
   * The planet's speed, formatted for display. This property is observable.
   * @type {string}
   */
  knockout.defineProperty(planet, "speedText", function () {
    return `${planet.speed.toLocaleString("en-US")}x`;
  });

  planet._body = body;
  // Seconds of orbital motion this planet has been given beyond the current time. It
  // stays at zero until the planet is set orbiting, so the planets sit where they
  // really are until the user asks for something else.
  planet._offsetSeconds = 0.0;

  planet._orbitRadius = addOrbit(owner, body, color);

  planet._point = owner._points.add({
    color: color,
    pixelSize: 6.0,
    outlineColor: Color.BLACK,
    outlineWidth: 1.0,
    distanceDisplayCondition: new DistanceDisplayCondition(
      markerDistance,
      Number.MAX_VALUE,
    ),
  });

  planet._label = owner._labels.add({
    text: body.name,
    font: "14px sans-serif",
    fillColor: color,
    outlineColor: Color.BLACK,
    outlineWidth: 2.0,
    style: LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cartesian2(0.0, 8.0),
    verticalOrigin: VerticalOrigin.TOP,
    distanceDisplayCondition: new DistanceDisplayCondition(
      markerDistance,
      Number.MAX_VALUE,
    ),
  });

  planet._bodyPrimitive = new EllipsoidPrimitive({
    radii: body.radii,
    material: Material.fromType(Material.ColorType, { color: color }),
    onlySunLighting: true,
  });
  planet._bodyPrimitive.material.translucent = false;
  scene.primitives.add(planet._bodyPrimitive);

  /**
   * Flies the camera out to the planet and locks onto it, or lets it go again if it is
   * already locked on.
   * @type {Command}
   */
  planet.flyTo = createCommand(function () {
    if (planet.tracking) {
      owner.stopTracking();
      return;
    }
    owner._flyTo(planet);
  });

  knockout.getObservable(planet, "orbiting").subscribe(function () {
    owner._requestRender();
  });

  return planet;
}

/**
 * The view model for {@link SolarSystem}.
 * @alias SolarSystemViewModel
 * @constructor
 *
 * @param {Scene} scene The Scene to draw the planets in.
 * @param {Clock} clock The clock that supplies the time the planets are drawn at.
 */
function SolarSystemViewModel(scene, clock) {
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
  this._lastTimestamp = getTimestamp();
  this._lastDistanceUpdate = 0.0;
  this._trackedPlanet = undefined;
  this._removeTrackingListener = undefined;
  this._originalMinimumZoomDistance = undefined;
  this._originalFar = undefined;
  this._orbitRotation = new Matrix3();
  this._orbitTranslation = new Cartesian3();

  this._points = scene.primitives.add(new PointPrimitiveCollection());
  this._labels = scene.primitives.add(new LabelCollection({ scene: scene }));
  this._orbits = scene.primitives.add(new PolylineCollection());

  const that = this;

  /**
   * Gets or sets whether the planet list is currently visible.  This property is
   * observable.
   * @type {boolean}
   * @default false
   */
  this.dropDownVisible = false;

  /**
   * Gets or sets whether each planet's orbit is drawn around the Sun.  This property
   * is observable.
   * @type {boolean}
   * @default true
   */
  this.showOrbits = true;

  /**
   * Gets or sets the widget's tooltip.  This property is observable.
   * @type {string}
   * @default 'Solar System'
   */
  this.tooltip = "Solar System";

  /**
   * Gets the color the Earth's orbit is drawn in, as a CSS string.
   * @type {string}
   */
  this.earthOrbitColorCss = EARTH_ORBIT_STYLE;

  knockout.track(this, ["dropDownVisible", "showOrbits", "tooltip"]);

  // The Earth gets a path like everything else, even though it has no row of its own:
  // nothing is drawn at the Earth itself, since the scene is already centered on it.
  // Seen from the ground the path traces out the ecliptic.
  this._earthOrbitRadius = addOrbit(
    this,
    PlanetaryEphemeris.EARTH_MOON_BARYCENTER,
    Color.fromCssColorString(EARTH_ORBIT_STYLE),
  );

  /**
   * Gets the bodies with a row in the widget -- every planet other than the Earth,
   * and Pluto -- ordered outward from the Sun.
   * @type {object[]}
   */
  this.planets = PlanetaryEphemeris.PLANETS.concat(
    PlanetaryEphemeris.DWARF_PLANETS,
  ).map(function (body) {
    return createPlanetViewModel(that, body);
  });

  /**
   * Gets or sets whether every planet is orbiting.  Setting it starts or stops all of
   * them at once.  This property is observable.
   * @type {boolean}
   */
  this.allOrbiting = false;
  knockout.defineProperty(this, "allOrbiting", {
    get: function () {
      return that.planets.every(function (planet) {
        return planet.orbiting;
      });
    },
    set: function (value) {
      that.planets.forEach(function (planet) {
        planet.orbiting = value;
      });
    },
  });

  knockout.getObservable(this, "showOrbits").subscribe(function () {
    that._requestRender();
  });

  this._toggleDropDown = createCommand(function () {
    that.dropDownVisible = !that.dropDownVisible;
  });

  this._resetPositions = createCommand(function () {
    that.planets.forEach(function (planet) {
      planet._offsetSeconds = 0.0;
    });
    that._requestRender();
  });

  this._removePreUpdateListener = scene.preUpdate.addEventListener(
    function (unusedScene, time) {
      that._update(time ?? clock.currentTime);
    },
  );
}

Object.defineProperties(SolarSystemViewModel.prototype, {
  /**
   * Gets the scene the planets are drawn in.
   * @memberof SolarSystemViewModel.prototype
   * @type {Scene}
   */
  scene: {
    get: function () {
      return this._scene;
    },
  },

  /**
   * Gets the clock the planets are drawn at.
   * @memberof SolarSystemViewModel.prototype
   * @type {Clock}
   */
  clock: {
    get: function () {
      return this._clock;
    },
  },

  /**
   * Gets the highest value a planet's speed slider takes, which corresponds to
   * 100000x real time.
   * @memberof SolarSystemViewModel.prototype
   * @type {number}
   */
  speedSliderMaximum: {
    get: function () {
      return SPEED_SLIDER_MAXIMUM;
    },
  },

  /**
   * Gets the command that shows or hides the planet list.
   * @memberof SolarSystemViewModel.prototype
   *
   * @type {Command}
   */
  toggleDropDown: {
    get: function () {
      return this._toggleDropDown;
    },
  },

  /**
   * Gets the command that returns every planet to where it really is right now.
   * @memberof SolarSystemViewModel.prototype
   *
   * @type {Command}
   */
  resetPositions: {
    get: function () {
      return this._resetPositions;
    },
  },

  /**
   * Gets the planet the camera is locked onto, if any.
   * @memberof SolarSystemViewModel.prototype
   *
   * @type {object|undefined}
   * @readonly
   */
  trackedPlanet: {
    get: function () {
      return this._trackedPlanet;
    },
  },
});

/**
 * Flies the camera out to a planet and locks onto it once it arrives.
 *
 * @param {object} planet One of the planets in {@link SolarSystemViewModel#planets}.
 *
 * @private
 */
SolarSystemViewModel.prototype._flyTo = function (planet) {
  const scene = this._scene;
  if (scene.mode !== SceneMode.SCENE3D) {
    return;
  }

  this.stopTracking();

  // The planet carries on moving while the camera is in the air, so aim at wherever it
  // will have got to by the time the flight lands rather than where it is now. At the
  // top of the speed range that is most of the way around an orbit.
  const destination = this._computePosition(
    planet,
    FLY_TO_DURATION,
    scratchFlyToPosition,
  );
  const radius = planet._body.radii.x;
  scratchBoundingSphere.center = Cartesian3.clone(
    destination,
    scratchBoundingSphere.center,
  );
  scratchBoundingSphere.radius = radius;
  scratchOffset.range = radius * FLY_TO_RANGE_SCALE;

  const that = this;
  scene.camera.flyToBoundingSphere(scratchBoundingSphere, {
    duration: FLY_TO_DURATION,
    offset: scratchOffset,
    complete: function () {
      // The widget can be torn down while the camera is still in the air.
      if (!that.isDestroyed()) {
        that._startTracking(planet);
      }
    },
  });
};

/**
 * Computes where a planet will be drawn a given number of seconds from now, taking in
 * both the speed the planet is being carried around the Sun at and the rate the clock
 * itself is running at.
 *
 * @param {object} planet One of the planets in {@link SolarSystemViewModel#planets}.
 * @param {number} secondsFromNow How far ahead to look, in seconds of wall clock.
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3} The modified result parameter, in the Earth fixed frame.
 *
 * @private
 */
SolarSystemViewModel.prototype._computePosition = function (
  planet,
  secondsFromNow,
  result,
) {
  const clock = this._clock;
  const time = JulianDate.addSeconds(
    clock.currentTime,
    computeClockRate(clock) * secondsFromNow,
    scratchFlyToDate,
  );
  const offsetSeconds =
    planet._offsetSeconds +
    (planet.orbiting ? planet.speed * secondsFromNow : 0.0);

  return computeFixedPosition(
    planet._body,
    time,
    offsetSeconds,
    computeIcrfToFixed(time, scratchFlyToIcrfToFixed),
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      time,
      scratchFlyToSun,
    ),
    result,
  );
};

/**
 * Locks the camera onto a planet, so that it keeps the same view of the planet however
 * far the planet is carried around the Sun.
 *
 * @param {object} planet One of the planets in {@link SolarSystemViewModel#planets}.
 *
 * @private
 */
SolarSystemViewModel.prototype._startTracking = function (planet) {
  const scene = this._scene;
  if (scene.isDestroyed() || scene.mode !== SceneMode.SCENE3D) {
    return;
  }

  this.stopTracking();

  const camera = scene.camera;
  // Moving into the planet's frame leaves the camera where it is, so its position in
  // the new frame is the offset that gets carried along as the planet moves.
  Matrix4.fromTranslation(planet.position, scratchTrackingTransform);
  camera.lookAtTransform(scratchTrackingTransform);

  const controller = scene.screenSpaceCameraController;
  this._originalMinimumZoomDistance = controller.minimumZoomDistance;
  controller.minimumZoomDistance =
    planet._body.radii.x * TRACK_MINIMUM_ZOOM_SCALE;

  // The camera controller has already run by the time postUpdate is raised, so this
  // carries over whatever the user did with the camera this frame.
  this._removeTrackingListener = scene.postUpdate.addEventListener(function () {
    Cartesian3.clone(camera.position, scratchTrackingOffset);
    Matrix4.fromTranslation(planet.position, scratchTrackingTransform);
    camera.lookAtTransform(scratchTrackingTransform, scratchTrackingOffset);
  });

  planet.tracking = true;
  this._trackedPlanet = planet;
};

/**
 * Releases the camera from the planet it is locked onto, leaving it where it is.
 */
SolarSystemViewModel.prototype.stopTracking = function () {
  const planet = this._trackedPlanet;
  if (!defined(planet)) {
    return;
  }

  this._removeTrackingListener();
  this._removeTrackingListener = undefined;
  this._trackedPlanet = undefined;
  planet.tracking = false;

  const scene = this._scene;
  // A morph resets the camera's frame itself, and will not accept one being set.
  if (!scene.isDestroyed() && scene.mode !== SceneMode.MORPHING) {
    scene.camera.lookAtTransform(Matrix4.IDENTITY);
    scene.screenSpaceCameraController.minimumZoomDistance =
      this._originalMinimumZoomDistance;
  }
  this._originalMinimumZoomDistance = undefined;
};

/**
 * @private
 */
SolarSystemViewModel.prototype._requestRender = function () {
  const scene = this._scene;
  if (!scene.isDestroyed()) {
    scene.requestRender();
  }
};

/**
 * Keeps the far plane beyond the furthest thing this widget draws. The planets are
 * millions of times further away than anything Cesium normally renders, so without
 * this they are all clipped away.
 *
 * @param {number} distance The distance that has to remain visible, in meters.
 *
 * @private
 */
SolarSystemViewModel.prototype._claimFarPlane = function (distance) {
  const frustum = this._scene.camera.frustum;
  if (typeof frustum.far !== "number") {
    // Not a frustum with a far plane we can manage, for example during a mode morph.
    return;
  }

  if (!defined(this._originalFar)) {
    this._originalFar = frustum.far;
  }

  frustum.far = Math.max(this._originalFar, distance);
};

/**
 * Puts the far plane back where the scene had it.
 *
 * @private
 */
SolarSystemViewModel.prototype._releaseFarPlane = function () {
  if (!defined(this._originalFar)) {
    return;
  }

  const frustum = this._scene.camera.frustum;
  if (typeof frustum.far === "number") {
    frustum.far = this._originalFar;
  }
  this._originalFar = undefined;
};

/**
 * Moves every planet to where it belongs for this frame.
 *
 * @param {JulianDate} time The current time.
 *
 * @private
 */
SolarSystemViewModel.prototype._update = function (time) {
  const scene = this._scene;
  const planets = this.planets;

  // EllipsoidPrimitive only draws in 3D, and a planet an astronomical unit away has
  // no sensible place on a flattened map, so sit the whole widget out otherwise.
  const visible = scene.mode === SceneMode.SCENE3D;
  this._points.show = visible;
  this._labels.show = visible;
  this._orbits.show = visible && this.showOrbits;

  const timestamp = getTimestamp();
  let elapsedSeconds = (timestamp - this._lastTimestamp) / 1000.0;
  this._lastTimestamp = timestamp;
  if (!(elapsedSeconds > 0.0) || elapsedSeconds > MAXIMUM_STEP_SECONDS) {
    elapsedSeconds = 0.0;
  }

  if (!visible) {
    planets.forEach(function (planet) {
      planet._bodyPrimitive.show = false;
    });
    this.stopTracking();
    this._releaseFarPlane();
    return;
  }

  // Cesium works in the Earth fixed frame, while the ephemeris is inertial, so every
  // position has to be rotated by the current orientation of the Earth.
  computeIcrfToFixed(time, scratchIcrfToFixed);
  const sunInertial =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      time,
      scratchSunInertial,
    );
  const sunFixed = Matrix3.multiplyByVector(
    scratchIcrfToFixed,
    sunInertial,
    scratchSunFixed,
  );

  // The orbits are stored relative to the Sun, so the whole collection can be carried
  // along by its model matrix instead of every point being transformed each frame.
  if (
    !Matrix3.equalsEpsilon(
      scratchIcrfToFixed,
      this._orbitRotation,
      ORBIT_ROTATION_EPSILON,
    ) ||
    !Cartesian3.equalsEpsilon(
      sunFixed,
      this._orbitTranslation,
      ORBIT_TRANSLATION_EPSILON,
    )
  ) {
    Matrix3.clone(scratchIcrfToFixed, this._orbitRotation);
    Cartesian3.clone(sunFixed, this._orbitTranslation);
    Matrix4.fromRotationTranslation(
      scratchIcrfToFixed,
      sunFixed,
      this._orbits.modelMatrix,
    );
  }

  const cameraPosition = scene.camera.positionWC;
  const sunDistance = Cartesian3.distance(cameraPosition, sunFixed);
  const updateDistances =
    this.dropDownVisible &&
    timestamp - this._lastDistanceUpdate > DISTANCE_UPDATE_INTERVAL;
  let orbiting = false;
  let requiredFar = this.showOrbits
    ? sunDistance + this._earthOrbitRadius
    : 0.0;

  for (let i = 0; i < planets.length; ++i) {
    const planet = planets[i];

    if (planet.orbiting) {
      planet._offsetSeconds += elapsedSeconds * planet.speed;
      orbiting = true;
    }

    // The offset is only added to, never cleared, so a planet that has been stopped
    // stays where it was carried to instead of jumping back to where it really is.
    const position = computeFixedPosition(
      planet._body,
      time,
      planet._offsetSeconds,
      scratchIcrfToFixed,
      sunInertial,
      scratchFixed,
    );

    Cartesian3.clone(position, planet.position);
    planet._point.position = position;
    planet._label.position = position;

    // The planets are not given their real spin axes, only the orientation of the
    // inertial frame, which is enough to keep the oblate ones from wobbling.
    planet._bodyPrimitive.show = true;
    Matrix4.fromRotationTranslation(
      scratchIcrfToFixed,
      position,
      planet._bodyPrimitive.modelMatrix,
    );

    const cameraDistance = Cartesian3.distance(cameraPosition, position);
    requiredFar = Math.max(requiredFar, cameraDistance);
    if (this.showOrbits) {
      requiredFar = Math.max(requiredFar, sunDistance + planet._orbitRadius);
    }

    if (updateDistances) {
      // The rotation into the fixed frame does not change the distance.
      planet.distanceText = `${(
        Cartesian3.magnitude(position) / PlanetaryEphemeris.AU_METERS
      ).toFixed(2)} AU`;
    }
  }

  if (updateDistances) {
    this._lastDistanceUpdate = timestamp;
  }

  this._claimFarPlane(requiredFar * FAR_PLANE_PADDING);

  if (orbiting) {
    // Nothing else in the scene is changing, so ask for the frames ourselves.
    scene.requestRender();
  }
};

/**
 * @returns {boolean} true if the object has been destroyed, false otherwise.
 */
SolarSystemViewModel.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the view model, along with everything it draws.
 */
SolarSystemViewModel.prototype.destroy = function () {
  this._removePreUpdateListener();
  this.stopTracking();

  const scene = this._scene;
  if (!scene.isDestroyed()) {
    this._releaseFarPlane();

    const primitives = scene.primitives;
    primitives.remove(this._points);
    primitives.remove(this._labels);
    primitives.remove(this._orbits);
    this.planets.forEach(function (planet) {
      primitives.remove(planet._bodyPrimitive);
    });
  }

  destroyObject(this);
};
export default SolarSystemViewModel;
