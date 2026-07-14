import {
  defined,
  DeveloperError,
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  CustomDataSource,
  HeadingPitchRange,
  JulianDate,
  LabelStyle,
  Material,
  Math as CesiumMath,
  Matrix3,
  Ellipsoid,
  NearFarScalar,
  PolylineCollection,
  Transforms,
  VerticalOrigin,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

const DEFAULT_ALTITUDE_KM = 400;
const EARTH_RADIUS = 6371000;
const EARTH_GM = 3.986004418e14;
const DEG = CesiumMath.RADIANS_PER_DEGREE;
const TWO_PI = 2 * Math.PI;

function getOrbitBand(altKm) {
  if (altKm < 2000) {
    return "LEO";
  }
  if (altKm < 35786) {
    return "MEO";
  }
  if (altKm <= 35800) {
    return "GEO";
  }
  return "HEO";
}

function solveKepler(M, e) {
  M = ((M % TWO_PI) + TWO_PI) % TWO_PI;
  let E = M;
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) {
      break;
    }
  }
  return E;
}

const scratchIcrfToFixed = new Matrix3();
const scratchFixedToIcrf = new Matrix3();
const scratchEciCam = new Cartesian3();

function keplerianToEci(bookmark, simTimeSec) {
  const a = EARTH_RADIUS + bookmark.altitudeKm * 1000;
  const e = bookmark.eccentricity || 0;
  const inc = (bookmark.inclinationDeg || 0) * DEG;
  const raan = (bookmark.raanDeg || 0) * DEG;
  const argP = (bookmark.argPerigeeDeg || 0) * DEG;
  const M0 = (bookmark.meanAnomalyDeg || 0) * DEG;
  const n = Math.sqrt(EARTH_GM / (a * a * a));
  const M = M0 + n * simTimeSec;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sqrt1me2 = Math.sqrt(1 - e * e);
  const denom = 1 - e * cosE;
  const cosV = (cosE - e) / denom;
  const sinV = (sqrt1me2 * sinE) / denom;
  const r = a * denom;
  const xP = r * cosV;
  const yP = r * sinV;
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);
  const cosW = Math.cos(argP);
  const sinW = Math.sin(argP);
  return new Cartesian3(
    (cosO * cosW - sinO * sinW * cosI) * xP +
      (-cosO * sinW - sinO * cosW * cosI) * yP,
    (sinO * cosW + cosO * sinW * cosI) * xP +
      (-sinO * sinW + cosO * cosW * cosI) * yP,
    sinW * sinI * xP + cosW * sinI * yP,
  );
}

function eciToEcef(eciPos, julianDate) {
  let icrfToFixed = Transforms.computeIcrfToFixedMatrix(
    julianDate,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    icrfToFixed = Transforms.computeTemeToPseudoFixedMatrix(
      julianDate,
      scratchIcrfToFixed,
    );
  }
  if (!defined(icrfToFixed)) {
    return Cartesian3.clone(eciPos);
  }
  return Matrix3.multiplyByVector(icrfToFixed, eciPos, new Cartesian3());
}

function keplerianToEcef(bookmark, simTimeSec, clock) {
  const eci = keplerianToEci(bookmark, simTimeSec);
  return eciToEcef(eci, clock.currentTime);
}

function keplerianToEcefAtDate(bookmark, simTimeSec, julianDate) {
  const eci = keplerianToEci(bookmark, simTimeSec);
  return eciToEcef(eci, julianDate);
}

function cameraToEciLongitude(camera, clock) {
  let icrfToFixed = Transforms.computeIcrfToFixedMatrix(
    clock.currentTime,
    scratchIcrfToFixed,
  );
  if (!defined(icrfToFixed)) {
    icrfToFixed = Transforms.computeTemeToPseudoFixedMatrix(
      clock.currentTime,
      scratchIcrfToFixed,
    );
  }
  if (!defined(icrfToFixed)) {
    const c = Cartographic.fromCartesian(camera.positionWC, Ellipsoid.WGS84);
    return defined(c) ? CesiumMath.toDegrees(c.longitude) : 0;
  }
  Matrix3.transpose(icrfToFixed, scratchFixedToIcrf);
  Matrix3.multiplyByVector(
    scratchFixedToIcrf,
    camera.positionWC,
    scratchEciCam,
  );
  return CesiumMath.toDegrees(Math.atan2(scratchEciCam.y, scratchEciCam.x));
}

function elevationAzimuth(observerLatDeg, observerLonDeg, satEcef) {
  const obsEcef = Cartesian3.fromDegrees(observerLonDeg, observerLatDeg, 0);
  const dx = satEcef.x - obsEcef.x;
  const dy = satEcef.y - obsEcef.y;
  const dz = satEcef.z - obsEcef.z;
  const lat = observerLatDeg * DEG;
  const lon = observerLonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  const horiz = Math.sqrt(east * east + north * north);
  let az = CesiumMath.toDegrees(Math.atan2(east, north));
  if (az < 0) {
    az += 360;
  }
  return {
    elevation: CesiumMath.toDegrees(Math.atan2(up, horiz)),
    azimuth: az,
  };
}

function compassLabel(azDeg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(azDeg / 45) % 8];
}

function parseTle(text) {
  const lines = text
    .trim()
    .split("\n")
    .map(function (l) {
      return l.trim();
    })
    .filter(function (l) {
      return l.length > 0;
    });
  let name, line2;
  if (lines.length >= 3 && !lines[0].startsWith("1 ")) {
    name = lines[0];
    line2 = lines[2];
  } else if (lines.length >= 2) {
    name = "Satellite";
    line2 = lines[1];
  } else {
    return null;
  }
  if (!line2.startsWith("2 ")) {
    return null;
  }
  const inc = parseFloat(line2.substring(8, 16));
  const raan = parseFloat(line2.substring(17, 25));
  const ecc = parseFloat(`0.${line2.substring(26, 33)}`);
  const argP = parseFloat(line2.substring(34, 42));
  const ma = parseFloat(line2.substring(43, 51));
  const mm = parseFloat(line2.substring(52, 63));
  if (isNaN(inc) || isNaN(mm) || mm <= 0) {
    return null;
  }
  const nRadSec = (mm * TWO_PI) / 86400;
  const a = Math.pow(EARTH_GM / (nRadSec * nRadSec), 1 / 3);
  return {
    name: name.replace(/^\d\s+/, ""),
    altitudeKm: (a - EARTH_RADIUS) / 1000,
    eccentricity: ecc,
    inclinationDeg: inc,
    raanDeg: raan,
    argPerigeeDeg: argP,
    meanAnomalyDeg: ma,
  };
}

function predictPasses(
  bookmark,
  simTimeStart,
  clockStartDate,
  obsLatDeg,
  obsLonDeg,
  maxPasses,
) {
  const passes = [];
  const step = 15;
  const total = 24 * 3600;
  let inPass = false;
  let pass = null;
  const futureDate = JulianDate.clone(clockStartDate);

  for (let dt = 0; dt < total; dt += step) {
    JulianDate.addSeconds(clockStartDate, dt, futureDate);
    const satPos = keplerianToEcefAtDate(
      bookmark,
      simTimeStart + dt,
      futureDate,
    );
    const ea = elevationAzimuth(obsLatDeg, obsLonDeg, satPos);

    if (ea.elevation > 0) {
      if (!inPass) {
        inPass = true;
        pass = {
          startMin: Math.round(dt / 60),
          maxEl: ea.elevation,
          maxElAz: ea.azimuth,
          riseAz: ea.azimuth,
        };
      }
      if (ea.elevation > pass.maxEl) {
        pass.maxEl = ea.elevation;
        pass.maxElAz = ea.azimuth;
      }
    } else if (inPass) {
      inPass = false;
      pass.endMin = Math.round(dt / 60);
      pass.durMin = pass.endMin - pass.startMin;
      pass.setAz = ea.azimuth;
      passes.push(pass);
      if (passes.length >= (maxPasses || 5)) {
        break;
      }
    }
  }
  return passes;
}

const TRACKER_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect x="26" y="26" width="12" height="16" rx="2" fill="#8CB4D8"/>
  <rect x="6" y="30" width="20" height="4" fill="#4A90D9"/>
  <rect x="6" y="36" width="20" height="4" fill="#4A90D9"/>
  <rect x="38" y="30" width="20" height="4" fill="#4A90D9"/>
  <rect x="38" y="36" width="20" height="4" fill="#4A90D9"/>
  <path d="M24,22 Q32,10 40,22" fill="none" stroke="#FFD700" stroke-width="2"/>
  <line x1="32" y1="26" x2="32" y2="16" stroke="#FFD700" stroke-width="1.5"/>
  <circle cx="32" cy="14" r="2.5" fill="#FF6B6B"/>
  <path d="M42,12 Q47,16 42,20" fill="none" stroke="#FF6B6B" stroke-width="1" opacity="0.6"/>
  <path d="M45,9 Q52,16 45,23" fill="none" stroke="#FF6B6B" stroke-width="1" opacity="0.35"/>
</svg>`;

const PRESET_ICONS = [
  {
    name: "Comm Satellite",
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="24" y="22" width="16" height="20" rx="2" fill="#8CB4D8"/>
      <rect x="4" y="26" width="20" height="3" fill="#4A90D9"/>
      <rect x="4" y="31" width="20" height="3" fill="#4A90D9"/>
      <rect x="40" y="26" width="20" height="3" fill="#4A90D9"/>
      <rect x="40" y="31" width="20" height="3" fill="#4A90D9"/>
      <circle cx="32" cy="18" r="5" fill="none" stroke="#FFD700" stroke-width="1.5"/>
      <line x1="32" y1="13" x2="32" y2="8" stroke="#FFD700" stroke-width="1.5"/>
      <circle cx="32" cy="7" r="2" fill="#FFD700"/>
      <rect x="29" y="42" width="6" height="4" fill="#6A8EB5"/>
    </svg>`,
  },
  {
    name: "Space Station",
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="28" width="28" height="8" rx="2" fill="#C0C0C0"/>
      <rect x="2" y="24" width="14" height="4" fill="#4A7FBF"/>
      <rect x="2" y="30" width="14" height="4" fill="#4A7FBF"/>
      <rect x="2" y="36" width="14" height="4" fill="#4A7FBF"/>
      <rect x="48" y="24" width="14" height="4" fill="#4A7FBF"/>
      <rect x="48" y="30" width="14" height="4" fill="#4A7FBF"/>
      <rect x="48" y="36" width="14" height="4" fill="#4A7FBF"/>
      <rect x="28" y="18" width="8" height="10" rx="1" fill="#A0A0A0"/>
      <rect x="28" y="36" width="8" height="10" rx="1" fill="#A0A0A0"/>
      <circle cx="32" cy="32" r="3" fill="#E8E8E8" stroke="#888" stroke-width="0.5"/>
    </svg>`,
  },
  {
    name: "GPS Satellite",
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <polygon points="32,8 38,20 26,20" fill="#E8C840"/>
      <rect x="26" y="20" width="12" height="24" rx="2" fill="#5A8ABF"/>
      <rect x="6" y="24" width="20" height="16" fill="#3A6A9F"/>
      <rect x="38" y="24" width="20" height="16" fill="#3A6A9F"/>
      <line x1="16" y1="24" x2="16" y2="40" stroke="#2A5A8F" stroke-width="0.5"/>
      <line x1="48" y1="24" x2="48" y2="40" stroke="#2A5A8F" stroke-width="0.5"/>
      <rect x="29" y="44" width="6" height="8" fill="#4A7AAF"/>
      <circle cx="32" cy="56" r="4" fill="none" stroke="#E8C840" stroke-width="1.5"/>
    </svg>`,
  },
  {
    name: "Telescope",
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="14" width="24" height="36" rx="4" fill="#B0B0B0"/>
      <ellipse cx="32" cy="14" rx="12" ry="4" fill="#808080"/>
      <ellipse cx="32" cy="14" rx="8" ry="2.5" fill="#1a1a2e"/>
      <rect x="8" y="28" width="12" height="3" fill="#4A90D9"/>
      <rect x="8" y="33" width="12" height="3" fill="#4A90D9"/>
      <rect x="44" y="28" width="12" height="3" fill="#4A90D9"/>
      <rect x="44" y="33" width="12" height="3" fill="#4A90D9"/>
      <rect x="26" y="50" width="12" height="4" rx="1" fill="#909090"/>
      <circle cx="28" cy="24" r="2" fill="#FFD700"/>
      <circle cx="36" cy="30" r="1.5" fill="#FF6B6B"/>
    </svg>`,
  },
  {
    name: "Weather Satellite",
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="12" fill="#6AAF6A"/>
      <circle cx="32" cy="32" r="8" fill="#4A8F4A"/>
      <circle cx="32" cy="32" r="3" fill="#2A6F2A"/>
      <rect x="4" y="29" width="16" height="6" fill="#4A90D9"/>
      <rect x="44" y="29" width="16" height="6" fill="#4A90D9"/>
      <line x1="32" y1="8" x2="32" y2="20" stroke="#888" stroke-width="1.5"/>
      <circle cx="32" cy="7" r="3" fill="none" stroke="#FFD700" stroke-width="1"/>
      <line x1="32" y1="44" x2="32" y2="56" stroke="#888" stroke-width="1.5"/>
      <rect x="29" y="56" width="6" height="3" fill="#888"/>
    </svg>`,
  },
  {
    name: "Tracker",
    svg: TRACKER_SVG,
  },
];

function svgToDataUri(svgString) {
  const cleaned = svgString.trim();
  return `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(cleaned)),
  )}`;
}

function createOrbitState() {
  return {
    active: false,
    speed: 1,
    accumulatedSeconds: 0,
    startTime: 0,
    tetherVisible: true,
  };
}

function migrateBookmark(b) {
  if (!defined(b.mode)) {
    if (defined(b.inclinationDeg)) {
      b.mode = "keplerian";
    } else {
      b.mode = "simple";
      b.lon = b.lon || 0;
      b.lat = b.lat || 0;
    }
  }
  return b;
}

function SatelliteBookmarksViewModel(scene, clock, dataSources) {
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }

  this._scene = scene;
  this._clock = clock;
  this._dataSources = dataSources;

  this._dataSource = new CustomDataSource("satellite-bookmarks");
  if (defined(dataSources)) {
    dataSources.add(this._dataSource);
  }

  this._tetherLines = new PolylineCollection();
  scene.primitives.add(this._tetherLines);
  this._tetherLineRefs = [];

  this._orbitStates = [];
  this._postUpdateListener = null;

  this.panelVisible = false;
  this.bookmarks = [];
  this.selectedIndex = -1;
  this.formMode = "simple";
  this.newName = "";
  this.newLat = "0";
  this.newLon = "0";
  this.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
  this.newEccentricity = "0";
  this.newInclination = "51.6";
  this.newRaan = "0";
  this.newArgPerigee = "0";
  this.newMeanAnomaly = "0";
  this.newTle = "";
  this.tleError = "";
  this.selectedPresetIndex = 0;
  this.showAddForm = false;
  this.customSvgData = "";
  this.orbitFlags = [];
  this.orbitSpeedLabels = [];
  this.tetherFlags = [];
  this.selectedPasses = [];

  knockout.track(this, [
    "panelVisible",
    "bookmarks",
    "selectedIndex",
    "formMode",
    "newName",
    "newLat",
    "newLon",
    "newAltitudeKm",
    "newEccentricity",
    "newInclination",
    "newRaan",
    "newArgPerigee",
    "newMeanAnomaly",
    "newTle",
    "tleError",
    "selectedPresetIndex",
    "showAddForm",
    "customSvgData",
    "orbitFlags",
    "orbitSpeedLabels",
    "tetherFlags",
    "selectedPasses",
  ]);

  const that = this;
  this._presetIcons = PRESET_ICONS;
  this._loadBookmarks();

  this._command = createCommand(function () {
    that.panelVisible = !that.panelVisible;
  });

  this._setFormModeCommand = createCommand(function (mode) {
    that.formMode = mode;
  });

  this._toggleAddFormCommand = createCommand(function () {
    that.showAddForm = !that.showAddForm;
    if (that.showAddForm) {
      that._resetForm();
    }
  });

  this._addBookmarkCommand = createCommand(function () {
    that._addBookmark();
  });

  this._cyclePresetCommand = createCommand(function (direction) {
    let idx = that.selectedPresetIndex + direction;
    if (idx < 0) {
      idx = PRESET_ICONS.length - 1;
    }
    if (idx >= PRESET_ICONS.length) {
      idx = 0;
    }
    that.selectedPresetIndex = idx;
  });

  this._selectBookmarkCommand = createCommand(function (index) {
    if (that.selectedIndex === index) {
      that.selectedIndex = -1;
      that.selectedPasses = [];
    } else {
      that.selectedIndex = index;
      that.selectedPasses = [];
    }
  });

  this._flyToBookmarkCommand = createCommand(function (index) {
    that._flyToBookmark(index);
  });

  this._toggleOrbitCommand = createCommand(function (index) {
    that._toggleOrbit(index);
  });

  this._setOrbitSpeedCommand = createCommand(function (args) {
    that._setOrbitSpeed(args.index, args.value);
  });

  this._toggleTetherCommand = createCommand(function (index) {
    that._toggleTether(index);
  });

  this._predictPassesCommand = createCommand(function (index) {
    that._predictPasses(index);
  });

  this._removeBookmarkCommand = createCommand(function (index) {
    that._stopOrbit(index);
    const updated = that.bookmarks.slice();
    updated.splice(index, 1);
    that._orbitStates.splice(index, 1);
    that.bookmarks = updated;
    that._syncOrbitUI();
    if (that.selectedIndex === index) {
      that.selectedIndex = -1;
      that.selectedPasses = [];
    } else if (that.selectedIndex > index) {
      that.selectedIndex--;
    }
    that._syncEntities();
    that._saveBookmarks();
  });

  this.tooltip = "Satellite Bookmarks";
}

SatelliteBookmarksViewModel.prototype._resetForm = function () {
  this.newName = "";
  this.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
  this.newEccentricity = "0";
  this.newInclination = "51.6";
  this.newArgPerigee = "0";
  this.newMeanAnomaly = "0";
  this.newTle = "";
  this.tleError = "";
  this.selectedPresetIndex = 0;
  this.customSvgData = "";

  const cartographic = Cartographic.fromCartesian(
    this._scene.camera.positionWC,
    Ellipsoid.WGS84,
  );
  if (defined(cartographic)) {
    this.newLat = CesiumMath.toDegrees(cartographic.latitude).toFixed(2);
    this.newLon = CesiumMath.toDegrees(cartographic.longitude).toFixed(2);
  } else {
    this.newLat = "0";
    this.newLon = "0";
  }

  const eciLon = cameraToEciLongitude(this._scene.camera, this._clock);
  this.newRaan = (((eciLon % 360) + 360) % 360).toFixed(1);
};

SatelliteBookmarksViewModel.prototype._addBookmark = function () {
  let svgData;
  if (this.customSvgData && this.customSvgData.trim().length > 0) {
    svgData = this.customSvgData.trim();
  } else {
    svgData = PRESET_ICONS[this.selectedPresetIndex].svg;
  }

  let bookmark;

  if (this.formMode === "tle") {
    const parsed = parseTle(this.newTle);
    if (!parsed) {
      this.tleError = "Invalid TLE format";
      return;
    }
    this.tleError = "";
    bookmark = {
      mode: "keplerian",
      name: this.newName.trim() || parsed.name,
      altitudeKm: parsed.altitudeKm,
      eccentricity: parsed.eccentricity,
      inclinationDeg: parsed.inclinationDeg,
      raanDeg: parsed.raanDeg,
      argPerigeeDeg: parsed.argPerigeeDeg,
      meanAnomalyDeg: parsed.meanAnomalyDeg,
      orbitBand: getOrbitBand(parsed.altitudeKm),
      svg: TRACKER_SVG,
      presetIndex: -1,
    };
  } else if (this.formMode === "keplerian") {
    const altKm = parseFloat(this.newAltitudeKm) || DEFAULT_ALTITUDE_KM;
    bookmark = {
      mode: "keplerian",
      name: this.newName.trim() || `Satellite ${this.bookmarks.length + 1}`,
      altitudeKm: Math.max(altKm, 160),
      eccentricity: CesiumMath.clamp(
        parseFloat(this.newEccentricity) || 0,
        0,
        0.99,
      ),
      inclinationDeg: parseFloat(this.newInclination) || 0,
      raanDeg: parseFloat(this.newRaan) || 0,
      argPerigeeDeg: parseFloat(this.newArgPerigee) || 0,
      meanAnomalyDeg: parseFloat(this.newMeanAnomaly) || 0,
      orbitBand: getOrbitBand(altKm),
      svg: svgData,
      presetIndex: this.customSvgData ? -1 : this.selectedPresetIndex,
    };
  } else {
    const altKm = parseFloat(this.newAltitudeKm) || DEFAULT_ALTITUDE_KM;
    bookmark = {
      mode: "simple",
      name: this.newName.trim() || `Satellite ${this.bookmarks.length + 1}`,
      lon: CesiumMath.clamp(parseFloat(this.newLon) || 0, -180, 180),
      lat: CesiumMath.clamp(parseFloat(this.newLat) || 0, -90, 90),
      altitudeKm: Math.max(altKm, 160),
      orbitBand: getOrbitBand(altKm),
      svg: svgData,
      presetIndex: this.customSvgData ? -1 : this.selectedPresetIndex,
    };
  }

  const updated = this.bookmarks.slice();
  updated.push(bookmark);
  this._orbitStates.push(createOrbitState());
  this.bookmarks = updated;
  this._syncOrbitUI();
  this._syncEntities();
  this.showAddForm = false;
  this._resetForm();
  this._saveBookmarks();
};

SatelliteBookmarksViewModel.prototype._getSimTime = function (index) {
  const state = this._orbitStates[index];
  if (!state) {
    return 0;
  }
  let t = state.accumulatedSeconds;
  if (state.active) {
    t += ((performance.now() - state.startTime) / 1000) * state.speed;
  }
  return t;
};

SatelliteBookmarksViewModel.prototype._computeSatellitePosition = function (
  index,
) {
  const b = this.bookmarks[index];
  if (!defined(b)) {
    return Cartesian3.ZERO;
  }
  if (b.mode === "simple") {
    return Cartesian3.fromDegrees(b.lon, b.lat, b.altitudeKm * 1000);
  }
  return keplerianToEcef(b, this._getSimTime(index), this._clock);
};

SatelliteBookmarksViewModel.prototype._computeGroundPosition = function (
  index,
) {
  const b = this.bookmarks[index];
  if (!defined(b)) {
    return Cartesian3.ZERO;
  }
  if (b.mode === "simple") {
    return Cartesian3.fromDegrees(b.lon, b.lat, 0);
  }
  const satPos = this._computeSatellitePosition(index);
  const cartographic = Cartographic.fromCartesian(satPos, Ellipsoid.WGS84);
  if (!defined(cartographic)) {
    return Cartesian3.ZERO;
  }
  return Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    0,
  );
};

SatelliteBookmarksViewModel.prototype._flyToBookmark = function (index) {
  const bookmark = this.bookmarks[index];
  if (!defined(bookmark)) {
    return;
  }
  const satellitePosition = this._computeSatellitePosition(index);
  const altMeters = bookmark.altitudeKm * 1000;
  const viewDistance = Math.max(altMeters * 0.3, 50000);
  this._scene.camera.flyToBoundingSphere(
    new BoundingSphere(satellitePosition, viewDistance / 6),
    {
      offset: new HeadingPitchRange(0, -CesiumMath.PI_OVER_FOUR, viewDistance),
      duration: 2,
    },
  );
};

SatelliteBookmarksViewModel.prototype._toggleOrbit = function (index) {
  const state = this._orbitStates[index];
  if (!state) {
    return;
  }
  if (state.active) {
    this._stopOrbit(index);
  } else {
    state.startTime = performance.now();
    state.active = true;
    this._startAnimationLoop();
  }
  this._syncOrbitUI();
};

SatelliteBookmarksViewModel.prototype._stopOrbit = function (index) {
  const state = this._orbitStates[index];
  if (!state || !state.active) {
    return;
  }
  state.accumulatedSeconds +=
    ((performance.now() - state.startTime) / 1000) * state.speed;
  state.active = false;
  this._checkStopAnimationLoop();
};

SatelliteBookmarksViewModel.prototype._setOrbitSpeed = function (index, value) {
  const state = this._orbitStates[index];
  if (!state) {
    return;
  }
  if (state.active) {
    state.accumulatedSeconds +=
      ((performance.now() - state.startTime) / 1000) * state.speed;
    state.startTime = performance.now();
  }
  state.speed = parseInt(value, 10) || 1;
  this._syncOrbitUI();
};

SatelliteBookmarksViewModel.prototype._toggleTether = function (index) {
  const state = this._orbitStates[index];
  if (!state) {
    return;
  }
  state.tetherVisible = !state.tetherVisible;
  const line = this._tetherLineRefs[index];
  if (defined(line)) {
    line.show = state.tetherVisible;
  }
  this._syncOrbitUI();
  this._scene.requestRender();
};

SatelliteBookmarksViewModel.prototype._predictPasses = function (index) {
  const b = this.bookmarks[index];
  if (!defined(b) || b.mode !== "keplerian") {
    this.selectedPasses = [];
    return;
  }

  const cartographic = Cartographic.fromCartesian(
    this._scene.camera.positionWC,
    Ellipsoid.WGS84,
  );
  if (!defined(cartographic)) {
    this.selectedPasses = [];
    return;
  }

  const obsLat = CesiumMath.toDegrees(cartographic.latitude);
  const obsLon = CesiumMath.toDegrees(cartographic.longitude);
  const simTime = this._getSimTime(index);

  const raw = predictPasses(
    b,
    simTime,
    this._clock.currentTime,
    obsLat,
    obsLon,
    5,
  );

  if (raw.length === 0) {
    this.selectedPasses = [
      {
        startLabel: "None",
        duration: "No passes in next 24h",
        maxEl: "",
        maxElDir: "",
        riseDir: "",
        setDir: "",
      },
    ];
    return;
  }

  this.selectedPasses = raw.map(function (p) {
    return {
      startLabel:
        p.startMin < 60
          ? `in ${p.startMin} min`
          : `in ${(p.startMin / 60).toFixed(1)} hr`,
      duration: `${p.durMin} min`,
      maxEl: `${p.maxEl.toFixed(1)}°`,
      maxElDir: compassLabel(p.maxElAz),
      riseDir: compassLabel(p.riseAz),
      setDir: compassLabel(p.setAz),
    };
  });
};

SatelliteBookmarksViewModel.prototype._syncOrbitUI = function () {
  this.orbitFlags = this._orbitStates.map(function (s) {
    return s.active;
  });
  this.orbitSpeedLabels = this._orbitStates.map(function (s) {
    return `${s.speed}x`;
  });
  this.tetherFlags = this._orbitStates.map(function (s) {
    return s.tetherVisible;
  });
};

SatelliteBookmarksViewModel.prototype._startAnimationLoop = function () {
  if (this._postUpdateListener) {
    return;
  }
  const that = this;
  this._postUpdateListener = this._scene.postUpdate.addEventListener(
    function () {
      that._updateOrbitingEntities();
    },
  );
};

SatelliteBookmarksViewModel.prototype._checkStopAnimationLoop = function () {
  const anyActive = this._orbitStates.some(function (s) {
    return s.active;
  });
  if (!anyActive && this._postUpdateListener) {
    this._postUpdateListener();
    this._postUpdateListener = null;
    this._updateOrbitingEntities();
  }
};

SatelliteBookmarksViewModel.prototype._updateOrbitingEntities = function () {
  for (let i = 0; i < this.bookmarks.length; i++) {
    const line = this._tetherLineRefs[i];
    if (defined(line) && line.show) {
      line.positions = [
        this._computeGroundPosition(i),
        this._computeSatellitePosition(i),
      ];
    }
  }
  this._scene.requestRender();
};

SatelliteBookmarksViewModel.prototype._syncEntities = function () {
  const ds = this._dataSource;
  if (!defined(ds)) {
    return;
  }

  ds.entities.removeAll();
  this._tetherLines.removeAll();
  this._tetherLineRefs = [];

  const that = this;
  for (let i = 0; i < this.bookmarks.length; i++) {
    const b = this.bookmarks[i];
    const idx = i;
    const state = this._orbitStates[i];

    const positionProperty = new CallbackProperty(function () {
      return that._computeSatellitePosition(idx);
    }, false);

    ds.entities.add({
      id: `sat-bookmark-${i}`,
      name: b.name,
      position: positionProperty,
      billboard: {
        image: new ConstantProperty(svgToDataUri(b.svg)),
        width: new ConstantProperty(32),
        height: new ConstantProperty(32),
        verticalOrigin: new ConstantProperty(VerticalOrigin.CENTER),
        scaleByDistance: new ConstantProperty(
          new NearFarScalar(1e4, 1.5, 1e7, 0.3),
        ),
      },
      label: {
        text: new ConstantProperty(b.name),
        font: new ConstantProperty("12px sans-serif"),
        fillColor: new ConstantProperty(Color.WHITE),
        outlineColor: new ConstantProperty(Color.BLACK),
        outlineWidth: new ConstantProperty(2),
        style: new ConstantProperty(LabelStyle.FILL_AND_OUTLINE),
        verticalOrigin: new ConstantProperty(VerticalOrigin.BOTTOM),
        pixelOffset: new ConstantProperty(new Cartesian2(0, -20)),
        scaleByDistance: new ConstantProperty(
          new NearFarScalar(1e4, 1.0, 1e7, 0.3),
        ),
      },
    });

    const tetherVisible = state ? state.tetherVisible : true;
    const line = this._tetherLines.add({
      positions: [
        this._computeGroundPosition(i),
        this._computeSatellitePosition(i),
      ],
      width: 1.5,
      material: Material.fromType("Color", {
        color: Color.fromCssColorString("rgba(106, 170, 255, 0.5)"),
      }),
      show: tetherVisible,
    });
    this._tetherLineRefs.push(line);
  }

  this._scene.requestRender();
};

SatelliteBookmarksViewModel.prototype._destroyDataSource = function () {
  if (this._postUpdateListener) {
    this._postUpdateListener();
    this._postUpdateListener = null;
  }
  if (defined(this._tetherLines)) {
    this._scene.primitives.remove(this._tetherLines);
  }
  if (defined(this._dataSources) && defined(this._dataSource)) {
    this._dataSources.remove(this._dataSource, true);
  }
};

SatelliteBookmarksViewModel.prototype._saveBookmarks = function () {
  try {
    const data = this.bookmarks.map(function (b) {
      const entry = {
        mode: b.mode,
        name: b.name,
        altitudeKm: b.altitudeKm,
        orbitBand: b.orbitBand,
        svg: b.svg,
        presetIndex: b.presetIndex,
      };
      if (b.mode === "simple") {
        entry.lon = b.lon;
        entry.lat = b.lat;
      } else {
        entry.eccentricity = b.eccentricity;
        entry.inclinationDeg = b.inclinationDeg;
        entry.raanDeg = b.raanDeg;
        entry.argPerigeeDeg = b.argPerigeeDeg;
        entry.meanAnomalyDeg = b.meanAnomalyDeg;
      }
      return entry;
    });
    localStorage.setItem("cesium-satellite-bookmarks", JSON.stringify(data));
  } catch (e) {
    // localStorage may be unavailable
  }
};

SatelliteBookmarksViewModel.prototype._loadBookmarks = function () {
  try {
    const raw = localStorage.getItem("cesium-satellite-bookmarks");
    if (raw) {
      const parsed = JSON.parse(raw).map(migrateBookmark);
      this.bookmarks = parsed;
      this._orbitStates = parsed.map(function () {
        return createOrbitState();
      });
      this._syncOrbitUI();
      this._syncEntities();
    }
  } catch (e) {
    this.bookmarks = [];
    this._orbitStates = [];
  }
};

SatelliteBookmarksViewModel.prototype.handleSvgUpload = function (file) {
  if (!file || !file.name.toLowerCase().endsWith(".svg")) {
    return;
  }
  const that = this;
  const reader = new FileReader();
  reader.onload = function (e) {
    that.customSvgData = e.target.result;
  };
  reader.readAsText(file);
};

SatelliteBookmarksViewModel.prototype.getOrbitSpeedValue = function (index) {
  const state = this._orbitStates[index];
  return state ? String(state.speed) : "1";
};

SatelliteBookmarksViewModel.prototype.isKeplerian = function (index) {
  const b = this.bookmarks[index];
  return defined(b) && b.mode === "keplerian";
};

Object.defineProperties(SatelliteBookmarksViewModel.prototype, {
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
  setFormModeCommand: {
    get: function () {
      return this._setFormModeCommand;
    },
  },
  toggleAddFormCommand: {
    get: function () {
      return this._toggleAddFormCommand;
    },
  },
  addBookmarkCommand: {
    get: function () {
      return this._addBookmarkCommand;
    },
  },
  cyclePresetCommand: {
    get: function () {
      return this._cyclePresetCommand;
    },
  },
  selectBookmarkCommand: {
    get: function () {
      return this._selectBookmarkCommand;
    },
  },
  flyToBookmarkCommand: {
    get: function () {
      return this._flyToBookmarkCommand;
    },
  },
  toggleOrbitCommand: {
    get: function () {
      return this._toggleOrbitCommand;
    },
  },
  setOrbitSpeedCommand: {
    get: function () {
      return this._setOrbitSpeedCommand;
    },
  },
  toggleTetherCommand: {
    get: function () {
      return this._toggleTetherCommand;
    },
  },
  predictPassesCommand: {
    get: function () {
      return this._predictPassesCommand;
    },
  },
  removeBookmarkCommand: {
    get: function () {
      return this._removeBookmarkCommand;
    },
  },
  presetIcons: {
    get: function () {
      return this._presetIcons;
    },
  },
});

export default SatelliteBookmarksViewModel;
