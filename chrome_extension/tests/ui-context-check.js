const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "ui.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "..", "src", "ui.css"), "utf8");
const instrumentedSource = source.replace(
  /\}\)\(\);\s*$/,
  [
    "window.SmartFlowHelperUITest = {",
    "  applyPageNavigation: applyPageNavigation,",
    "  currentRouteKey: currentRouteKey,",
    "  handleLocationChange: handleLocationChange,",
    "  renderFluidSummary: renderFluidSummary,",
    "  refreshFluids: refreshFluids,",
    "  refreshVitals: refreshVitals,",
    "  refreshActiveTab: refreshActiveTab,",
    "  watchPatientNavigation: watchPatientNavigation,",
    "  state: state",
    "};",
    "})();"
  ].join("\n")
);

const elements = {};
const timers = new Map();
const windowListeners = {};
const documentListeners = {};
let nextTimerId = 1;
let root = null;
let dateNodes = [];
let mutationObserver = null;

class MutationObserver {
  constructor(callback) {
    this.callback = callback;
    mutationObserver = this;
  }

  observe(target, options) {
    this.target = target;
    this.options = options;
  }
}

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
  documentElement: {},
  addEventListener(name, callback) {
    documentListeners[name] = callback;
  },
  getElementById(id) {
    return id === "sf-helper-root" ? root : null;
  },
  querySelector(selector) {
    return elements[selector] || null;
  },
  querySelectorAll(selector) {
    return selector === ".current-flowsheet .date" ? dateNodes : [];
  }
};

const window = {
  addEventListener(name, callback) {
    windowListeners[name] = callback;
  },
  navigation: {
    addEventListener(name, callback) {
      windowListeners[name] = callback;
    }
  },
  setTimeout(callback) {
    const timerId = nextTimerId++;
    timers.set(timerId, callback);
    return timerId;
  },
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
  MutationObserver,
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
assert(
  source.indexOf('text: "Patient"') < source.indexOf('text: "Maintenance"') &&
    source.indexOf('text: "Maintenance"') < source.indexOf('text: "Target"'),
  "the fluids tab should read from patient context to maintenance and then target"
);
assert(
  source.indexOf('buildRateRow("Using", "sf-helper-maintenance-calculation")') !== -1,
  "maintenance should identify the formula used for its results"
);
assert(
  source.indexOf('buildRateRow("Using", "sf-helper-target-calculation")') !== -1,
  "target should identify the values used for its results"
);
assert(
  /\.sf-helper-fluid-grid\s*\{[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s.test(cssSource),
  "the fluids tab should use one compact vertical flow without an internal scrollbar"
);
assert(
  !/\.sf-helper-fluid-grid\s*\{[^}]*overflow-y:\s*auto;/s.test(cssSource),
  "the fluids tab should not require vertical scrolling"
);
assert(
  source.includes('className: "sf-helper-pane sf-helper-fluid-pane sf-helper-fluid-maintenance"') &&
    source.includes('className: "sf-helper-pane sf-helper-fluid-pane sf-helper-fluid-target"'),
  "fluids should use the same pane structure as the other tabs"
);
assert(
  source.includes('className: "sf-helper-fluid-mode-tabs"') &&
    cssSource.includes(".sf-helper-fluid-mode-option:has(input:checked)"),
  "the maintenance formula selector should use a compact segmented control"
);
assert(
  /\.sf-helper-fluid-result-grid \.sf-helper-summary-item\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s.test(cssSource),
  "hourly and daily results should read as compact label-value pairs"
);
[
  "Used in both calculations below",
  "Choose one formula; both results use the patient weight above.",
  "Enter either target; the other field updates automatically.",
  "Maintenance estimate",
  "Custom fluid target"
].forEach((copy) => {
  assert(!source.includes(copy), "fluids should omit explanatory copy: " + copy);
});
assert(!source.includes("sf-helper-fluid-step"), "fluids should not use numbered step markers");
assert(source.indexOf('"Maint / day"') === -1, "maintenance outputs should not be mixed into patient details");

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

  [
    "#sf-helper-fluid-weight",
    "#sf-helper-fluid-species",
    "#sf-helper-maintenance-day",
    "#sf-helper-maintenance-hour",
    "#sf-helper-maintenance-calculation",
    "#sf-helper-target-calculation",
    "#sf-helper-target-day",
    "#sf-helper-target-hour"
  ].forEach((selector) => {
    elements[selector] = { textContent: "" };
  });
  elements["#sf-helper-fluid-target-day"] = { value: "" };
  elements["#sf-helper-fluid-target-hour"] = { value: "" };

  ui.renderFluidSummary(fluidSummary("visible"));

  assert(
    elements["#sf-helper-maintenance-calculation"].textContent === "10 kg × 60 mL/kg/day",
    "maintenance should show the patient weight and selected formula together"
  );
  assert(
    elements["#sf-helper-target-calculation"].textContent ===
      "10 kg × 90 mL/kg/day = 3.8 mL/kg/hr",
    "custom target should show the active and equivalent target values"
  );
  assert(
    elements["#sf-helper-maintenance-hour"].textContent === "25 mL/hr" &&
      elements["#sf-helper-maintenance-day"].textContent === "600 mL/day",
    "maintenance results should remain visible in their own section"
  );
  assert(
    elements["#sf-helper-target-hour"].textContent === "38 mL/hr" &&
      elements["#sf-helper-target-day"].textContent === "900 mL/day",
    "custom target results should remain visible in their own section"
  );

  const bodyWeightSummary = fluidSummary("body-weight");
  bodyWeightSummary.maintenance.mode = "bodyWeight";
  bodyWeightSummary.maintenance.formula = "132 * BW(kg)^0.75";
  bodyWeightSummary.target.mode = "hour";
  ui.renderFluidSummary(bodyWeightSummary);

  assert(
    elements["#sf-helper-maintenance-calculation"].textContent === "132 × (10 kg)^0.75",
    "weight-based maintenance should substitute the visible patient weight into its formula"
  );
  assert(
    elements["#sf-helper-target-calculation"].textContent ===
      "10 kg × 3.8 mL/kg/hr = 90 mL/kg/day",
    "the last-edited hourly target should lead the custom calculation"
  );
}

async function checkAsyncNavigationReadiness() {
  let open = true;
  let patientReady = false;
  let rowsReady = false;
  let pendingFluidRequest = null;
  const calls = [];
  const readySummary = Object.assign({}, ui.state.fluids.summary, { marker: "arrived" });
  root = { classList: { contains: () => open } };
  location.pathname = "/whiteboard";
  location.search = "";
  ui.state.activeTab = "fluids";

  window.SmartFlowHelperBridge.callPageHelper = function (method) {
    calls.push(method);
    if (method === "getFluidRateSummary") {
      return pendingFluidRequest ? pendingFluidRequest.promise : Promise.resolve(patientReady ? readySummary : null);
    }
    if (method === "getTechNotesSummary") {
      return Promise.resolve({ notes: [], count: 0, formattedText: "" });
    }
    throw new Error("Unexpected navigation helper call: " + method);
  };

  function fluidCallCount() {
    return calls.filter((method) => method === "getFluidRateSummary").length;
  }

  function emitMutation(helperMutation = false) {
    mutationObserver.callback([{
      target: { nodeType: 1, closest: () => helperMutation ? root : null }
    }]);
  }

  async function flushNavigation() {
    const callbacks = Array.from(timers.values());
    timers.clear();
    callbacks.forEach((callback) => callback());
    // Let both bridge responses and their chained renders settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  ui.watchPatientNavigation();
  assert(mutationObserver.target === document.documentElement, "readiness should observe the site DOM");
  await ui.handleLocationChange({ contextChange: true });
  assert(ui.state.fluids.summary === null, "the whiteboard has no current patient details");

  location.pathname = "/whiteboard/hosp/11111111-1111-1111-1111-111111111111";
  windowListeners.currententrychange();
  await flushNavigation();
  const beforeReady = fluidCallCount();
  assert(ui.state.fluids.summary === null, "a route event may arrive before the patient DOM");

  const name = { textContent: "Example patient", getAttribute: () => "" };
  elements["#patient-table .patient-card-container"] = {
    querySelector: (selector) => selector === ".patient-card-patient-name" ? name : null
  };
  elements["#flowsheetTable"] = {
    querySelector: () => rowsReady ? {} : null
  };
  dateNodes = [{ textContent: "Wed, 21 Oct 2026" }];
  patientReady = true;
  for (let index = 0; index < 20; index += 1) {
    emitMutation();
  }
  assert(timers.size === 1, "a burst of site mutations should coalesce into one bounded check");
  await flushNavigation();
  assert(fluidCallCount() === beforeReady + 1, "late patient data should refresh the active tab once");
  assert(ui.state.fluids.summary.marker === "arrived", "late patient data should replace the unavailable result");
  assert(elements["#sf-helper-fluid-weight"].textContent === "10 kg", "late patient details should reach the visible calculation");

  rowsReady = true;
  emitMutation();
  await flushNavigation();
  assert(fluidCallCount() === beforeReady + 2, "a table populated after its shell should trigger a readiness refresh");

  const beforeOrdinaryMutation = fluidCallCount();
  const stableGeneration = ui.state.pageContext.generation;
  emitMutation(true);
  assert(timers.size === 0, "helper rendering must not schedule its own observer checks");
  emitMutation();
  await flushNavigation();
  assert(fluidCallCount() === beforeOrdinaryMutation, "ordinary cell or clock changes should wait for manual Refresh");
  assert(ui.state.pageContext.generation === stableGeneration, "ordinary same-page mutations must not invalidate requests");

  const patientRoute = ui.currentRouteKey();
  dateNodes[0].textContent = "Tue, 20 Oct 2026";
  delete elements["#flowsheetTable"];
  emitMutation();
  await flushNavigation();
  assert(ui.currentRouteKey() === patientRoute, "the day-navigation regression uses the same URL");
  assert(fluidCallCount() === beforeOrdinaryMutation + 1, "changing the selected day should refresh context without a route event");
  elements["#flowsheetTable"] = { querySelector: () => ({}) };
  emitMutation();
  await flushNavigation();
  assert(fluidCallCount() === beforeOrdinaryMutation + 2, "the new day's asynchronously loaded table should refresh again");

  open = false;
  const beforeMinimized = fluidCallCount();
  dateNodes[0].textContent = "Mon, 19 Oct 2026";
  emitMutation();
  await flushNavigation();
  assert(fluidCallCount() === beforeMinimized, "minimized readiness changes should not read helper data");
  assert(Object.values(ui.state.pageContext.dirtyTabs).every(Boolean), "minimized navigation should leave all tabs dirty");
  open = true;
  await ui.refreshActiveTab();
  assert(fluidCallCount() === beforeMinimized + 1, "reopening should read the deferred context");

  document.hidden = true;
  const beforeHidden = fluidCallCount();
  dateNodes[0].textContent = "Sun, 18 Oct 2026";
  emitMutation();
  await flushNavigation();
  assert(fluidCallCount() === beforeHidden, "hidden pages should defer readiness refreshes");
  document.hidden = false;
  documentListeners.visibilitychange();
  await flushNavigation();
  assert(fluidCallCount() === beforeHidden + 1, "returning to a visible page should read its changed context");

  pendingFluidRequest = deferred();
  const staleRefresh = ui.refreshFluids();
  open = false;
  location.pathname = "/whiteboard/hosp/22222222-2222-2222-2222-222222222222";
  windowListeners.currententrychange();
  await flushNavigation();
  pendingFluidRequest.resolve(Object.assign({}, readySummary, { marker: "stale" }));
  await staleRefresh;
  assert(ui.state.fluids.summary.marker === "arrived", "navigation while minimized must invalidate an earlier patient response");
}

checkStaleAsyncResults().then(checkAsyncNavigationReadiness).then(() => {
  console.log("ui-context-check: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
