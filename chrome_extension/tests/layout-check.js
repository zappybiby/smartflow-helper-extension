const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "ui-layout.js"), "utf8");
const context = {
  console
};

context.globalThis = context;
vm.runInNewContext(source, context, {
  filename: "ui-layout.js"
});

const layout = context.SmartFlowHelperLayout;

function rect(left, top, right, bottom) {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoOverlap(name, result, tableRects, bugPanelRects) {
  const tableOverlap = tableRects.some((tableRect) => layout.overlaps(result.rect, tableRect, 0));
  const bugPanelOverlap = bugPanelRects.some((bugPanelRect) => layout.overlaps(result.rect, bugPanelRect, 0));

  assert(!tableOverlap, `${name}: helper overlaps the whiteboard table`);
  assert(!bugPanelOverlap, `${name}: helper overlaps the minimized bug panel`);
}

function choose(options) {
  return layout.choosePlacement({
    viewport: options.viewport,
    margin: options.margin || 20,
    open: options.open,
    helperSize: options.helperSize,
    tableRects: options.tableRects || [],
    bugPanelRects: options.bugPanelRects || []
  });
}

const desktopTables = [rect(510, 404, 1530, 900)];
const desktopBugPanel = [rect(0, 273, 50, 379)];
const desktopOpen = choose({
  viewport: { width: 1920, height: 900 },
  open: true,
  helperSize: { width: 680, height: 476 },
  tableRects: desktopTables,
  bugPanelRects: desktopBugPanel
});

assert(desktopOpen.left === 20, "desktop open: helper should stay bottom-left when it fits there");
assert(desktopOpen.panelWidth === 468, "desktop open: helper should use the wider stable panel width");
assert(desktopOpen.panelHeight === desktopOpen.panelMaxHeight, "desktop open: helper height should stay fixed at the available height");
assert(desktopOpen.panelMaxHeight <= 489, "desktop open: helper should fit below the minimized bug panel");
assertNoOverlap("desktop open", desktopOpen, desktopTables, desktopBugPanel);

const patientOpen = choose({
  viewport: { width: 1920, height: 900 },
  open: true,
  helperSize: { width: 680, height: 476 },
  tableRects: [rect(505, 402, 1400, 613)],
  bugPanelRects: desktopBugPanel
});

assert(patientOpen.left === 20, "patient open: helper should stay bottom-left");
assert(patientOpen.panelWidth === desktopOpen.panelWidth, "patient open: helper width should not change between whiteboards");
assert(patientOpen.panelHeight === desktopOpen.panelHeight, "patient open: helper height should not change between whiteboards");
assertNoOverlap("patient open", patientOpen, [rect(505, 402, 1400, 613)], desktopBugPanel);

const shortTables = [rect(520, 220, 1180, 620)];
const shortBugPanel = [rect(0, 250, 50, 356)];
const shortOpen = choose({
  viewport: { width: 1200, height: 620 },
  open: true,
  helperSize: { width: 680, height: 540 },
  tableRects: shortTables,
  bugPanelRects: shortBugPanel
});

assert(shortOpen.left >= 62, "short open: helper should move right of the minimized bug panel");
assert(shortOpen.panelWidth === 446, "short open: helper should use all available room before the whiteboard table");
assertNoOverlap("short open", shortOpen, shortTables, shortBugPanel);

const minimized = choose({
  viewport: { width: 1200, height: 620 },
  open: false,
  helperSize: { width: 42, height: 42 },
  tableRects: shortTables,
  bugPanelRects: shortBugPanel
});

assert(minimized.left === 20, "minimized: launcher should stay at the bottom-left margin");
assertNoOverlap("minimized", minimized, shortTables, shortBugPanel);

console.log("layout-check: passed");
