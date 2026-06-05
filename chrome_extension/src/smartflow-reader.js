(function () {
  "use strict";

  var API_NAME = "SmartFlowExt";
  var VERSION = "0.1.0";

  function getValueParsers() {
    if (!window.SmartFlowValueParsers) {
      throw new Error("Smart Flow value parsers are not loaded");
    }

    return window.SmartFlowValueParsers;
  }

  function textOf(element) {
    if (!element) {
      return "";
    }

    return (element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function firstText(selectors, root) {
    root = root || document;

    for (var i = 0; i < selectors.length; i++) {
      var element = root.querySelector(selectors[i]);
      var text = textOf(element);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function elementTextOrTitle(element) {
    if (!element) {
      return "";
    }

    return textOf(element) || String(element.getAttribute("title") || "").trim();
  }

  function firstTextOrTitle(selectors, root) {
    root = root || document;

    for (var i = 0; i < selectors.length; i++) {
      var element = root.querySelector(selectors[i]);
      var text = elementTextOrTitle(element);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function isVisible(element) {
    return !!element &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length) &&
      getComputedStyle(element).visibility !== "hidden";
  }

  function stripHtml(value) {
    if (!value) {
      return "";
    }

    var template = document.createElement("template");
    template.innerHTML = String(value);
    return textOf(template.content);
  }

  function safeClone(value, depth) {
    if (value === null || value === undefined) {
      return value;
    }

    if (depth <= 0) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map(function (item) {
        return safeClone(item, depth - 1);
      });
    }

    if (typeof value === "object") {
      var result = {};
      Object.keys(value).forEach(function (key) {
        if (key.charAt(0) === "$" || typeof value[key] === "function") {
          return;
        }

        result[key] = safeClone(value[key], depth - 1);
      });
      return result;
    }

    return value;
  }

  function getAngularScope(element) {
    if (!element || !window.angular || !window.angular.element) {
      return null;
    }

    try {
      return window.angular.element(element).scope() || null;
    } catch (error) {
      return null;
    }
  }

  function getPatientScope() {
    var candidates = [
      "#patient-table",
      ".whiteboard-table-holder",
      "[data-ng-view]",
      "#ng-app"
    ];

    for (var i = 0; i < candidates.length; i++) {
      var element = document.querySelector(candidates[i]);
      var scope = getAngularScope(element);
      if (scope && (scope.hospitalization || scope.flowsheet || scope.patientWeight)) {
        return scope;
      }
    }

    return null;
  }

  function parseNumber(value) {
    return getValueParsers().parseNumber(value);
  }

  function parseWeight(value) {
    var text = String(value || "").trim();
    var number = parseNumber(text);
    var unitMatch = text.match(/\b(kg|kgs|kilograms?|lb|lbs|pounds?)\b/i);
    var unit = unitMatch ? unitMatch[1].toLowerCase() : "";

    if (unit === "kgs" || unit.indexOf("kilogram") === 0) {
      unit = "kg";
    }

    if (unit === "lb" || unit.indexOf("pound") === 0) {
      unit = "lbs";
    }

    return {
      text: text,
      value: number,
      unit: unit || null
    };
  }

  function normalizeSpecies(value) {
    var text = String(value || "").trim();
    var lower = text.toLowerCase();

    if (lower.indexOf("canine") !== -1 || lower.indexOf("dog") !== -1) {
      return "dog";
    }

    if (lower.indexOf("feline") !== -1 || lower.indexOf("cat") !== -1) {
      return "cat";
    }

    return text ? "other" : null;
  }

  function getPatientWeightKg(patient) {
    if (!patient || !patient.weight || typeof patient.weight.value !== "number") {
      return null;
    }

    if (patient.weight.unit === "lbs") {
      return patient.weight.value / 2.2046226218;
    }

    return patient.weight.value;
  }

  function fluidRatePrecision(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "";
    }

    if (value >= 100) {
      return String(Math.round(value));
    }

    if (value >= 10) {
      return String(Math.round(value * 10) / 10);
    }

    return String(Math.round(value * 100) / 100);
  }

  function fluidPerKgDayText(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "";
    }

    return Math.round(value) + " mL/kg/day";
  }

  function fluidPerKgHourText(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "";
    }

    return (Math.round(value * 10) / 10).toFixed(1) + " mL/kg/hr";
  }

  function fluidMlHourText(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "";
    }

    return Math.round(value) + " mL/hr";
  }

  function maintenanceMultiplier(species) {
    if (species === "dog") {
      return 132;
    }

    if (species === "cat") {
      return 80;
    }

    return null;
  }

  function parseFluidTarget(target) {
    var mode = "day";
    var mlKgDay = null;
    var mlKgHour = null;

    if (target && typeof target === "object") {
      mode = target.mode === "hour" ? "hour" : "day";
      mlKgDay = parseNumber(target.mlKgDay);
      mlKgHour = parseNumber(target.mlKgHour);
    } else {
      mlKgDay = parseNumber(target);
    }

    if (mode === "hour" && mlKgHour !== null && mlKgHour > 0) {
      mlKgDay = mlKgHour * 24;
    } else if (mlKgDay !== null && mlKgDay > 0) {
      mlKgHour = mlKgDay / 24;
      mode = "day";
    } else if (mlKgHour !== null && mlKgHour > 0) {
      mlKgDay = mlKgHour * 24;
      mode = "hour";
    } else {
      mlKgDay = 90;
      mlKgHour = mlKgDay / 24;
      mode = "day";
    }

    return {
      mode: mode,
      mlKgDay: mlKgDay,
      mlKgHour: mlKgHour
    };
  }

  function findRenderedWeight(tags) {
    var fallback = "";

    for (var i = 0; i < tags.length; i++) {
      if (/\b(kg|kgs|kilograms?|lb|lbs|pounds?)\b/i.test(tags[i])) {
        return tags[i];
      }

      if (!fallback && /\d/.test(tags[i]) && !/\b(DNR|BLS|ALS|CPR|CAUTION)\b/i.test(tags[i])) {
        fallback = tags[i];
      }
    }

    return fallback;
  }

  function findPatientCardBlock(panel, headerText) {
    var normalizedHeader = String(headerText || "").toUpperCase();
    var blocks = Array.prototype.slice.call(panel.querySelectorAll(".patient-card-content-block"));

    for (var i = 0; i < blocks.length; i++) {
      var header = blocks[i].querySelector(".patient-card-content-block-header");
      if (textOf(header).toUpperCase() === normalizedHeader) {
        return blocks[i];
      }
    }

    return null;
  }

  function cardBlockInfoLines(block) {
    if (!block) {
      return [];
    }

    return Array.prototype.slice.call(block.querySelectorAll(".patient-card-basic-info"))
      .map(textOf)
      .filter(function (line) {
        return line && line.indexOf(": ") === -1;
      });
  }

  function readPatientPanelFromScope(scope) {
    if (!scope || !scope.hospitalization) {
      return null;
    }

    var hospitalization = scope.hospitalization;
    var patient = hospitalization.patient || {};
    var owner = patient.owner || {};
    var weightText = scope.patientWeight || hospitalization.weight || hospitalization.patientWeight || "";
    var species = patient.speciesName || hospitalization.pet || "";

    return {
      source: "angular",
      hospitalizationId: hospitalization.id || null,
      flowsheetId: scope.flowsheet ? scope.flowsheet.flowsheetID || null : null,
      name: hospitalization.name || patient.name || "",
      cage: hospitalization.cage || "",
      weight: parseWeight(weightText),
      species: {
        text: species,
        normalized: normalizeSpecies(species)
      },
      breed: patient.breedName || "",
      sex: patient.sexName || "",
      age: hospitalization.age || "",
      color: patient.colorName || "",
      fileNumber: hospitalization.customField || "",
      problems: Array.isArray(hospitalization.diseases) ? hospitalization.diseases.slice() : [],
      criticalNote: hospitalization.alergy || "",
      owner: {
        displayName: [owner.nameLast, owner.nameFirst].filter(Boolean).join(" "),
        firstName: owner.nameFirst || "",
        lastName: owner.nameLast || "",
        homePhone: owner.homePhone || "",
        workPhone: owner.workPhone || ""
      }
    };
  }

  function readPatientPanelFromDom() {
    var panel = document.querySelector("#patient-table .patient-card-container");
    if (!panel) {
      return null;
    }

    var firstBlock = panel.querySelector(".patient-card-content-block");
    var clientBlock = findPatientCardBlock(panel, "CLIENT");
    var problemsBlock = findPatientCardBlock(panel, "PROBLEMS");
    var tags = Array.prototype.slice.call(panel.querySelectorAll(".patient-tag"))
      .map(textOf)
      .filter(Boolean);
    var basicRows = firstBlock ? Array.prototype.slice.call(firstBlock.children)
      .filter(function (element) {
        return element.classList && element.classList.contains("patient-card-basic-info");
      }) : [];
    var basicInfo = Array.prototype.slice.call(panel.querySelectorAll(".patient-card-basic-info"))
      .map(textOf)
      .filter(Boolean);
    var speciesNode = firstBlock ? firstBlock.querySelector(".patient-card-basic-info span[title]") : null;
    var breedNode = firstBlock ? firstBlock.querySelector(".patient-card-basic-info span[title] + span[title]") : null;
    var sexNode = firstBlock ? firstBlock.querySelector(".patient-card-basic-info span[title] + span[title] + span") : null;
    var clientInfo = clientBlock ? cardBlockInfoLines(clientBlock) : [];
    var problems = problemsBlock ? cardBlockInfoLines(problemsBlock) : [];
    var weightText = findRenderedWeight(tags);
    var speciesText = "";
    var fileNumber = "";

    for (var i = 0; i < basicInfo.length; i++) {
      if (/\b(canine|feline|dog|cat|equine|horse)\b/i.test(basicInfo[i])) {
        speciesText = basicInfo[i];
      }

      if (/^File Number:/i.test(basicInfo[i])) {
        fileNumber = basicInfo[i].replace(/^File Number:\s*/i, "");
      }
    }

    return {
      source: "dom",
      hospitalizationId: null,
      flowsheetId: null,
      name: firstTextOrTitle([".patient-card-patient-name"], panel),
      cage: "",
      weight: parseWeight(weightText),
      species: {
        text: elementTextOrTitle(speciesNode) || speciesText,
        normalized: normalizeSpecies(elementTextOrTitle(speciesNode) || speciesText)
      },
      breed: elementTextOrTitle(breedNode).replace(/^\s*-\s*/, ""),
      sex: elementTextOrTitle(sexNode),
      age: basicRows[1] ? textOf(basicRows[1]) : "",
      color: basicRows[2] ? textOf(basicRows[2]) : "",
      fileNumber: fileNumber,
      problems: problems,
      criticalNote: firstText([".patient-card-critical"], panel).replace(/^Critical:\s*/i, ""),
      owner: {
        displayName: clientInfo[0] || "",
        firstName: "",
        lastName: "",
        homePhone: "",
        workPhone: (clientInfo.filter(function (line) {
          return /^Tel:/i.test(line);
        })[0] || "").replace(/^Tel:\s*/i, "")
      }
    };
  }

  function getPatientPanel() {
    return readPatientPanelFromScope(getPatientScope()) || readPatientPanelFromDom();
  }

  function parseHourLabel(label) {
    var clean = String(label || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return {
        label: "",
        hour24: null
      };
    }

    var ampm = clean.match(/\b(AM|PM)\b/i);
    var numberMatch = clean.match(/\d{1,2}/);
    var hour = numberMatch ? Number(numberMatch[0]) : null;

    if (hour !== null && ampm) {
      var part = ampm[1].toUpperCase();
      if (part === "AM" && hour === 12) {
        hour = 0;
      } else if (part === "PM" && hour !== 12) {
        hour += 12;
      }
    } else if (hour === 24) {
      hour = 0;
    }

    return {
      label: clean,
      hour24: hour
    };
  }

  function getRenderedFlowsheetDate() {
    var months = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11
    };
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".current-flowsheet .date"));

    for (var i = nodes.length - 1; i >= 0; i--) {
      var text = textOf(nodes[i]);
      var match = text.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{2,4})\b/);

      if (!match) {
        continue;
      }

      var day = Number(match[1]);
      var month = months[match[2].toLowerCase()];
      var year = Number(match[3]);

      if (year < 100) {
        year += 2000;
      }

      if (month === undefined) {
        continue;
      }

      return {
        raw: text,
        date: new Date(year, month, day, 0, 0, 0, 0)
      };
    }

    return null;
  }

  function setRenderedHour(dateInfo, header, fallbackHour) {
    if (!dateInfo || !dateInfo.date) {
      return null;
    }

    var hour = header && typeof header.hour24 === "number" ? header.hour24 : fallbackHour;
    var date = new Date(dateInfo.date.getTime());

    if (typeof hour !== "number" || Number.isNaN(hour)) {
      hour = 0;
    }

    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  }

  function getHeaderCells() {
    var headerRow = document.querySelector("#flowsheetTable thead tr.pr-time") ||
      document.querySelector("#patient-table tr.pr-time");

    if (!headerRow) {
      return [];
    }

    return Array.prototype.slice.call(headerRow.children)
      .filter(function (cell) {
        return !cell.classList.contains("pr-heading");
      })
      .map(function (cell, index) {
        var parsed = parseHourLabel(textOf(cell));
        var scope = getAngularScope(cell);

        return {
          index: index,
          label: parsed.label,
          hour24: parsed.hour24,
          day: scope && scope.hour ? scope.hour.d || null : null,
          element: cell
        };
      });
  }

  function rectOverlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function getCurrentHour() {
    var ribbon = document.querySelector("#flowsheet-current-time") ||
      document.querySelector("#whiteboard-table .current-time");

    if (!ribbon) {
      return null;
    }

    var ribbonRect = ribbon.getBoundingClientRect();
    var headers = getHeaderCells();
    var best = null;
    var bestOverlap = 0;

    headers.forEach(function (header) {
      var rect = header.element.getBoundingClientRect();
      if (!rectOverlaps(ribbonRect, rect)) {
        return;
      }

      var overlap = Math.min(ribbonRect.right, rect.right) - Math.max(ribbonRect.left, rect.left);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = header;
      }
    });

    var visible = !!(ribbon.offsetWidth || ribbon.offsetHeight || ribbon.getClientRects().length);

    return {
      source: ribbon.id || "whiteboard-current-time",
      visible: visible,
      left: ribbonRect.left,
      width: ribbonRect.width,
      columnIndex: best ? best.index : null,
      label: best ? best.label : "",
      hour24: best ? best.hour24 : null
    };
  }

  function sectionFromParameterType(parameterSection) {
    var sections = {
      1: "monitoring",
      2: "activity",
      3: "fluid",
      4: "medication",
      5: "procedure"
    };

    return sections[parameterSection] || "";
  }

  function getCellDate(scope, hourIndex, header) {
    if (!scope || !scope.flowsheet || !scope.flowsheet.date) {
      return setRenderedHour(getRenderedFlowsheetDate(), header, hourIndex);
    }

    var rawHour = typeof hourIndex === "number" ? hourIndex : 0;

    if (window.moment) {
      try {
        return window.moment(scope.flowsheet.date).add(rawHour, "hours").format();
      } catch (error) {
        return null;
      }
    }

    var date = new Date(scope.flowsheet.date);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    date.setHours(date.getHours() + rawHour);
    return date.toISOString();
  }

  function cellHasColor(cell) {
    if (!cell) {
      return false;
    }

    var inline = cell.getAttribute("style") || "";
    return /background(?:-color)?\s*:/i.test(inline);
  }

  function getCellState(cell) {
    var classNames = Array.prototype.slice.call(cell.classList);
    var stateClasses = [
      "planned",
      "checked",
      "cancelled",
      "critical",
      "yellow",
      "planned-filtered",
      "sync-value",
      "error-value",
      "discontinued"
    ];

    return {
      classes: classNames,
      planned: classNames.indexOf("planned") !== -1,
      checked: classNames.indexOf("checked") !== -1,
      cancelled: classNames.indexOf("cancelled") !== -1,
      critical: classNames.indexOf("critical") !== -1,
      yellow: classNames.indexOf("yellow") !== -1 || classNames.indexOf("planned-filtered") !== -1,
      syncing: classNames.indexOf("sync-value") !== -1,
      error: classNames.indexOf("error-value") !== -1,
      discontinued: classNames.indexOf("discontinued") !== -1,
      highlighted: stateClasses.some(function (className) {
        return classNames.indexOf(className) !== -1;
      }) || cellHasColor(cell)
    };
  }

  function getRowParameter(row) {
    var scope = getAngularScope(row);
    return scope && scope.param ? scope.param : null;
  }

  function getTreatmentName(row, parameter) {
    if (parameter) {
      var name = stripHtml(parameter.NameHtml) || parameter.nameFull || parameter.name || parameter.Name || "";
      var prescription = stripHtml(parameter.PrescriptionHtml || parameter.Prescription || "");
      return {
        name: name,
        prescription: prescription,
        label: [name, prescription].filter(Boolean).join(" ")
      };
    }

    var heading = row.querySelector(".pr-heading-content");
    var nameText = firstText([".pb-name"], heading);
    var prescriptionText = firstText([".prescription"], heading);
    var label = [nameText, prescriptionText].filter(Boolean).join(" ") || textOf(heading);

    return {
      name: nameText || label,
      prescription: prescriptionText,
      label: label
    };
  }

  function readFlowsheetTable() {
    var table = document.querySelector("#flowsheetTable");
    if (!table) {
      return null;
    }

    var patientScope = getPatientScope();
    var headers = getHeaderCells().map(function (header) {
      return {
        index: header.index,
        label: header.label,
        hour24: header.hour24,
        day: header.day
      };
    });
    var rows = [];
    var entries = [];
    var currentSection = "";
    var renderedDate = getRenderedFlowsheetDate();

    Array.prototype.slice.call(table.querySelectorAll("tbody")).forEach(function (body) {
      Array.prototype.slice.call(body.querySelectorAll(":scope > tr")).forEach(function (row) {
        if (row.classList.contains("pr-group")) {
          currentSection = textOf(row.querySelector(".pr-heading-content")) ||
            textOf(row.querySelector(".pr-heading"));
          return;
        }

        if (!row.classList.contains("pr-item")) {
          return;
        }

        var parameter = getRowParameter(row);
        var treatment = getTreatmentName(row, parameter);
        var section = sectionFromParameterType(parameter && parameter.parameterSection) || currentSection;
        var cells = Array.prototype.slice.call(row.children)
          .filter(function (cell) {
            return !cell.classList.contains("pr-heading");
          })
          .map(function (cell, index) {
            var value = textOf(cell);
            var header = headers[index] || {
              index: index,
              label: "",
              hour24: null
            };
            var state = getCellState(cell);
            var cellScope = getAngularScope(cell);
            var hourIndex = cellScope && typeof cellScope.hour === "number" ? cellScope.hour : index;
            var recordedAt = getCellDate(patientScope || cellScope, hourIndex, header);
            var entry = {
              section: section,
              treatment: treatment.label,
              treatmentName: treatment.name,
              prescription: treatment.prescription,
              columnIndex: index,
              hourLabel: header.label,
              hour24: header.hour24,
              recordedAt: recordedAt,
              value: value,
              numericValue: parseNumber(value),
              state: state
            };

            if (value || state.highlighted) {
              entries.push(entry);
            }

            return entry;
          });

        rows.push({
          section: section,
          treatment: treatment.label,
          treatmentName: treatment.name,
          prescription: treatment.prescription,
          parameter: parameter ? {
            parameterBaseID: parameter.parameterBaseID || null,
            localInventoryItemID: parameter.localInventoryItemID || null,
            parameterSection: parameter.parameterSection || null,
            valueType: parameter.valueType || null
          } : null,
          cells: cells
        });
      });
    });

    return {
      source: "dom",
      flowsheetId: patientScope && patientScope.flowsheet ? patientScope.flowsheet.flowsheetID || null : null,
      date: patientScope && patientScope.flowsheet ? patientScope.flowsheet.date || null : null,
      renderedDate: renderedDate ? renderedDate.raw : "",
      durationHours: patientScope && patientScope.flowsheet ? patientScope.flowsheet.durationHours || headers.length : headers.length,
      headers: headers,
      currentHour: getCurrentHour(),
      rows: rows,
      entries: entries
    };
  }

  function readWhiteboardSummary() {
    var table = document.querySelector("#whiteboard-table table.pr-table");
    if (!table) {
      return null;
    }

    var headers = Array.prototype.slice.call(table.querySelectorAll("tr.pr-time .pr-value"))
      .map(function (cell, index) {
        var parsed = parseHourLabel(textOf(cell));
        return {
          index: index,
          label: parsed.label,
          hour24: parsed.hour24
        };
      });

    var rows = Array.prototype.slice.call(table.querySelectorAll("tr[data-testid='whiteboard-patient-row']"))
      .map(function (row) {
        var patientInfo = row.querySelector(".wb-patient-info");
        var cells = Array.prototype.slice.call(row.querySelectorAll(":scope > td.pr-value"))
          .map(function (cell, index) {
            return {
              columnIndex: index,
              hourLabel: headers[index] ? headers[index].label : "",
              hour24: headers[index] ? headers[index].hour24 : null,
              value: textOf(cell),
              numericValue: parseNumber(textOf(cell)),
              state: getCellState(cell)
            };
          });

        return {
          hospitalizationId: row.getAttribute("data-id") || "",
          patientText: textOf(patientInfo),
          cells: cells
        };
      });

    return {
      source: "dom",
      headers: headers,
      currentHour: getCurrentHour(),
      rows: rows
    };
  }

  function normalizeQuery(value) {
    return getValueParsers().normalizeQuery(value);
  }

  function queryTokens(query) {
    var aliases = {
      bg: ["bg", "blood glucose", "glucose", "libre", "spot bg", "spot blood glucose"],
      bp: ["bp", "blood pressure"],
      glu: ["glu", "glucose", "blood glucose"],
      temp: ["temp", "temperature"],
      wt: ["wt", "weight"]
    };
    var normalized = normalizeQuery(query);

    return aliases[normalized] || [normalized];
  }

  function labelContainsToken(label, token) {
    var normalizedToken = normalizeQuery(token);

    if (!normalizedToken) {
      return false;
    }

    if (normalizedToken.length <= 3) {
      return (" " + label + " ").indexOf(" " + normalizedToken + " ") !== -1;
    }

    return label.indexOf(normalizedToken) !== -1;
  }

  function rowMatches(row, query) {
    var tokens = queryTokens(query);
    var label = normalizeQuery([row.treatment, row.treatmentName, row.prescription, row.section].join(" "));

    return tokens.some(function (token) {
      return labelContainsToken(label, token);
    });
  }

  function findRows(query) {
    var flowsheet = readFlowsheetTable();
    if (!flowsheet) {
      return [];
    }

    return flowsheet.rows.filter(function (row) {
      return rowMatches(row, query);
    });
  }

  function findEntries(query, options) {
    options = options || {};

    var flowsheet = readFlowsheetTable();
    if (!flowsheet) {
      return [];
    }

    return flowsheet.entries.filter(function (entry) {
      if (!rowMatches(entry, query)) {
        return false;
      }

      if (options.valuesOnly && !entry.value) {
        return false;
      }

      if (options.highlightedOnly && !entry.state.highlighted) {
        return false;
      }

      return true;
    });
  }

  function latestValue(query) {
    var values = findEntries(query, { valuesOnly: true });

    if (!values.length) {
      return null;
    }

    return values.reduce(function (latest, entry) {
      if (!latest) {
        return entry;
      }

      if (entry.recordedAt && latest.recordedAt) {
        return new Date(entry.recordedAt) > new Date(latest.recordedAt) ? entry : latest;
      }

      return entry.columnIndex > latest.columnIndex ? entry : latest;
    }, null);
  }

  function formatDate(dateLike) {
    return getValueParsers().formatDate(dateLike);
  }

  function formatTime(dateLike, fallbackLabel) {
    return getValueParsers().formatTime(dateLike, fallbackLabel);
  }

  function getFluidRateSummary(targetInput) {
    var patient = getPatientPanel();
    var weightKg = getPatientWeightKg(patient);
    var species = patient && patient.species ? patient.species.normalized : null;
    var multiplier = maintenanceMultiplier(species);
    var target = parseFluidTarget(targetInput);
    var maintenanceMlDay = null;
    var maintenanceMlHour = null;
    var targetMlDay = null;
    var targetMlHour = null;

    if (typeof weightKg === "number" && weightKg > 0 && multiplier) {
      maintenanceMlDay = multiplier * Math.pow(weightKg, 0.75);
      maintenanceMlHour = maintenanceMlDay / 24;
    }

    if (typeof weightKg === "number" && weightKg > 0) {
      targetMlDay = weightKg * target.mlKgDay;
      targetMlHour = targetMlDay / 24;
    }

    return {
      patient: patient ? {
        name: patient.name || "",
        species: patient.species || {
          text: "",
          normalized: null
        },
        weight: patient.weight || {
          text: "",
          value: null,
          unit: null
        },
        weightKg: weightKg,
        weightKgText: weightKg === null ? "" : fluidRatePrecision(weightKg) + " kg"
      } : null,
      targetMode: target.mode,
      targetMlKgDay: target.mlKgDay,
      targetMlKgHour: target.mlKgHour,
      maintenance: {
        available: maintenanceMlDay !== null,
        species: species,
        formula: multiplier ? multiplier + " * kg^0.75" : "",
        mlPerDay: maintenanceMlDay,
        mlPerHour: maintenanceMlHour,
        mlPerDayText: maintenanceMlDay === null ? "" : fluidRatePrecision(maintenanceMlDay) + " mL/day",
        mlPerHourText: fluidMlHourText(maintenanceMlHour)
      },
      target: {
        available: targetMlHour !== null,
        mode: target.mode,
        mlPerKgDay: target.mlKgDay,
        mlPerKgHour: target.mlKgHour,
        mlPerDay: targetMlDay,
        mlPerHour: targetMlHour,
        mlPerKgDayText: fluidPerKgDayText(target.mlKgDay),
        mlPerKgHourText: fluidPerKgHourText(target.mlKgHour),
        mlPerDayText: targetMlDay === null ? "" : fluidRatePrecision(targetMlDay) + " mL/day",
        mlPerHourText: fluidMlHourText(targetMlHour)
      }
    };
  }

  function parseDateLike(value) {
    var date = null;

    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      date = value;
    } else if (window.moment) {
      try {
        var momentDate = window.moment(value);
        if (momentDate && momentDate.isValid && momentDate.isValid()) {
          date = momentDate.toDate();
        }
      } catch (error) {
        date = null;
      }
    }

    if (!date) {
      date = new Date(value);
    }

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateWithTimeText(dateText, timeText) {
    var date = parseDateLike(dateText);
    var match = cleanText(timeText).match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
    var hour = null;
    var minute = 0;
    var part = "";

    if (!date || !match) {
      return date;
    }

    hour = Number(match[1]);
    minute = match[2] ? Number(match[2]) : 0;
    part = match[3] ? match[3].toLowerCase().replace(/\./g, "") : "";

    if (part === "am" && hour === 12) {
      hour = 0;
    } else if (part === "pm" && hour !== 12) {
      hour += 12;
    }

    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return date;
    }

    date.setHours(hour, minute, 0, 0);
    return date;
  }

  function formatTechNoteDate(date) {
    var weekday = date.toLocaleDateString("en-US", { weekday: "long" });

    return weekday + ", " + [
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
      date.getFullYear()
    ].join("/");
  }

  function formatTechNoteTime(date, fallbackTime) {
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var part = hours >= 12 ? "PM" : "AM";
    var hour12 = hours % 12;

    if (hour12 === 0) {
      hour12 = 12;
    }

    if (Number.isNaN(date.getTime())) {
      return cleanText(fallbackTime);
    }

    return hour12 + ":" + pad2(minutes) + " " + part;
  }

  function techNoteText(prescription, text) {
    return [cleanText(prescription), cleanText(text)].filter(Boolean).join(" ");
  }

  function techNoteDateKey(date) {
    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }

    return [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate())
    ].join("-");
  }

  function normalizeTechNote(raw, index, source, dateText, timeText) {
    raw = raw || {};

    var date = parseDateLike(raw.Date || raw.date || raw.DateTime || raw.dateTime || raw.CreatedDate || raw.createdDate) ||
      dateWithTimeText(dateText, timeText);
    var text = techNoteText(raw.Prescription || raw.prescription, raw.Text || raw.text || raw.Note || raw.note || raw.NoteText || raw.noteText);

    if (!text) {
      return null;
    }

    if (!date) {
      date = dateWithTimeText(dateText, raw.Time || raw.time || timeText);
    }

    return {
      id: raw.TechNoteId || raw.Id || raw.id || null,
      source: source || "",
      text: text,
      date: date ? date.toISOString() : "",
      dateKey: date ? techNoteDateKey(date) : "",
      dateLabel: date ? formatTechNoteDate(date) : cleanText(dateText) || "Date unavailable",
      timeLabel: date ? formatTechNoteTime(date, raw.Time || raw.time || timeText) : cleanText(raw.Time || raw.time || timeText),
      sortTime: date ? date.getTime() : 0,
      pageOrder: index || 0
    };
  }

  function normalizeMappedTechNotes(dayNotes, source) {
    var notes = [];
    var dayDateText = dayNotes && dayNotes.Date ? dayNotes.Date : "";
    var dayItems = dayNotes && Array.isArray(dayNotes.Notes) ? dayNotes.Notes : [];

    dayItems.forEach(function (note, index) {
      var normalized = normalizeTechNote(note, index, source, dayDateText, note && note.Time);

      if (normalized) {
        notes.push(normalized);
      }
    });

    return notes;
  }

  function normalizeRawTechNotes(rawNotes, source) {
    if (!Array.isArray(rawNotes)) {
      return [];
    }

    return rawNotes.map(function (note, index) {
      return normalizeTechNote(note, index, source);
    }).filter(Boolean);
  }

  function uniqueSortedTechNotes(notes) {
    var seen = {};

    return notes
      .filter(function (note) {
        var key = note.id ? "id:" + note.id : [note.sortTime, note.text].join("|");

        if (seen[key]) {
          return false;
        }

        seen[key] = true;
        return true;
      })
      .sort(function (a, b) {
        return b.sortTime - a.sortTime || b.pageOrder - a.pageOrder;
      });
  }

  function sameHospitalizationId(first, second) {
    return String(first || "").toLowerCase() === String(second || "").toLowerCase();
  }

  function hospitalizationIdFromPath() {
    var pathMatch = location.pathname.match(/\/hosp\/([0-9a-f-]{20,})/i);

    return pathMatch ? pathMatch[1] : "";
  }

  function readTechNotesFromAngular(hospitalizationId) {
    var notes = [];
    var scopes = [];
    var patientScope = getPatientScope();
    var candidates = [
      "[data-ng-controller='technotesctrl']",
      "[ng-controller='technotesctrl']",
      "[data-ng-controller='technotesReadonlyctrl']",
      "[ng-controller='technotesReadonlyctrl']",
      "#technotes-dlg",
      ".tech-notes-modal",
      ".flowsheet-notes"
    ];

    if (patientScope) {
      scopes.push(patientScope);
    }

    Array.prototype.slice.call(document.querySelectorAll(candidates.join(","))).forEach(function (element) {
      var scope = getAngularScope(element);

      if (scope && scopes.indexOf(scope) === -1) {
        scopes.push(scope);
      }
    });

    scopes.forEach(function (scope) {
      var hospitalization = scope && scope.hospitalization;
      var technote = scope && scope.technote;

      if (hospitalizationId) {
        if (!hospitalization || !hospitalization.id || !sameHospitalizationId(hospitalization.id, hospitalizationId)) {
          return;
        }
      }

      if (hospitalization && Array.isArray(hospitalization.technotesRaw)) {
        notes = notes.concat(normalizeRawTechNotes(hospitalization.technotesRaw, "angular-cache"));
      }

      if (hospitalization && Array.isArray(hospitalization.technotes)) {
        hospitalization.technotes.forEach(function (dayNotes) {
          notes = notes.concat(normalizeMappedTechNotes(dayNotes, "angular-cache"));
        });
      }

      if (technote && Array.isArray(technote.items)) {
        technote.items.forEach(function (dayNotes) {
          notes = notes.concat(normalizeMappedTechNotes(dayNotes, "angular-scope"));
        });
      }
    });

    return uniqueSortedTechNotes(notes);
  }

  function readTechNotesFromDom(hospitalizationId) {
    var pathHospitalizationId = hospitalizationIdFromPath();
    var roots = Array.prototype.slice.call(document.querySelectorAll(".modal-body, .flowsheet-notes-content"))
      .filter(isVisible);
    var searchRoots = roots.length ? roots : [];
    var notes = [];

    if (hospitalizationId && pathHospitalizationId && !sameHospitalizationId(pathHospitalizationId, hospitalizationId)) {
      return notes;
    }

    searchRoots.forEach(function (root) {
      Array.prototype.slice.call(root.querySelectorAll('[data-ng-repeat="dayNotes in technote.items"]')).forEach(function (daySection) {
        var dateText = cleanText(daySection.querySelector(".tech-notes-date") && daySection.querySelector(".tech-notes-date").textContent);

        if (!dateText || !isVisible(daySection)) {
          return;
        }

        Array.prototype.slice.call(daySection.querySelectorAll(':scope > [data-ng-repeat="note in dayNotes.Notes"]')).forEach(function (noteRow, index) {
          var children = Array.prototype.slice.call(noteRow.children);
          var timeElement = children.filter(function (element) {
            return element.classList.contains("tech-notes-time") && isVisible(element);
          })[0];
          var noteElement = children.filter(function (element) {
            return isVisible(element) &&
              (element.classList.contains("tech-notes-note") ||
                element.classList.contains("tech-notes-note-readonly") ||
                element.classList.contains("tnt-form"));
          })[0];
          var timeText = cleanText(timeElement && timeElement.textContent);
          var noteText = cleanText(noteElement && (noteElement.innerText || noteElement.textContent));
          var normalized = normalizeTechNote({
            Text: noteText,
            Time: timeText
          }, index, "dom", dateText, timeText);

          if (normalized) {
            notes.push(normalized);
          }
        });
      });
    });

    return uniqueSortedTechNotes(notes);
  }

  function activeHospitalizationId() {
    var patient = getPatientPanel();
    var scope = getPatientScope();
    var pathHospitalizationId = hospitalizationIdFromPath();

    return pathHospitalizationId ||
      (patient && patient.hospitalizationId) ||
      (scope && scope.hospitalization && scope.hospitalization.id) ||
      "";
  }

  function canFetchTechNotes() {
    return typeof window.fetch === "function" && location.protocol !== "file:";
  }

  function fetchTechNotesRaw(hospitalizationId) {
    var services = window.constants && window.constants.services ? window.constants.services : {};
    var base = services.TECHNOTES || "/api/v3/TechNotes/GetNotes/";
    var separator = base.indexOf("?") === -1 ? "?" : "&";
    var url = base + separator + "hospitalizationId=" + encodeURIComponent(hospitalizationId);

    return window.fetch(url, {
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load notes: HTTP " + response.status);
      }

      return response.json();
    });
  }

  function getTechNotes(options) {
    options = options || {};

    var hospitalizationId = options.hospitalizationId || activeHospitalizationId();
    var cachedNotes = uniqueSortedTechNotes(readTechNotesFromAngular(hospitalizationId).concat(readTechNotesFromDom(hospitalizationId)));

    if (options.cachedOnly || !hospitalizationId || !canFetchTechNotes()) {
      return cachedNotes;
    }

    return fetchTechNotesRaw(hospitalizationId).then(function (rawNotes) {
      return uniqueSortedTechNotes(normalizeRawTechNotes(rawNotes, "fetch"));
    }).catch(function (error) {
      if (cachedNotes.length) {
        return cachedNotes;
      }

      throw error;
    });
  }

  function formatTechNotes(notes) {
    if (!notes) {
      var notesResult = getTechNotes();

      if (notesResult && typeof notesResult.then === "function") {
        return notesResult.then(formatTechNotes);
      }

      return formatTechNotes(notesResult);
    }

    if (!notes.length) {
      return "";
    }

    var output = [];
    var currentDate = "";

    notes.forEach(function (note) {
      if (note.dateLabel !== currentDate) {
        if (output.length) {
          output.push("");
        }

        output.push(note.dateLabel || "Date unavailable");
        currentDate = note.dateLabel;
      }

      output.push("- " + (note.timeLabel || "Time unavailable") + " - " + note.text);
    });

    return output.join("\n");
  }

  function getTechNotesSummary(options) {
    var notesResult = getTechNotes(options);

    function summarize(notes) {
      return {
        notes: notes,
        formattedText: formatTechNotes(notes),
        count: notes.length
      };
    }

    if (notesResult && typeof notesResult.then === "function") {
      return notesResult.then(summarize);
    }

    return summarize(notesResult);
  }

  function parseBloodGlucoseValue(rawValue, context) {
    return getValueParsers().parseBloodGlucose(rawValue, context);
  }

  function getBloodGlucoseResults() {
    return findEntries("BG", { valuesOnly: true }).map(function (entry) {
      var context = [
        entry.treatment,
        entry.treatmentName,
        entry.prescription,
        entry.section
      ].join(" ");
      var parsed = parseBloodGlucoseValue(entry.value, context);
      var dateText = formatDate(entry.recordedAt);
      var timeText = formatTime(entry.recordedAt, entry.hourLabel);
      var line = timeText + ": " + parsed.valueText;

      if (parsed.source) {
        line += ", " + parsed.source;
      }

      return {
        date: dateText,
        time: timeText,
        value: parsed.value,
        valueText: parsed.valueText,
        source: parsed.source,
        high: parsed.high,
        raw: parsed.raw,
        recognized: parsed.recognized,
        row: entry.treatment,
        recordedAt: entry.recordedAt,
        hourLabel: entry.hourLabel,
        columnIndex: entry.columnIndex,
        line: line
      };
    }).sort(function (a, b) {
      var aDate = new Date(a.recordedAt);
      var bDate = new Date(b.recordedAt);

      if (!Number.isNaN(aDate.getTime()) && !Number.isNaN(bDate.getTime())) {
        return aDate - bDate;
      }

      return a.columnIndex - b.columnIndex;
    });
  }

  function formatBloodGlucoseResults(results) {
    results = results || getBloodGlucoseResults();

    if (!results.length) {
      return "";
    }

    var output = [];
    var currentDate = "";

    results.forEach(function (result) {
      var date = result.date || "Date unavailable";

      if (date !== currentDate) {
        if (output.length) {
          output.push("");
        }

        output.push(date);
        currentDate = date;
      }

      output.push(result.line);
    });

    return output.join("\n");
  }

  function parseBloodPressureValue(rawValue) {
    return getValueParsers().parseBloodPressure(rawValue);
  }

  function getBloodPressureResults() {
    return findEntries("BP", { valuesOnly: true }).map(function (entry) {
      var parsed = parseBloodPressureValue(entry.value);
      var dateText = formatDate(entry.recordedAt);
      var timeText = formatTime(entry.recordedAt, entry.hourLabel);
      var details = [parsed.cuff, parsed.location, parsed.method].filter(Boolean);
      var line = timeText + ": " + parsed.valueText;

      if (details.length) {
        line += ", " + details.join(", ");
      }

      return {
        date: dateText,
        time: timeText,
        systolic: parsed.systolic,
        diastolic: parsed.diastolic,
        map: parsed.map,
        cuff: parsed.cuff,
        location: parsed.location,
        method: parsed.method,
        valueText: parsed.valueText,
        raw: parsed.raw,
        recognized: parsed.recognized,
        row: entry.treatment,
        recordedAt: entry.recordedAt,
        hourLabel: entry.hourLabel,
        columnIndex: entry.columnIndex,
        line: line
      };
    }).sort(function (a, b) {
      var aDate = new Date(a.recordedAt);
      var bDate = new Date(b.recordedAt);

      if (!Number.isNaN(aDate.getTime()) && !Number.isNaN(bDate.getTime())) {
        return aDate - bDate;
      }

      return a.columnIndex - b.columnIndex;
    });
  }

  function formatBloodPressureResults(results) {
    results = results || getBloodPressureResults();

    if (!results.length) {
      return "";
    }

    var output = [];
    var currentDate = "";

    results.forEach(function (result) {
      var date = result.date || "Date unavailable";

      if (date !== currentDate) {
        if (output.length) {
          output.push("");
        }

        output.push(date);
        currentDate = date;
      }

      output.push(result.line);
    });

    return output.join("\n");
  }

  function getCurrentHourCells() {
    var flowsheet = readFlowsheetTable();
    if (!flowsheet || !flowsheet.currentHour || flowsheet.currentHour.columnIndex === null) {
      return [];
    }

    return flowsheet.rows.map(function (row) {
      return row.cells[flowsheet.currentHour.columnIndex];
    }).filter(function (cell) {
      return cell && (cell.value || cell.state.highlighted);
    });
  }

  function getHighlightedCells() {
    var flowsheet = readFlowsheetTable();
    if (!flowsheet) {
      return [];
    }

    return flowsheet.entries.filter(function (entry) {
      return entry.state.highlighted;
    });
  }

  function inspect() {
    return {
      version: VERSION,
      url: location.href,
      capturedAt: new Date().toISOString(),
      page: {
        hasPatientPanel: !!document.querySelector("#patient-table .patient-card-container"),
        hasFlowsheetTable: !!document.querySelector("#flowsheetTable"),
        hasWhiteboard: !!document.querySelector("#whiteboard-table")
      },
      patient: getPatientPanel(),
      currentHour: getCurrentHour(),
      flowsheet: readFlowsheetTable(),
      whiteboard: readWhiteboardSummary()
    };
  }

  var api = {
    version: VERSION,
    inspect: inspect,
    getPatientPanel: getPatientPanel,
    getCurrentHour: getCurrentHour,
    getFlowsheetTable: readFlowsheetTable,
    getWhiteboardSummary: readWhiteboardSummary,
    findRows: findRows,
    findEntries: findEntries,
    latestValue: latestValue,
    getBloodGlucoseResults: getBloodGlucoseResults,
    formatBloodGlucoseResults: formatBloodGlucoseResults,
    getBloodPressureResults: getBloodPressureResults,
    formatBloodPressureResults: formatBloodPressureResults,
    getFluidRateSummary: getFluidRateSummary,
    getTechNotes: getTechNotes,
    formatTechNotes: formatTechNotes,
    getTechNotesSummary: getTechNotesSummary,
    getCurrentHourCells: getCurrentHourCells,
    getHighlightedCells: getHighlightedCells
  };

  window[API_NAME] = api;

  document.dispatchEvent(new CustomEvent("smartflow-helper:ready", {
    detail: {
      name: API_NAME,
      version: VERSION
    }
  }));

  document.addEventListener("smartflow-helper:request", function (event) {
    var detail = event.detail || {};
    var id = detail.id || "";
    var method = detail.method || "inspect";
    var args = Array.isArray(detail.args) ? detail.args : [];
    var response = {
      id: id,
      method: method,
      ok: false,
      result: null,
      error: ""
    };

    function send(result) {
      response.result = safeClone(result, 12);
      response.ok = true;

      document.dispatchEvent(new CustomEvent("smartflow-helper:response", {
        detail: response
      }));
    }

    function sendError(error) {
      response.error = error && error.message ? error.message : String(error);

      document.dispatchEvent(new CustomEvent("smartflow-helper:response", {
        detail: response
      }));
    }

    try {
      if (!api[method]) {
        throw new Error("Unknown Smart Flow helper method: " + method);
      }

      var result = api[method].apply(api, args);

      if (result && typeof result.then === "function") {
        result.then(send).catch(sendError);
        return;
      }

      send(result);
    } catch (error) {
      sendError(error);
    }
  });
})();
