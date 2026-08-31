import {
  Cartesian3,
  Clock,
  ClockStep,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  SceneMode,
  Simon1994PlanetaryPositions,
  Transforms,
} from "@cesium/engine";

import { PlanetaryEphemeris, SolarSystemViewModel } from "../../index.js";

import createScene from "../../../../Specs/createScene.js";

describe(
  "Widgets/SolarSystem/SolarSystemViewModel",
  function () {
    let scene;
    let clock;

    beforeEach(function () {
      scene = createScene();
      clock = new Clock({
        currentTime: JulianDate.fromIso8601("2025-08-25T00:00:00Z"),
        shouldAnimate: false,
      });
    });

    afterEach(function () {
      scene.destroyForSpecs();
    });

    /**
     * The Earth and the fixed frame stay on the clock while a planet is carried
     * ahead of it, so only the heliocentric term takes the offset.
     *
     * @param {object} planet A planet view model.
     * @param {JulianDate} date The current time.
     * @param {number} [offsetSeconds=0] The planet's orbital offset.
     * @returns {Cartesian3} Where the planet belongs, in the Earth fixed frame.
     */
    function expectedPosition(planet, date, offsetSeconds) {
      const icrfToFixed = new Matrix3();
      if (!Transforms.computeIcrfToFixedMatrix(date, icrfToFixed)) {
        Transforms.computeTemeToPseudoFixedMatrix(date, icrfToFixed);
      }

      const position = PlanetaryEphemeris.computeHeliocentricPosition(
        planet._body,
        JulianDate.addSeconds(date, offsetSeconds ?? 0.0, new JulianDate()),
        new Cartesian3(),
      );
      Cartesian3.add(
        position,
        Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
          date,
          new Cartesian3(),
        ),
        position,
      );
      return Matrix3.multiplyByVector(icrfToFixed, position, position);
    }

    it("can construct and destroy", function () {
      const primitiveCount = scene.primitives.length;

      const viewModel = new SolarSystemViewModel(scene, clock);
      expect(viewModel.scene).toBe(scene);
      expect(viewModel.clock).toBe(clock);
      expect(viewModel.dropDownVisible).toEqual(false);
      expect(scene.preUpdate.numberOfListeners).toEqual(1);
      // The point, label, orbit and asteroid collections, plus one body per row --
      // but nothing for the Earth, which Cesium draws itself, and nothing for the
      // belt, which draws a cloud instead.
      expect(scene.primitives.length).toEqual(primitiveCount + 12);

      viewModel.destroy();
      expect(viewModel.isDestroyed()).toEqual(true);
      expect(scene.preUpdate.numberOfListeners).toEqual(0);
      expect(scene.primitives.length).toEqual(primitiveCount);
    });

    it("constructor throws without a scene", function () {
      expect(function () {
        return new SolarSystemViewModel(undefined, clock);
      }).toThrowDeveloperError();
    });

    it("constructor throws without a clock", function () {
      expect(function () {
        return new SolarSystemViewModel(scene, undefined);
      }).toThrowDeveloperError();
    });

    it("has a row for each planet, the Earth and Pluto included", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      expect(
        viewModel.planets.map(function (planet) {
          return planet.name;
        }),
      ).toEqual([
        "Mercury",
        "Venus",
        "Earth",
        "Mars",
        "Asteroid belt",
        "Jupiter",
        "Saturn",
        "Uranus",
        "Neptune",
        "Pluto",
      ]);
      expect(viewModel.planets[9].description).toContain("a dwarf planet");
      viewModel.planets.forEach(function (planet) {
        expect(planet.orbiting).toEqual(false);
        expect(planet.colorCss).toMatch(/^#[0-9a-f]{6}$/);
      });

      viewModel.destroy();
    });

    it("scales each speed slider to its own body", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      viewModel.planets.forEach(function (planet) {
        const periods = {
          orbit: PlanetaryEphemeris.computeOrbitalPeriod(planet._body),
          spin: PlanetaryEphemeris.computeRotationPeriod(planet._body),
        };

        ["orbit", "spin"].forEach(function (prefix) {
          const value = `${prefix}SpeedSliderValue`;
          const speed = `${prefix}Speed`;
          const seconds = Math.abs(periods[prefix]) * 86400.0;

          // Every slider starts at 1x however slow the body is.
          planet[value] = 0;
          expect(planet[speed]).toEqual(1);
          expect(planet[`${prefix}SpeedText`]).toEqual("1x");

          // A minute a revolution to begin with, four seconds at the top, whether it
          // is Mercury's 88 day year or Pluto's 248 year one.
          planet[value] = viewModel.speedSliderMaximum;
          expect(seconds / planet[speed]).toEqualEpsilon(4.0, 0.4);

          // The range input reports its value as a string.
          planet[value] = "0";
          expect(planet[speed]).toEqual(1);
        });
      });

      // Which means the ceilings differ by orders of magnitude between bodies.
      const mercury = viewModel.planets[0];
      const pluto = viewModel.planets[9];
      mercury.orbitSpeedSliderValue = viewModel.speedSliderMaximum;
      pluto.orbitSpeedSliderValue = viewModel.speedSliderMaximum;
      expect(pluto.orbitSpeed / mercury.orbitSpeed).toBeGreaterThan(100.0);

      viewModel.destroy();
    });

    it("starts every planet at a minute a revolution", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      viewModel.planets.forEach(function (planet) {
        const orbit =
          PlanetaryEphemeris.computeOrbitalPeriod(planet._body) * 86400.0;
        const spin = Math.abs(
          PlanetaryEphemeris.computeRotationPeriod(planet._body) * 86400.0,
        );
        expect(orbit / planet.orbitSpeed).toEqualEpsilon(60.0, 6.0);
        expect(spin / planet.spinSpeed).toEqualEpsilon(60.0, 6.0);
      });

      viewModel.destroy();
    });

    it("keeps the orbit and spin speeds apart", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[5];
      const time = clock.currentTime;

      planet.orbitSpeedSliderValue = 0;
      planet.spinSpeedSliderValue = viewModel.speedSliderMaximum;
      expect(planet.orbitSpeed).toEqual(1);
      expect(planet.spinSpeed).toBeGreaterThan(1000);

      planet.orbiting = true;
      planet.spinning = true;
      viewModel._update(time);
      const orbitBefore = planet._offsetSeconds;
      const spinBefore = planet._spinSeconds;
      viewModel._update(time);

      // The spin ran on far faster than the orbit, each at its own slider's rate.
      const orbited = planet._offsetSeconds - orbitBefore;
      const spun = planet._spinSeconds - spinBefore;
      expect(spun / orbited).toEqualEpsilon(planet.spinSpeed, 1.0);
      expect(orbited).toBeGreaterThan(0.0);

      viewModel.destroy();
    });

    it("orbits the real Earth by carrying the observer, drawing nothing of its own", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const earth = viewModel.planets[2];
      const time = clock.currentTime;
      expect(earth.name).toEqual("Earth");

      // Cesium's globe is the Earth, so the widget adds no body, marker or label for
      // it, and it cannot be spun: the globe's rotation is the fixed frame itself.
      expect(earth._drawn).toEqual(false);
      expect(earth._bodyPrimitive).toBeUndefined();

      viewModel._update(time);
      expect(earth.position).toEqual(Cartesian3.ZERO);

      // Half a year round its orbit puts the observer on the far side of the Sun, so
      // every other planet's apparent position moves by the width of Earth's orbit.
      const before = viewModel.planets.map(function (planet) {
        return Cartesian3.clone(planet.position);
      });
      earth._offsetSeconds = 182.6 * 86400.0;
      viewModel._update(time);

      expect(earth.position).toEqual(Cartesian3.ZERO);
      viewModel.planets.forEach(function (planet, index) {
        if (planet === earth) {
          return;
        }
        expect(
          Cartesian3.distance(planet.position, before[index]) /
            PlanetaryEphemeris.AU_METERS,
        ).toEqualEpsilon(2.0, 0.05);
      });

      viewModel.destroy();
    });

    it("allSpinning starts and stops every planet", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      expect(viewModel.allSpinning).toEqual(false);
      viewModel.allSpinning = true;
      expect(
        viewModel.planets.every(function (planet) {
          return planet.spinning;
        }),
      ).toEqual(true);
      // The two group toggles are independent.
      expect(viewModel.allOrbiting).toEqual(false);

      viewModel.planets[7].spinning = false;
      expect(viewModel.allSpinning).toEqual(false);

      viewModel.allSpinning = false;
      expect(
        viewModel.planets.some(function (planet) {
          return planet.spinning;
        }),
      ).toEqual(false);

      viewModel.destroy();
    });

    it("allOrbiting starts and stops every planet", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      expect(viewModel.allOrbiting).toEqual(false);
      viewModel.allOrbiting = true;
      expect(
        viewModel.planets.every(function (planet) {
          return planet.orbiting;
        }),
      ).toEqual(true);

      viewModel.planets[3].orbiting = false;
      expect(viewModel.allOrbiting).toEqual(false);
      // The Earth is in the group with the rest of them.
      expect(viewModel.planets[2].orbiting).toEqual(true);

      viewModel.allOrbiting = false;
      expect(
        viewModel.planets.some(function (planet) {
          return planet.orbiting;
        }),
      ).toEqual(false);

      viewModel.destroy();
    });

    it("draws each planet where the ephemeris says it is", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      viewModel._update(clock.currentTime);

      viewModel.planets.forEach(function (planet) {
        const expected = expectedPosition(planet, clock.currentTime);
        expect(planet.position).toEqualEpsilon(expected, CesiumMath.EPSILON7);
        expect(planet._point.position).toEqualEpsilon(
          expected,
          CesiumMath.EPSILON7,
        );
        expect(planet._bodyPrimitive.show).toEqual(true);
      });

      viewModel.destroy();
    });

    it("carries an orbiting planet forward in time, and resetPositions brings it back", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      const time = clock.currentTime;

      // A tenth of a Martian year, far enough around the orbit to be unambiguous.
      const offset =
        PlanetaryEphemeris.computeOrbitalPeriod(planet._body) * 8640.0;
      planet._offsetSeconds = offset;
      viewModel._update(time);

      const advanced = expectedPosition(planet, time, offset);
      expect(planet.position).toEqualEpsilon(advanced, CesiumMath.EPSILON7);
      expect(
        Cartesian3.distance(planet.position, expectedPosition(planet, time)),
      ).toBeGreaterThan(1.0e10);

      viewModel.resetPositions();
      viewModel._update(time);
      expect(planet.position).toEqualEpsilon(
        expectedPosition(planet, time),
        CesiumMath.EPSILON7,
      );

      viewModel.destroy();
    });

    it("leaves a stopped planet where it was carried to", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      const time = clock.currentTime;

      // Stand in for having had the planet orbiting for a while.
      planet.orbiting = true;
      planet._offsetSeconds = 30.0 * 86400.0;
      viewModel._update(time);
      const carriedTo = Cartesian3.clone(planet.position);
      const carriedBy = planet._offsetSeconds;

      planet.orbiting = false;
      viewModel._update(time);
      viewModel._update(time);

      // It stays where it was carried to rather than snapping back, and stops moving.
      expect(planet._offsetSeconds).toEqual(carriedBy);
      expect(planet.position).toEqual(carriedTo);
      expect(planet.position).toEqualEpsilon(
        expectedPosition(planet, time, carriedBy),
        CesiumMath.EPSILON7,
      );
      expect(
        Cartesian3.distance(planet.position, expectedPosition(planet, time)),
      ).toBeGreaterThan(1.0e10);

      viewModel.destroy();
    });

    it("flies to where a planet will be when the flight lands", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      const time = clock.currentTime;
      spyOn(scene.camera, "flyToBoundingSphere");

      planet.orbitSpeedSliderValue = viewModel.speedSliderMaximum;
      planet.orbiting = true;
      viewModel._update(time);

      planet.flyTo();

      const call = scene.camera.flyToBoundingSphere.calls.mostRecent().args;
      const duration = call[1].duration;
      expect(duration).toBeGreaterThan(0.0);
      // Where the planet gets to over the course of the flight, not where it is now.
      expect(call[0].center).toEqualEpsilon(
        expectedPosition(
          planet,
          time,
          planet._offsetSeconds + planet.orbitSpeed * duration,
        ),
        CesiumMath.EPSILON7,
      );
      expect(
        Cartesian3.distance(call[0].center, planet.position),
      ).toBeGreaterThan(planet._body.radii.x);

      viewModel.destroy();
    });

    it("flies to a stopped planet where it was carried to", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      const time = clock.currentTime;
      spyOn(scene.camera, "flyToBoundingSphere");

      planet._offsetSeconds = 30.0 * 86400.0;
      planet.orbiting = false;
      viewModel._update(time);

      planet.flyTo();

      // A planet that is not moving is exactly where the flight should land.
      const sphere =
        scene.camera.flyToBoundingSphere.calls.mostRecent().args[0];
      expect(sphere.center).toEqualEpsilon(
        planet.position,
        CesiumMath.EPSILON7,
      );
      expect(sphere.radius).toEqual(planet._body.radii.x);

      viewModel.destroy();
    });

    it("locks the camera onto the planet once the flight lands, and lets it go again", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      spyOn(scene.camera, "flyToBoundingSphere").and.callFake(
        function (boundingSphere, options) {
          options.complete();
        },
      );

      viewModel._update(clock.currentTime);
      expect(planet.tracking).toEqual(false);
      expect(planet.flyToText).toEqual("Fly to");

      planet.flyTo();
      expect(planet.tracking).toEqual(true);
      expect(planet.flyToText).toEqual("Release");
      expect(viewModel.trackedPlanet).toBe(planet);
      expect(scene.camera.transform).not.toEqual(Matrix4.IDENTITY);
      // The one that draws the planets, and the one that follows this planet.
      expect(scene.postUpdate.numberOfListeners).toEqual(1);
      expect(scene.preUpdate.numberOfListeners).toEqual(1);

      // The same button lets the camera go again.
      planet.flyTo();
      expect(planet.tracking).toEqual(false);
      expect(viewModel.trackedPlanet).toBeUndefined();
      expect(scene.camera.transform).toEqual(Matrix4.IDENTITY);
      expect(scene.postUpdate.numberOfListeners).toEqual(0);

      viewModel.destroy();
    });

    it("keeps the camera with a planet that is still orbiting", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];
      const time = clock.currentTime;

      viewModel._update(time);
      viewModel._startTracking(planet);
      const cameraToPlanet = Cartesian3.subtract(
        scene.camera.positionWC,
        planet.position,
        new Cartesian3(),
      );

      // Carry the planet a long way around its orbit and let the camera follow.
      planet._offsetSeconds = 60.0 * 86400.0;
      viewModel._update(time);
      scene.postUpdate.raiseEvent(scene, time);

      expect(
        Cartesian3.subtract(
          scene.camera.positionWC,
          planet.position,
          new Cartesian3(),
        ),
      ).toEqualEpsilon(cameraToPlanet, CesiumMath.EPSILON7);

      viewModel.destroy();
    });

    it("lets the camera go when it stops drawing the planets", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];

      viewModel._update(clock.currentTime);
      viewModel._startTracking(planet);
      expect(planet.tracking).toEqual(true);

      scene.mode = SceneMode.COLUMBUS_VIEW;
      viewModel._update(clock.currentTime);
      expect(planet.tracking).toEqual(false);
      expect(scene.camera.transform).toEqual(Matrix4.IDENTITY);

      scene.mode = SceneMode.SCENE3D;
      viewModel.destroy();
    });

    it("lets the camera go when it is destroyed", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[3];

      viewModel._update(clock.currentTime);
      viewModel._startTracking(planet);
      const minimumZoomDistance =
        scene.screenSpaceCameraController.minimumZoomDistance;
      expect(minimumZoomDistance).toBeGreaterThan(planet._body.radii.x);

      viewModel.destroy();
      expect(scene.camera.transform).toEqual(Matrix4.IDENTITY);
      expect(scene.postUpdate.numberOfListeners).toEqual(0);
      expect(
        scene.screenSpaceCameraController.minimumZoomDistance,
      ).toBeLessThan(minimumZoomDistance);
    });

    it("turns a planet on its axis without moving it along its orbit", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[5];
      const time = clock.currentTime;

      viewModel._update(time);
      expect(planet.spinning).toEqual(false);
      expect(planet._spinSeconds).toEqual(0.0);
      // Plain while it is not spinning, banded while it is, so the turn can be seen.
      expect(planet._bodyPrimitive.material.type).toEqual("Color");

      planet.spinning = true;
      expect(planet._bodyPrimitive.material.type).toEqual("Stripe");

      // Stand in for having spun for a while, then check the orbit stayed put.
      const position = Cartesian3.clone(planet.position);
      planet._spinSeconds = 3.0 * 3600.0;
      viewModel._update(time);
      expect(planet._offsetSeconds).toEqual(0.0);
      expect(planet.position).toEqualEpsilon(position, CesiumMath.EPSILON7);

      // A quarter of Jupiter's day turns the body a quarter turn about its pole.
      const rotation = Matrix4.getMatrix3(
        planet._bodyPrimitive.modelMatrix,
        new Matrix3(),
      );
      expect(Matrix3.determinant(rotation)).toEqualEpsilon(
        1.0,
        CesiumMath.EPSILON9,
      );

      planet.spinning = false;
      expect(planet._bodyPrimitive.material.type).toEqual("Color");
      viewModel._update(time);
      viewModel._update(time);
      expect(planet._spinSeconds).toEqual(3.0 * 3600.0);

      viewModel.resetPositions();
      expect(planet._spinSeconds).toEqual(0.0);

      viewModel.destroy();
    });

    it("spins the real Earth by running the clock, and puts it back", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const earth = viewModel.planets[2];
      clock.multiplier = 1.0;
      clock.shouldAnimate = false;
      clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;

      // The globe's rotation is the Earth fixed frame, and that frame is a function
      // of the clock, so the clock is the only thing that can turn it.
      earth.spinning = true;
      expect(clock.multiplier).toEqual(earth.spinSpeed);
      expect(clock.shouldAnimate).toEqual(true);

      // Dragging the slider has to reach the clock as well.
      earth.spinSpeedSliderValue = viewModel.speedSliderMaximum;
      expect(clock.multiplier).toEqual(earth.spinSpeed);

      // One sidereal day of simulated time is one turn of the globe.
      const day =
        Math.abs(
          PlanetaryEphemeris.computeRotationPeriod(earth._body) * 86400.0,
        ) * 0.25;
      const before = new Matrix3();
      const after = new Matrix3();
      Transforms.computeTemeToPseudoFixedMatrix(clock.currentTime, before);
      Transforms.computeTemeToPseudoFixedMatrix(
        JulianDate.addSeconds(clock.currentTime, day, new JulianDate()),
        after,
      );
      const turned = Matrix3.multiply(
        after,
        Matrix3.transpose(before, new Matrix3()),
        new Matrix3(),
      );
      expect(
        CesiumMath.toDegrees(
          Math.acos(
            CesiumMath.clamp(
              (turned[0] + turned[4] + turned[8] - 1.0) * 0.5,
              -1.0,
              1.0,
            ),
          ),
        ),
      ).toEqualEpsilon(90.0, 0.5);

      // And the camera is held against the stars, so it is the globe that turns
      // rather than the sky: left in the fixed frame the camera would ride round with
      // the ground and the Earth would appear to stand still.
      expect(scene.camera.transform).not.toEqual(Matrix4.IDENTITY);

      earth.spinning = false;
      expect(clock.multiplier).toEqual(1.0);
      expect(clock.shouldAnimate).toEqual(false);
      expect(scene.camera.transform).toEqual(Matrix4.IDENTITY);

      // Anything the user changed underneath is left where they put it.
      earth.spinning = true;
      clock.multiplier = 5.0;
      earth.spinning = false;
      expect(clock.multiplier).toEqual(5.0);

      viewModel.destroy();
    });

    it("holds the camera against the stars while the Earth turns", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const earth = viewModel.planets[2];
      const camera = scene.camera;

      earth.spinning = true;
      viewModel._update(clock.currentTime);
      scene.postUpdate.raiseEvent(scene, clock.currentTime);
      const before = Cartesian3.clone(camera.positionWC);

      // A quarter of a sidereal day on, as the running clock would take it.
      const quarter =
        Math.abs(
          PlanetaryEphemeris.computeRotationPeriod(earth._body) * 86400.0,
        ) * 0.25;
      clock.currentTime = JulianDate.addSeconds(
        clock.currentTime,
        quarter,
        new JulianDate(),
      );
      viewModel._update(clock.currentTime);
      scene.postUpdate.raiseEvent(scene, clock.currentTime);

      // In inertial coordinates the camera has not moved at all. In the fixed frame
      // the globe is drawn in, it has come a quarter of the way round -- which is the
      // globe turning underneath it.
      function inertial(fixed, date) {
        const rotation = new Matrix3();
        if (!Transforms.computeIcrfToFixedMatrix(date, rotation)) {
          Transforms.computeTemeToPseudoFixedMatrix(date, rotation);
        }
        return Matrix3.multiplyByVector(
          Matrix3.transpose(rotation, rotation),
          fixed,
          new Cartesian3(),
        );
      }
      const startTime = JulianDate.addSeconds(
        clock.currentTime,
        -quarter,
        new JulianDate(),
      );
      expect(
        Cartesian3.angleBetween(
          inertial(before, startTime),
          inertial(camera.positionWC, clock.currentTime),
        ),
      ).toBeLessThan(CesiumMath.toRadians(0.5));
      expect(Cartesian3.angleBetween(before, camera.positionWC)).toEqualEpsilon(
        CesiumMath.PI_OVER_TWO,
        CesiumMath.toRadians(1.0),
      );

      earth.spinning = false;
      viewModel.destroy();
    });

    it("scatters an asteroid belt between Mars and Jupiter", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const belt = viewModel.planets[4];
      const time = clock.currentTime;
      expect(belt.name).toEqual("Asteroid belt");

      // A population, not a body: a cloud of rocks rather than an ellipsoid, and
      // nothing to spin, since they each turn on their own.
      expect(belt._bodyPrimitive).toBeUndefined();
      expect(belt.canSpin).toEqual(false);
      expect(viewModel.planets[5].canSpin).toEqual(true);
      expect(viewModel._beltPoints.length).toEqual(
        PlanetaryEphemeris.ASTEROID_BELT.members.length,
      );

      // The row goes round at the average of its rocks' speeds, while each rock keeps
      // to its own orbit: the inner ones really do outrun the outer ones.
      expect(belt.description).toContain("averages one turn");
      const members = PlanetaryEphemeris.ASTEROID_BELT.members;
      const inner = members.reduce(function (slowest, asteroid) {
        return asteroid.elements.a < slowest.elements.a ? asteroid : slowest;
      });
      const outer = members.reduce(function (fastest, asteroid) {
        return asteroid.elements.a > fastest.elements.a ? asteroid : fastest;
      });
      expect(PlanetaryEphemeris.computeOrbitalPeriod(inner)).toBeLessThan(
        PlanetaryEphemeris.computeOrbitalPeriod(outer),
      );

      // The rocks are held relative to the Sun, in the same frame as the orbit paths,
      // so that turning the sky costs nothing.
      expect(viewModel._beltPoints.modelMatrix).toBe(
        viewModel._orbits.modelMatrix,
      );

      viewModel._update(time);
      for (let i = 0; i < viewModel._beltPoints.length; ++i) {
        const distance =
          Cartesian3.magnitude(viewModel._beltPoints.get(i).position) /
          PlanetaryEphemeris.AU_METERS;
        expect(distance).toBeGreaterThan(1.5);
        expect(distance).toBeLessThan(4.5);
      }

      // It goes round on its own slider, like everything else.
      const before = Cartesian3.clone(viewModel._beltPoints.get(0).position);
      belt._offsetSeconds = 365.25 * 86400.0;
      viewModel._update(time);
      expect(
        Cartesian3.distance(viewModel._beltPoints.get(0).position, before) /
          PlanetaryEphemeris.AU_METERS,
      ).toBeGreaterThan(0.5);

      viewModel.destroy();
    });

    it("pushes the far plane out past the planets and puts it back", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const originalFar = scene.camera.frustum.far;

      viewModel._update(clock.currentTime);
      const furthest = viewModel.planets.reduce(function (distance, planet) {
        return Math.max(
          distance,
          Cartesian3.distance(scene.camera.positionWC, planet.position),
        );
      }, 0.0);
      expect(scene.camera.frustum.far).toBeGreaterThan(furthest);

      viewModel.destroy();
      expect(scene.camera.frustum.far).toEqual(originalFar);
    });

    it("draws nothing outside of 3D", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const originalFar = scene.camera.frustum.far;
      viewModel._update(clock.currentTime);

      scene.mode = SceneMode.COLUMBUS_VIEW;
      viewModel._update(clock.currentTime);

      expect(viewModel._points.show).toEqual(false);
      expect(viewModel._labels.show).toEqual(false);
      expect(viewModel._orbits.show).toEqual(false);
      viewModel.planets.forEach(function (planet) {
        expect(planet._bodyPrimitive.show).toEqual(false);
      });
      expect(scene.camera.frustum.far).toEqual(originalFar);

      scene.mode = SceneMode.SCENE3D;
      viewModel.destroy();
    });

    it("draws a path around the Sun for every body", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      // One path per body, the Earth's among them.
      expect(viewModel._orbits.length).toEqual(9);
      // The Earth's aphelion, at 1.0167 AU.
      expect(
        viewModel.planets[2]._orbitRadius / PlanetaryEphemeris.AU_METERS,
      ).toEqualEpsilon(1.0167, CesiumMath.EPSILON3);

      viewModel.destroy();
    });

    it("only draws orbit paths while they are turned on", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      viewModel._update(clock.currentTime);
      expect(viewModel._orbits.show).toEqual(true);

      viewModel.showOrbits = false;
      viewModel._update(clock.currentTime);
      expect(viewModel._orbits.show).toEqual(false);

      viewModel.destroy();
    });
  },
  "WebGL",
);
