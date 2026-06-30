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
const scratchSunFixed = new Cartesian3();
const scratchSunDir = new Cartesian3();
const scratchUp = new Cartesian3();
const scratchEast = new Cartesian3();
const scratchNorth = new Cartesian3();
const scratchHorizontal = new Cartesian3();
const scratchIcrfToFixed = new Matrix3();
const scratchScreenPos = new Cartesian2();
const scratchTrackSunPos = new Cartesian3();
const scratchTrackSunFixed = new Cartesian3();

const SOLAR_RADIUS = 6.955e8;
const AU_METERS = 149597870700;

function compassLabel(deg) {
  if (deg >= 337.5 || deg < 22.5) {
    return "N";
  }
  if (deg < 67.5) {
    return "NE";
  }
  if (deg < 112.5) {
    return "E";
  }
  if (deg < 157.5) {
    return "SE";
  }
  if (deg < 202.5) {
    return "S";
  }
  if (deg < 247.5) {
    return "SW";
  }
  if (deg < 292.5) {
    return "W";
  }
  return "NW";
}

function SunIndicatorViewModel(scene, clock, labelOverlay) {
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }

  this._scene = scene;
  this._clock = clock;
  this._tickListener = null;
  this._labelOverlay = labelOverlay;

  this.sunElevation = "---";
  this.sunAzimuth = "---";
  this.sunAzimuthDir = "";
  this.sunAboveHorizon = false;
  this.distanceAU = "---";
  this.distanceKm = "---";
  this.panelVisible = false;
  this.labelVisible = false;
  this.orbitActive = false;

  knockout.track(this, [
    "sunElevation",
    "sunAzimuth",
    "sunAzimuthDir",
    "sunAboveHorizon",
    "distanceAU",
    "distanceKm",
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

  this._flyToSunCommand = createCommand(function () {
    that._flyToSun();
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

  this._origComputeSun =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame;
  this._orbitStartRealTime = 0;
  this._orbitAccumulatedSeconds = 0;

  const orbitScratchDate = new JulianDate();
  const ORBIT_SPEED = 10000;
  const origSun = this._origComputeSun;

  Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame =
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
        return origSun(julianDate, result);
      }
      JulianDate.addSeconds(julianDate, totalOffset, orbitScratchDate);
      return origSun(orbitScratchDate, result);
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

  this.tooltip = "Sun Info";
}

SunIndicatorViewModel.prototype._getSunFixedPosition = function (result) {
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
  const sunECI =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      date,
      scratchTrackSunPos,
    );
  return Matrix3.multiplyByVector(icrfToFixed, sunECI, result);
};

SunIndicatorViewModel.prototype._flyToSun = function () {
  const sunFixed = this._getSunFixedPosition(scratchSunFixed);
  if (!defined(sunFixed)) {
    return;
  }

  const that = this;
  const boundingSphere = new BoundingSphere(sunFixed, SOLAR_RADIUS);

  this._scene.camera.flyToBoundingSphere(boundingSphere, {
    offset: {
      heading: 0,
      pitch: 0,
      range: SOLAR_RADIUS * 6,
    },
    duration: 3,
    complete: function () {
      that._startTrackingSun();
    },
  });
};

SunIndicatorViewModel.prototype._startTrackingSun = function () {
  this._stopTrackingSun();
  const that = this;
  const scene = this._scene;
  const trackTransform = new Matrix4();

  this._sunTrackingListener = scene.postUpdate.addEventListener(function () {
    const sunNow = that._getSunFixedPosition(scratchTrackSunFixed);
    if (!defined(sunNow)) {
      return;
    }
    Matrix4.fromTranslation(sunNow, trackTransform);
    scene.camera.lookAtTransform(trackTransform);
  });
};

SunIndicatorViewModel.prototype._stopTrackingSun = function () {
  if (this._sunTrackingListener) {
    this._sunTrackingListener();
    this._sunTrackingListener = null;
    this._scene.camera.lookAtTransform(Matrix4.IDENTITY);
  }
};

SunIndicatorViewModel.prototype._startUpdating = function () {
  const that = this;
  that._update();
  this._tickListener = this._clock.onTick.addEventListener(function () {
    that._update();
  });
};

SunIndicatorViewModel.prototype._stopUpdating = function () {
  if (this._tickListener) {
    this._tickListener();
    this._tickListener = null;
  }
};

SunIndicatorViewModel.prototype._hideLabelOverlay = function () {
  if (this._labelOverlay) {
    this._labelOverlay.style.display = "none";
  }
};

SunIndicatorViewModel.prototype._update = function () {
  const date = this._clock.currentTime;
  const scene = this._scene;

  const sunPos =
    Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      date,
      scratchSunPos,
    );

  const distMeters = Cartesian3.magnitude(sunPos);
  this.distanceAU = (distMeters / AU_METERS).toFixed(4);
  this.distanceKm = (distMeters / 1e6).toFixed(1);

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
    Matrix3.multiplyByVector(icrfToFixed, sunPos, scratchSunFixed);

    const cameraPos = scene.camera.positionWC;

    Cartesian3.subtract(scratchSunFixed, cameraPos, scratchSunDir);
    Cartesian3.normalize(scratchSunDir, scratchSunDir);

    Cartesian3.normalize(cameraPos, scratchUp);

    const sinElevation = Cartesian3.dot(scratchSunDir, scratchUp);
    const elevationDeg = CesiumMath.toDegrees(Math.asin(sinElevation));
    this.sunElevation = `${elevationDeg.toFixed(1)}°`;
    this.sunAboveHorizon = elevationDeg > 0;

    Cartesian3.cross(Cartesian3.UNIT_Z, scratchUp, scratchEast);
    let eastMag = Cartesian3.magnitude(scratchEast);
    if (eastMag < 1e-6) {
      Cartesian3.cross(Cartesian3.UNIT_X, scratchUp, scratchEast);
      eastMag = Cartesian3.magnitude(scratchEast);
    }
    Cartesian3.divideByScalar(scratchEast, eastMag, scratchEast);
    Cartesian3.cross(scratchUp, scratchEast, scratchNorth);

    const upDot = Cartesian3.dot(scratchSunDir, scratchUp);
    Cartesian3.multiplyByScalar(scratchUp, upDot, scratchHorizontal);
    Cartesian3.subtract(scratchSunDir, scratchHorizontal, scratchHorizontal);

    const eastComponent = Cartesian3.dot(scratchHorizontal, scratchEast);
    const northComponent = Cartesian3.dot(scratchHorizontal, scratchNorth);
    let azimuthDeg = CesiumMath.toDegrees(
      Math.atan2(eastComponent, northComponent),
    );
    if (azimuthDeg < 0) {
      azimuthDeg += 360;
    }
    this.sunAzimuth = `${azimuthDeg.toFixed(1)}°`;
    this.sunAzimuthDir = compassLabel(azimuthDeg);

    this._updateLabelOverlay(scratchSunFixed);
  } else {
    this.sunElevation = "---";
    this.sunAzimuth = "---";
    this.sunAzimuthDir = "";
    this.sunAboveHorizon = false;
    this._hideLabelOverlay();
  }
};

SunIndicatorViewModel.prototype._updateLabelOverlay = function (sunFixedPos) {
  const overlay = this._labelOverlay;
  if (!overlay || !this.labelVisible) {
    if (overlay) {
      overlay.style.display = "none";
    }
    return;
  }

  const scene = this._scene;
  const screenPos = scene.cartesianToCanvasCoordinates(
    sunFixedPos,
    scratchScreenPos,
  );

  if (!defined(screenPos)) {
    overlay.style.display = "none";
    return;
  }

  overlay.style.display = "block";
  overlay.style.left = `${screenPos.x + 15}px`;
  overlay.style.top = `${screenPos.y - 20}px`;
  overlay.textContent = `Sun • Elev ${this.sunElevation} • ${this.distanceAU} AU`;
};

Object.defineProperties(SunIndicatorViewModel.prototype, {
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
  flyToSunCommand: {
    get: function () {
      return this._flyToSunCommand;
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

export default SunIndicatorViewModel;
