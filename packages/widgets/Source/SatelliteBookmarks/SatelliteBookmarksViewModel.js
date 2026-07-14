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
const scratchEci = new Cartesian3();
const scratchEciCam = new Cartesian3();

function keplerianToEcef(bookmark, simTimeSec, clock) {
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

  scratchEci.x =
    (cosO * cosW - sinO * sinW * cosI) * xP +
    (-cosO * sinW - sinO * cosW * cosI) * yP;
  scratchEci.y =
    (sinO * cosW + cosO * sinW * cosI) * xP +
    (-sinO * sinW + cosO * cosW * cosI) * yP;
  scratchEci.z = sinW * sinI * xP + cosW * sinI * yP;

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
    return Cartesian3.clone(scratchEci);
  }

  return Matrix3.multiplyByVector(icrfToFixed, scratchEci, new Cartesian3());
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
  this.useKeplerian = true;
  this.newName = "";
  this.newLat = "0";
  this.newLon = "0";
  this.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
  this.newEccentricity = "0";
  this.newInclination = "51.6";
  this.newRaan = "0";
  this.newArgPerigee = "0";
  this.newMeanAnomaly = "0";
  this.selectedPresetIndex = 0;
  this.showAddForm = false;
  this.customSvgData = "";
  this.orbitFlags = [];
  this.orbitSpeedLabels = [];
  this.tetherFlags = [];

  knockout.track(this, [
    "panelVisible",
    "bookmarks",
    "selectedIndex",
    "useKeplerian",
    "newName",
    "newLat",
    "newLon",
    "newAltitudeKm",
    "newEccentricity",
    "newInclination",
    "newRaan",
    "newArgPerigee",
    "newMeanAnomaly",
    "selectedPresetIndex",
    "showAddForm",
    "customSvgData",
    "orbitFlags",
    "orbitSpeedLabels",
    "tetherFlags",
  ]);

  const that = this;
  this._presetIcons = PRESET_ICONS;
  this._loadBookmarks();

  this._command = createCommand(function () {
    that.panelVisible = !that.panelVisible;
  });

  this._toggleModeCommand = createCommand(function () {
    that.useKeplerian = !that.useKeplerian;
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
    that.selectedIndex = that.selectedIndex === index ? -1 : index;
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

  this._removeBookmarkCommand = createCommand(function (index) {
    that._stopOrbit(index);
    const updated = that.bookmarks.slice();
    updated.splice(index, 1);
    that._orbitStates.splice(index, 1);
    that.bookmarks = updated;
    that._syncOrbitUI();
    if (that.selectedIndex === index) {
      that.selectedIndex = -1;
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
  this.newRaan = ((eciLon % 360) + 360).toFixed(1);
};

SatelliteBookmarksViewModel.prototype._addBookmark = function () {
  const altKm = parseFloat(this.newAltitudeKm) || DEFAULT_ALTITUDE_KM;

  let svgData;
  if (this.customSvgData && this.customSvgData.trim().length > 0) {
    svgData = this.customSvgData.trim();
  } else {
    svgData = PRESET_ICONS[this.selectedPresetIndex].svg;
  }

  let bookmark;

  if (this.useKeplerian) {
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
  const boundingSphere = new BoundingSphere(
    satellitePosition,
    viewDistance / 6,
  );

  this._scene.camera.flyToBoundingSphere(boundingSphere, {
    offset: new HeadingPitchRange(0, -CesiumMath.PI_OVER_FOUR, viewDistance),
    duration: 2,
  });
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
  const bookmarks = this.bookmarks;
  for (let i = 0; i < bookmarks.length; i++) {
    const b = bookmarks[i];
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

    const groundPos = this._computeGroundPosition(i);
    const satPos = this._computeSatellitePosition(i);
    const tetherVisible = state ? state.tetherVisible : true;

    const line = this._tetherLines.add({
      positions: [groundPos, satPos],
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
  toggleModeCommand: {
    get: function () {
      return this._toggleModeCommand;
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
