const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/recurring-color.js"), "utf8");
const hour = 3600000;
const start = new Date(2026, 10, 21, 7).getTime();

async function batch(interval, future, duplicate = false) {
  const ids = ["previous", "nov21", "nov22"];
  const days = ids.map((sheet, i) => ({
    sheet, days: ids, patient: "patient", date: start + (i - 1) * 24 * hour, hours: 24,
    rows: [{ id: "fluid-" + sheet, name: "Fluids", orderKey: "order" }]
  }));
  if (duplicate) days[2].rows.push({ ...days[2].rows[0], id: "other-fluid" });
  let current = 1;
  const writes = [];
  const document = {
    querySelector: () => ({ getAttribute: () => "false", click() {} }),
    querySelectorAll: () => days.map((_, i) => ({ click() { current = i; } }))
  };
  const window = { SmartFlowScheduleEditor: {
    waitFor: async read => { const value = await read(); assert.ok(value); return value; },
    colorCell: async (row, index, swatch, guard, read) => {
      assert.equal((await read()).id, row.id);
      writes.push([current, index, swatch.name]);
      return true;
    }
  } };
  vm.runInNewContext(source, { window, document, Date });
  const { palette, apply } = window.SmartFlowRecurringColor;
  const result = await apply({ origin: days[1], selected: days[1].rows, hour: 22, interval,
    swatch: palette.find(swatch => swatch.name === "Pink"), future,
    getSheet: async () => days[current], guard() {}, progress() {} });
  assert.equal(current, 1);
  return { writes: writes.map(([day, index]) => day + ":" + index), result };
}

(async () => {
  assert.deepEqual((await batch(4, false)).writes, ["1:15", "1:19", "1:23"]);
  assert.deepEqual((await batch(4, true)).writes,
    ["1:15", "1:19", "1:23", "2:3", "2:7", "2:11", "2:15", "2:19", "2:23"]);
  assert.deepEqual((await batch(5, true)).writes, ["1:15", "1:20", "2:1", "2:6", "2:11", "2:16", "2:21"]);
  const skipped = await batch(5, true, true);
  assert.deepEqual(skipped.writes, ["1:15", "1:20"]);
  assert.match(skipped.result, /Skipped 1/);
  console.log("recurring-color-check: passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
