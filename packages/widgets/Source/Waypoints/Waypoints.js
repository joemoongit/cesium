import {
  defined,
  destroyObject,
  DeveloperError,
  getElement,
  Cartesian3,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import createCommand from "../createCommand.js";

/**
 * A toolbar widget that bookmarks camera views and flies back to them.
 *
 * @alias Waypoints
 * @constructor
 *
 * @param {Element|string} container The DOM element or ID that will contain the widget.
 * @param {Scene} scene The Scene instance whose camera is bookmarked.
 */
function Waypoints(container, scene) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }
  if (!defined(scene)) {
    throw new DeveloperError("scene is required.");
  }
  //>>includeEnd('debug');

  container = getElement(container);

  const that = this;
  this._scene = scene;
  this._camera = scene.camera;
  this._views = [];
  this._count = 0;
  // localStorage key under which saved views are persisted across reloads.
  this._storageKey = "cesium-waypoints";

  const tooltip = knockout.observable("Waypoints");
  const panelVisible = knockout.observable(false);

  const toggleCommand = createCommand(function () {
    panelVisible(!panelVisible());
  });

  this._viewModel = {
    tooltip: tooltip,
    panelVisible: panelVisible,
    toggleCommand: toggleCommand,
  };

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-waypoints-wrapper";

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "cesium-button cesium-toolbar-button cesium-waypoints-button";
  button.textContent = "⚑";
  button.setAttribute(
    "data-bind",
    "attr: { title: tooltip }, click: toggleCommand",
  );
  wrapper.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "cesium-waypoints-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-waypoints-panel-visible': panelVisible }",
  );

  const header = document.createElement("div");
  header.className = "cesium-waypoints-header";
  header.textContent = "Saved views";
  panel.appendChild(header);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "cesium-button cesium-waypoints-saveButton";
  saveButton.textContent = "Save view";
  saveButton.addEventListener("click", function () {
    that._saveView();
  });
  panel.appendChild(saveButton);

  const tourButton = document.createElement("button");
  tourButton.type = "button";
  tourButton.className = "cesium-button cesium-waypoints-tourButton";
  tourButton.textContent = "Play tour";
  tourButton.addEventListener("click", function () {
    that._playTour();
  });
  panel.appendChild(tourButton);

  const list = document.createElement("ul");
  list.className = "cesium-waypoints-list";
  panel.appendChild(list);
  this._list = list;

  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  knockout.applyBindings(this._viewModel, wrapper);

  // Collapse the panel when the user clicks outside the widget.
  this._onOutsidePointerDown = function (e) {
    if (panelVisible() && !wrapper.contains(e.target)) {
      panelVisible(false);
    }
  };
  document.addEventListener("pointerdown", this._onOutsidePointerDown, true);
  document.addEventListener("mousedown", this._onOutsidePointerDown, true);

  this._container = container;
  this._element = wrapper;

  // Restore any views persisted from a previous session so they survive reloads.
  this._loadPersistedViews();
}

Object.defineProperties(Waypoints.prototype, {
  container: {
    get: function () {
      return this._container;
    },
  },
  viewModel: {
    get: function () {
      return this._viewModel;
    },
  },
});

/**
 * Capture the current camera pose, add it to the list, and persist it.
 * @private
 */
Waypoints.prototype._saveView = function () {
  const camera = this._camera;
  const view = {
    destination: Cartesian3.clone(camera.position, new Cartesian3()),
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
  };
  this._views.push(view);
  this._addEntry(view);
  this._persistViews();
};

/**
 * Build the list entry (restore + delete controls) for an already-captured view.
 * Used both by _saveView and by _loadPersistedViews on reload.
 * @private
 */
Waypoints.prototype._addEntry = function (view) {
  this._count += 1;
  const that = this;

  const item = document.createElement("li");
  item.className = "cesium-waypoints-item";

  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "cesium-waypoints-entry";
  entry.textContent = `View ${this._count}`;
  entry.addEventListener("click", function () {
    that._flyToView(view);
  });
  item.appendChild(entry);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "cesium-waypoints-delete";
  deleteButton.title = "Delete";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", function () {
    const index = that._views.indexOf(view);
    if (index !== -1) {
      that._views.splice(index, 1);
    }
    item.remove();
    that._persistViews();
  });
  item.appendChild(deleteButton);

  this._list.appendChild(item);
};

/**
 * Serialize the saved views to localStorage.
 * @private
 */
Waypoints.prototype._persistViews = function () {
  try {
    const data = this._views.map(function (v) {
      return {
        destination: { x: v.destination.x, y: v.destination.y, z: v.destination.z },
        heading: v.heading,
        pitch: v.pitch,
        roll: v.roll,
      };
    });
    window.localStorage.setItem(this._storageKey, JSON.stringify(data));
  } catch (e) {
    // storage unavailable — persistence is best-effort.
  }
};

/**
 * Load persisted views from localStorage and rebuild their list entries.
 * @private
 */
Waypoints.prototype._loadPersistedViews = function () {
  let data;
  try {
    data = JSON.parse(window.localStorage.getItem(this._storageKey) || "[]");
  } catch (e) {
    data = [];
  }
  if (!Array.isArray(data)) {
    return;
  }
  const that = this;
  data.forEach(function (d) {
    if (!d || !d.destination) {
      return;
    }
    const view = {
      destination: new Cartesian3(d.destination.x, d.destination.y, d.destination.z),
      heading: d.heading,
      pitch: d.pitch,
      roll: d.roll,
    };
    that._views.push(view);
    that._addEntry(view);
  });
};

/**
 * Fly the camera through every saved view in list order, pausing briefly at each.
 * @private
 */
Waypoints.prototype._playTour = function () {
  const views = this._views.slice();
  const that = this;
  let index = 0;
  function next() {
    if (index >= views.length) {
      return;
    }
    that._flyToView(views[index]);
    index += 1;
    setTimeout(next, 1500);
  }
  next();
};

/**
 * Fly the camera back to a saved view.
 * @private
 */
Waypoints.prototype._flyToView = function (view) {
  this._camera.flyTo({
    destination: view.destination,
    orientation: {
      heading: view.heading,
      pitch: view.pitch,
      roll: view.roll,
    },
  });
};

Waypoints.prototype.isDestroyed = function () {
  return false;
};

Waypoints.prototype.destroy = function () {
  document.removeEventListener("pointerdown", this._onOutsidePointerDown, true);
  document.removeEventListener("mousedown", this._onOutsidePointerDown, true);
  knockout.cleanNode(this._element);
  this._container.removeChild(this._element);
  return destroyObject(this);
};

export default Waypoints;
