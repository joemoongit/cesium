import { Cartesian3, Color, Material } from "@cesium/engine";
import PlanetaryEphemeris from "../PlanetaryEphemeris.js";
import PlanetIndicatorViewModel from "../PlanetIndicatorViewModel.js";

// Jupiter is visibly oblate, so it is drawn as a true ellipsoid rather than a sphere.
const JUPITER_EQUATORIAL_RADIUS = 71492000;
const JUPITER_POLAR_RADIUS = 66854000;
// Jupiter never gets farther than ~6.47 AU from Earth; pad the frustum a little.
const MAXIMUM_EARTH_DISTANCE = 6.7 * PlanetaryEphemeris.AU_METERS;

/**
 * The view model for {@link JupiterIndicator}.
 *
 * @alias JupiterIndicatorViewModel
 * @constructor
 * @extends PlanetIndicatorViewModel
 *
 * @param {Scene} scene The scene instance to use.
 * @param {Clock} clock The clock that drives the ephemeris.
 * @param {Element} labelOverlay The DOM element used to draw the on-screen Jupiter label.
 *
 * @exception {DeveloperError} scene is required.
 * @exception {DeveloperError} clock is required.
 */
function JupiterIndicatorViewModel(scene, clock, labelOverlay) {
  PlanetIndicatorViewModel.call(this, scene, clock, labelOverlay, {
    name: "Jupiter",
    planet: PlanetaryEphemeris.JUPITER,
    radii: new Cartesian3(
      JUPITER_EQUATORIAL_RADIUS,
      JUPITER_EQUATORIAL_RADIUS,
      JUPITER_POLAR_RADIUS,
    ),
    createMaterial: function () {
      // Latitude banding, which is what makes Jupiter read as Jupiter. The stripe
      // material runs along the ellipsoid's t coordinate when horizontal is true.
      return Material.fromType(Material.StripeType, {
        horizontal: true,
        evenColor: Color.fromCssColorString("#e3d5b8"),
        oddColor: Color.fromCssColorString("#c08b52"),
        repeat: 9.0,
      });
    },
    maximumEarthDistance: MAXIMUM_EARTH_DISTANCE,
  });
}

JupiterIndicatorViewModel.prototype = Object.create(
  PlanetIndicatorViewModel.prototype,
);
JupiterIndicatorViewModel.prototype.constructor = JupiterIndicatorViewModel;

export default JupiterIndicatorViewModel;
