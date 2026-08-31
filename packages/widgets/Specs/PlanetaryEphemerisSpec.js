import {
  Cartesian3,
  IauOrientationAxes,
  IauOrientationParameters,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms,
} from "@cesium/engine";
import { PlanetaryEphemeris } from "../index.js";

describe("Widgets/PlanetaryEphemeris", function () {
  const AU = PlanetaryEphemeris.AU_METERS;
  const OBLIQUITY = CesiumMath.toRadians(23.43928);

  // Dates spread across the interval the elements are fit to.
  const dates = [
    "2000-01-01T12:00:00Z",
    "2025-08-25T00:00:00Z",
    "2049-06-15T18:00:00Z",
  ].map(function (iso8601) {
    return JulianDate.fromIso8601(iso8601);
  });

  const bodies = PlanetaryEphemeris.BODIES.concat([
    PlanetaryEphemeris.EARTH_MOON_BARYCENTER,
  ]);

  /**
   * @param {Cartesian3} position An equatorial position.
   * @returns {number} The position's ecliptic longitude, in degrees.
   */
  function eclipticLongitude(position) {
    const y =
      Math.cos(OBLIQUITY) * position.y + Math.sin(OBLIQUITY) * position.z;
    return CesiumMath.toDegrees(Math.atan2(y, position.x));
  }

  /**
   * @param {number} degrees An angle, in degrees.
   * @returns {number} The angle wrapped into [-180, 180).
   */
  function wrap(degrees) {
    const wrapped = degrees % 360.0;
    if (wrapped >= 180.0) {
      return wrapped - 360.0;
    }
    if (wrapped < -180.0) {
      return wrapped + 360.0;
    }
    return wrapped;
  }

  it("lists the seven planets other than the Earth, ordered outward", function () {
    expect(
      PlanetaryEphemeris.PLANETS.map(function (body) {
        return body.name;
      }),
    ).toEqual([
      "Mercury",
      "Venus",
      "Mars",
      "Jupiter",
      "Saturn",
      "Uranus",
      "Neptune",
    ]);
  });

  it("keeps Pluto out of the planets, as a dwarf planet", function () {
    expect(PlanetaryEphemeris.PLANETS).not.toContain(PlanetaryEphemeris.PLUTO);
    expect(PlanetaryEphemeris.DWARF_PLANETS).toEqual([
      PlanetaryEphemeris.PLUTO,
    ]);
  });

  it("keeps every body between its perihelion and its aphelion", function () {
    const position = new Cartesian3();
    bodies.forEach(function (body) {
      const elements = body.elements;
      // A percent of slack covers the drift in the elements over the interval.
      const perihelion = elements.a * (1.0 - elements.e) * AU * 0.99;
      const aphelion = elements.a * (1.0 + elements.e) * AU * 1.01;

      dates.forEach(function (date) {
        PlanetaryEphemeris.computeHeliocentricPosition(body, date, position);
        const distance = Cartesian3.magnitude(position);
        expect(distance).toBeGreaterThan(perihelion);
        expect(distance).toBeLessThan(aphelion);
      });
    });
  });

  it("puts every body within the equation of center of its mean longitude", function () {
    const position = new Cartesian3();
    bodies.forEach(function (body) {
      const eccentricity = body.elements.e;
      const halfInclination = CesiumMath.toRadians(
        body.elements.inclination * 0.5,
      );
      // The first three terms of the equation of center and the reduction to the
      // ecliptic, plus half a degree for the drift in the elements.
      const tolerance =
        CesiumMath.toDegrees(
          2.0 * eccentricity +
            1.25 * eccentricity * eccentricity +
            1.1 * eccentricity * eccentricity * eccentricity +
            Math.tan(halfInclination) * Math.tan(halfInclination),
        ) + 0.5;

      dates.forEach(function (date) {
        PlanetaryEphemeris.computeHeliocentricPosition(body, date, position);
        const centuries = (JulianDate.totalDays(date) - 2451545.0) / 36525.0;
        const meanLongitude =
          body.elements.meanLongitude + body.rates.meanLongitude * centuries;
        expect(
          Math.abs(wrap(eclipticLongitude(position) - meanLongitude)),
        ).toBeLessThan(tolerance);
      });
    });
  });

  it("agrees with Simon1994PlanetaryPositions about where the Earth is", function () {
    // Simon1994 is a far more accurate ephemeris, but it only knows about the Sun and
    // the Moon, which is why the planets are computed here in the first place. Its
    // Earth-Sun vector is the one thing the two share, so it pins down the frames,
    // the units and the direction of every rotation in this module.
    const barycenter = new Cartesian3();
    const earth = new Cartesian3();

    dates.forEach(function (date) {
      PlanetaryEphemeris.computeHeliocentricPosition(
        PlanetaryEphemeris.EARTH_MOON_BARYCENTER,
        date,
        barycenter,
      );
      Cartesian3.negate(
        Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
          date,
          earth,
        ),
        earth,
      );

      // The two disagree by the error in the approximate elements plus the offset
      // between the Earth and the Earth-Moon barycenter, which is 4700 km at most.
      expect(Cartesian3.distance(barycenter, earth)).toBeLessThan(0.0005 * AU);
    });
  });

  it("computes geocentric positions by shifting the origin to the Earth", function () {
    const heliocentric = new Cartesian3();
    const geocentric = new Cartesian3();
    const sun = new Cartesian3();
    const date = dates[1];

    PlanetaryEphemeris.PLANETS.forEach(function (body) {
      PlanetaryEphemeris.computeHeliocentricPosition(body, date, heliocentric);
      PlanetaryEphemeris.computeGeocentricPosition(body, date, geocentric);
      Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        date,
        sun,
      );

      expect(
        Cartesian3.subtract(geocentric, heliocentric, geocentric),
      ).toEqualEpsilon(sun, CesiumMath.EPSILON7);
    });
  });

  it("samples a closed orbit that stays between perihelion and aphelion", function () {
    const date = dates[1];
    bodies.forEach(function (body) {
      const samples = PlanetaryEphemeris.computeOrbitSamples(body, date, 36);
      expect(samples.length).toEqual(37);
      expect(samples[36]).toEqual(samples[0]);

      const elements = body.elements;
      samples.forEach(function (sample) {
        const distance = Cartesian3.magnitude(sample);
        expect(distance).toBeGreaterThan(
          elements.a * (1.0 - elements.e) * AU * 0.99,
        );
        expect(distance).toBeLessThan(
          elements.a * (1.0 + elements.e) * AU * 1.01,
        );
      });
    });
  });

  it("turns each body at its published rate, and the right way round", function () {
    // Rotation periods in days; negative for the retrograde rotators.
    const periods = {
      Mercury: 58.646,
      Earth: 0.99726968,
      Venus: -243.025,
      Mars: 1.02595676,
      Jupiter: 0.41354,
      Saturn: 0.44401,
      Uranus: -0.71833,
      Neptune: 0.67125,
      Pluto: 6.3872,
    };

    PlanetaryEphemeris.BODIES.forEach(function (body) {
      const period = PlanetaryEphemeris.computeRotationPeriod(body);
      const expected = periods[body.name];
      expect(period).toEqualEpsilon(expected, Math.abs(expected) * 0.001);
      expect(Math.sign(period)).toEqual(Math.sign(expected));
    });
  });

  it("points each body's pole so that its obliquity comes out right", function () {
    // The angle between the pole and the orbit's angular momentum. Measured from the
    // IAU north pole, so a retrograde rotator's is the supplement of the figure
    // usually quoted.
    const obliquities = {
      Mercury: 0.034,
      Earth: 23.44,
      Venus: 2.64,
      Mars: 25.19,
      Jupiter: 3.13,
      Saturn: 26.73,
      Uranus: 82.23,
      Neptune: 28.32,
      Pluto: 119.59,
    };
    const orientation = new IauOrientationParameters();

    PlanetaryEphemeris.BODIES.forEach(function (body) {
      PlanetaryEphemeris.computeOrientation(body, dates[0], orientation);
      const pole = new Cartesian3(
        Math.cos(orientation.declination) *
          Math.cos(orientation.rightAscension),
        Math.cos(orientation.declination) *
          Math.sin(orientation.rightAscension),
        Math.sin(orientation.declination),
      );

      const inclination = CesiumMath.toRadians(body.elements.inclination);
      const node = CesiumMath.toRadians(body.elements.longitudeOfNode);
      const y = -Math.sin(inclination) * Math.cos(node);
      const z = Math.cos(inclination);
      const normal = new Cartesian3(
        Math.sin(inclination) * Math.sin(node),
        Math.cos(OBLIQUITY) * y - Math.sin(OBLIQUITY) * z,
        Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z,
      );

      expect(
        CesiumMath.toDegrees(Math.acos(Cartesian3.dot(pole, normal))),
      ).toEqualEpsilon(obliquities[body.name], 0.05);
    });
  });

  it("sends every body round the Sun the way it really goes", function () {
    const eclipticNorth = new Cartesian3(
      0.0,
      -Math.sin(OBLIQUITY),
      Math.cos(OBLIQUITY),
    );

    PlanetaryEphemeris.BODIES.forEach(function (body) {
      const before = PlanetaryEphemeris.computeHeliocentricPosition(
        body,
        dates[1],
        new Cartesian3(),
      );
      const after = PlanetaryEphemeris.computeHeliocentricPosition(
        body,
        JulianDate.addSeconds(dates[1], 86400.0, new JulianDate()),
        new Cartesian3(),
      );

      // Every planet goes the same way round, which a sign slip anywhere in the
      // rotation out of the orbital plane would reverse.
      expect(
        Cartesian3.dot(
          Cartesian3.cross(before, after, new Cartesian3()),
          eclipticNorth,
        ),
      ).toBeGreaterThan(0.0);
    });
  });

  it("puts each planet opposite the Sun on its published opposition date", function () {
    // Opposition pins down where a planet is on its orbit, which the perihelion and
    // period checks cannot: they would all pass with the whole orbit rotated.
    const oppositions = {
      Mars: "2025-01-16",
      Jupiter: "2026-01-10",
      Saturn: "2025-09-21",
      Uranus: "2025-11-21",
      Neptune: "2025-09-23",
      Pluto: "2025-07-25",
    };

    Object.keys(oppositions).forEach(function (name) {
      const body = PlanetaryEphemeris.BODIES.filter(function (candidate) {
        return candidate.name === name;
      })[0];
      const date = JulianDate.fromIso8601(`${oppositions[name]}T00:00:00Z`);

      const planet = PlanetaryEphemeris.computeGeocentricPosition(
        body,
        date,
        new Cartesian3(),
      );
      const sun =
        Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
          date,
          new Cartesian3(),
        );

      // Opposition is defined on ecliptic longitude; the latitude is what keeps the
      // elongation itself a degree or two short of a straight line.
      const separation = Math.abs(
        wrap(eclipticLongitude(planet) - eclipticLongitude(sun)),
      );
      expect(separation).toEqualEpsilon(180.0, 0.6);
    });
  });

  it("agrees with Cesium about which way the Earth is facing", function () {
    // The engine's own Earth fixed frame is an independent implementation of the one
    // thing this module cannot check against itself: the phase of a body's spin.
    const axes = new IauOrientationAxes(function (date) {
      return PlanetaryEphemeris.computeOrientation(
        PlanetaryEphemeris.EARTH,
        date,
        new IauOrientationParameters(),
      );
    });

    dates.forEach(function (date) {
      const mine = axes.evaluate(date, new Matrix3());
      const cesium = new Matrix3();
      if (!Transforms.computeIcrfToFixedMatrix(date, cesium)) {
        Transforms.computeTemeToPseudoFixedMatrix(date, cesium);
      }

      // The angle of the rotation between the two frames. A wrong prime meridian
      // would be out by tens of degrees, and a wrong sense would swing with time.
      const difference = Matrix3.multiply(
        cesium,
        Matrix3.transpose(mine, new Matrix3()),
        new Matrix3(),
      );
      const angle = CesiumMath.toDegrees(
        Math.acos(
          CesiumMath.clamp(
            (difference[0] + difference[4] + difference[8] - 1.0) * 0.5,
            -1.0,
            1.0,
          ),
        ),
      );
      expect(angle).toBeLessThan(1.0);
    });
  });

  it("computes orbital periods", function () {
    expect(
      PlanetaryEphemeris.computeOrbitalPeriod(PlanetaryEphemeris.MERCURY),
    ).toEqualEpsilon(87.969, 0.01);
    expect(
      PlanetaryEphemeris.computeOrbitalPeriod(
        PlanetaryEphemeris.EARTH_MOON_BARYCENTER,
      ),
    ).toEqualEpsilon(365.256, 0.01);
    expect(
      PlanetaryEphemeris.computeOrbitalPeriod(PlanetaryEphemeris.NEPTUNE),
    ).toEqualEpsilon(60189.0, 10.0);
    // 247.9 years.
    expect(
      PlanetaryEphemeris.computeOrbitalPeriod(PlanetaryEphemeris.PLUTO),
    ).toEqualEpsilon(90553.0, 20.0);
  });
});
