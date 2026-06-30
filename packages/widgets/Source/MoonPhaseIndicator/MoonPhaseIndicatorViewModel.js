import {
  defined,
  DeveloperError,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  JulianDate,
  Matrix4,
  Simon1994PlanetaryPositions,
  Transforms,
  Matrix3,
  Math as CesiumMath,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

const scratchSunPos = new Cartesian3();
const scratchMoonPos = new Cartesian3();
const scratchMoonFixed = new Cartesian3();
const scratchMoonDir = new Cartesian3();
const scratchUp = new Cartesian3();
const scratchIcrfToFixed = new Matrix3();
const scratchScreenPos = new Cartesian2();

const LUNAR_RADIUS = 1737400.0;

const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Third Quarter",
  "Waning Crescent",
];

function computePhaseIndex(elongationDeg, isWaxing) {
  if (elongationDeg < 22.5) {
    return 0;
  }
  if (elongationDeg >= 157.5) {
    return 4;
  }
  if (isWaxing) {
    if (elongationDeg < 67.5) {
      return 1;
    }
    if (elongationDeg < 112.5) {
      return 2;
    }
    return 3;
  }
  if (elongationDeg >= 112.5) {
    return 5;
  }
  if (elongationDeg >= 67.5) {
    return 6;
  }
  return 7;
}

function computeMoonShadowPath(illumination, isWaxing) {
  const r = 46;
  const cx = 50;
  const cy = 50;
  const top = cy - r;
  const bottom = cy + r;

  if (illumination <= 0.005) {
    return `M${cx - r},${cy} A${r},${r} 0 1,1 ${cx + r},${cy} A${r},${r} 0 1,1 ${cx - r},${cy}Z`;
  }
  if (illumination >= 0.995) {
    return "";
  }

  const elongation = Math.acos(2 * illumination - 1);
  const rx = Math.abs(r * Math.cos(elongation));

  const limbSweep = isWaxing ? 0 : 1;
  const termSweep = elongation > Math.PI / 2 ? limbSweep : 1 - limbSweep;

  return `M${cx},${top} A${r},${r} 0 0,${limbSweep} ${cx},${bottom} A${rx},${r} 0 0,${termSweep} ${cx},${top}Z`;
}

function MoonPhaseIndicatorViewModel(scene, clock, labelOverlay) {
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }

  this._scene = scene;
  this._clock = clock;
  this._tickListener = null;
  this._labelOverlay = labelOverlay;

  this.phaseName = "---";
  this.illuminationPercent = "0";
  this.elongationDeg = "0";
  this.moonElevation = "---";
  this.moonVisible = false;
  this.shadowPath = computeMoonShadowPath(0, true);
  this.panelVisible = false;
  this.labelVisible = false;
  this.orbitActive = false;

  knockout.track(this, [
    "phaseName",
    "illuminationPercent",
    "elongationDeg",
    "moonElevation",
    "moonVisible",
    "shadowPath",
    "panelVisible",
    "labelVisible",
    "orbitActive",
  ]);

  const that = this;

  this._command = createCommand(function () {
    that.panelVisible = !that.panelVisible;
    if (that.panelVisible && !that._tickListener) {
      that._startUpdating();
    } else if (!that.panelVisible && !that.labelVisible) {
      that._stopUpdating();
    }
  });

  this._flyToMoonCommand = createCommand(function () {
    that._flyToMoon();
  });

  this._toggleLabelCommand = createCommand(function () {
    that.labelVisible = !that.labelVisible;
    if (that.labelVisible && !that._tickListener) {
      that._startUpdating();
    } else if (!that.labelVisible) {
      that._hideLabelOverlay();
      if (!that.panelVisible) {
        that._stopUpdating();
      }
    }
  });

  this._origComputeMoon =
    Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame;
  this._orbitStartRealTime = 0;
  this._orbitAccumulatedSeconds = 0;

  const orbitScratchDate = new JulianDate();
  const ORBIT_SPEED = 10000;
  const orig = this._origComputeMoon;

  Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame =
    function (julianDate, result) {
      if (!defined(julianDate)) {
        julianDate = JulianDate.now();
      }
      const totalOffset =
        that._orbitAccumulatedSeconds +
        (that.orbitActive
          ? ((performance.now() - that._orbitStartRealTime) / 1000) *
            ORBIT_SPEED
          : 0);
      if (totalOffset === 0) {
        return orig(julianDate, result);
      }
      JulianDate.addSeconds(julianDate, totalOffset, orbitScratchDate);
      return orig(orbitScratchDate, result);
    };

  this._toggleOrbitCommand = createCommand(function () {
    if (that.orbitActive) {
      const elapsed = (performance.now() - that._orbitStartRealTime) / 1000;
      that._orbitAccumulatedSeconds += elapsed * ORBIT_SPEED;
      that.orbitActive = false;
    } else {
      that._orbitStartRealTime = performance.now();
      that.orbitActive = true;
    }
  });

  this.tooltip = "Moon Phase";
}

MoonPhaseIndicatorViewModel.prototype._getMoonFixedPosition = function (
  result,
) {
  const date = this._clock.currentTime;
  let icrfToFixed = Transforms.computeIcrfToFixedMatrix(
    date,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    icrfToFixed = Transforms.computeTemeToPseudoFixedMatrix(
      date,
      scratchIcrfToFixed,
    );
  }
  if (!defined(icrfToFixed)) {
    return undefined;
  }
  const moonECI =
    Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
      date,
      scratchMoonPos,
    );
  return Matrix3.multiplyByVector(icrfToFixed, moonECI, result);
};

MoonPhaseIndicatorViewModel.prototype._flyToMoon = function () {
  const moonFixed = this._getMoonFixedPosition(scratchMoonFixed);
  if (!defined(moonFixed)) {
    return;
  }

  const that = this;
  const boundingSphere = new BoundingSphere(moonFixed, LUNAR_RADIUS);

  this._scene.camera.flyToBoundingSphere(boundingSphere, {
    offset: {
      heading: 0,
      pitch: 0,
      range: LUNAR_RADIUS * 4,
    },
    duration: 3,
    complete: function () {
      that._startTrackingMoon();
    },
  });
};

MoonPhaseIndicatorViewModel.prototype._startTrackingMoon = function () {
  this._stopTrackingMoon();
  const that = this;
  const scene = this._scene;
  const trackTransform = new Matrix4();

  this._moonTrackingListener = scene.postUpdate.addEventListener(function () {
    const moonNow = that._getMoonFixedPosition(scratchMoonFixed);
    if (!defined(moonNow)) {
      return;
    }
    Matrix4.fromTranslation(moonNow, trackTransform);
    scene.camera.lookAtTransform(trackTransform);
  });
};

MoonPhaseIndicatorViewModel.prototype._stopTrackingMoon = function () {
  if (this._moonTrackingListener) {
    this._moonTrackingListener();
    this._moonTrackingListener = null;
    this._scene.camera.lookAtTransform(Matrix4.IDENTITY);
  }
};

MoonPhaseIndicatorViewModel.prototype._startUpdating = function () {
  const that = this;
  that._update();
  this._tickListener = this._clock.onTick.addEventListener(function () {
    that._update();
  });
};

MoonPhaseIndicatorViewModel.prototype._stopUpdating = function () {
  if (this._tickListener) {
    this._tickListener();
    this._tickListener = null;
  }
};

MoonPhaseIndicatorViewModel.prototype._hideLabelOverlay = function () {
  if (this._labelOverlay) {
    this._labelOverlay.style.display = "none";
  }
};

MoonPhaseIndicatorViewModel.prototype._update = function () {
  const date = this._clock.currentTime;
  const scene = this._scene;

  const sunPos =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      date,
      scratchSunPos,
    );
  const moonPos =
    Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
      date,
      scratchMoonPos,
    );

  const elongation = Cartesian3.angleBetween(sunPos, moonPos);
  const elongationDeg = CesiumMath.toDegrees(elongation);

  const cross = Cartesian3.cross(sunPos, moonPos, scratchMoonDir);
  const isWaxing = cross.z > 0;

  const moonToSun = Cartesian3.subtract(sunPos, moonPos, scratchMoonDir);
  const moonToEarth = Cartesian3.negate(moonPos, scratchUp);
  const phaseAngle = Cartesian3.angleBetween(moonToSun, moonToEarth);
  const illumination = (1 + Math.cos(phaseAngle)) / 2;

  const phaseIndex = computePhaseIndex(elongationDeg, isWaxing);
  this.phaseName = PHASE_NAMES[phaseIndex];
  this.illuminationPercent = (illumination * 100).toFixed(1);
  this.elongationDeg = elongationDeg.toFixed(1);
  this.shadowPath = computeMoonShadowPath(illumination, isWaxing);

  let icrfToFixed = Transforms.computeIcrfToFixedMatrix(
    date,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    icrfToFixed = Transforms.computeTemeToPseudoFixedMatrix(
      date,
      scratchIcrfToFixed,
    );
  }

  if (defined(icrfToFixed)) {
    Matrix3.multiplyByVector(icrfToFixed, moonPos, scratchMoonFixed);

    const cameraPos = scene.camera.positionWC;
    Cartesian3.subtract(scratchMoonFixed, cameraPos, scratchMoonDir);
    Cartesian3.normalize(scratchMoonDir, scratchMoonDir);
    Cartesian3.normalize(cameraPos, scratchUp);

    const sinElevation = Cartesian3.dot(scratchMoonDir, scratchUp);
    const elevationDeg = CesiumMath.toDegrees(Math.asin(sinElevation));
    this.moonElevation = `${elevationDeg.toFixed(1)}°`;
    this.moonVisible = elevationDeg > 0;

    this._updateLabelOverlay(scratchMoonFixed);
  } else {
    this.moonElevation = "---";
    this.moonVisible = false;
    this._hideLabelOverlay();
  }
};

MoonPhaseIndicatorViewModel.prototype._updateLabelOverlay = function (
  moonFixedPos,
) {
  const overlay = this._labelOverlay;
  if (!overlay || !this.labelVisible) {
    if (overlay) {
      overlay.style.display = "none";
    }
    return;
  }

  const scene = this._scene;
  const screenPos = scene.cartesianToCanvasCoordinates(
    moonFixedPos,
    scratchScreenPos,
  );

  if (!defined(screenPos)) {
    overlay.style.display = "none";
    return;
  }

  overlay.style.display = "block";
  overlay.style.left = `${screenPos.x + 15}px`;
  overlay.style.top = `${screenPos.y - 20}px`;
  overlay.textContent = `${this.phaseName} (${this.illuminationPercent}%)`;
};

Object.defineProperties(MoonPhaseIndicatorViewModel.prototype, {
  scene: {
    get: function () {
      return this._scene;
    },
  },
  command: {
    get: function () {
      return this._command;
    },
  },
  flyToMoonCommand: {
    get: function () {
      return this._flyToMoonCommand;
    },
  },
  toggleLabelCommand: {
    get: function () {
      return this._toggleLabelCommand;
    },
  },
  toggleOrbitCommand: {
    get: function () {
      return this._toggleOrbitCommand;
    },
  },
});

export default MoonPhaseIndicatorViewModel;
