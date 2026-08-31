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
      expect(widget.viewModel.planets.length).toEqual(9);
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
      // Every planet, the Earth included, and Pluto.
      expect(rows.length).toEqual(9);
      expect(rows[0].textContent).toContain("Mercury");
      expect(rows[2].textContent).toContain("Earth");
      expect(rows[8].textContent).toContain("Pluto");

      // The Earth has the same controls as the rest of them.
      expect(
        rows[2].getElementsByClassName("cesium-solarSystem-speed").length,
      ).toEqual(2);
      expect(rows[2].getElementsByTagName("button").length).toEqual(1);
      expect(
        rows[2].getElementsByClassName("cesium-solarSystem-spin").length,
      ).toEqual(1);
      expect(
        rows[0].getElementsByClassName("cesium-solarSystem-spin").length,
      ).toEqual(1);
      // One slider for the orbit and one for the spin, hidden until toggled on.
      const sliders = rows[0].getElementsByClassName(
        "cesium-solarSystem-speed",
      );
      expect(sliders.length).toEqual(2);
      expect(sliders[0].max).toEqual(`${widget.viewModel.speedSliderMaximum}`);

      const rates = rows[0].getElementsByClassName("cesium-solarSystem-rate");
      expect(rates[0].style.display).toEqual("none");
      widget.viewModel.planets[0].orbiting = true;
      expect(rates[0].style.display).not.toEqual("none");
      expect(rates[1].style.display).toEqual("none");

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
