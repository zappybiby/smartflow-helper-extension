const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const patientA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const patientB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const now = "2026-10-21T14:00:00.000Z";
const boardUrl = "https://api.smartflowsheet.com/api/v1/whiteboards/data";
const sourceDirectory = path.join(__dirname, "..", "src");
const sources = ["value-parsers.js", "controlled-medications.js", "smartflow-reader.js"]
  .map(name => ({ name, code: fs.readFileSync(path.join(sourceDirectory, name), "utf8") }));

function element(options = {}) {
  const classes = options.classes || [];
  classes.contains = name => classes.includes(name);
  return {
    textContent: options.text || "",
    children: options.children || [],
    classList: classes,
    offsetWidth: options.hidden ? 0 : 10,
    offsetHeight: options.hidden ? 0 : 10,
    getClientRects() { return options.hidden ? [] : [{}]; },
    getAttribute(name) { return (options.attributes || {})[name] || null; },
    querySelector(selector) { return (options.single || {})[selector] || null; },
    querySelectorAll(selector) { return (options.multiple || {})[selector] || []; }
  };
}

function createReader(options = {}) {
  const calls = [];
  const single = Object.assign({}, options.single);
  const multiple = Object.assign({}, options.multiple);
  const location = new URL(options.url || "https://app.smartflowsheet.com/whiteboard");
  const document = {
    querySelector(selector) {
      return single[selector] || selector.split(",").map(part => single[part.trim()]).find(Boolean) || null;
    },
    querySelectorAll(selector) { return multiple[selector] || []; },
    addEventListener() {},
    dispatchEvent() {},
    createElement(tagName) {
      assert.equal(tagName, "template");
      const content = { textContent: "" };
      return {
        content,
        set innerHTML(value) {
          content.textContent = value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
        }
      };
    }
  };
  const window = {
    document,
    location,
    constants: options.constants,
    SmartFlowSiteData: {
      getPatientContext() { return options.patientContext || null; },
      getRowParameter(row) { return row.parameter || null; }
    },
    async fetch(url, init = {}) {
      calls.push({ url, init });
      assert.ok(options.fetch, "unexpected fetch: " + url);
      const result = await options.fetch(url, init);
      return {
        ok: result.status === undefined || result.status < 400,
        status: result.status || 200,
        async json() {
          if (result.jsonError) throw new SyntaxError("Unexpected HTML in JSON response");
          return result.body;
        }
      };
    }
  };
  if (options.angularScopes) {
    window.angular = { element(node) { return { scope() { return options.angularScopes.get(node); } }; } };
  }
  const context = {
    window, document, location, URL, console,
    getComputedStyle() { return { visibility: "visible" }; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  };
  sources.forEach(source => vm.runInNewContext(source.code, context, { filename: source.name }));
  return { api: window.SmartFlowExt, calls };
}

function boardSurface(visibleIds = [patientA], hiddenIds = [patientB]) {
  const rows = visibleIds.map(id => element({ attributes: { "data-id": id } }))
    .concat(hiddenIds.map(id => element({ hidden: true, attributes: { "data-id": id } })));
  return {
    single: { "#whiteboard-table": element() },
    multiple: { "#whiteboard-table tr[data-testid='whiteboard-patient-row'][data-id]": rows }
  };
}

function hospitalization(id = patientA) {
  return {
    id,
    name: id === patientA ? "Patient A" : "Patient B",
    weight: "22.046226218 lbs",
    patientCustomField: "CASE-123",
    patient: { speciesName: "Canine", owner: { nameLast: "Example", nameFirst: "Owner" } }
  };
}

function boardData() {
  return {
    Data: {
      hospitalizations: [hospitalization(), hospitalization(patientB)],
      flowsheetData: [
        { hospitalizationID: patientA, flowsheetIds: ["a-old", "a-current", "a-next"], currentFlowsheetID: "a-current" },
        { hospitalizationID: patientB, flowsheetIds: ["b-current"], currentFlowsheetID: "b-current" }
      ]
    }
  };
}

function flowsheet(id = "a-current", dueAt = "2026-10-21T15:00:00.000Z") {
  return {
    flowsheetID: id,
    hospitalizationID: patientA,
    date: "2026-10-21T00:00:00.000Z",
    medications: [{
      name: "Buprenorphine",
      parameterBaseID: "medication-1",
      parameterSection: 4,
      totalDose: 0.3,
      concentrationMeasureTypeAsString: "mg",
      routeTypeAsString: "IV",
      values: [{ st: 1, date: dueAt }]
    }]
  };
}

function modernFetcher(payload = boardData(), sheetResult) {
  return (url, init) => {
    assert.equal(init.credentials, "include", "modern API requests need cross-origin credentials");
    if (url === boardUrl) return { body: payload };
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://www.smartflowsheet.com");
    assert.equal(parsed.pathname, "/api/v3/flowsheet");
    const id = parsed.searchParams.get("id");
    assert.ok(["a-current", "a-next"].includes(id), "unselected patient's/past flowsheet was fetched: " + id);
    return sheetResult ? sheetResult(id) : {
      body: { flowsheet: flowsheet(id, id === "a-next" ? "2026-10-21T16:00:00.000Z" : undefined) }
    };
  };
}

const tests = [];
function test(name, check) { tests.push({ name, check }); }

test("modern controlled schedule joins API metadata and filters visible board patients before fetching", async () => {
  const reader = createReader({ ...boardSurface(), fetch: modernFetcher() });
  const schedule = await reader.api.getControlledMedicationSchedule({ now, horizonHours: 4 });
  assert.equal(schedule.patientCount, 1);
  assert.equal(schedule.patients[0].hospitalizationId, patientA);
  assert.equal(schedule.patients[0].ownerLastName, "Example");
  assert.equal(schedule.events.length, 2, "both selected flowsheets should contribute scheduled doses");
  assert.deepEqual(Array.from(schedule.events, event => event.dueAt), ["2026-10-21T15:00:00.000Z", "2026-10-21T16:00:00.000Z"]);
  assert.match(schedule.formattedText, /Patient A/);
  assert.match(schedule.formattedText, /Buprenorphine/);
  assert.equal(reader.calls.length, 3, "only the board request and two selected sheets should be loaded");
});

test("modern patient view selects its current patient even when other patients are in the API response", async () => {
  const reader = createReader({
    url: "https://app.smartflowsheet.com/whiteboard/hosp/" + patientA,
    single: { "#patient-table .patient-card-container": element() },
    fetch: modernFetcher()
  });
  const schedule = await reader.api.getControlledMedicationSchedule({ now, horizonHours: 4 });
  assert.equal(schedule.patientCount, 1);
  assert.equal(schedule.patients[0].hospitalizationId, patientA);
  assert.equal(schedule.events.length, 2);
});

test("a board without visible patient rows does not scan all patients", async () => {
  const reader = createReader(boardSurface([], [patientA, patientB]));
  const schedule = await reader.api.getControlledMedicationSchedule({ now });
  assert.equal(schedule.source, "not-ready");
  assert.equal(reader.calls.length, 0);
});

test("a loading patient route cannot use the remaining tab strip to scan every patient", async () => {
  const reader = createReader({
    url: "https://app.smartflowsheet.com/whiteboard/hosp/" + patientA,
    single: { ".tabs-container": element() },
    multiple: {
      ".tabs-container [data-hosp]": [
        element({ attributes: { "data-hosp": patientA } }),
        element({ attributes: { "data-hosp": patientB } })
      ]
    }
  });
  const schedule = await reader.api.getControlledMedicationSchedule({ now });
  assert.equal(schedule.source, "not-ready");
  assert.equal(schedule.patientCount, 0);
  assert.equal(reader.calls.length, 0, "wait for the current patient surface before making API calls");
});

test("an incomplete API selection cannot turn a visible patient's missing data into zero due", async () => {
  const payload = boardData();
  payload.Data.hospitalizations = [hospitalization()];
  const reader = createReader({
    ...boardSurface([patientA, patientB], []),
    fetch: modernFetcher(payload)
  });
  await assert.rejects(async () => reader.api.getControlledMedicationSchedule({ now }), /whiteboard changed/i);
  assert.equal(reader.calls.length, 1, "incomplete selection should fail before loading any flowsheets");
});

test("a current flowsheet absent from its patient's list cannot fall back to an old sheet", async () => {
  const payload = boardData();
  payload.Data.flowsheetData[0].flowsheetIds = ["a-old", "a-next"];
  const reader = createReader({ ...boardSurface(), fetch: modernFetcher(payload) });
  await assert.rejects(async () => reader.api.getControlledMedicationSchedule({ now }), /flowsheet list/i);
  assert.equal(reader.calls.length, 1, "inconsistent metadata should fail before loading an old flowsheet");
});

for (const [label, result] of [
  ["HTTP failure", { status: 401 }],
  ["HTML response", { jsonError: true }],
  ["unrecognized JSON", { body: { Data: { error: "Unauthorized" } } }]
]) {
  test("modern board " + label + " is an error instead of an empty medication schedule", async () => {
    const reader = createReader({ ...boardSurface(), fetch: () => result });
    await assert.rejects(async () => reader.api.getControlledMedicationSchedule({ now }));
    assert.equal(reader.calls.length, 1);
  });
}

for (const [label, result] of [
  ["HTTP failure", { status: 503 }],
  ["HTML response", { jsonError: true }],
  ["unrecognized JSON", { body: { loginRequired: true } }]
]) {
  test("one selected flowsheet's " + label + " rejects the entire medication schedule", async () => {
    const reader = createReader({
      ...boardSurface(),
      fetch: modernFetcher(boardData(), id => id === "a-next" ? result : { body: { flowsheet: flowsheet(id) } })
    });
    await assert.rejects(async () => reader.api.getControlledMedicationSchedule({ now }));
  });
}

test("legacy Angular board preserves its configured endpoint and same-origin credentials", async () => {
  const surface = boardSurface();
  const board = surface.single["#whiteboard-table"];
  const patient = { ...hospitalization(), curFlowsheetId: "legacy-sheet", flowsheetIds: ["legacy-sheet"] };
  const reader = createReader({
    ...surface,
    url: "https://www.smartflowsheet.com/whiteboard",
    angularScopes: new Map([[board, { hospitalizations: [patient, hospitalization(patientB)] }]]),
    constants: { services: { FLOWSHEET: "/legacy/flowsheet?id=" } },
    fetch(url, init) {
      assert.equal(url, "/legacy/flowsheet?id=legacy-sheet");
      assert.equal(init.credentials, "same-origin");
      return { body: { flowsheet: flowsheet("legacy-sheet") } };
    }
  });
  const schedule = await reader.api.getControlledMedicationSchedule({ now, horizonHours: 4 });
  assert.equal(schedule.patientCount, 1);
  assert.equal(schedule.events.length, 1);
  assert.equal(reader.calls.length, 1, "the Angular site should not request the React whiteboard API");
});

const rawNotes = [
  { TechNoteId: "old", Date: "2026-10-20T08:00:00", Text: "Previous day" },
  { TechNoteId: "early", Date: "2026-10-21T09:15:00", Text: "Earlier note" },
  { TechNoteId: "late", Date: "2026-10-21T10:30:00", Prescription: "Observation:", Text: "Latest note" },
  { TechNoteId: "late", Date: "2026-10-21T10:30:00", Text: "Duplicate should not appear" }
];

test("modern tech notes use the credentialed API and produce sorted, deduplicated formatted notes", async () => {
  const reader = createReader({
    url: "https://app.smartflowsheet.com/whiteboard/hosp/" + patientA,
    fetch(url, init) {
      assert.equal(url, "https://www.smartflowsheet.com/api/v3/technotes/getnotes?hospitalizationID=" + patientA);
      assert.equal(init.credentials, "include");
      return { body: rawNotes };
    }
  });
  const summary = await reader.api.getTechNotesSummary();
  assert.equal(summary.count, 3);
  assert.deepEqual(Array.from(summary.notes, note => note.id), ["late", "early", "old"]);
  assert.equal(summary.formattedText, [
    "Wednesday, 10/21/2026",
    "- 10:30 AM - Observation: Latest note",
    "- 9:15 AM - Earlier note",
    "",
    "Tuesday, 10/20/2026",
    "- 8:00 AM - Previous day"
  ].join("\n"));
});

test("legacy tech notes preserve service constants and an existing query string", async () => {
  const reader = createReader({
    url: "https://www.smartflowsheet.com/whiteboard/hosp/" + patientA,
    constants: { services: { TECHNOTES: "/legacy/notes?readonly=true" } },
    fetch(url, init) {
      assert.equal(url, "/legacy/notes?readonly=true&hospitalizationId=" + patientA);
      assert.equal(init.credentials, "same-origin");
      return { body: rawNotes };
    }
  });
  assert.equal((await reader.api.getTechNotes()).length, 3);
});

for (const [label, result] of [
  ["HTTP failure", { status: 401 }],
  ["HTML response", { jsonError: true }],
  ["unrecognized JSON", { body: { error: "Session expired" } }]
]) {
  test("tech notes " + label + " is an error instead of zero notes", async () => {
    const reader = createReader({ fetch: () => result });
    await assert.rejects(async () => reader.api.getTechNotesSummary({ hospitalizationId: patientA }));
  });
}

test("a valid empty notes response remains an empty result", async () => {
  const reader = createReader({ fetch: () => ({ body: [] }) });
  const summary = await reader.api.getTechNotesSummary({ hospitalizationId: patientA });
  assert.equal(summary.count, 0);
  assert.equal(summary.formattedText, "");
});

test("React patient context supplies patient identity and weight for fluids", () => {
  const reader = createReader({ patientContext: { source: "react", hospitalization: hospitalization(), flowsheet: flowsheet() } });
  const patient = reader.api.getPatientPanel();
  assert.equal(patient.source, "react");
  assert.equal(patient.hospitalizationId, patientA);
  assert.equal(patient.flowsheetId, "a-current");
  assert.equal(patient.owner.displayName, "Example Owner");
  const summary = reader.api.getFluidRateSummary({ mlKgDay: 90 });
  assert.ok(Math.abs(summary.patient.weightKg - 10) < 0.0001);
  assert.ok(Math.abs(summary.maintenance.mlPerHour - 25) < 0.0001);
  assert.ok(Math.abs(summary.target.mlPerDay - 900) < 0.0001);
});

test("patient navigation with rejected React context cannot reuse the previous patient's mounted DOM", () => {
  const oldPanel = element({
    single: { ".patient-card-patient-name": element({ text: "Previous Patient" }) },
    multiple: { ".patient-tag": [element({ text: "10 kg" })] }
  });
  const oldRow = element({ classes: ["pr-item"], children: [element({ text: "145" })] });
  oldRow.parameter = { name: "Blood Glucose", parameterSection: 1 };
  const oldTable = element({ multiple: { tbody: [element({ multiple: { ":scope > tr": [oldRow] } })] } });
  const reader = createReader({
    url: "https://app.smartflowsheet.com/whiteboard/hosp/" + patientB,
    patientContext: null,
    single: {
      "#patient-table .patient-card-container": oldPanel,
      "#flowsheetTable": oldTable
    }
  });
  assert.equal(reader.api.getPatientPanel(), null, "the old card must not supply the new patient's identity or weight");
  assert.equal(reader.api.getFlowsheetTable(), null, "the old table must not supply the new patient's values");
  assert.equal(reader.api.getFluidRateSummary().patient, null);
  assert.equal(reader.api.getBloodGlucoseResults().length, 0);
});

test("React row parameters preserve treatment metadata and flowsheet timestamps", () => {
  const cell = element({ text: "145", classes: ["checked"] });
  const row = element({ classes: ["pr-item"], children: [cell] });
  row.parameter = { NameHtml: "<b>Blood Glucose</b>", parameterSection: 1, parameterBaseID: "glucose" };
  const table = element({ multiple: { tbody: [element({ multiple: { ":scope > tr": [row] } })] } });
  const sheet = flowsheet();
  const reader = createReader({
    single: { "#flowsheetTable": table },
    patientContext: { source: "react", hospitalization: hospitalization(), flowsheet: sheet }
  });
  const result = reader.api.getFlowsheetTable();
  assert.equal(result.flowsheetId, sheet.flowsheetID);
  assert.equal(result.rows[0].treatmentName, "Blood Glucose");
  assert.equal(result.rows[0].section, "monitoring");
  assert.equal(result.entries[0].recordedAt, sheet.date);
  assert.equal(result.entries[0].numericValue, 145);
  const glucose = reader.api.getBloodGlucoseResults();
  assert.equal(glucose.length, 1);
  assert.equal(glucose[0].value, 145);
  assert.equal(glucose[0].recognized, true);
  assert.equal(glucose[0].valueText, "145 mg/dL");
  assert.equal(reader.api.formatBloodGlucoseResults(), glucose[0].date + "\n" + glucose[0].time + ": 145 mg/dL");
});

test("React blood pressure rows preserve measurements and group formatted readings across midnight", () => {
  const row = element({ classes: ["pr-item"], children: [
    element({ text: "120/80 MAP 93 cuff #3 left front limb oscillometric", classes: ["checked"] }),
    element({ text: "115/75 (88) cuff #2 right hind limb doppler", classes: ["checked"] })
  ] });
  row.parameter = { NameHtml: "<b>Blood Pressure</b>", parameterSection: 1, parameterBaseID: "pressure" };
  const table = element({ multiple: { tbody: [element({ multiple: { ":scope > tr": [row] } })] } });
  const sheet = { ...flowsheet(), date: "2026-10-21T23:00:00" };
  const reader = createReader({
    single: { "#flowsheetTable": table },
    patientContext: { source: "react", hospitalization: hospitalization(), flowsheet: sheet }
  });
  const pressure = reader.api.getBloodPressureResults();
  assert.equal(pressure.length, 2);
  assert.deepEqual(Array.from(pressure, result => [
    result.systolic, result.diastolic, result.map, result.cuff, result.location, result.method, result.recognized
  ]), [
    [120, 80, 93, "#3", "Left Front Limb", "Oscillometric", true],
    [115, 75, 88, "#2", "Right Hind Limb", "Doppler", true]
  ]);
  assert.equal(reader.api.formatBloodPressureResults(), [
    "10/21/2026",
    "11 PM: 120/80 (MAP 93), #3, Left Front Limb, Oscillometric",
    "",
    "10/22/2026",
    "12 AM: 115/75 (MAP 88), #2, Right Hind Limb, Doppler"
  ].join("\n"));
});

(async () => {
  let failed = 0;
  for (const { name, check } of tests) {
    try {
      await check();
    } catch (error) {
      failed += 1;
      console.error("FAIL: " + name + "\n" + error.stack);
    }
  }
  if (failed) {
    process.exitCode = 1;
    console.error("reader-compatibility-check: " + failed + " of " + tests.length + " checks failed");
  } else {
    console.log("reader-compatibility-check: " + tests.length + " checks passed");
  }
})();
