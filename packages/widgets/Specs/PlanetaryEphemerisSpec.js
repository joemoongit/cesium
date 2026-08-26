import {
  Cartesian3,
  JulianDate,
  Math as CesiumMath,
  Simon1994PlanetaryPositions,
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

  const bodies = PlanetaryEphemeris.PLANETS.concat(
    PlanetaryEphemeris.DWARF_PLANETS,
    [PlanetaryEphemeris.EARTH_MOON_BARYCENTER],
  );

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
