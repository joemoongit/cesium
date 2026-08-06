import { Cartesian3, Color, Material } from "@cesium/engine";
import PlanetaryEphemeris from "../PlanetaryEphemeris.js";
import PlanetIndicatorViewModel from "../PlanetIndicatorViewModel.js";

// Volumetric mean radius of Mars, in meters. Mars is very nearly spherical.
const MARS_RADIUS = 3389500;
// Mars never gets farther than ~2.68 AU from Earth; pad the frustum a little.
const MAXIMUM_EARTH_DISTANCE = 2.8 * PlanetaryEphemeris.AU_METERS;

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
