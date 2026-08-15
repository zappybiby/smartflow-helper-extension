(function () {
  "use strict";

  var ROOT_ID = "sf-helper-root";
  var OPEN_CLASS = "sf-helper-open";
  var layoutFrame = null;
  var layoutSecondPassFrame = null;
  var state = {
    activeTab: "vitals",
    activeMetric: "bloodGlucose",
    vitalsRequestSeq: 0,
    bloodGlucose: {
      results: [],
      formattedText: ""
    },
    bloodPressure: {
      results: [],
      formattedText: ""
    },
    fluids: {
      maintenanceMode: "default",
      targetMlKgDay: 90,
      targetMlKgHour: 90 / 24,
      targetMode: "day",
      summary: null,
      requestSeq: 0
    },
    notes: {
      notes: [],
      formattedText: "",
      patientKey: "",
      loaded: false,
      loading: false,
      requestSeq: 0
    },
    controlled: {
      events: [],
      formattedText: "",
      loading: false,
      patientCount: 0,
      source: "",
      updatedAt: "",
      requestSeq: 0
    },
    pageContext: {
      generation: 0,
      dirtyTabs: {
        vitals: true,
        fluids: true,
        notes: true,
        controlled: true
      }
    }
  };

  function createElement(tag, options) {
    options = options || {};

    var element = document.createElement(tag);

    if (options.className) {
      element.className = options.className;
    }

    if (options.text) {
      element.textContent = options.text;
    }

    if (options.attrs) {
      Object.keys(options.attrs).forEach(function (key) {
        element.setAttribute(key, options.attrs[key]);
      });
    }

    return element;
  }

  function applyHelperPlacement() {
    var layout = window.SmartFlowHelperLayout;
    var root = document.getElementById(ROOT_ID);

    if (!layout || !root || typeof layout.apply !== "function") {
      return;
    }

    layout.apply(root);

    if (root.classList.contains(OPEN_CLASS) && !layoutSecondPassFrame) {
      layoutSecondPassFrame = window.requestAnimationFrame(function () {
        layoutSecondPassFrame = null;
        layout.apply(root);
      });
    }
  }

  function scheduleHelperPlacement() {
    if (layoutFrame) {
      return;
    }

    layoutFrame = window.requestAnimationFrame(function () {
      layoutFrame = null;
      applyHelperPlacement();
    });
  }

  function getBridge() {
    return window.SmartFlowHelperBridge;
  }

  function helperCall(method, args, timeoutMs) {
    var bridge = getBridge();

    if (!bridge) {
      return Promise.reject(new Error("Smart Flow helper is not ready"));
    }

    return bridge.callPageHelper(method, args || [], timeoutMs);
  }

  function setStatus(message, isError) {
    var status = document.querySelector("#sf-helper-status");
    if (!status) {
      return;
    }

    status.textContent = message || "";
    status.classList.toggle("sf-helper-status-error", !!isError);
  }

  function setElementText(selector, text) {
    var element = document.querySelector(selector);
    if (element) {
      element.textContent = text || "";
    }
  }

  function formatDateTime(value) {
    var date = value ? new Date(value) : null;

    if (!date || !Number.isFinite(date.getTime())) {
      return "";
    }

    return date.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function controlledStatusText() {
    var updatedAt = formatDateTime(state.controlled.updatedAt);

    return "Last updated: " + (updatedAt || "never");
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        if (!document.execCommand("copy")) {
          throw new Error("Copy command failed");
        }

        resolve();
      } catch (error) {
        reject(error);
      } finally {
        textarea.remove();
      }
    });
  }

  function resultDetails(result, type) {
    if (type === "bloodPressure") {
      return [result.cuff, result.location, result.method].filter(Boolean).join(", ");
    }

    return result.source || "";
  }

  function renderResultsList(type, results) {
    var listId = type === "bloodPressure" ? "#sf-helper-bp-list" : "#sf-helper-bg-list";
    var list = document.querySelector(listId);
    if (!list) {
      return;
    }

    list.textContent = "";

    if (!results.length) {
      list.appendChild(createElement("div", {
        className: "sf-helper-empty",
        text: "No results found."
      }));
      return;
    }

    results.forEach(function (result) {
      var row = createElement("div", { className: "sf-helper-list-row" });
      row.appendChild(createElement("div", {
        className: "sf-helper-list-time",
        text: result.time || ""
      }));
      row.appendChild(createElement("div", {
        className: "sf-helper-list-value",
        text: result.valueText || result.raw || ""
      }));
      row.appendChild(createElement("div", {
        className: "sf-helper-list-source",
        text: resultDetails(result, type)
      }));
      list.appendChild(row);
    });
  }

  function renderMetric(type, results, formattedText) {
    var prefix = type === "bloodPressure" ? "bp" : "bg";
    var metricState = state[type];

    metricState.results = results || [];
    metricState.formattedText = formattedText || "";

    var output = document.querySelector("#sf-helper-" + prefix + "-output");
    var copyButton = document.querySelector("#sf-helper-" + prefix + "-copy");
    var count = document.querySelector("#sf-helper-" + prefix + "-count");

    if (output) {
      output.value = metricState.formattedText;
    }

    if (copyButton) {
      copyButton.disabled = !metricState.formattedText;
    }

    if (count) {
      count.textContent = metricState.results.length + (metricState.results.length === 1 ? " result" : " results");
    }

    renderResultsList(type, metricState.results);
  }

  function refreshVitals() {
    var requestSeq = ++state.vitalsRequestSeq;
    var contextGeneration = state.pageContext.generation;

    setStatus("Reading flowsheet...", false);

    return Promise.all([
      helperCall("getBloodGlucoseResults"),
      helperCall("formatBloodGlucoseResults"),
      helperCall("getBloodPressureResults"),
      helperCall("formatBloodPressureResults")
    ]).then(function (values) {
      if (
        requestSeq !== state.vitalsRequestSeq ||
        contextGeneration !== state.pageContext.generation ||
        state.activeTab !== "vitals"
      ) {
        return null;
      }

      var bgResults = values[0] || [];
      var bpResults = values[2] || [];

      renderMetric("bloodGlucose", bgResults, values[1] || "");
      renderMetric("bloodPressure", bpResults, values[3] || "");
      setStatus(bgResults.length || bpResults.length ? "" : "No matching values on this sheet.", false);
      return values;
    }).catch(function (error) {
      if (
        requestSeq !== state.vitalsRequestSeq ||
        contextGeneration !== state.pageContext.generation ||
        state.activeTab !== "vitals"
      ) {
        return null;
      }

      renderMetric("bloodGlucose", [], "");
      renderMetric("bloodPressure", [], "");
      setStatus(error && error.message ? error.message : String(error), true);
      return null;
    });
  }

  function copyMetric(type) {
    var metricState = state[type];

    copyText(metricState.formattedText).then(function () {
      setStatus("Copied.", false);
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    });
  }

  function renderNotes(summary) {
    summary = summary || {};
    state.notes.notes = summary.notes || [];
    state.notes.formattedText = summary.formattedText || "";

    var output = document.querySelector("#sf-helper-notes-output");
    var copyButton = document.querySelector("#sf-helper-notes-copy");
    var count = document.querySelector("#sf-helper-notes-count");

    if (output) {
      output.value = state.notes.formattedText;
    }

    if (copyButton) {
      copyButton.disabled = !state.notes.formattedText;
    }

    if (count) {
      count.textContent = state.notes.notes.length + (state.notes.notes.length === 1 ? " note" : " notes");
    }
  }

  function currentWhiteboardPatientKey() {
    var match = location.pathname.match(/\/whiteboard\/hosp\/([0-9a-f-]{20,})/i);

    return match ? match[1].toLowerCase() : "";
  }

  function currentRouteKey() {
    return [location.pathname, location.search, location.hash].join("");
  }

  function isHelperOpen() {
    var root = document.getElementById(ROOT_ID);

    return !!root && root.classList.contains(OPEN_CLASS);
  }

  function canAutoRefresh() {
    return isHelperOpen() && !document.hidden;
  }

  function markAllTabsDirty() {
    Object.keys(state.pageContext.dirtyTabs).forEach(function (tabName) {
      state.pageContext.dirtyTabs[tabName] = true;
    });
  }

  function isTabDirty(tabName) {
    return !!state.pageContext.dirtyTabs[tabName];
  }

  function applyPageNavigation() {
    state.pageContext.generation += 1;
    markAllTabsDirty();

    state.controlled.requestSeq += 1;
    state.controlled.loading = false;

    handleLocationChange({
      contextChange: true
    });
  }

  function resetNotesForPatient(patientKey) {
    state.notes.patientKey = patientKey || "";
    state.notes.notes = [];
    state.notes.formattedText = "";
    state.notes.loaded = false;
    state.notes.loading = false;
    state.notes.requestSeq += 1;
    renderNotes(null);
  }

  function syncNotesPatientKey() {
    var patientKey = currentWhiteboardPatientKey();

    if (patientKey !== state.notes.patientKey) {
      resetNotesForPatient(patientKey);
    }

    return patientKey;
  }

  function refreshNotes(options) {
    options = options || {};

    var patientKey = syncNotesPatientKey();
    var visibleNotesTab = state.activeTab === "notes";
    var shouldShowStatus = !options.silent || visibleNotesTab;
    var requestSeq = 0;

    if (!options.force && state.notes.loaded && state.notes.patientKey === patientKey) {
      if (visibleNotesTab) {
        renderNotes({
          notes: state.notes.notes,
          formattedText: state.notes.formattedText,
          count: state.notes.notes.length
        });
      }

      return Promise.resolve({
        notes: state.notes.notes,
        formattedText: state.notes.formattedText,
        count: state.notes.notes.length
      });
    }

    state.notes.loading = true;
    requestSeq = ++state.notes.requestSeq;

    if (shouldShowStatus) {
      setStatus("Reading notes...", false);
      renderNotes(null);
      setElementText("#sf-helper-notes-count", "Loading...");
    }

    return helperCall("getTechNotesSummary", patientKey ? [{
      hospitalizationId: patientKey
    }] : [], 10000).then(function (summary) {
      if (requestSeq !== state.notes.requestSeq || patientKey !== currentWhiteboardPatientKey()) {
        return null;
      }

      state.notes.loading = false;
      state.notes.loaded = true;
      renderNotes(summary);

      if (shouldShowStatus && state.activeTab === "notes") {
        setStatus(summary && summary.count ? "" : "No notes found for this patient.", false);
      }

      return summary;
    }).catch(function (error) {
      if (requestSeq !== state.notes.requestSeq || patientKey !== currentWhiteboardPatientKey()) {
        return null;
      }

      state.notes.loading = false;
      state.notes.loaded = false;

      if (shouldShowStatus && state.activeTab === "notes") {
        renderNotes(null);
        setStatus(error && error.message ? error.message : String(error), true);
      }

      return null;
    });
  }

  function preloadNotesForCurrentPatient() {
    return refreshNotes({
      force: false,
      silent: true
    });
  }

  function forceRefreshNotesForCurrentPatient(silent) {
    return refreshNotes({
      force: true,
      silent: !!silent
    });
  }

  function handleLocationChange(options) {
    options = options || {};

    var patientKey = syncNotesPatientKey();

    scheduleHelperPlacement();

    if (!canAutoRefresh()) {
      return Promise.resolve(null);
    }

    if (patientKey && state.activeTab !== "notes") {
      preloadNotesForCurrentPatient();
    }

    return refreshActiveTab({
      contextChange: !!options.contextChange
    });
  }

  function watchPatientNavigation() {
    var lastRouteKey = currentRouteKey();
    var navigationTimer = null;

    state.pageContext.generation = 1;

    function scheduleNavigationRefresh() {
      if (navigationTimer) {
        window.clearTimeout(navigationTimer);
      }

      navigationTimer = window.setTimeout(function () {
        var nextRouteKey = currentRouteKey();

        navigationTimer = null;

        if (nextRouteKey === lastRouteKey) {
          return;
        }

        lastRouteKey = nextRouteKey;
        applyPageNavigation();
      }, 100);
    }

    if (window.navigation && typeof window.navigation.addEventListener === "function") {
      window.navigation.addEventListener("currententrychange", scheduleNavigationRefresh);
    }

    window.addEventListener("popstate", scheduleNavigationRefresh);
    window.addEventListener("hashchange", scheduleNavigationRefresh);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        return;
      }

      if (isTabDirty(state.activeTab) && canAutoRefresh()) {
        handleLocationChange({
          contextChange: true
        });
      }
    });
  }

  function watchSmartFlowNotesOpen() {
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
      var notesButton = target && target.closest ?
        target.closest("[data-testid='patient-add-notes'], .panel-tech-notes a") :
        null;

      if (!notesButton) {
        return;
      }

      window.setTimeout(function () {
        forceRefreshNotesForCurrentPatient(true);
      }, 250);
    }, true);
  }

  function copyNotes() {
    copyText(state.notes.formattedText).then(function () {
      setStatus("Copied notes.", false);
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    });
  }

  function renderControlled(summary) {
    if (summary) {
      state.controlled.events = summary.events || [];
      state.controlled.formattedText = summary.formattedText || "";
      state.controlled.patientCount = Number(summary.patientCount) || 0;
      state.controlled.source = summary.source || "";
      state.controlled.updatedAt = summary.generatedAt || new Date().toISOString();
    }

    var output = document.querySelector("#sf-helper-controlled-output");
    var copyButton = document.querySelector("#sf-helper-controlled-copy");
    var count = document.querySelector("#sf-helper-controlled-count");

    if (output) {
      output.value = state.controlled.loading ? "Loading..." : state.controlled.formattedText;
    }

    if (copyButton) {
      copyButton.disabled = !!state.controlled.loading || !state.controlled.formattedText;
    }

    if (count) {
      count.textContent = state.controlled.loading ?
        "Loading..." :
        state.controlled.events.length + (state.controlled.events.length === 1 ? " due" : " due");
    }
  }

  function refreshControlled(options) {
    options = options || {};

    var requestSeq = ++state.controlled.requestSeq;
    var contextGeneration = state.pageContext.generation;

    state.controlled.loading = true;
    state.pageContext.dirtyTabs.controlled = false;

    renderControlled();
    setStatus("Reading controlled meds...", false);

    return helperCall("getControlledMedicationSchedule", [{
      horizonHours: 12
    }], 30000).then(function (summary) {
      if (
        requestSeq !== state.controlled.requestSeq ||
        contextGeneration !== state.pageContext.generation
      ) {
        if (requestSeq === state.controlled.requestSeq) {
          state.controlled.loading = false;
          renderControlled();
        }

        return null;
      }

      state.controlled.loading = false;

      if (summary && summary.source === "not-ready") {
        state.pageContext.dirtyTabs.controlled = true;
        renderControlled();
        if (state.activeTab === "controlled") {
          setStatus("Whiteboard or patient page is not visible yet. " + controlledStatusText(), true);
        }
        return summary;
      }

      renderControlled(summary);
      if (state.activeTab === "controlled") {
        setStatus(controlledStatusText(), false);
      }

      return summary;
    }).catch(function (error) {
      if (
        requestSeq !== state.controlled.requestSeq ||
        contextGeneration !== state.pageContext.generation
      ) {
        if (requestSeq === state.controlled.requestSeq) {
          state.controlled.loading = false;
          renderControlled();
        }

        return null;
      }

      state.controlled.loading = false;
      state.pageContext.dirtyTabs.controlled = true;
      renderControlled();
      if (state.activeTab === "controlled") {
        setStatus(error && error.message ? error.message : String(error), true);
      }

      return null;
    });
  }

  function copyControlledSchedule() {
    copyText(state.controlled.formattedText).then(function () {
      setStatus("Copied controlled meds.", false);
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), true);
    });
  }

  function speciesText(summary) {
    var species = summary && summary.patient && summary.patient.species;
    var normalized = species && species.normalized;

    if (normalized === "dog") {
      return "Dog";
    }

    if (normalized === "cat") {
      return "Cat";
    }

    return species && species.text ? species.text : "";
  }

  function formatInputNumber(value, type) {
    if (!Number.isFinite(value)) {
      return "";
    }

    if (type === "hour") {
      return (Math.round(value * 10) / 10).toFixed(1);
    }

    return String(Math.round(value));
  }

  function readPositiveNumber(selector, fallback) {
    var input = document.querySelector(selector);
    var value = input ? Number(input.value) : fallback;

    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return value;
  }

  function getFluidTargetInputValue() {
    var mode = state.fluids.targetMode;
    var mlKgDay = readPositiveNumber("#sf-helper-fluid-target-day", state.fluids.targetMlKgDay);
    var mlKgHour = readPositiveNumber("#sf-helper-fluid-target-hour", state.fluids.targetMlKgHour);
    var maintenanceModeInput = document.querySelector("input[name='sf-helper-maintenance-mode']:checked");
    var maintenanceMode = maintenanceModeInput ? maintenanceModeInput.value : state.fluids.maintenanceMode;

    if (document.activeElement && document.activeElement.id === "sf-helper-fluid-target-hour") {
      mode = "hour";
    } else if (document.activeElement && document.activeElement.id === "sf-helper-fluid-target-day") {
      mode = "day";
    }

    return {
      maintenanceMode: maintenanceMode === "bodyWeight" ? "bodyWeight" : "default",
      mode: mode,
      mlKgDay: mlKgDay,
      mlKgHour: mlKgHour
    };
  }

  function renderFluidSummary(summary) {
    state.fluids.summary = summary || null;

    var dayInput = document.querySelector("#sf-helper-fluid-target-day");
    var hourInput = document.querySelector("#sf-helper-fluid-target-hour");

    if (summary && summary.target) {
      state.fluids.maintenanceMode = summary.maintenance && summary.maintenance.mode ?
        summary.maintenance.mode :
        state.fluids.maintenanceMode;
      state.fluids.targetMlKgDay = summary.target.mlPerKgDay;
      state.fluids.targetMlKgHour = summary.target.mlPerKgHour;
      state.fluids.targetMode = summary.target.mode || state.fluids.targetMode;

      if (dayInput && document.activeElement !== dayInput) {
        dayInput.value = formatInputNumber(summary.target.mlPerKgDay, "day");
      }

      if (hourInput && document.activeElement !== hourInput) {
        hourInput.value = formatInputNumber(summary.target.mlPerKgHour, "hour");
      }
    }

    if (!summary || !summary.patient) {
      setElementText("#sf-helper-fluid-weight", "Unavailable");
      setElementText("#sf-helper-fluid-species", "Unavailable");
      setElementText("#sf-helper-maintenance-day", "");
      setElementText("#sf-helper-maintenance-hour", "");
      setElementText("#sf-helper-maintenance-calculation", "");
      setElementText("#sf-helper-target-calculation", "");
      setElementText("#sf-helper-target-day", "");
      setElementText("#sf-helper-target-hour", "");
      setStatus("Patient details unavailable.", true);
      return;
    }

    var weightText = summary.patient.weightKgText || summary.patient.weight.text || "Unavailable";
    var maintenanceFormula = summary.maintenance.formula || "";
    var maintenanceCalculation = "";
    var primaryTargetRate = summary.target.mode === "hour" ?
      summary.target.mlPerKgHourText :
      summary.target.mlPerKgDayText;
    var equivalentTargetRate = summary.target.mode === "hour" ?
      summary.target.mlPerKgDayText :
      summary.target.mlPerKgHourText;
    var targetCalculation = "";

    if (maintenanceFormula && weightText !== "Unavailable") {
      if (maintenanceFormula.indexOf("BW(kg)") !== -1) {
        maintenanceCalculation = maintenanceFormula
          .replace("BW(kg)", "(" + weightText + ")")
          .replace(" * ", " × ");
      } else {
        maintenanceCalculation = weightText + " × " + maintenanceFormula;
      }
    }

    if (primaryTargetRate && weightText !== "Unavailable") {
      targetCalculation = weightText + " × " + primaryTargetRate;

      if (equivalentTargetRate) {
        targetCalculation += " · equivalent to " + equivalentTargetRate;
      }
    }

    setElementText("#sf-helper-fluid-weight", weightText);
    setElementText("#sf-helper-fluid-species", speciesText(summary) || "Unavailable");
    setElementText("#sf-helper-maintenance-day", summary.maintenance.mlPerDayText || "");
    setElementText("#sf-helper-maintenance-hour", summary.maintenance.mlPerHourText || "");
    setElementText("#sf-helper-maintenance-calculation", maintenanceCalculation);
    setElementText("#sf-helper-target-calculation", targetCalculation);
    setElementText("#sf-helper-target-day", summary.target.mlPerDayText || "");
    setElementText("#sf-helper-target-hour", summary.target.mlPerHourText || "");

    if (!summary.patient.weightKg) {
      setStatus("Patient weight unavailable.", true);
    } else if (!summary.maintenance.available) {
      setStatus("Patient species unavailable.", true);
    } else {
      setStatus("", false);
    }
  }

  function refreshFluids() {
    var target = getFluidTargetInputValue();
    var requestSeq = ++state.fluids.requestSeq;
    var contextGeneration = state.pageContext.generation;

    state.fluids.targetMlKgDay = target.mlKgDay;
    state.fluids.targetMlKgHour = target.mlKgHour;
    state.fluids.targetMode = target.mode;
    state.fluids.maintenanceMode = target.maintenanceMode;
    setStatus("Reading patient details...", false);

    return helperCall("getFluidRateSummary", [target]).then(function (summary) {
      if (
        requestSeq !== state.fluids.requestSeq ||
        contextGeneration !== state.pageContext.generation ||
        state.activeTab !== "fluids"
      ) {
        return null;
      }

      renderFluidSummary(summary);
      return summary;
    }).catch(function (error) {
      if (
        requestSeq !== state.fluids.requestSeq ||
        contextGeneration !== state.pageContext.generation ||
        state.activeTab !== "fluids"
      ) {
        return null;
      }

      renderFluidSummary(null);
      setStatus(error && error.message ? error.message : String(error), true);
      return null;
    });
  }

  function buildMetricPane(type, title) {
    var prefix = type === "bloodPressure" ? "bp" : "bg";
    var pane = createElement("section", {
      className: "sf-helper-pane",
      attrs: {
        "data-sf-helper-metric-panel": type
      }
    });
    var header = createElement("div", { className: "sf-helper-pane-header" });

    if (state.activeMetric !== type) {
      pane.setAttribute("hidden", "hidden");
    }

    header.appendChild(createElement("h2", {
      className: "sf-helper-pane-title",
      text: title
    }));
    header.appendChild(createElement("div", {
      className: "sf-helper-count",
      attrs: {
        id: "sf-helper-" + prefix + "-count"
      },
      text: "0 results"
    }));

    var list = createElement("div", {
      className: "sf-helper-list",
      attrs: {
        id: "sf-helper-" + prefix + "-list"
      }
    });
    var output = createElement("textarea", {
      className: "sf-helper-output",
      attrs: {
        id: "sf-helper-" + prefix + "-output",
        spellcheck: "false"
      }
    });
    var actions = createElement("div", { className: "sf-helper-pane-actions" });
    var copyButton = createElement("button", {
      className: "sf-helper-button sf-helper-button-primary",
      text: "Copy",
      attrs: {
        id: "sf-helper-" + prefix + "-copy",
        type: "button",
        disabled: "disabled"
      }
    });

    copyButton.addEventListener("click", function () {
      copyMetric(type);
    });

    actions.appendChild(copyButton);
    pane.appendChild(header);
    pane.appendChild(list);
    pane.appendChild(output);
    pane.appendChild(actions);

    return pane;
  }

  function selectMetric(type) {
    state.activeMetric = type === "bloodPressure" ? "bloodPressure" : "bloodGlucose";

    Array.prototype.slice.call(document.querySelectorAll("[data-sf-helper-metric-tab]")).forEach(function (button) {
      button.setAttribute("aria-selected", button.getAttribute("data-sf-helper-metric-tab") === state.activeMetric ? "true" : "false");
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-sf-helper-metric-panel]")).forEach(function (panel) {
      var selected = panel.getAttribute("data-sf-helper-metric-panel") === state.activeMetric;
      if (selected) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "hidden");
      }
    });
  }

  function buildMetricTab(type, label) {
    var selected = state.activeMetric === type;
    var tab = createElement("button", {
      className: "sf-helper-metric-tab",
      text: label,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": selected ? "true" : "false",
        "data-sf-helper-metric-tab": type
      }
    });

    tab.addEventListener("click", function () {
      selectMetric(type);
    });

    return tab;
  }

  function buildRateRow(label, valueId) {
    var row = createElement("div", { className: "sf-helper-rate-row" });

    row.appendChild(createElement("div", {
      className: "sf-helper-rate-label",
      text: label
    }));
    row.appendChild(createElement("div", {
      className: "sf-helper-rate-value",
      attrs: {
        id: valueId
      }
    }));

    return row;
  }

  function buildSummaryItem(label, valueId) {
    var stat = createElement("div", { className: "sf-helper-summary-item" });

    stat.appendChild(createElement("div", {
      className: "sf-helper-summary-label",
      text: label
    }));
    stat.appendChild(createElement("div", {
      className: "sf-helper-summary-value",
      attrs: {
        id: valueId
      }
    }));

    return stat;
  }

  function buildFluidOutput(label, valueId, className) {
    var outputClassName = "sf-helper-fluid-output";

    if (className) {
      outputClassName += " " + className;
    }

    var output = createElement("div", { className: outputClassName });

    output.appendChild(createElement("div", {
      className: "sf-helper-fluid-output-label",
      text: label
    }));
    output.appendChild(createElement("div", {
      className: "sf-helper-fluid-output-value",
      attrs: {
        id: valueId
      }
    }));

    return output;
  }

  function buildFluidSectionHeader(step, title, detail) {
    var header = createElement("div", { className: "sf-helper-fluid-section-header" });
    var copy = createElement("div", { className: "sf-helper-fluid-section-copy" });

    header.appendChild(createElement("span", {
      className: "sf-helper-fluid-step",
      text: step
    }));
    copy.appendChild(createElement("h2", {
      className: "sf-helper-pane-title",
      text: title
    }));
    copy.appendChild(createElement("p", {
      className: "sf-helper-fluid-section-help",
      text: detail
    }));
    header.appendChild(copy);

    return header;
  }

  function buildFluidCalculation(valueId) {
    var calculation = createElement("div", { className: "sf-helper-fluid-calculation" });

    calculation.appendChild(createElement("span", {
      className: "sf-helper-fluid-calculation-label",
      text: "Calculation"
    }));
    calculation.appendChild(createElement("span", {
      className: "sf-helper-fluid-calculation-value",
      attrs: {
        id: valueId
      }
    }));

    return calculation;
  }

  function buildMaintenanceModeOption(value, title, detail) {
    var label = createElement("label", { className: "sf-helper-radio-option" });
    var input = createElement("input", {
      attrs: {
        type: "radio",
        name: "sf-helper-maintenance-mode",
        value: value
      }
    });

    if (state.fluids.maintenanceMode === value) {
      input.checked = true;
    }

    input.addEventListener("change", function () {
      if (!input.checked) {
        return;
      }

      state.fluids.maintenanceMode = value;
      refreshFluids();
    });

    label.appendChild(input);
    label.appendChild(createElement("span", {
      className: "sf-helper-radio-label",
      text: title
    }));
    label.appendChild(createElement("span", {
      className: "sf-helper-radio-detail",
      text: detail
    }));

    return label;
  }

  function buildVitalsPanel() {
    var panel = createElement("div", {
      className: "sf-helper-tab-panel",
      attrs: {
        id: "sf-helper-panel-vitals",
        role: "tabpanel",
        "data-sf-helper-panel": "vitals"
      }
    });
    var metricTabs = createElement("div", {
      className: "sf-helper-metric-tabs",
      attrs: {
        role: "tablist",
        "aria-label": "Vitals type"
      }
    });
    var split = createElement("div", { className: "sf-helper-split" });

    metricTabs.appendChild(buildMetricTab("bloodGlucose", "Blood Glucose"));
    metricTabs.appendChild(buildMetricTab("bloodPressure", "Blood Pressure"));
    split.appendChild(buildMetricPane("bloodGlucose", "Blood Glucose"));
    split.appendChild(buildMetricPane("bloodPressure", "Blood Pressure"));
    panel.appendChild(metricTabs);
    panel.appendChild(split);

    return panel;
  }

  function buildFluidsPanel() {
    var panel = createElement("div", {
      className: "sf-helper-tab-panel",
      attrs: {
        id: "sf-helper-panel-fluids",
        role: "tabpanel",
        "data-sf-helper-panel": "fluids",
        hidden: "hidden"
      }
    });
    var grid = createElement("div", { className: "sf-helper-fluid-grid" });
    var summary = createElement("section", { className: "sf-helper-fluid-card sf-helper-fluid-summary" });
    var summaryHeading = createElement("div", { className: "sf-helper-fluid-summary-heading" });
    var summaryGrid = createElement("div", { className: "sf-helper-fluid-summary-grid" });
    var maintenance = createElement("section", {
      className: "sf-helper-fluid-card sf-helper-fluid-section sf-helper-fluid-maintenance"
    });
    var maintenanceMode = createElement("div", {
      className: "sf-helper-radio-group",
      attrs: {
        role: "radiogroup",
        "aria-label": "Maintenance formula"
      }
    });
    var maintenanceResults = createElement("div", { className: "sf-helper-fluid-output-grid" });
    var target = createElement("section", {
      className: "sf-helper-fluid-card sf-helper-fluid-section sf-helper-fluid-target"
    });
    var targetInputs = createElement("div", { className: "sf-helper-target-inputs" });
    var targetDayField = createElement("label", { className: "sf-helper-field sf-helper-target-field" });
    var targetHourField = createElement("label", { className: "sf-helper-field sf-helper-target-field" });
    var targetResults = createElement("div", { className: "sf-helper-fluid-output-grid" });
    var targetDayInput = createElement("input", {
      className: "sf-helper-number-input",
      attrs: {
        id: "sf-helper-fluid-target-day",
        type: "number",
        min: "1",
        step: "1",
        value: String(state.fluids.targetMlKgDay)
      }
    });
    var targetHourInput = createElement("input", {
      className: "sf-helper-number-input",
      attrs: {
        id: "sf-helper-fluid-target-hour",
        type: "number",
        min: "0.1",
        step: "0.1",
        value: formatInputNumber(state.fluids.targetMlKgHour, "hour")
      }
    });

    summaryHeading.appendChild(createElement("h2", {
      className: "sf-helper-pane-title",
      text: "Current patient"
    }));
    summaryHeading.appendChild(createElement("p", {
      className: "sf-helper-fluid-section-help",
      text: "Used in both calculations below"
    }));
    summaryGrid.appendChild(buildSummaryItem("Weight", "sf-helper-fluid-weight"));
    summaryGrid.appendChild(buildSummaryItem("Species", "sf-helper-fluid-species"));
    summary.appendChild(summaryHeading);
    summary.appendChild(summaryGrid);

    maintenance.appendChild(buildFluidSectionHeader(
      "1",
      "Maintenance estimate",
      "Choose one formula; both results use the patient weight above."
    ));
    maintenanceMode.appendChild(buildMaintenanceModeOption("default", "Standard", "Dog 60 / Cat 40 mL/kg/day"));
    maintenanceMode.appendChild(buildMaintenanceModeOption("bodyWeight", "Weight based", "Dog 132, Cat 80 × kg^0.75"));
    maintenance.appendChild(maintenanceMode);
    maintenance.appendChild(buildFluidCalculation("sf-helper-maintenance-calculation"));
    maintenanceResults.appendChild(buildFluidOutput(
      "Hourly rate",
      "sf-helper-maintenance-hour",
      "sf-helper-fluid-output-primary"
    ));
    maintenanceResults.appendChild(buildFluidOutput(
      "Daily total",
      "sf-helper-maintenance-day",
      "sf-helper-fluid-output-secondary"
    ));
    maintenance.appendChild(maintenanceResults);

    target.appendChild(buildFluidSectionHeader(
      "2",
      "Custom fluid target",
      "Enter either target; the other field updates automatically."
    ));
    targetDayField.appendChild(createElement("span", {
      className: "sf-helper-field-label",
      text: "Daily target"
    }));
    targetDayField.appendChild(createElement("span", {
      className: "sf-helper-field-unit",
      text: "mL/kg/day"
    }));
    targetDayField.appendChild(targetDayInput);
    targetHourField.appendChild(createElement("span", {
      className: "sf-helper-field-label",
      text: "Hourly target"
    }));
    targetHourField.appendChild(createElement("span", {
      className: "sf-helper-field-unit",
      text: "mL/kg/hr"
    }));
    targetHourField.appendChild(targetHourInput);
    targetInputs.appendChild(targetDayField);
    targetInputs.appendChild(targetHourField);
    target.appendChild(targetInputs);
    target.appendChild(buildFluidCalculation("sf-helper-target-calculation"));
    targetResults.appendChild(buildFluidOutput(
      "Pump rate",
      "sf-helper-target-hour",
      "sf-helper-fluid-output-primary"
    ));
    targetResults.appendChild(buildFluidOutput(
      "Total per day",
      "sf-helper-target-day",
      "sf-helper-fluid-output-secondary"
    ));
    target.appendChild(targetResults);

    targetDayInput.addEventListener("input", function () {
      state.fluids.targetMode = "day";
      refreshFluids();
    });
    targetHourInput.addEventListener("input", function () {
      state.fluids.targetMode = "hour";
      refreshFluids();
    });

    grid.appendChild(summary);
    grid.appendChild(maintenance);
    grid.appendChild(target);
    panel.appendChild(grid);

    return panel;
  }

  function buildNotesPanel() {
    var panel = createElement("div", {
      className: "sf-helper-tab-panel",
      attrs: {
        id: "sf-helper-panel-notes",
        role: "tabpanel",
        "data-sf-helper-panel": "notes",
        hidden: "hidden"
      }
    });
    var pane = createElement("section", { className: "sf-helper-pane sf-helper-notes-pane" });
    var header = createElement("div", { className: "sf-helper-pane-header" });
    var output = createElement("textarea", {
      className: "sf-helper-output sf-helper-notes-output",
      attrs: {
        id: "sf-helper-notes-output",
        spellcheck: "false"
      }
    });
    var actions = createElement("div", { className: "sf-helper-pane-actions" });
    var copyButton = createElement("button", {
      className: "sf-helper-button sf-helper-button-primary",
      text: "Copy to Clipboard",
      attrs: {
        id: "sf-helper-notes-copy",
        type: "button",
        disabled: "disabled"
      }
    });

    header.appendChild(createElement("h2", {
      className: "sf-helper-pane-title",
      text: "Notes"
    }));
    header.appendChild(createElement("div", {
      className: "sf-helper-count",
      attrs: {
        id: "sf-helper-notes-count"
      },
      text: "0 notes"
    }));

    copyButton.addEventListener("click", copyNotes);

    actions.appendChild(copyButton);
    pane.appendChild(header);
    pane.appendChild(output);
    pane.appendChild(actions);
    panel.appendChild(pane);

    return panel;
  }

  function buildControlledPanel() {
    var panel = createElement("div", {
      className: "sf-helper-tab-panel",
      attrs: {
        id: "sf-helper-panel-controlled",
        role: "tabpanel",
        "data-sf-helper-panel": "controlled",
        hidden: "hidden"
      }
    });
    var pane = createElement("section", { className: "sf-helper-pane sf-helper-controlled-pane" });
    var header = createElement("div", { className: "sf-helper-pane-header" });
    var output = createElement("textarea", {
      className: "sf-helper-output sf-helper-controlled-output",
      attrs: {
        id: "sf-helper-controlled-output",
        spellcheck: "false",
        readonly: "readonly"
      }
    });
    var actions = createElement("div", { className: "sf-helper-pane-actions" });
    var copyButton = createElement("button", {
      className: "sf-helper-button sf-helper-button-primary",
      text: "Copy",
      attrs: {
        id: "sf-helper-controlled-copy",
        type: "button",
        disabled: "disabled"
      }
    });

    header.appendChild(createElement("h2", {
      className: "sf-helper-pane-title",
      text: "Controlled Meds"
    }));
    header.appendChild(createElement("div", {
      className: "sf-helper-count",
      attrs: {
        id: "sf-helper-controlled-count"
      },
      text: "0 due"
    }));

    copyButton.addEventListener("click", copyControlledSchedule);

    actions.appendChild(copyButton);
    pane.appendChild(header);
    pane.appendChild(output);
    pane.appendChild(actions);
    panel.appendChild(pane);

    return panel;
  }

  function refreshActiveTab(options) {
    options = options || {};

    var tabWasDirty = isTabDirty(state.activeTab);

    state.pageContext.dirtyTabs[state.activeTab] = false;

    if (state.activeTab === "fluids") {
      return refreshFluids();
    }

    if (state.activeTab === "notes") {
      return forceRefreshNotesForCurrentPatient(false);
    }

    if (state.activeTab === "controlled") {
      if (options.manual || options.contextChange || tabWasDirty || !state.controlled.updatedAt) {
        return refreshControlled({
          force: true
        });
      }

      renderControlled();
      setStatus(controlledStatusText(), false);
      return Promise.resolve(null);
    }

    return refreshVitals();
  }

  function selectTab(tabName) {
    state.activeTab = tabName;

    Array.prototype.slice.call(document.querySelectorAll("[data-sf-helper-tab]")).forEach(function (button) {
      button.setAttribute("aria-selected", button.getAttribute("data-sf-helper-tab") === tabName ? "true" : "false");
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-sf-helper-panel]")).forEach(function (panel) {
      var selected = panel.getAttribute("data-sf-helper-panel") === tabName;
      if (selected) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "hidden");
      }
    });

    refreshActiveTab();
  }

  function buildTab(tabName, label, selected, disabled) {
    var tab = createElement("button", {
      className: "sf-helper-tab",
      text: label,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": selected ? "true" : "false",
        "data-sf-helper-tab": tabName
      }
    });

    if (disabled) {
      tab.setAttribute("disabled", "disabled");
    } else {
      tab.addEventListener("click", function () {
        selectTab(tabName);
      });
    }

    return tab;
  }

  function buildPanel() {
    var root = createElement("div", {
      className: OPEN_CLASS,
      attrs: {
        id: ROOT_ID
      }
    });

    var launcher = createElement("button", {
      className: "sf-helper-launcher",
      text: "SF",
      attrs: {
        type: "button",
        title: "Open Smart Flow Helper",
        "aria-label": "Open Smart Flow Helper",
        "aria-controls": "sf-helper-panel",
        "aria-expanded": "true"
      }
    });

    var panel = createElement("div", {
      className: "sf-helper-panel",
      attrs: {
        id: "sf-helper-panel",
        role: "dialog",
        "aria-label": "Smart Flow Helper",
        "aria-hidden": "false"
      }
    });

    var header = createElement("div", { className: "sf-helper-header" });
    header.appendChild(createElement("div", {
      className: "sf-helper-title",
      text: "Smart Flow Helper"
    }));

    var windowActions = createElement("div", { className: "sf-helper-window-actions" });
    var minimizeButton = createElement("button", {
      className: "sf-helper-icon-button sf-helper-minimize-button",
      text: "\u2212",
      attrs: {
        type: "button",
        title: "Minimize",
        "aria-label": "Minimize Smart Flow Helper"
      }
    });
    windowActions.appendChild(minimizeButton);
    header.appendChild(windowActions);

    var tabs = createElement("div", {
      className: "sf-helper-tabs",
      attrs: {
        role: "tablist"
      }
    });
    tabs.appendChild(buildTab("vitals", "Vitals", true, false));
    tabs.appendChild(buildTab("fluids", "Fluids", false, false));
    tabs.appendChild(buildTab("notes", "Notes", false, false));
    tabs.appendChild(buildTab("controlled", "Controlled", false, false));

    var body = createElement("div", { className: "sf-helper-body" });

    var status = createElement("div", {
      className: "sf-helper-status",
      attrs: {
        id: "sf-helper-status",
        role: "status"
      }
    });

    var footer = createElement("div", { className: "sf-helper-footer" });
    var refreshButton = createElement("button", {
      className: "sf-helper-button sf-helper-refresh-button",
      text: "Refresh",
      attrs: {
        type: "button",
        title: "Refresh the current tab"
      }
    });
    footer.appendChild(refreshButton);

    body.appendChild(buildVitalsPanel());
    body.appendChild(buildFluidsPanel());
    body.appendChild(buildNotesPanel());
    body.appendChild(buildControlledPanel());
    body.appendChild(status);

    panel.appendChild(header);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(footer);
    root.appendChild(launcher);
    root.appendChild(panel);

    launcher.addEventListener("click", function () {
      root.classList.add(OPEN_CLASS);
      launcher.setAttribute("aria-expanded", "true");
      panel.setAttribute("aria-hidden", "false");
      scheduleHelperPlacement();
      refreshActiveTab();
      minimizeButton.focus();
    });

    minimizeButton.addEventListener("click", function () {
      root.classList.remove(OPEN_CLASS);
      launcher.setAttribute("aria-expanded", "false");
      panel.setAttribute("aria-hidden", "true");
      scheduleHelperPlacement();
      launcher.focus();
    });

    refreshButton.addEventListener("click", function () {
      refreshActiveTab({
        manual: true
      });
    });

    return root;
  }

  function init() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    document.documentElement.appendChild(buildPanel());
    applyHelperPlacement();
    window.addEventListener("resize", scheduleHelperPlacement);
    window.addEventListener("scroll", scheduleHelperPlacement, true);
    watchPatientNavigation();
    watchSmartFlowNotesOpen();
    handleLocationChange({
      contextChange: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
