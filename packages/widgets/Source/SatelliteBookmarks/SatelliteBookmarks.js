import {
  defined,
  destroyObject,
  DeveloperError,
  FeatureDetection,
  getElement,
} from "@cesium/engine";
import knockout from "../ThirdParty/knockout.js";
import SatelliteBookmarksViewModel from "./SatelliteBookmarksViewModel.js";

function SatelliteBookmarks(container, scene, clock, dataSources) {
  if (!defined(container)) {
    throw new DeveloperError("container is required.");
  }

  container = getElement(container);

  const viewModel = new SatelliteBookmarksViewModel(scene, clock, dataSources);

  const wrapper = document.createElement("span");
  wrapper.className = "cesium-satelliteBookmarks-wrapper";

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "cesium-button cesium-toolbar-button cesium-satelliteBookmarks-button";
  button.setAttribute("data-bind", "attr: { title: tooltip }, click: command");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "cesium-satelliteBookmarks-icon");

  const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  body.setAttribute("x", "38");
  body.setAttribute("y", "30");
  body.setAttribute("width", "24");
  body.setAttribute("height", "40");
  body.setAttribute("rx", "3");
  body.setAttribute("fill", "#8CB4D8");

  const panelL = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  panelL.setAttribute("x", "8");
  panelL.setAttribute("y", "38");
  panelL.setAttribute("width", "30");
  panelL.setAttribute("height", "5");
  panelL.setAttribute("fill", "#4A90D9");

  const panelL2 = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  panelL2.setAttribute("x", "8");
  panelL2.setAttribute("y", "46");
  panelL2.setAttribute("width", "30");
  panelL2.setAttribute("height", "5");
  panelL2.setAttribute("fill", "#4A90D9");

  const panelR = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  panelR.setAttribute("x", "62");
  panelR.setAttribute("y", "38");
  panelR.setAttribute("width", "30");
  panelR.setAttribute("height", "5");
  panelR.setAttribute("fill", "#4A90D9");

  const panelR2 = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  panelR2.setAttribute("x", "62");
  panelR2.setAttribute("y", "46");
  panelR2.setAttribute("width", "30");
  panelR2.setAttribute("height", "5");
  panelR2.setAttribute("fill", "#4A90D9");

  const antenna = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line",
  );
  antenna.setAttribute("x1", "50");
  antenna.setAttribute("y1", "30");
  antenna.setAttribute("x2", "50");
  antenna.setAttribute("y2", "18");
  antenna.setAttribute("stroke", "#FFD700");
  antenna.setAttribute("stroke-width", "2");

  const dish = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dish.setAttribute("cx", "50");
  dish.setAttribute("cy", "15");
  dish.setAttribute("r", "5");
  dish.setAttribute("fill", "none");
  dish.setAttribute("stroke", "#FFD700");
  dish.setAttribute("stroke-width", "2");

  svg.appendChild(body);
  svg.appendChild(panelL);
  svg.appendChild(panelL2);
  svg.appendChild(panelR);
  svg.appendChild(panelR2);
  svg.appendChild(antenna);
  svg.appendChild(dish);
  button.appendChild(svg);
  wrapper.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "cesium-satelliteBookmarks-panel";
  panel.setAttribute(
    "data-bind",
    "css: { 'cesium-satelliteBookmarks-panel-visible': panelVisible }",
  );

  panel.innerHTML = `
    <div class="cesium-satelliteBookmarks-header">
      <span>Satellite Bookmarks</span>
      <button type="button" class="cesium-satelliteBookmarks-header-btn"
        data-bind="click: toggleAddFormCommand, text: showAddForm ? '✕' : '+'"></button>
    </div>

    <div data-bind="visible: showAddForm" class="cesium-satelliteBookmarks-addForm">
      <div class="cesium-satelliteBookmarks-formRow">
        <input type="text" placeholder="Satellite name..."
          class="cesium-satelliteBookmarks-nameInput"
          data-bind="textInput: newName" />
      </div>

      <div class="cesium-satelliteBookmarks-coordRow">
        <div class="cesium-satelliteBookmarks-coordField">
          <label class="cesium-satelliteBookmarks-coordLabel">Lat</label>
          <input type="number" min="-90" max="90" step="0.1"
            class="cesium-satelliteBookmarks-coordInput"
            data-bind="textInput: newLat" />
        </div>
        <div class="cesium-satelliteBookmarks-coordField">
          <label class="cesium-satelliteBookmarks-coordLabel">Lon</label>
          <input type="number" min="-180" max="180" step="0.1"
            class="cesium-satelliteBookmarks-coordInput"
            data-bind="textInput: newLon" />
        </div>
        <div class="cesium-satelliteBookmarks-coordField">
          <label class="cesium-satelliteBookmarks-coordLabel">Alt (km)</label>
          <input type="number" min="160" max="200000" step="10"
            class="cesium-satelliteBookmarks-coordInput"
            data-bind="textInput: newAltitudeKm" />
        </div>
      </div>

      <div class="cesium-satelliteBookmarks-iconPicker">
        <div class="cesium-satelliteBookmarks-iconPicker-label">Icon:</div>
        <div class="cesium-satelliteBookmarks-iconPicker-row">
          <button type="button" class="cesium-satelliteBookmarks-arrowBtn"
            data-bind="click: function() { cyclePresetCommand(-1); }">&lsaquo;</button>
          <div class="cesium-satelliteBookmarks-previewIcon"
            data-bind="html: customSvgData || presetIcons[selectedPresetIndex].svg"></div>
          <button type="button" class="cesium-satelliteBookmarks-arrowBtn"
            data-bind="click: function() { cyclePresetCommand(1); }">&rsaquo;</button>
        </div>
        <div class="cesium-satelliteBookmarks-presetName"
          data-bind="text: customSvgData ? 'Custom SVG' : presetIcons[selectedPresetIndex].name"></div>
      </div>

      <div class="cesium-satelliteBookmarks-uploadRow">
        <label class="cesium-button cesium-satelliteBookmarks-uploadBtn">
          Upload SVG
          <input type="file" accept=".svg" style="display:none"
            data-bind="event: { change: function(vm, e) { $root.handleSvgUpload(e.target.files[0]); } }" />
        </label>
        <button type="button" class="cesium-button cesium-satelliteBookmarks-uploadBtn"
          data-bind="click: function() { customSvgData = ''; }, visible: customSvgData">
          Clear
        </button>
      </div>

      <button type="button"
        class="cesium-button cesium-satelliteBookmarks-addBtn"
        data-bind="click: addBookmarkCommand">
        Place Satellite
      </button>
    </div>

    <div class="cesium-satelliteBookmarks-list" data-bind="foreach: bookmarks">
      <div class="cesium-satelliteBookmarks-itemWrap">
        <div class="cesium-satelliteBookmarks-item"
          data-bind="click: function() { $parent.selectBookmarkCommand($index()); },
                     css: { 'cesium-satelliteBookmarks-item-selected': $index() === $parent.selectedIndex }">
          <div class="cesium-satelliteBookmarks-itemIcon" data-bind="html: svg"></div>
          <div class="cesium-satelliteBookmarks-itemInfo">
            <div class="cesium-satelliteBookmarks-itemName" data-bind="text: name"></div>
            <div class="cesium-satelliteBookmarks-itemCoords">
              <span class="cesium-satelliteBookmarks-orbitBadge"
                data-bind="text: orbitBand"></span>
              <span data-bind="text: (altitudeKm >= 1000 ? (altitudeKm/1000).toFixed(1) + 'k' : Math.round(altitudeKm)) + ' km'"></span>
              <span class="cesium-satelliteBookmarks-coordSep">|</span>
              <span data-bind="text: lat.toFixed(1) + '°, ' + lon.toFixed(1) + '°'"></span>
            </div>
          </div>
          <button type="button" class="cesium-satelliteBookmarks-removeBtn"
            data-bind="click: function(data, e) { e.stopPropagation(); $parent.removeBookmarkCommand($index()); }"
            title="Remove">&times;</button>
        </div>
        <div class="cesium-satelliteBookmarks-itemControls"
          data-bind="visible: $index() === $parent.selectedIndex">
          <div class="cesium-satelliteBookmarks-controlBtns">
            <button type="button"
              class="cesium-button cesium-satelliteBookmarks-ctrlBtn"
              data-bind="click: function() { $parent.flyToBookmarkCommand($index()); }">
              Fly To
            </button>
            <button type="button"
              class="cesium-button cesium-satelliteBookmarks-ctrlBtn"
              data-bind="click: function() { $parent.toggleOrbitCommand($index()); },
                         css: { 'cesium-satelliteBookmarks-ctrlBtn-active': $parent.orbitFlags[$index()] }">
              Orbit
            </button>
            <button type="button"
              class="cesium-button cesium-satelliteBookmarks-ctrlBtn"
              data-bind="click: function() { $parent.toggleTetherCommand($index()); },
                         css: { 'cesium-satelliteBookmarks-ctrlBtn-active': $parent.tetherFlags[$index()] }">
              Tether
            </button>
            <button type="button"
              class="cesium-button cesium-satelliteBookmarks-ctrlBtn cesium-satelliteBookmarks-dirBtn"
              data-bind="click: function() { $parent.toggleOrbitDirectionCommand($index()); },
                         text: $parent.orbitSpeedLabels[$index()] && $parent.orbitSpeedLabels[$index()].charAt(0) === '-' ? '◀ W' : 'E ▶',
                         visible: $parent.orbitFlags[$index()]"
              title="Toggle direction">
            </button>
          </div>
          <div class="cesium-satelliteBookmarks-orbitSliderRow"
            data-bind="visible: $parent.orbitFlags[$index()]">
            <span class="cesium-satelliteBookmarks-sliderLabel">Speed:</span>
            <input type="range" min="1" max="1000" step="1"
              class="cesium-satelliteBookmarks-slider"
              data-bind="value: $parent.getOrbitSpeedValue($index()),
                         event: { input: function(data, e) { $parent.setOrbitSpeedCommand({index: $index(), value: e.target.value}); } }" />
            <span class="cesium-satelliteBookmarks-speedLabel"
              data-bind="text: $parent.orbitSpeedLabels[$index()]"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="cesium-satelliteBookmarks-empty"
      data-bind="visible: bookmarks.length === 0 && !showAddForm">
      No bookmarks yet. Click + to add one.
    </div>
  `;

  wrapper.appendChild(panel);
  container.appendChild(wrapper);

  knockout.applyBindings(viewModel, wrapper);

  this._container = container;
  this._wrapper = wrapper;
  this._viewModel = viewModel;
  this._element = button;

  this._closePanel = function (e) {
    if (!wrapper.contains(e.target)) {
      viewModel.panelVisible = false;
    }
  };

  if (FeatureDetection.supportsPointerEvents()) {
    document.addEventListener("pointerdown", this._closePanel, true);
  } else {
    document.addEventListener("mousedown", this._closePanel, true);
    document.addEventListener("touchstart", this._closePanel, true);
  }
}

Object.defineProperties(SatelliteBookmarks.prototype, {
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

SatelliteBookmarks.prototype.isDestroyed = function () {
  return false;
};

SatelliteBookmarks.prototype.destroy = function () {
  if (FeatureDetection.supportsPointerEvents()) {
    document.removeEventListener("pointerdown", this._closePanel, true);
  } else {
    document.removeEventListener("mousedown", this._closePanel, true);
    document.removeEventListener("touchstart", this._closePanel, true);
  }
  this._viewModel._destroyDataSource();
  knockout.cleanNode(this._wrapper);
  this._container.removeChild(this._wrapper);
  return destroyObject(this);
};

export default SatelliteBookmarks;
