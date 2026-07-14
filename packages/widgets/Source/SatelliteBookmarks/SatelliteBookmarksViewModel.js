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
  Ellipsoid,
  NearFarScalar,
  PolylineCollection,
  VerticalOrigin,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

const DEFAULT_ALTITUDE_KM = 400;
const EARTH_RADIUS = 6371000;
const EARTH_GM = 3.986004418e14;

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

function orbitalAngularVelocity(altKm) {
  const r = EARTH_RADIUS + altKm * 1000;
  return Math.sqrt(EARTH_GM / (r * r * r));
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
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(cleaned)))}`;
}

function createOrbitState() {
  return {
    active: false,
    speed: 1,
    direction: 1,
    accumulatedRadians: 0,
    startTime: 0,
    tetherVisible: true,
  };
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
  this._anyOrbiting = false;

  this.panelVisible = false;
  this.bookmarks = [];
  this.selectedIndex = -1;
  this.newName = "";
  this.newLat = "0";
  this.newLon = "0";
  this.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
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
    "newName",
    "newLat",
    "newLon",
    "newAltitudeKm",
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

  this._toggleAddFormCommand = createCommand(function () {
    that.showAddForm = !that.showAddForm;
    if (that.showAddForm) {
      that.newName = "";
      that.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
      that.selectedPresetIndex = 0;
      that.customSvgData = "";
      const cartographic = Cartographic.fromCartesian(
        that._scene.camera.positionWC,
        Ellipsoid.WGS84,
      );
      if (defined(cartographic)) {
        that.newLat = CesiumMath.toDegrees(cartographic.latitude).toFixed(2);
        that.newLon = CesiumMath.toDegrees(cartographic.longitude).toFixed(2);
      }
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

  this._toggleOrbitDirectionCommand = createCommand(function (index) {
    that._toggleOrbitDirection(index);
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

SatelliteBookmarksViewModel.prototype._addBookmark = function () {
  const lat = parseFloat(this.newLat) || 0;
  const lon = parseFloat(this.newLon) || 0;
  const altKm = parseFloat(this.newAltitudeKm) || DEFAULT_ALTITUDE_KM;

  let svgData;
  if (this.customSvgData && this.customSvgData.trim().length > 0) {
    svgData = this.customSvgData.trim();
  } else {
    svgData = PRESET_ICONS[this.selectedPresetIndex].svg;
  }

  const bookmark = {
    name: this.newName.trim() || `Satellite ${this.bookmarks.length + 1}`,
    lon: CesiumMath.clamp(lon, -180, 180),
    lat: CesiumMath.clamp(lat, -90, 90),
    altitudeKm: Math.max(altKm, 160),
    orbitBand: getOrbitBand(altKm),
    svg: svgData,
    presetIndex: this.customSvgData ? -1 : this.selectedPresetIndex,
  };

  const updated = this.bookmarks.slice();
  updated.push(bookmark);
  this._orbitStates.push(createOrbitState());
  this.bookmarks = updated;
  this._syncOrbitUI();
  this._syncEntities();
  this.showAddForm = false;
  this.newName = "";
  this.newLat = "0";
  this.newLon = "0";
  this.newAltitudeKm = String(DEFAULT_ALTITUDE_KM);
  this.customSvgData = "";
  this._saveBookmarks();
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

  const elapsed = (performance.now() - state.startTime) / 1000;
  const omega = orbitalAngularVelocity(this.bookmarks[index].altitudeKm);
  state.accumulatedRadians += elapsed * omega * state.speed * state.direction;
  state.active = false;
  this._checkStopAnimationLoop();
};

SatelliteBookmarksViewModel.prototype._setOrbitSpeed = function (index, value) {
  const state = this._orbitStates[index];
  if (!state) {
    return;
  }

  if (state.active) {
    const elapsed = (performance.now() - state.startTime) / 1000;
    const omega = orbitalAngularVelocity(this.bookmarks[index].altitudeKm);
    state.accumulatedRadians += elapsed * omega * state.speed * state.direction;
    state.startTime = performance.now();
  }
  state.speed = parseInt(value, 10) || 1;
  this._syncOrbitUI();
};

SatelliteBookmarksViewModel.prototype._toggleOrbitDirection = function (index) {
  const state = this._orbitStates[index];
  if (!state) {
    return;
  }

  if (state.active) {
    const elapsed = (performance.now() - state.startTime) / 1000;
    const omega = orbitalAngularVelocity(this.bookmarks[index].altitudeKm);
    state.accumulatedRadians += elapsed * omega * state.speed * state.direction;
    state.startTime = performance.now();
  }
  state.direction *= -1;
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
    const dir = s.direction > 0 ? "" : "-";
    return `${dir}${s.speed}x`;
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

SatelliteBookmarksViewModel.prototype._computeSatellitePosition = function (
  index,
) {
  const b = this.bookmarks[index];
  if (!defined(b)) {
    return Cartesian3.ZERO;
  }

  const state = this._orbitStates[index];
  let lon = b.lon;
  if (state) {
    let totalRad = state.accumulatedRadians;
    if (state.active) {
      const elapsed = (performance.now() - state.startTime) / 1000;
      totalRad +=
        elapsed *
        orbitalAngularVelocity(b.altitudeKm) *
        state.speed *
        state.direction;
    }
    lon += CesiumMath.toDegrees(totalRad);
  }
  return Cartesian3.fromDegrees(lon, b.lat, b.altitudeKm * 1000);
};

SatelliteBookmarksViewModel.prototype._computeGroundPosition = function (
  index,
) {
  const b = this.bookmarks[index];
  if (!defined(b)) {
    return Cartesian3.ZERO;
  }

  const state = this._orbitStates[index];
  let lon = b.lon;
  if (state) {
    let totalRad = state.accumulatedRadians;
    if (state.active) {
      const elapsed = (performance.now() - state.startTime) / 1000;
      totalRad +=
        elapsed *
        orbitalAngularVelocity(b.altitudeKm) *
        state.speed *
        state.direction;
    }
    lon += CesiumMath.toDegrees(totalRad);
  }
  return Cartesian3.fromDegrees(lon, b.lat, 0);
};

SatelliteBookmarksViewModel.prototype._updateOrbitingEntities = function () {
  for (let i = 0; i < this.bookmarks.length; i++) {
    const line = this._tetherLineRefs[i];
    if (defined(line) && line.show) {
      const groundPos = this._computeGroundPosition(i);
      const satPos = this._computeSatellitePosition(i);
      line.positions = [groundPos, satPos];
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
      return {
        name: b.name,
        lon: b.lon,
        lat: b.lat,
        altitudeKm: b.altitudeKm,
        orbitBand: b.orbitBand,
        svg: b.svg,
        presetIndex: b.presetIndex,
      };
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
      const parsed = JSON.parse(raw);
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
  toggleOrbitDirectionCommand: {
    get: function () {
      return this._toggleOrbitDirectionCommand;
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
