import { Cartesian3, Color, Material } from "@cesium/engine";
import PlanetaryEphemeris from "../PlanetaryEphemeris.js";
import PlanetIndicatorViewModel from "../PlanetIndicatorViewModel.js";

// Volumetric mean radius of Mars, in meters. Mars is very nearly spherical.
const MARS_RADIUS = 3389500;
// Mars never gets farther than ~2.68 AU from Earth; pad the frustum a little.
const MAXIMUM_EARTH_DISTANCE = 2.8 * PlanetaryEphemeris.AU_METERS;

function createMoonMaterial(color) {
  return function () {
    return Material.fromType(Material.ColorType, {
      color: Color.fromCssColorString(color),
    });
  };
}

/**
 * Phobos and Deimos. Both are captured-asteroid-looking rubble with very irregular
 * shapes, so the triaxial radii below are the best ellipsoid fit to their published
 * dimensions rather than a sphere. Orbits are circular approximations in the Martian
 * equatorial plane -- see {@link PlanetaryEphemeris.computeSatelliteOffset} for what
 * that does and does not get right.
 *
 * @private
 */
const MARTIAN_MOONS = [
  {
    name: "Phobos",
    semiMajorAxis: 9376000,
    periodDays: 0.31891023,
    epochMeanLongitude: 232.412,
    radii: new Cartesian3(13000, 11400, 9100),
    createMaterial: createMoonMaterial("#8b7d6f"),
  },
  {
    name: "Deimos",
    semiMajorAxis: 23463200,
    periodDays: 1.2624407,
    epochMeanLongitude: 28.963,
    radii: new Cartesian3(7800, 6000, 5100),
    createMaterial: createMoonMaterial("#9c8b78"),
  },
];

/**
 * The view model for {@link MarsIndicator}.
 *
 * @alias MarsIndicatorViewModel
 * @constructor
 * @extends PlanetIndicatorViewModel
 *
 * @param {Scene} scene The scene instance to use.
 * @param {Clock} clock The clock that drives the ephemeris.
 * @param {Element} labelOverlay The DOM element used to draw the on-screen Mars label.
 *
 * @exception {DeveloperError} scene is required.
 * @exception {DeveloperError} clock is required.
 */
function MarsIndicatorViewModel(scene, clock, labelOverlay) {
  PlanetIndicatorViewModel.call(this, scene, clock, labelOverlay, {
    name: "Mars",
    planet: PlanetaryEphemeris.MARS,
    radii: new Cartesian3(MARS_RADIUS, MARS_RADIUS, MARS_RADIUS),
    createMaterial: function () {
      return Material.fromType(Material.ColorType, {
        color: Color.fromCssColorString("#c1440e"),
      });
    },
    maximumEarthDistance: MAXIMUM_EARTH_DISTANCE,
    satellites: MARTIAN_MOONS,
  });
}

MarsIndicatorViewModel.prototype = Object.create(
  PlanetIndicatorViewModel.prototype,
);
MarsIndicatorViewModel.prototype.constructor = MarsIndicatorViewModel;

Object.defineProperties(MarsIndicatorViewModel.prototype, {
  /**
   * Gets the command that flies the camera to Mars. An alias for
   * {@link PlanetIndicatorViewModel#flyToCommand}.
   * @memberof MarsIndicatorViewModel.prototype
   * @type {Command}
   * @readonly
   */
  flyToMarsCommand: {
    get: function () {
      return this._flyToCommand;
    },
  },
});

export default MarsIndicatorViewModel;
