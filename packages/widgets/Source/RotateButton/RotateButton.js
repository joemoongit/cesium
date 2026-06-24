import {
  defined,
  destroyObject,
  DeveloperError,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import RotateButtonViewModel from "./RotateButtonViewModel.js";

/**
 * A single button widget for returning to the default camera view of the current scene.
 *
 * @alias RotateButton
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance to use.
 * @param {number} [duration] The time, in seconds, it takes to complete the camera flight home.
 */
function RotateButton(container, scene, clock, duration) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  //>>includeEnd('debug');

  container = getElement(container);

  const viewModel = new RotateButtonViewModel(scene, clock, duration);

  viewModel._svgPath =
    "M50,19.3c-27.9,0-49,10.3-49,24.1C1,55.5,17.4,64.9,40.4,67l-6.7,6.6c-1.6,1.6-1.6,4.2,0,5.9c0.8,0.8,1.8,1.2,2.9,1.2  c1.1,0,2.2-0.4,3-1.2L53,66.2c1.6-1.6,1.6-4.3,0-5.9L39.7,47.1c-1.6-1.6-4.3-1.6-5.9,0c-1.6,1.6-1.6,4.3,0,5.9l5.6,5.6  c-17.8-2-30.1-8.9-30.1-15.2c0-7.5,17.4-15.8,40.7-15.8s40.7,8.3,40.7,15.8c0,5.1-8.5,10.8-20.8,13.6c-2.2,0.5-3.6,2.8-3.1,5  c0.5,2.2,2.8,3.6,5,3.1C88.8,61.1,99,53,99,43.4C99,29.6,77.9,19.3,50,19.3z";

  const element = document.createElement("button");
  element.type = "button";
  element.className = "cesium-button cesium-toolbar-button cesium-rotate-button";
  element.setAttribute(
    "data-bind",
    "\
attr: { title: tooltip },\
click: command,\
cesiumSvgPath: { path: _svgPath, width: 100, height: 100 }",
  );

  container.appendChild(element);

  knockout.applyBindings(viewModel, element);

  this._container = container;
  this._viewModel = viewModel;
  this._element = element;
}

Object.defineProperties(RotateButton.prototype, {
  /**
   * Gets the parent container.
   * @memberof RotateButton.prototype
   *
   * @type {Element}
   */
  container: {
    get: function () {
      return this._container;
    },
  },

  /**
   * Gets the view model.
   * @memberof RotateButton.prototype
   *
   * @type {RotateButtonViewModel}
   */
  viewModel: {
    get: function () {
      return this._viewModel;
    },
  },
});

/**
 * @returns {boolean} true if the object has been destroyed, false otherwise.
 */
RotateButton.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the widget.  Should be called if permanently
 * removing the widget from layout.
 */
RotateButton.prototype.destroy = function () {
  knockout.cleanNode(this._element);
  this._container.removeChild(this._element);

  return destroyObject(this);
};
export default RotateButton;
