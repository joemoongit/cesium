import { defined } from "@cesium/engine";

// scene -> { originalFar, claims: Map(owner, distance) }
const sceneStates = new Map();

/**
 * Coordinates the camera's far plane between widgets that each need to see something
 * beyond the default view distance.
 *
 * <p>The far plane is a single shared value, so a widget that simply saved and restored
 * it would clobber any other widget that had raised it in the meantime -- hiding one
 * planet would make another one vanish. Claims are reference counted instead: the far
 * plane sits at the largest outstanding claim, and drops back to the value it had
 * before the first claim once every claim is released.</p>
 *
 * @namespace SceneFarPlane
 *
 * @private
 */
const SceneFarPlane = {};

function applyClaims(scene, state) {
  let far = state.originalFar;
  state.claims.forEach(function (distance) {
    far = Math.max(far, distance);
  });
  scene.camera.frustum.far = far;
}

/**
 * Requires the camera's far plane to reach at least the given distance for as long as
 * <code>owner</code> holds the claim. Claiming again with the same owner replaces that
 * owner's previous claim.
 *
 * @param {Scene} scene The scene whose camera is being adjusted.
 * @param {object} owner The object holding the claim.
 * @param {number} distance The minimum required far plane distance, in meters.
 */
SceneFarPlane.claim = function (scene, owner, distance) {
  const currentFar = scene.camera.frustum.far;
  if (typeof currentFar !== "number") {
    // Not a frustum with a far plane we can manage, for example during a mode morph.
    return;
  }

  let state = sceneStates.get(scene);
  if (!defined(state)) {
    state = { originalFar: currentFar, claims: new Map() };
    sceneStates.set(scene, state);
  }

  state.claims.set(owner, distance);
  applyClaims(scene, state);
};

/**
 * Releases <code>owner</code>'s claim on the far plane. Does nothing if the owner has
 * no outstanding claim.
 *
 * @param {Scene} scene The scene whose camera is being adjusted.
 * @param {object} owner The object releasing its claim.
 */
SceneFarPlane.release = function (scene, owner) {
  const state = sceneStates.get(scene);
  if (!defined(state) || !state.claims.delete(owner)) {
    return;
  }

  if (state.claims.size === 0) {
    scene.camera.frustum.far = state.originalFar;
    sceneStates.delete(scene);
    return;
  }

  applyClaims(scene, state);
};

export default SceneFarPlane;
