import { Clock, FeatureDetection } from "@cesium/engine";

import { SolarSystem } from "../../index.js";

import createScene from "../../../../Specs/createScene.js";
import DomEventSimulator from "../../../../Specs/DomEventSimulator.js";

describe(
  "Widgets/SolarSystem/SolarSystem",
  function () {
    let scene;
    let clock;

    beforeAll(function () {
      scene = createScene();
    });

    afterAll(function () {
      scene.destroyForSpecs();
    });

    beforeEach(function () {
      clock = new Clock({ shouldAnimate: false });
    });

    function createContainer() {
      const container = document.createElement("span");
      container.id = "testContainer";
      document.body.appendChild(container);
      return container;
    }

    it("can create and destroy", function () {
      const container = createContainer();

      const widget = new SolarSystem("testContainer", scene, clock);
      expect(widget.container.id).toBe(container.id);
      expect(widget.viewModel.planets.length).toEqual(8);
      expect(widget.isDestroyed()).toEqual(false);

      widget.destroy();
      expect(widget.isDestroyed()).toEqual(true);
      expect(container.children.length).toEqual(0);

      document.body.removeChild(container);
    });

    it("renders a row for each planet, and for Pluto", function () {
      const container = createContainer();
      const widget = new SolarSystem("testContainer", scene, clock);

      const rows = container.getElementsByClassName(
        "cesium-solarSystem-planet",
      );
      expect(rows.length).toEqual(8);
      expect(rows[7].textContent).toContain("Pluto");
      expect(rows[0].textContent).toContain("Mercury");
      expect(
        rows[0].getElementsByClassName("cesium-solarSystem-speed")[0].max,
      ).toEqual(`${widget.viewModel.speedSliderMaximum}`);

      widget.destroy();
      document.body.removeChild(container);
    });

    function addCloseOnInputSpec(name, func) {
      it(`${name} event closes dropdown if target is not inside container`, function () {
        const container = createContainer();
        const widget = new SolarSystem("testContainer", scene, clock);

        widget.viewModel.dropDownVisible = true;
        func(document.body);
        expect(widget.viewModel.dropDownVisible).toEqual(false);

        widget.viewModel.dropDownVisible = true;
        func(container.firstChild);
        expect(widget.viewModel.dropDownVisible).toEqual(true);

        widget.destroy();
        document.body.removeChild(container);
      });
    }

    if (FeatureDetection.supportsPointerEvents()) {
      addCloseOnInputSpec("pointerDown", DomEventSimulator.firePointerDown);
    } else {
      addCloseOnInputSpec("mousedown", DomEventSimulator.fireMouseDown);
      addCloseOnInputSpec("touchstart", DomEventSimulator.fireTouchStart);
    }

    it("constructor throws with no element", function () {
      expect(function () {
        return new SolarSystem(undefined, scene, clock);
      }).toThrowDeveloperError();
    });

    it("constructor throws with no scene", function () {
      expect(function () {
        return new SolarSystem(document.body, undefined, clock);
      }).toThrowDeveloperError();
    });

    it("constructor throws with no clock", function () {
      expect(function () {
        return new SolarSystem(document.body, scene, undefined);
      }).toThrowDeveloperError();
    });

    it("constructor throws with string element that does not exist", function () {
      expect(function () {
        return new SolarSystem("does not exist", scene, clock);
      }).toThrowDeveloperError();
    });
  },
  "WebGL",
);
