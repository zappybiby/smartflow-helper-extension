const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "ui.js"), "utf8");
const instrumentedSource = source.replace(
  /\}\)\(\);\s*$/,
  [
    "window.SmartFlowHelperUITest = {",
    "  applyPageNavigation: applyPageNavigation,",
    "  currentRouteKey: currentRouteKey,",
    "  refreshFluids: refreshFluids,",
    "  refreshVitals: refreshVitals,",
    "  state: state",
    "};",
    "})();"
  ].join("\n")
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const document = {
  activeElement: null,
  hidden: false,
  readyState: "loading",
  addEventListener() {},
  getElementById() {
    return null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  }
};

const window = {
  requestAnimationFrame() {
    return 1;
  }
};

const location = {
  hash: "",
  pathname: "/whiteboard",
  search: ""
};

vm.runInNewContext(instrumentedSource, {
  clearTimeout,
  console,
  document,
  location,
  navigator: {},
  setTimeout,
  window
}, {
  filename: "ui.js"
});

const ui = window.SmartFlowHelperUITest;

assert(ui, "UI test hooks should load");
assert((source.match(/text: "Refresh"/g) || []).length === 1, "the panel should have one Refresh button");
assert(source.indexOf('className: "sf-helper-launcher"') !== -1, "the panel should include the SF launcher");
assert(source.indexOf('aria-label": "Minimize Smart Flow Helper"') !== -1, "the panel should include a labeled minimize button");
assert(source.indexOf("setInterval") === -1, "navigation refresh should not poll");
assert(source.indexOf('addEventListener("currententrychange"') !== -1, "pushState navigation should be observed");
assert(source.indexOf('addEventListener("popstate"') !== -1, "history navigation should have a fallback");

const originalRouteKey = ui.currentRouteKey();
location.search = "?page=2";
assert(ui.currentRouteKey() !== originalRouteKey, "route changes should update the navigation key");

Object.keys(ui.state.pageContext.dirtyTabs).forEach((tabName) => {
  ui.state.pageContext.dirtyTabs[tabName] = false;
});
const originalGeneration = ui.state.pageContext.generation;
ui.applyPageNavigation();
assert(ui.state.pageContext.generation === originalGeneration + 1, "navigation should advance one generation");
assert(
  Object.values(ui.state.pageContext.dirtyTabs).every(Boolean),
  "navigation should mark every tab for refresh"
);

async function checkStaleAsyncResults() {
  const oldVitals = {};
  const newVitals = {};
  [
    "getBloodGlucoseResults",
    "formatBloodGlucoseResults",
    "getBloodPressureResults",
    "formatBloodPressureResults"
  ].forEach((method) => {
    oldVitals[method] = deferred();
    newVitals[method] = deferred();
  });

  let vitalsBatch = oldVitals;
  window.SmartFlowHelperBridge = {
    callPageHelper(method) {
      return vitalsBatch[method].promise;
    }
  };

  ui.state.activeTab = "vitals";
  const oldVitalsRefresh = ui.refreshVitals();
  ui.state.pageContext.generation += 1;
  vitalsBatch = newVitals;
  const newVitalsRefresh = ui.refreshVitals();

  newVitals.getBloodGlucoseResults.resolve([{ marker: "new" }]);
  newVitals.formatBloodGlucoseResults.resolve("new bg");
  newVitals.getBloodPressureResults.resolve([]);
  newVitals.formatBloodPressureResults.resolve("");
  await newVitalsRefresh;

  oldVitals.getBloodGlucoseResults.resolve([{ marker: "old" }]);
  oldVitals.formatBloodGlucoseResults.resolve("old bg");
  oldVitals.getBloodPressureResults.resolve([]);
  oldVitals.formatBloodPressureResults.resolve("");
  await oldVitalsRefresh;

  assert(ui.state.bloodGlucose.results[0].marker === "new", "stale vitals should not replace current results");

  const oldFluids = deferred();
  const newFluids = deferred();
  let fluidsRequest = oldFluids;

  window.SmartFlowHelperBridge.callPageHelper = function (method) {
    assert(method === "getFluidRateSummary", "the fluids check should request a fluid summary");
    return fluidsRequest.promise;
  };

  function fluidSummary(marker) {
    return {
      marker,
      patient: {
        species: { normalized: "dog" },
        weight: { text: "10 kg" },
        weightKg: 10,
        weightKgText: "10 kg"
      },
      maintenance: {
        available: true,
        formula: "60 mL/kg/day",
        mlPerDayText: "600 mL/day",
        mlPerHourText: "25 mL/hr",
        mode: "default"
      },
      target: {
        mlPerDayText: "900 mL/day",
        mlPerHourText: "38 mL/hr",
        mlPerKgDay: 90,
        mlPerKgDayText: "90 mL/kg/day",
        mlPerKgHour: 3.75,
        mlPerKgHourText: "3.8 mL/kg/hr",
        mode: "day"
      }
    };
  }

  ui.state.activeTab = "fluids";
  const oldFluidsRefresh = ui.refreshFluids();
  ui.state.pageContext.generation += 1;
  fluidsRequest = newFluids;
  const newFluidsRefresh = ui.refreshFluids();

  newFluids.resolve(fluidSummary("new"));
  await newFluidsRefresh;
  oldFluids.resolve(fluidSummary("old"));
  await oldFluidsRefresh;

  assert(ui.state.fluids.summary.marker === "new", "stale fluids should not replace the current summary");
}

checkStaleAsyncResults().then(() => {
  console.log("ui-context-check: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
