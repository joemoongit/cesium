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
  IauOrientationAxes,
  IauOrientationParameters,
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
// Pluto's year is a thousand times Mercury's, so one shared ceiling cannot suit both:
// whatever makes Pluto move turns Mercury into a blur. Each slider is scaled to its own
// body instead, and still reads a true multiple of real time. At the top of its travel
// a body takes this long to come round once, and at rest it takes this long.
const TOP_REVOLUTION_SECONDS = 4.0;
const DEFAULT_REVOLUTION_SECONDS = 60.0;
// The sliders are logarithmic so that the slow end, where the planets still look like
// they are keeping real time, is not crammed into the first pixel of travel.
const SPEED_SLIDER_MAXIMUM = 100;

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
const scratchInertialTransform = new Matrix4();
const scratchInertialRotation = new Matrix3();
const scratchInertialOffset = new Cartesian3();
const scratchEarthDate = new JulianDate();
const scratchEarthMoved = new Cartesian3();
const scratchEarthNow = new Cartesian3();
const scratchSpinDate = new JulianDate();
const scratchSpin = new Matrix3();
const scratchOrientation = new IauOrientationParameters();

// The colors are eyeballed from spacecraft imagery; they only have to make the
// planets tellable apart against a black sky.
const PLANET_STYLES = {
  Mercury: "#a9a29a",
  Venus: "#e6c67a",
  Earth: "#6ba6e8",
  Mars: "#c1440e",
  Jupiter: "#d8ca9d",
  Saturn: "#ead6b8",
  Uranus: "#a7e0e8",
  Neptune: "#4b70dd",
  Pluto: "#c8a68a",
};

const ORBIT_ALPHA = 0.35;

// A body turning on its axis is invisible while it is a plain coloured ball, so a
// spinning one is banded in two shades of its own colour to give the eye something to
// follow. The bands run north to south, across the direction of rotation.
const SPIN_BAND_COUNT = 6.0;
const SPIN_BAND_DARKEN = 0.55;

/**
 * Converts a slider position into an orbit speed.
 *
 * @param {number} sliderValue The slider position, in the range [0, SPEED_SLIDER_MAXIMUM].
 * @returns {number} The speed, as a multiple of real time.
 *
 * @private
 */
function sliderValueToSpeed(sliderValue, maximumSpeed) {
  // The range input hands back a string, and an empty one if it has been cleared.
  const value = Number(sliderValue);
  const clamped = CesiumMath.clamp(
    isNaN(value) ? 0.0 : value,
    0.0,
    SPEED_SLIDER_MAXIMUM,
  );
  const speed = Math.pow(
    10.0,
    (Math.log10(maximumSpeed) * clamped) / SPEED_SLIDER_MAXIMUM,
  );
  return CesiumMath.clamp(Math.round(speed), MINIMUM_SPEED, maximumSpeed);
}

/**
 * The speed at which a body comes round once every <code>seconds</code>, rounded to two
 * figures so that the ends of the slider read as round numbers.
 *
 * @param {number} periodDays How long the body takes, in days. The sign is ignored.
 * @param {number} seconds How long it should appear to take.
 * @returns {number} The speed, as a multiple of real time.
 *
 * @private
 */
function speedForRevolution(periodDays, seconds) {
  const speed = (Math.abs(periodDays) * 86400.0) / seconds;
  const figures = Math.pow(10.0, Math.floor(Math.log10(speed)) - 1.0);
  return Math.max(MINIMUM_SPEED, Math.round(speed / figures) * figures);
}

/**
 * The slider position that gives a speed, so that both sliders can start at the same
 * multiple of real time even though they cover different ranges.
 *
 * @param {number} speed The speed, as a multiple of real time.
 * @param {number} maximumSpeed The speed at the top of that slider's travel.
 * @returns {number} The slider position.
 *
 * @private
 */
function speedToSliderValue(speed, maximumSpeed) {
  return (SPEED_SLIDER_MAXIMUM * Math.log10(speed)) / Math.log10(maximumSpeed);
}

/**
 * Gives a planet a <code>&lt;prefix&gt;Speed</code> read off its
 * <code>&lt;prefix&gt;SpeedSliderValue</code>, and a <code>&lt;prefix&gt;SpeedText</code>
 * to label it with. The orbit and the spin each get their own.
 *
 * @param {object} planet The planet view model.
 * @param {string} prefix The name the pair is built from.
 * @param {number} maximumSpeed The speed at the top of that slider's travel.
 *
 * @private
 */
function defineSpeed(planet, prefix, maximumSpeed) {
  const speed = `${prefix}Speed`;
  knockout.defineProperty(planet, speed, function () {
    return sliderValueToSpeed(planet[`${speed}SliderValue`], maximumSpeed);
  });
  knockout.defineProperty(planet, `${speed}Text`, function () {
    return `${planet[speed].toLocaleString("en-US")}x`;
  });
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
 * Describes how long a body takes to turn once on its axis, and which way round.
 *
 * @param {object} body One of the {@link PlanetaryEphemeris} element tables.
 * @returns {string} The description, for example <code>"24.6 hours"</code>.
 *
 * @private
 */
function describeRotationPeriod(body) {
  const days = PlanetaryEphemeris.computeRotationPeriod(body);
  const magnitude = Math.abs(days);
  const period =
    magnitude < 2.0
      ? `${(magnitude * 24.0).toFixed(1)} hours`
      : `${magnitude.toFixed(1)} days`;
  return days < 0.0 ? `${period}, the other way round` : period;
}

/**
 * Builds the material a body is drawn with. A spinning one is banded so that the
 * rotation can be seen at all.
 *
 * @param {Color} color The body's color.
 * @param {boolean} spinning Whether the body is being spun.
 * @returns {Material} The material.
 *
 * @private
 */
function createBodyMaterial(color, spinning) {
  const material = spinning
    ? Material.fromType(Material.StripeType, {
        horizontal: false,
        evenColor: color,
        oddColor: color.darken(SPIN_BAND_DARKEN, new Color()),
        repeat: SPIN_BAND_COUNT,
      })
    : Material.fromType(Material.ColorType, { color: color });
  material.translucent = false;
  return material;
}

/**
 * Spins the Earth, by running the clock.
 *
 * <p>Cesium draws the globe in the Earth fixed frame, so the globe's rotation is that
 * frame, and the frame is a function of the time on the clock: one sidereal day of
 * simulated time is one turn of the Earth. Running the clock at a multiple of real
 * time therefore spins the real Earth at exactly that multiple, terminator, stars and
 * all. It also carries the rest of the sky along with it, which is not a side effect
 * but the same fact seen from outside: time is passing faster for everything.</p>
 *
 * <p>The camera has to be dealt with as well. It lives in the same fixed frame as the
 * globe, so left alone it turns with the ground and the Earth appears to stand still
 * while the sky wheels past. Holding it against the stars instead is what makes the
 * Earth, rather than everything else, look like the thing that is turning.</p>
 *
 * @param {SolarSystemViewModel} owner The widget view model.
 *
 * @private
 */
function applyEarthSpin(owner) {
  const earth = owner._earth;
  const clock = owner._clock;

  if (earth.spinning) {
    if (!defined(owner._clockBeforeSpin)) {
      owner._clockBeforeSpin = {
        multiplier: clock.multiplier,
        shouldAnimate: clock.shouldAnimate,
        clockStep: clock.clockStep,
      };
    }
    // The multiplier is only honoured in this step, so it has to be set as well.
    clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    clock.multiplier = earth.spinSpeed;
    clock.shouldAnimate = true;
    owner._holdCameraStill();
    return;
  }

  owner._releaseCamera();

  if (defined(owner._clockBeforeSpin)) {
    const before = owner._clockBeforeSpin;
    owner._clockBeforeSpin = undefined;
    // Leave alone anything the user has changed from under us in the meantime.
    if (clock.multiplier === earth.spinSpeed) {
      clock.multiplier = before.multiplier;
      clock.shouldAnimate = before.shouldAnimate;
      clock.clockStep = before.clockStep;
    }
  }
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
  const orbitPeriod = PlanetaryEphemeris.computeOrbitalPeriod(body);
  const spinPeriod = PlanetaryEphemeris.computeRotationPeriod(body);
  const maximumOrbitSpeed = speedForRevolution(
    orbitPeriod,
    TOP_REVOLUTION_SECONDS,
  );
  const maximumSpinSpeed = speedForRevolution(
    spinPeriod,
    TOP_REVOLUTION_SECONDS,
  );
  const color = Color.fromCssColorString(PLANET_STYLES[body.name]);
  // Cesium already draws the Earth: it is the globe, and it is where the camera is.
  // So the Earth gets a row and an orbit but nothing of its own in the scene.
  const isEarth = body === PlanetaryEphemeris.EARTH;
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
    } orbits the Sun once every ${describeOrbitalPeriod(body)} and turns on its axis once every ${describeRotationPeriod(body)}.${
      body === PlanetaryEphemeris.EARTH
        ? " Everything here is drawn from the Earth, so sending it round the Sun carries the camera with it and the rest of the sky shifts to match, and its distance is given to the Sun rather than to itself. Turning it runs the clock, since the globe's rotation is what the clock measures."
        : ""
    }`,

    /**
     * Whether the planet is currently being carried around the Sun. This property is
     * observable.
     * @type {boolean}
     * @default false
     */
    orbiting: false,

    /**
     * The position of this planet's orbit speed slider. This property is observable.
     * @type {number}
     * @default 60
     */
    orbitSpeedSliderValue: speedToSliderValue(
      speedForRevolution(orbitPeriod, DEFAULT_REVOLUTION_SECONDS),
      maximumOrbitSpeed,
    ),

    /**
     * The position of this planet's spin speed slider. This property is observable.
     * @type {number}
     * @default 60
     */
    spinSpeedSliderValue: speedToSliderValue(
      speedForRevolution(spinPeriod, DEFAULT_REVOLUTION_SECONDS),
      maximumSpinSpeed,
    ),

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
     * Whether the planet is being turned on its own axis. This property is observable.
     * @type {boolean}
     * @default false
     */
    spinning: false,

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
    "spinning",
    "orbitSpeedSliderValue",
    "spinSpeedSliderValue",
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
   * How much faster than real time the planet is orbiting, as
   * <code>orbitSpeed</code> and <code>orbitSpeedText</code>, and how much faster it is
   * turning on its axis, as <code>spinSpeed</code> and <code>spinSpeedText</code>. All
   * four are observable.
   *
   * <p>Each slider is scaled to its own body, so that the top of the travel brings it
   * round once every few seconds whether it is Mercury or Pluto. That takes the outer
   * planets a long way outside the 1800 AD - 2050 AD interval the elements are fit to,
   * and their positions drift from the real thing the longer they are left running.
   * Resetting brings them back.</p>
   *
   * @type {number}
   */
  defineSpeed(planet, "orbit", maximumOrbitSpeed);
  defineSpeed(planet, "spin", maximumSpinSpeed);

  planet._body = body;

  // Seconds of orbital motion this planet has been given beyond the current time. It
  // stays at zero until the planet is set orbiting, so the planets sit where they
  // really are until the user asks for something else.
  planet._offsetSeconds = 0.0;
  // The same, for the turn the planet has been given on its own axis.
  planet._spinSeconds = 0.0;
  planet._axes = new IauOrientationAxes(function (date) {
    return PlanetaryEphemeris.computeOrientation(
      body,
      date,
      scratchOrientation,
    );
  });

  planet._orbitRadius = addOrbit(owner, body, color);

  // Nothing is drawn for the Earth: Cesium's globe is the Earth, and the camera is
  // standing on it. Everything else in the loop below skips it.
  planet._drawn = !isEarth;
  if (planet._drawn) {
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
      material: createBodyMaterial(color, false),
      onlySunLighting: true,
    });
    scene.primitives.add(planet._bodyPrimitive);
  }

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

  knockout.getObservable(planet, "spinning").subscribe(function (spinning) {
    if (planet._drawn) {
      planet._bodyPrimitive.material = createBodyMaterial(color, spinning);
    } else {
      applyEarthSpin(owner);
    }
    owner._requestRender();
  });

  if (isEarth) {
    // Dragging the slider while it is turning has to reach the clock too.
    knockout.getObservable(planet, "spinSpeed").subscribe(function () {
      applyEarthSpin(owner);
    });
  }

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
  this._removeCameraHold = undefined;
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

  knockout.track(this, ["dropDownVisible", "showOrbits", "tooltip"]);

  /**
   * Gets the bodies the widget lists, ordered outward from the Sun: every planet,
   * the Earth included, and Pluto.
   * @type {object[]}
   */
  this.planets = PlanetaryEphemeris.BODIES.map(function (body) {
    return createPlanetViewModel(that, body);
  });

  // The Earth is handled apart from the others in the update: it is the origin.
  this._earth = this.planets.filter(function (planet) {
    return !planet._drawn;
  })[0];

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

  /**
   * Gets or sets whether every planet is turning on its axis.  Setting it starts or
   * stops all of them at once.  This property is observable.
   * @type {boolean}
   */
  this.allSpinning = false;
  knockout.defineProperty(this, "allSpinning", {
    get: function () {
      return that.planets.every(function (planet) {
        return planet.spinning;
      });
    },
    set: function (value) {
      that.planets.forEach(function (planet) {
        planet.spinning = value;
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
      planet._spinSeconds = 0.0;
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
   * Gets the highest position a planet's speed slider takes. What speed that is
   * depends on the planet and on whether it is the orbit or the spin slider.
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
    (planet.orbiting ? planet.orbitSpeed * secondsFromNow : 0.0);

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
 * Holds the camera still against the stars, so that the globe turns underneath it.
 *
 * @private
 */
SolarSystemViewModel.prototype._holdCameraStill = function () {
  const scene = this._scene;
  if (
    defined(this._removeCameraHold) ||
    scene.isDestroyed() ||
    scene.mode !== SceneMode.SCENE3D
  ) {
    return;
  }

  // Only one thing may hold the camera; watching a planet wins.
  this.stopTracking();

  const camera = scene.camera;
  const clock = this._clock;
  const inertial = function (result) {
    // The inertial frame, centred on the Earth. Rotation only, so the Earth stays put
    // while its own rotation carries the frame -- and the camera in it -- around.
    return Matrix4.fromRotationTranslation(
      computeIcrfToFixed(clock.currentTime, scratchInertialRotation),
      Cartesian3.ZERO,
      result,
    );
  };

  // Moving into the frame leaves the camera where it is, so its position in the new
  // frame is the offset that then stays put while the globe turns beneath it.
  camera.lookAtTransform(inertial(scratchInertialTransform));

  this._removeCameraHold = scene.postUpdate.addEventListener(function () {
    Cartesian3.clone(camera.position, scratchInertialOffset);
    camera.lookAtTransform(
      inertial(scratchInertialTransform),
      scratchInertialOffset,
    );
  });
};

/**
 * Puts the camera back into the frame it shares with the ground.
 *
 * @private
 */
SolarSystemViewModel.prototype._releaseCamera = function () {
  if (!defined(this._removeCameraHold)) {
    return;
  }

  this._removeCameraHold();
  this._removeCameraHold = undefined;

  const scene = this._scene;
  if (!scene.isDestroyed() && scene.mode !== SceneMode.MORPHING) {
    scene.camera.lookAtTransform(Matrix4.IDENTITY);
  }
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
  this._releaseCamera();

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
      if (planet._drawn) {
        planet._bodyPrimitive.show = false;
      }
    });
    this.stopTracking();
    this._releaseCamera();
    this._releaseFarPlane();
    return;
  }

  let moving = false;

  // Cesium works in the Earth fixed frame, while the ephemeris is inertial, so every
  // position has to be rotated by the current orientation of the Earth.
  computeIcrfToFixed(time, scratchIcrfToFixed);
  const sunInertial =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      time,
      scratchSunInertial,
    );

  // Carrying the Earth along its orbit carries the camera with it, since everything
  // here is drawn from the Earth. So its offset is applied to the Sun's position
  // instead of to a body of its own, and the whole sky shifts to match. Only the
  // change is applied, which leaves the accurate Simon1994 vector alone at rest.
  const earth = this._earth;
  if (earth.orbiting) {
    earth._offsetSeconds += elapsedSeconds * earth.orbitSpeed;
    moving = true;
  }
  if (earth._offsetSeconds !== 0.0) {
    PlanetaryEphemeris.computeHeliocentricPosition(
      earth._body,
      JulianDate.addSeconds(time, earth._offsetSeconds, scratchEarthDate),
      scratchEarthMoved,
    );
    PlanetaryEphemeris.computeHeliocentricPosition(
      earth._body,
      time,
      scratchEarthNow,
    );
    Cartesian3.subtract(scratchEarthMoved, scratchEarthNow, scratchEarthMoved);
    Cartesian3.subtract(sunInertial, scratchEarthMoved, sunInertial);
  }
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
  let requiredFar = 0.0;

  for (let i = 0; i < planets.length; ++i) {
    const planet = planets[i];

    if (planet.orbiting && planet._drawn) {
      planet._offsetSeconds += elapsedSeconds * planet.orbitSpeed;
      moving = true;
    }

    // The offset is only added to, never cleared, so a planet that has been stopped
    // stays where it was carried to instead of jumping back to where it really is.
    // The Earth is the origin by definition: it is where the camera is standing.
    const position = planet._drawn
      ? computeFixedPosition(
          planet._body,
          time,
          planet._offsetSeconds,
          scratchIcrfToFixed,
          sunInertial,
          scratchFixed,
        )
      : Cartesian3.clone(Cartesian3.ZERO, scratchFixed);

    Cartesian3.clone(position, planet.position);
    const cameraDistance = Cartesian3.distance(cameraPosition, position);
    if (planet._drawn) {
      planet._point.position = position;
      planet._label.position = position;
    }

    if (planet._drawn) {
      if (planet.spinning) {
        planet._spinSeconds += elapsedSeconds * planet.spinSpeed;
        moving = true;
      }

      // The planet's own axes, from the IAU pole and prime meridian, taken through the
      // inertial frame into the fixed frame Cesium draws in. The pole gives the planet
      // its real axial tilt whether or not it is being spun.
      const spin = planet._axes.evaluate(
        JulianDate.addSeconds(time, planet._spinSeconds, scratchSpinDate),
        scratchSpin,
      );
      Matrix3.multiply(scratchIcrfToFixed, Matrix3.transpose(spin, spin), spin);

      planet._bodyPrimitive.show = true;
      Matrix4.fromRotationTranslation(
        spin,
        position,
        planet._bodyPrimitive.modelMatrix,
      );
    }

    requiredFar = Math.max(requiredFar, cameraDistance);
    if (this.showOrbits) {
      requiredFar = Math.max(requiredFar, sunDistance + planet._orbitRadius);
    }

    if (updateDistances) {
      // The rotation into the fixed frame does not change the distance. The Earth's
      // distance to itself is no use, so it is given the distance to the Sun.
      planet.distanceText = `${(
        Cartesian3.magnitude(planet._drawn ? position : sunInertial) /
        PlanetaryEphemeris.AU_METERS
      ).toFixed(2)} AU`;
    }
  }

  if (updateDistances) {
    this._lastDistanceUpdate = timestamp;
  }

  this._claimFarPlane(requiredFar * FAR_PLANE_PADDING);

  if (moving) {
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
  this._earth.spinning = false;
  this._releaseCamera();

  const scene = this._scene;
  if (!scene.isDestroyed()) {
    this._releaseFarPlane();

    const primitives = scene.primitives;
    primitives.remove(this._points);
    primitives.remove(this._labels);
    primitives.remove(this._orbits);
    this.planets.forEach(function (planet) {
      if (planet._drawn) {
        primitives.remove(planet._bodyPrimitive);
      }
    });
  }

  destroyObject(this);
};
export default SolarSystemViewModel;
