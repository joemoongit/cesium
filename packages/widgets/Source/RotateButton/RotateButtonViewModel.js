import {
  defined,
  DeveloperError,
  Cartesian3,
  Matrix3,
  Transforms,
  Math as CesiumMath,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

/**
 * The view model for {@link RotateButton}.
 * @alias RotateButtonViewModel
 * @constructor
 *
 * @param {Scene} scene The scene instance to use.
 * @param {number} [duration] The duration of the camera flight in seconds.
 */
function RotateButtonViewModel(scene, clock, duration) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }
  //>>includeEnd('debug');

  this._scene = scene;
  this._clock = clock;
  this._duration = duration;

  const that = this;
  this._accumulatedAngle = 0;
  this._transformsPatched = false;
  this._origIcrfToFixed = null;
  this._origTemeToFixed = null;

  const scratchCounterRotation = new Matrix3();

  this._patchTransforms = function () {
    if (that._transformsPatched) {
      return;
    }
    that._transformsPatched = true;
    that._origIcrfToFixed = Transforms.computeIcrfToFixedMatrix;
    that._origTemeToFixed = Transforms.computeTemeToPseudoFixedMatrix;

    Transforms.computeIcrfToFixedMatrix = function (date, result) {
      result = that._origIcrfToFixed(date, result);
      if (defined(result) && that._accumulatedAngle !== 0) {
        Matrix3.fromRotationZ(-that._accumulatedAngle, scratchCounterRotation);
        Matrix3.multiply(scratchCounterRotation, result, result);
      }
      return result;
    };

    Transforms.computeTemeToPseudoFixedMatrix = function (date, result) {
      result = that._origTemeToFixed(date, result);
      if (that._accumulatedAngle !== 0) {
        Matrix3.fromRotationZ(-that._accumulatedAngle, scratchCounterRotation);
        Matrix3.multiply(scratchCounterRotation, result, result);
      }
      return result;
    };
  };

  this._command = createCommand(function () {
    if (!that._rotating) {
      let lastTime = performance.now();
      that._patchTransforms();

      that._rotating = that._clock.onTick.addEventListener(() => {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        const angle = CesiumMath.toRadians((360 / 86164.091) * dt);
        that._accumulatedAngle += angle;
        that._scene.camera.rotate(Cartesian3.UNIT_Z, angle);
      });
    } else {
      that._rotating();
      that._rotating = null;
    }
  });

  /**
   * Gets or sets the tooltip.  This property is observable.
   *
   * @type {string}
   */
  this.tooltip = "Rotate";

  knockout.track(this, ["tooltip"]);
}

Object.defineProperties(RotateButtonViewModel.prototype, {
  /**
   * Gets the scene to control.
   * @memberof RotateButtonViewModel.prototype
   *
   * @type {Scene}
   */
  scene: {
    get: function () {
      return this._scene;
    },
  },

  /**
   * Gets the Command that is executed when the button is clicked.
   * @memberof RotateButtonViewModel.prototype
   *
   * @type {Command}
   */
  command: {
    get: function () {
      return this._command;
    },
  },

  /**
   * Gets or sets the the duration of the camera flight in seconds.
   * A value of zero causes the camera to instantly switch to home view.
   * The duration will be computed based on the distance when undefined.
   * @memberof RotateButtonViewModel.prototype
   *
   * @type {number|undefined}
   */
  duration: {
    get: function () {
      return this._duration;
    },
    set: function (value) {
      //>>includeStart('debug', pragmas.debug);
      if (defined(value) && value < 0) {
        throw new DeveloperError("value must be positive.");
      }
      //>>includeEnd('debug');

      this._duration = value;
    },
  },
});
export default RotateButtonViewModel;
