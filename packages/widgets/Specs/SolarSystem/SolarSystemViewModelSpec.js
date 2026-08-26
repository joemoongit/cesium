import {
  Cartesian3,
  Clock,
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
      // The point, label and orbit collections, plus one body per row.
      expect(scene.primitives.length).toEqual(primitiveCount + 11);

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

    it("has a row for each planet, and for Pluto", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      expect(
        viewModel.planets.map(function (planet) {
          return planet.name;
        }),
      ).toEqual([
        "Mercury",
        "Venus",
        "Mars",
        "Jupiter",
        "Saturn",
        "Uranus",
        "Neptune",
        "Pluto",
      ]);
      expect(viewModel.planets[7].description).toContain("a dwarf planet");
      viewModel.planets.forEach(function (planet) {
        expect(planet.orbiting).toEqual(false);
        expect(planet.colorCss).toMatch(/^#[0-9a-f]{6}$/);
      });

      viewModel.destroy();
    });

    it("maps the speed slider onto 1x through 100000x", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);
      const planet = viewModel.planets[0];

      // A decade of speed every fifth of the slider's travel.
      expect(planet.speed).toEqual(1000);

      planet.speedSliderValue = 0;
      expect(planet.speed).toEqual(1);
      expect(planet.speedText).toEqual("1x");

      planet.speedSliderValue = 40;
      expect(planet.speed).toEqual(100);

      planet.speedSliderValue = viewModel.speedSliderMaximum;
      expect(planet.speed).toEqual(100000);
      expect(planet.speedText).toEqual("100,000x");

      // The range input reports its value as a string.
      planet.speedSliderValue = "20";
      expect(planet.speed).toEqual(10);

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
      const planet = viewModel.planets[2];
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
      const planet = viewModel.planets[2];
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
      const planet = viewModel.planets[2];
      const time = clock.currentTime;
      spyOn(scene.camera, "flyToBoundingSphere");

      planet.speedSliderValue = viewModel.speedSliderMaximum;
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
          planet._offsetSeconds + planet.speed * duration,
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
      const planet = viewModel.planets[2];
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
      const planet = viewModel.planets[2];
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
      const planet = viewModel.planets[2];
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
      const planet = viewModel.planets[2];

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
      const planet = viewModel.planets[2];

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

    it("draws the Earth's path around the Sun along with the planets'", function () {
      const viewModel = new SolarSystemViewModel(scene, clock);

      // One path per row, plus the Earth's.
      expect(viewModel._orbits.length).toEqual(9);
      // The Earth's aphelion, at 1.0167 AU.
      expect(
        viewModel._earthOrbitRadius / PlanetaryEphemeris.AU_METERS,
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
