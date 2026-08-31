import {
  Cartesian3,
  defined,
  JulianDate,
  Math as CesiumMath,
  Simon1994PlanetaryPositions,
} from "@cesium/engine";

const AU_METERS = 149597870700.0;
const DAYS_PER_CENTURY = 36525.0;
const J2000_JULIAN_DAY = 2451545.0;

// Obliquity of the J2000 ecliptic, used to rotate ecliptic coordinates onto the
// equatorial axes the rest of Cesium works in.
const OBLIQUITY = CesiumMath.toRadians(23.43928);
const COS_OBLIQUITY = Math.cos(OBLIQUITY);
const SIN_OBLIQUITY = Math.sin(OBLIQUITY);

const scratchSunPosition = new Cartesian3();

/**
 * Low precision positions for the planets Cesium does not ship an ephemeris for.
 * {@link Simon1994PlanetaryPositions} only covers the Sun and the Moon, so planet
 * positions are evaluated here from JPL's approximate Keplerian elements.
 *
 * <p>All positions are returned in the J2000 equatorial (ICRF aligned) frame, in
 * meters, and are accurate to roughly an arcminute over the 1800 AD - 2050 AD
 * interval the elements are fit to.</p>
 *
 * @namespace PlanetaryEphemeris
 *
 * @private
 */
const PlanetaryEphemeris = {};

/**
 * One astronomical unit, in meters.
 * @type {number}
 */
PlanetaryEphemeris.AU_METERS = AU_METERS;

/**
 * Keplerian elements and their per-century rates, valid 1800 AD - 2050 AD. Source:
 * "Keplerian Elements for Approximate Positions of the Major Planets", E. M. Standish,
 * JPL Solar System Dynamics. Semi-major axes are in AU, all angles are in degrees, and
 * all element rates are per Julian century. Radii are the IAU mean equatorial and polar
 * radii, in meters.
 *
 * <p>The orientation is the body's pole of rotation and prime meridian, from the IAU
 * Working Group on Cartographic Coordinates and Rotational Elements. The pole rates are
 * per Julian century, but the prime meridian rate is per day, and its sign is what makes
 * Venus and Uranus turn the other way. The small periodic terms some of the bodies carry
 * are left out; they are a few hundredths of a degree.</p>
 *
 * @type {object}
 */
PlanetaryEphemeris.MERCURY = {
  name: "Mercury",
  elements: {
    a: 0.38709927,
    e: 0.20563593,
    inclination: 7.00497902,
    meanLongitude: 252.2503235,
    longitudeOfPerihelion: 77.45779628,
    longitudeOfNode: 48.33076593,
  },
  rates: {
    a: 0.00000037,
    e: 0.00001906,
    inclination: -0.00594749,
    meanLongitude: 149472.67411175,
    longitudeOfPerihelion: 0.16047689,
    longitudeOfNode: -0.12534081,
  },
  radii: new Cartesian3(2439700.0, 2439700.0, 2439700.0),
  orientation: {
    rightAscension: 281.0103,
    rightAscensionRate: -0.0328,
    declination: 61.4155,
    declinationRate: -0.0049,
    primeMeridian: 329.5988,
    primeMeridianRate: 6.1385108,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.VENUS = {
  name: "Venus",
  elements: {
    a: 0.72333566,
    e: 0.00677672,
    inclination: 3.39467605,
    meanLongitude: 181.9790995,
    longitudeOfPerihelion: 131.60246718,
    longitudeOfNode: 76.67984255,
  },
  rates: {
    a: 0.0000039,
    e: -0.00004107,
    inclination: -0.0007889,
    meanLongitude: 58517.81538729,
    longitudeOfPerihelion: 0.00268329,
    longitudeOfNode: -0.27769418,
  },
  radii: new Cartesian3(6051800.0, 6051800.0, 6051800.0),
  orientation: {
    rightAscension: 272.76,
    rightAscensionRate: 0.0,
    declination: 67.16,
    declinationRate: 0.0,
    primeMeridian: 160.2,
    primeMeridianRate: -1.4813688,
  },
};

/**
 * The Earth-Moon barycenter. Nothing is drawn for it -- Cesium already knows where the
 * Earth is -- but it lets the ephemeris be checked against the far more accurate
 * {@link Simon1994PlanetaryPositions}.
 *
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.EARTH_MOON_BARYCENTER = {
  name: "Earth-Moon barycenter",
  elements: {
    a: 1.00000261,
    e: 0.01671123,
    inclination: -0.00001531,
    meanLongitude: 100.46457166,
    longitudeOfPerihelion: 102.93768193,
    longitudeOfNode: 0.0,
  },
  rates: {
    a: 0.00000562,
    e: -0.00004392,
    inclination: -0.01294668,
    meanLongitude: 35999.37244981,
    longitudeOfPerihelion: 0.32327364,
    longitudeOfNode: 0.0,
  },
};

/**
 * The Earth. It shares the barycenter's elements -- the two are never further apart
 * than 4700 km, which is nothing at the distances the widget draws at -- but carries
 * its own radii and its own pole.
 *
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.EARTH = {
  name: "Earth",
  elements: PlanetaryEphemeris.EARTH_MOON_BARYCENTER.elements,
  rates: PlanetaryEphemeris.EARTH_MOON_BARYCENTER.rates,
  radii: new Cartesian3(6378137.0, 6378137.0, 6356752.314245),
  orientation: {
    rightAscension: 0.0,
    rightAscensionRate: -0.641,
    declination: 90.0,
    declinationRate: -0.557,
    // A sidereal day, which is the turn the Earth makes against the stars.
    primeMeridian: 190.147,
    primeMeridianRate: 360.9856235,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.MARS = {
  name: "Mars",
  elements: {
    a: 1.52371034,
    e: 0.0933941,
    inclination: 1.84969142,
    meanLongitude: -4.55343205,
    longitudeOfPerihelion: -23.94362959,
    longitudeOfNode: 49.55953891,
  },
  rates: {
    a: 0.00001847,
    e: 0.00007882,
    inclination: -0.00813131,
    meanLongitude: 19140.30268499,
    longitudeOfPerihelion: 0.44441088,
    longitudeOfNode: -0.29257343,
  },
  radii: new Cartesian3(3396190.0, 3396190.0, 3376200.0),
  orientation: {
    rightAscension: 317.68143,
    rightAscensionRate: -0.1061,
    declination: 52.8865,
    declinationRate: -0.0609,
    primeMeridian: 176.63,
    primeMeridianRate: 350.89198226,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.JUPITER = {
  name: "Jupiter",
  elements: {
    a: 5.202887,
    e: 0.04838624,
    inclination: 1.30439695,
    meanLongitude: 34.39644051,
    longitudeOfPerihelion: 14.72847983,
    longitudeOfNode: 100.47390909,
  },
  rates: {
    a: -0.00011607,
    e: -0.00013253,
    inclination: -0.00183714,
    meanLongitude: 3034.74612775,
    longitudeOfPerihelion: 0.21252668,
    longitudeOfNode: 0.20469106,
  },
  radii: new Cartesian3(71492000.0, 71492000.0, 66854000.0),
  orientation: {
    rightAscension: 268.056595,
    rightAscensionRate: -0.006499,
    declination: 64.495303,
    declinationRate: 0.002413,
    primeMeridian: 284.95,
    primeMeridianRate: 870.536,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.SATURN = {
  name: "Saturn",
  elements: {
    a: 9.53667594,
    e: 0.05386179,
    inclination: 2.48599187,
    meanLongitude: 49.95424423,
    longitudeOfPerihelion: 92.59887831,
    longitudeOfNode: 113.66242448,
  },
  rates: {
    a: -0.0012506,
    e: -0.00050991,
    inclination: 0.00193609,
    meanLongitude: 1222.49362201,
    longitudeOfPerihelion: -0.41897216,
    longitudeOfNode: -0.28867794,
  },
  radii: new Cartesian3(60268000.0, 60268000.0, 54364000.0),
  orientation: {
    rightAscension: 40.589,
    rightAscensionRate: -0.036,
    declination: 83.537,
    declinationRate: -0.004,
    primeMeridian: 38.9,
    primeMeridianRate: 810.7939024,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.URANUS = {
  name: "Uranus",
  elements: {
    a: 19.18916464,
    e: 0.04725744,
    inclination: 0.77263783,
    meanLongitude: 313.23810451,
    longitudeOfPerihelion: 170.9542763,
    longitudeOfNode: 74.01692503,
  },
  rates: {
    a: -0.00196176,
    e: -0.00004397,
    inclination: -0.00242939,
    meanLongitude: 428.48202785,
    longitudeOfPerihelion: 0.40805281,
    longitudeOfNode: 0.04240589,
  },
  radii: new Cartesian3(25559000.0, 25559000.0, 24973000.0),
  orientation: {
    rightAscension: 257.311,
    rightAscensionRate: 0.0,
    declination: -15.175,
    declinationRate: 0.0,
    primeMeridian: 203.81,
    primeMeridianRate: -501.1600928,
  },
};

/**
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.NEPTUNE = {
  name: "Neptune",
  elements: {
    a: 30.06992276,
    e: 0.00859048,
    inclination: 1.77004347,
    meanLongitude: -55.12002969,
    longitudeOfPerihelion: 44.96476227,
    longitudeOfNode: 131.78422574,
  },
  rates: {
    a: 0.00026291,
    e: 0.00005105,
    inclination: 0.00035372,
    meanLongitude: 218.45945325,
    longitudeOfPerihelion: -0.32241464,
    longitudeOfNode: -0.00508664,
  },
  radii: new Cartesian3(24764000.0, 24764000.0, 24341000.0),
  orientation: {
    rightAscension: 299.36,
    rightAscensionRate: 0.0,
    declination: 43.46,
    declinationRate: 0.0,
    primeMeridian: 253.18,
    primeMeridianRate: 536.3128492,
    // Half a degree of pole wander, which is more than the accuracy of everything
    // else here, so unlike the other bodies' periodic terms it is kept.
    libration: {
      argument: 357.85,
      argumentRate: 52.316,
      rightAscension: 0.7,
      declination: -0.51,
      primeMeridian: -0.48,
    },
  },
};

/**
 * Pluto, a dwarf planet rather than a planet since 2006, which is why it is kept out
 * of {@link PlanetaryEphemeris.PLANETS}. Its elements come from the same JPL table.
 * The radius is the one New Horizons measured in 2015.
 *
 * @see PlanetaryEphemeris.MERCURY
 * @type {object}
 */
PlanetaryEphemeris.PLUTO = {
  name: "Pluto",
  elements: {
    a: 39.48211675,
    e: 0.2488273,
    inclination: 17.14001206,
    meanLongitude: 238.92903833,
    longitudeOfPerihelion: 224.06891629,
    longitudeOfNode: 110.30393684,
  },
  rates: {
    a: -0.00031596,
    e: 0.0000517,
    inclination: 0.00004818,
    meanLongitude: 145.20780515,
    longitudeOfPerihelion: -0.04062942,
    longitudeOfNode: -0.01183482,
  },
  radii: new Cartesian3(1188300.0, 1188300.0, 1188300.0),
  orientation: {
    rightAscension: 132.993,
    rightAscensionRate: 0.0,
    declination: -6.163,
    declinationRate: 0.0,
    primeMeridian: 302.695,
    primeMeridianRate: 56.3625225,
  },
};

/**
 * Every planet other than the Earth, ordered outward from the Sun.
 *
 * @type {object[]}
 */
PlanetaryEphemeris.PLANETS = Object.freeze([
  PlanetaryEphemeris.MERCURY,
  PlanetaryEphemeris.VENUS,
  PlanetaryEphemeris.MARS,
  PlanetaryEphemeris.JUPITER,
  PlanetaryEphemeris.SATURN,
  PlanetaryEphemeris.URANUS,
  PlanetaryEphemeris.NEPTUNE,
]);

/**
 * The dwarf planets this module has elements for, ordered outward from the Sun.
 *
 * @type {object[]}
 */
PlanetaryEphemeris.DWARF_PLANETS = Object.freeze([PlanetaryEphemeris.PLUTO]);

/**
 * Everything this module can draw, the Earth included, ordered outward from the Sun.
 *
 * @type {object[]}
 */
PlanetaryEphemeris.BODIES = Object.freeze([
  PlanetaryEphemeris.MERCURY,
  PlanetaryEphemeris.VENUS,
  PlanetaryEphemeris.EARTH,
  PlanetaryEphemeris.MARS,
  PlanetaryEphemeris.JUPITER,
  PlanetaryEphemeris.SATURN,
  PlanetaryEphemeris.URANUS,
  PlanetaryEphemeris.NEPTUNE,
  PlanetaryEphemeris.PLUTO,
]);

/**
 * Wraps an angle into the range [-180, 180).
 *
 * @param {number} degrees The angle, in degrees.
 * @returns {number} The wrapped angle, in degrees.
 *
 * @private
 */
function wrapToHalfTurn(degrees) {
  const wrapped = degrees % 360.0;
  if (wrapped >= 180.0) {
    return wrapped - 360.0;
  }
  if (wrapped < -180.0) {
    return wrapped + 360.0;
  }
  return wrapped;
}

/**
 * Solves Kepler's equation <code>M = E - e* sin(E)</code> by Newton iteration, where
 * <code>M</code> and <code>E</code> are in degrees and <code>e*</code> is the
 * eccentricity expressed in degrees.
 *
 * @param {number} meanAnomaly The mean anomaly, in degrees, in the range [-180, 180).
 * @param {number} eccentricity The orbital eccentricity.
 * @returns {number} The eccentric anomaly, in degrees.
 *
 * @private
 */
function solveKepler(meanAnomaly, eccentricity) {
  const eccentricityDegrees = CesiumMath.toDegrees(eccentricity);
  let eccentricAnomaly =
    meanAnomaly +
    eccentricityDegrees * Math.sin(CesiumMath.toRadians(meanAnomaly));

  for (let i = 0; i < 12; ++i) {
    const radians = CesiumMath.toRadians(eccentricAnomaly);
    const deltaMeanAnomaly =
      meanAnomaly -
      (eccentricAnomaly - eccentricityDegrees * Math.sin(radians));
    const deltaEccentricAnomaly =
      deltaMeanAnomaly / (1.0 - eccentricity * Math.cos(radians));
    eccentricAnomaly += deltaEccentricAnomaly;
    if (Math.abs(deltaEccentricAnomaly) < 1e-9) {
      break;
    }
  }

  return eccentricAnomaly;
}

/**
 * Evaluates a body's osculating elements at a given time. Angles are returned in
 * radians and the semi-major axis in meters.
 *
 * @param {object} body One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the elements.
 * @returns {object} The evaluated elements.
 *
 * @private
 */
function evaluateElements(body, date) {
  const centuries =
    (JulianDate.totalDays(date) - J2000_JULIAN_DAY) / DAYS_PER_CENTURY;
  const elements = body.elements;
  const rates = body.rates;

  const meanLongitude =
    elements.meanLongitude + rates.meanLongitude * centuries;
  const longitudeOfPerihelion =
    elements.longitudeOfPerihelion + rates.longitudeOfPerihelion * centuries;
  const longitudeOfNode =
    elements.longitudeOfNode + rates.longitudeOfNode * centuries;

  return {
    semiMajorAxis:
      (elements.a + rates.a * centuries) * PlanetaryEphemeris.AU_METERS,
    eccentricity: elements.e + rates.e * centuries,
    inclination: CesiumMath.toRadians(
      elements.inclination + rates.inclination * centuries,
    ),
    longitudeOfNode: CesiumMath.toRadians(longitudeOfNode),
    argumentOfPerihelion: CesiumMath.toRadians(
      longitudeOfPerihelion - longitudeOfNode,
    ),
    meanAnomaly: wrapToHalfTurn(meanLongitude - longitudeOfPerihelion),
  };
}

/**
 * Rotates a point given in the orbital plane, with <code>x</code> toward perihelion,
 * onto the J2000 equatorial axes.
 *
 * @param {number} x The distance along the perihelion axis, in meters.
 * @param {number} y The distance along the in-plane axis 90 degrees ahead of perihelion, in meters.
 * @param {object} elements Elements as returned by <code>evaluateElements</code>.
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3} The modified result parameter.
 *
 * @private
 */
function orbitalPlaneToEquatorial(x, y, elements, result) {
  const cosArgument = Math.cos(elements.argumentOfPerihelion);
  const sinArgument = Math.sin(elements.argumentOfPerihelion);
  const cosNode = Math.cos(elements.longitudeOfNode);
  const sinNode = Math.sin(elements.longitudeOfNode);
  const cosInclination = Math.cos(elements.inclination);
  const sinInclination = Math.sin(elements.inclination);

  const eclipticX =
    (cosArgument * cosNode - sinArgument * sinNode * cosInclination) * x +
    (-sinArgument * cosNode - cosArgument * sinNode * cosInclination) * y;
  const eclipticY =
    (cosArgument * sinNode + sinArgument * cosNode * cosInclination) * x +
    (-sinArgument * sinNode + cosArgument * cosNode * cosInclination) * y;
  const eclipticZ =
    sinArgument * sinInclination * x + cosArgument * sinInclination * y;

  result.x = eclipticX;
  result.y = COS_OBLIQUITY * eclipticY - SIN_OBLIQUITY * eclipticZ;
  result.z = SIN_OBLIQUITY * eclipticY + COS_OBLIQUITY * eclipticZ;
  return result;
}

/**
 * Computes the position of a body relative to the Sun, in the J2000 equatorial frame.
 *
 * @param {object} body One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the ephemeris.
 * @param {Cartesian3} result The object onto which to store the result, in meters.
 * @returns {Cartesian3} The modified result parameter.
 */
PlanetaryEphemeris.computeHeliocentricPosition = function (body, date, result) {
  const elements = evaluateElements(body, date);
  const eccentricity = elements.eccentricity;
  const eccentricAnomaly = CesiumMath.toRadians(
    solveKepler(elements.meanAnomaly, eccentricity),
  );

  const semiMajorAxis = elements.semiMajorAxis;
  const x = semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity);
  const y =
    semiMajorAxis *
    Math.sqrt(1.0 - eccentricity * eccentricity) *
    Math.sin(eccentricAnomaly);

  return orbitalPlaneToEquatorial(x, y, elements, result);
};

/**
 * Computes the position of a body relative to the Earth, in the J2000 equatorial
 * (inertial) frame. Multiply the result by
 * {@link Transforms.computeIcrfToFixedMatrix} to draw it in world coordinates.
 *
 * @param {object} body One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the ephemeris.
 * @param {Cartesian3} result The object onto which to store the result, in meters.
 * @returns {Cartesian3} The modified result parameter.
 */
PlanetaryEphemeris.computeGeocentricPosition = function (body, date, result) {
  // The Sun's position relative to the Earth is also the Earth's position relative to
  // the Sun, negated, so adding it shifts the origin from the Sun to the Earth.
  const sunPosition =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      date,
      scratchSunPosition,
    );
  PlanetaryEphemeris.computeHeliocentricPosition(body, date, result);
  return Cartesian3.add(result, sunPosition, result);
};

/**
 * Samples one full revolution of a body's orbit, relative to the Sun, in the J2000
 * equatorial frame. The elements are evaluated once, at <code>date</code>, so the
 * samples describe the orbit the body is currently on rather than the path it
 * actually sweeps out over a full period.
 *
 * @param {object} body One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the elements.
 * @param {number} count The number of samples to take around the orbit.
 * @returns {Cartesian3[]} <code>count + 1</code> positions, in meters, the last of which repeats the first so the loop is closed.
 */
PlanetaryEphemeris.computeOrbitSamples = function (body, date, count) {
  const elements = evaluateElements(body, date);
  const semiMajorAxis = elements.semiMajorAxis;
  const eccentricity = elements.eccentricity;
  const semiMinorAxis =
    semiMajorAxis * Math.sqrt(1.0 - eccentricity * eccentricity);

  const positions = new Array(count + 1);
  for (let i = 0; i < count; ++i) {
    const eccentricAnomaly = (CesiumMath.TWO_PI * i) / count;
    positions[i] = orbitalPlaneToEquatorial(
      semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
      semiMinorAxis * Math.sin(eccentricAnomaly),
      elements,
      new Cartesian3(),
    );
  }
  positions[count] = Cartesian3.clone(positions[0], new Cartesian3());

  return positions;
};

/**
 * Computes a body's orientation, in the form {@link IauOrientationAxes} takes.
 *
 * @param {object} body One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the orientation.
 * @param {IauOrientationParameters} result The object onto which to store the result.
 * @returns {IauOrientationParameters} The modified result parameter.
 */
PlanetaryEphemeris.computeOrientation = function (body, date, result) {
  const days = JulianDate.totalDays(date) - J2000_JULIAN_DAY;
  const orientation = body.orientation;
  const centuries = days / DAYS_PER_CENTURY;

  let rightAscension =
    orientation.rightAscension + orientation.rightAscensionRate * centuries;
  let declination =
    orientation.declination + orientation.declinationRate * centuries;
  let primeMeridian =
    orientation.primeMeridian + orientation.primeMeridianRate * days;

  const libration = orientation.libration;
  if (defined(libration)) {
    const argument = CesiumMath.toRadians(
      libration.argument + libration.argumentRate * centuries,
    );
    rightAscension += libration.rightAscension * Math.sin(argument);
    declination += libration.declination * Math.cos(argument);
    primeMeridian += libration.primeMeridian * Math.sin(argument);
  }

  result.rightAscension = CesiumMath.toRadians(rightAscension);
  result.declination = CesiumMath.toRadians(declination);
  result.rotation = CesiumMath.toRadians(primeMeridian);
  return result;
};

/**
 * Computes how long a body takes to turn once on its axis. The sign follows the
 * direction of rotation, so a retrograde body has a negative period.
 *
 * @param {object} body One of the element tables on this namespace.
 * @returns {number} The rotation period, in days.
 */
PlanetaryEphemeris.computeRotationPeriod = function (body) {
  return 360.0 / body.orientation.primeMeridianRate;
};

/**
 * Computes how long a body takes to orbit the Sun, from the rate its mean longitude
 * advances.
 *
 * @param {object} body One of the element tables on this namespace.
 * @returns {number} The orbital period, in days.
 */
PlanetaryEphemeris.computeOrbitalPeriod = function (body) {
  return (360.0 * DAYS_PER_CENTURY) / body.rates.meanLongitude;
};

export default PlanetaryEphemeris;
