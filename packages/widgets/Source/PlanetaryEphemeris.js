import {
  Cartesian3,
  defined,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms,
} from "@cesium/engine";

const scratchSunPosition = new Cartesian3();
const scratchHeliocentric = new Cartesian3();
const scratchInertial = new Cartesian3();
const scratchIcrfToFixed = new Matrix3();

const AU_METERS = 149597870700;
// Obliquity of the J2000 ecliptic, in radians.
const OBLIQUITY = CesiumMath.toRadians(23.43928);

/**
 * Low-precision positions for the planets Cesium does not ship an ephemeris for.
 * {@link Simon1994PlanetaryPositions} only covers the Sun and the Moon, so planet
 * positions are evaluated here from JPL's approximate Keplerian elements.
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
 * The speed of light in a vacuum, in meters per second.
 * @type {number}
 */
PlanetaryEphemeris.SPEED_OF_LIGHT = 299792458;

/**
 * Keplerian elements and their per-century rates, valid 1800 AD - 2050 AD.
 * Source: "Keplerian Elements for Approximate Positions of the Major Planets",
 * E. M. Standish, JPL Solar System Dynamics. Semi-major axes are in AU and all
 * angles are in degrees.
 *
 * @type {object}
 */
PlanetaryEphemeris.MARS = {
  elements: {
    a: 1.52371034,
    e: 0.0933941,
    i: 1.84969142,
    meanLongitude: -4.55343205,
    longitudeOfPerihelion: -23.94362959,
    longitudeOfNode: 49.55953891,
  },
  rates: {
    a: 0.00001847,
    e: 0.00007882,
    i: -0.00813131,
    meanLongitude: 19140.30268499,
    longitudeOfPerihelion: 0.44441088,
    longitudeOfNode: -0.29257343,
  },
};

/**
 * @see PlanetaryEphemeris.MARS
 * @type {object}
 */
PlanetaryEphemeris.JUPITER = {
  elements: {
    a: 5.202887,
    e: 0.04838624,
    i: 1.30439695,
    meanLongitude: 34.39644051,
    longitudeOfPerihelion: 14.72847983,
    longitudeOfNode: 100.47390909,
  },
  rates: {
    a: -0.00011607,
    e: -0.00013253,
    i: -0.00183714,
    meanLongitude: 3034.74612775,
    longitudeOfPerihelion: 0.21252668,
    longitudeOfNode: 0.20469106,
  },
};

/**
 * Wraps an angle into the range [0, 360).
 *
 * @param {number} degrees The angle, in degrees.
 * @returns {number} The wrapped angle, in degrees.
 */
PlanetaryEphemeris.normalizeDegrees = function (degrees) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

/**
 * Converts an azimuth to the nearest of the eight principal compass points.
 *
 * @param {number} degrees The azimuth, in degrees clockwise from north.
 * @returns {string} The compass point, for example <code>"NE"</code>.
 */
PlanetaryEphemeris.compassLabel = function (degrees) {
  if (degrees >= 337.5 || degrees < 22.5) {
    return "N";
  }
  if (degrees < 67.5) {
    return "NE";
  }
  if (degrees < 112.5) {
    return "E";
  }
  if (degrees < 157.5) {
    return "SE";
  }
  if (degrees < 202.5) {
    return "S";
  }
  if (degrees < 247.5) {
    return "SW";
  }
  if (degrees < 292.5) {
    return "W";
  }
  return "NW";
};

/**
 * Solves Kepler's equation <code>M = E - e* sin(E)</code> by Newton iteration, where
 * <code>M</code> and <code>E</code> are in degrees and <code>e*</code> is the eccentricity
 * expressed in degrees.
 *
 * @param {number} meanAnomaly The mean anomaly, in degrees, in the range [-180, 180].
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
 * Computes the heliocentric position of a planet in the J2000 equatorial frame.
 * Accurate to roughly an arcminute over the 1800 AD - 2050 AD interval the elements
 * are fit to, which is well within the precision the planet widgets need.
 *
 * @param {object} planet One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the ephemeris.
 * @param {Cartesian3} result The object onto which to store the result, in meters.
 * @returns {Cartesian3} The modified result parameter.
 */
PlanetaryEphemeris.computeHeliocentricPosition = function (
  planet,
  date,
  result,
) {
  const centuries = (JulianDate.totalDays(date) - 2451545.0) / 36525.0;
  const base = planet.elements;
  const rates = planet.rates;

  const a = base.a + rates.a * centuries;
  const e = base.e + rates.e * centuries;
  const inclination = CesiumMath.toRadians(base.i + rates.i * centuries);
  const meanLongitude = base.meanLongitude + rates.meanLongitude * centuries;
  const longitudeOfPerihelion =
    base.longitudeOfPerihelion + rates.longitudeOfPerihelion * centuries;
  const longitudeOfNode =
    base.longitudeOfNode + rates.longitudeOfNode * centuries;

  const argumentOfPerihelion = CesiumMath.toRadians(
    longitudeOfPerihelion - longitudeOfNode,
  );
  const node = CesiumMath.toRadians(longitudeOfNode);

  let meanAnomaly = PlanetaryEphemeris.normalizeDegrees(
    meanLongitude - longitudeOfPerihelion,
  );
  if (meanAnomaly > 180.0) {
    meanAnomaly -= 360.0;
  }
  const eccentricAnomaly = CesiumMath.toRadians(solveKepler(meanAnomaly, e));

  // Position in the orbital plane, in AU.
  const xOrbital = a * (Math.cos(eccentricAnomaly) - e);
  const yOrbital = a * Math.sqrt(1.0 - e * e) * Math.sin(eccentricAnomaly);

  const cosArgument = Math.cos(argumentOfPerihelion);
  const sinArgument = Math.sin(argumentOfPerihelion);
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);

  // Rotate into the J2000 ecliptic frame.
  const xEcliptic =
    (cosArgument * cosNode - sinArgument * sinNode * cosInclination) *
      xOrbital +
    (-sinArgument * cosNode - cosArgument * sinNode * cosInclination) *
      yOrbital;
  const yEcliptic =
    (cosArgument * sinNode + sinArgument * cosNode * cosInclination) *
      xOrbital +
    (-sinArgument * sinNode + cosArgument * cosNode * cosInclination) *
      yOrbital;
  const zEcliptic =
    sinArgument * sinInclination * xOrbital +
    cosArgument * sinInclination * yOrbital;

  // Rotate the ecliptic frame onto the equator to match ICRF.
  result.x = xEcliptic * AU_METERS;
  result.y =
    (Math.cos(OBLIQUITY) * yEcliptic - Math.sin(OBLIQUITY) * zEcliptic) *
    AU_METERS;
  result.z =
    (Math.sin(OBLIQUITY) * yEcliptic + Math.cos(OBLIQUITY) * zEcliptic) *
    AU_METERS;
  return result;
};

/**
 * Computes the rotation from the Earth inertial frame to the Earth fixed frame,
 * falling back to the TEME approximation while the IAU data is still loading.
 *
 * @param {JulianDate} date The time at which to evaluate the transform.
 * @param {Matrix3} result The object onto which to store the result.
 * @returns {Matrix3|undefined} The modified result parameter, or <code>undefined</code>
 *          if neither transform is available.
 */
PlanetaryEphemeris.computeIcrfToFixedMatrix = function (date, result) {
  const icrfToFixed = Transforms.computeIcrfToFixedMatrix(date, result);
  if (defined(icrfToFixed)) {
    return icrfToFixed;
  }
  return Transforms.computeTemeToPseudoFixedMatrix(date, result);
};

/**
 * Computes the position of a planet relative to the Earth, in the Earth-centered,
 * Earth-fixed frame.
 *
 * @param {object} planet One of the element tables on this namespace.
 * @param {JulianDate} date The time at which to evaluate the ephemeris.
 * @param {Cartesian3} result The object onto which to store the result, in meters.
 * @returns {Cartesian3|undefined} The modified result parameter, or <code>undefined</code>
 *          if the inertial-to-fixed transform is unavailable.
 */
PlanetaryEphemeris.computeFixedPosition = function (planet, date, result) {
  const icrfToFixed = PlanetaryEphemeris.computeIcrfToFixedMatrix(
    date,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    return undefined;
  }

  // The Sun's geocentric position is the negated heliocentric position of the Earth,
  // so the planet relative to the Earth is its heliocentric position plus the Sun vector.
  const sunPosition =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      date,
      scratchSunPosition,
    );
  PlanetaryEphemeris.computeHeliocentricPosition(
    planet,
    date,
    scratchHeliocentric,
  );
  Cartesian3.add(scratchHeliocentric, sunPosition, scratchInertial);

  return Matrix3.multiplyByVector(icrfToFixed, scratchInertial, result);
};

/**
 * Computes the unit vector pointing at the Sun in the Earth-fixed frame. This is the
 * direction the renderer lights bodies with, so it also identifies which side of a
 * body is the lit one.
 *
 * @param {JulianDate} date The time at which to evaluate the direction.
 * @param {Cartesian3} result The object onto which to store the result.
 * @returns {Cartesian3|undefined} The modified result parameter, or <code>undefined</code>
 *          if the inertial-to-fixed transform is unavailable.
 */
PlanetaryEphemeris.computeSunFixedDirection = function (date, result) {
  const icrfToFixed = PlanetaryEphemeris.computeIcrfToFixedMatrix(
    date,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    return undefined;
  }

  Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    date,
    scratchSunPosition,
  );
  Matrix3.multiplyByVector(icrfToFixed, scratchSunPosition, result);
  return Cartesian3.normalize(result, result);
};

export default PlanetaryEphemeris;
