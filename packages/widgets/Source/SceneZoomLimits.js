import { defined } from "@cesium/engine";

// scene -> { originalMinimum, originalMaximum, claims: Map(owner, {minimum, maximum}) }
const sceneStates = new Map();

/**
 * Coordinates the screen space camera controller's zoom limits between widgets that each
 * need to bound how close the camera can get to whatever it is locked onto.
 *
 * <p>While the camera has a look-at transform set, the controller measures zoom as the
 * distance to the transform's origin and clamps it against
 * <code>minimumZoomDistance</code>, which defaults to one metre -- so a single drag can
 * put the camera inside the body being viewed. Widgets therefore raise the limits while
 * they hold the camera, but the limits are a single shared pair of values: a widget that
 * naively saved and restored them would bank whatever another widget had already set and
 * put that back later. Claims are tracked per owner instead, the most recent claim wins,
 * and the values from before the first claim are restored once every claim is released.</p>
 *
 * @namespace SceneZoomLimits
 *
 * @private
 */
const SceneZoomLimits = {};

function applyClaims(scene, state) {
  const controller = scene.screenSpaceCameraController;
  let minimum = state.originalMinimum;
  let maximum = state.originalMaximum;
  // Map preserves insertion order and claim() re-inserts, so the last claim wins.
  state.claims.forEach(function (claim) {
    minimum = claim.minimum;
    maximum = claim.maximum;
  });
  controller.minimumZoomDistance = minimum;
  controller.maximumZoomDistance = maximum;
}

/**
 * Bounds how close and how far the camera may zoom for as long as <code>owner</code>
 * holds the claim.
 *
 * @param {Scene} scene The scene whose camera controller is being adjusted.
 * @param {object} owner The object holding the claim.
 * @param {number} minimum The minimum zoom distance, in meters.
 * @param {number} maximum The maximum zoom distance, in meters.
 */
SceneZoomLimits.claim = function (scene, owner, minimum, maximum) {
  const controller = scene.screenSpaceCameraController;
  if (!defined(controller)) {
    return;
  }

  let state = sceneStates.get(scene);
  if (!defined(state)) {
    state = {
      originalMinimum: controller.minimumZoomDistance,
      originalMaximum: controller.maximumZoomDistance,
      claims: new Map(),
    };
    sceneStates.set(scene, state);
  }

  // Delete first so re-claiming moves this owner to the end of the iteration order.
  state.claims.delete(owner);
  state.claims.set(owner, { minimum: minimum, maximum: maximum });
  applyClaims(scene, state);
};

/**
 * Releases <code>owner</code>'s claim on the zoom limits.
 *
 * @param {Scene} scene The scene whose camera controller is being adjusted.
 * @param {object} owner The object releasing its claim.
 */
SceneZoomLimits.release = function (scene, owner) {
  const state = sceneStates.get(scene);
  if (!defined(state) || !state.claims.delete(owner)) {
    return;
  }

  const controller = scene.screenSpaceCameraController;
  if (state.claims.size === 0) {
    controller.minimumZoomDistance = state.originalMinimum;
    controller.maximumZoomDistance = state.originalMaximum;
    sceneStates.delete(scene);
    return;
  }

  applyClaims(scene, state);
};

export default SceneZoomLimits;
