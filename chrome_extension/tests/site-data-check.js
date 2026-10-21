const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "site-data.js"), "utf8");
const elements = {};
const window = {
  location: { pathname: "/whiteboard" },
  document: {
    querySelector(selector) { return elements[selector] || null; }
  }
};
vm.runInNewContext(source, { window });
const site = window.SmartFlowSiteData;

function element() {
  return {};
}

function mount(props, host = element()) {
  const root = { memoizedProps: null, return: null };
  root.stateNode = { current: root };
  const component = { memoizedProps: props, return: root };
  const leaf = { memoizedProps: {}, return: component };
  root.child = component;
  component.child = leaf;
  host.__reactFiber$test = leaf;
  return { component, host, leaf, root };
}

function alternateTree(tree, props) {
  const newer = mount(props, element());
  for (const key of ["root", "component", "leaf"]) {
    tree[key].alternate = newer[key];
    newer[key].alternate = tree[key];
  }
  newer.root.stateNode = tree.root.stateNode;
  tree.root.stateNode.current = newer.root;
  return newer;
}

const oldParameter = { name: "Previous" };
const newParameter = { name: "Current" };
const row = mount({ param: oldParameter });
assert.equal(site.getRowParameter(row.host), oldParameter, "initial committed row props should be available");
const currentRow = alternateTree(row, { param: newParameter });
assert.equal(site.getRowParameter(row.host), newParameter, "a stale DOM fiber should read its committed alternate");
assert.equal(site.readComponentProps(row.host, props => props.param), currentRow.component.memoizedProps);
assert.equal(site.getRowParameter(currentRow.host), newParameter, "already-current DOM fiber should remain current");
currentRow.component.pendingProps = { param: oldParameter };
assert.equal(site.getRowParameter(row.host), newParameter, "uncommitted pending props must never replace committed props");

// Bailouts can leave both alternates' return chains pointing to the same root.
const sharedParent = mount({ param: oldParameter });
const committedComponent = { memoizedProps: { param: newParameter }, return: sharedParent.root };
const committedLeaf = { memoizedProps: {}, return: committedComponent };
committedComponent.child = committedLeaf;
sharedParent.component.alternate = committedComponent;
committedComponent.alternate = sharedParent.component;
sharedParent.leaf.alternate = committedLeaf;
committedLeaf.alternate = sharedParent.leaf;
sharedParent.root.child = committedComponent;
assert.equal(site.getRowParameter(sharedParent.host), newParameter, "current child links should resolve shared-root alternates");

const detached = mount({ param: oldParameter });
detached.root.child = null;
assert.equal(site.getRowParameter(detached.host), null, "detached components should fall back instead of using stale props");
const cyclic = element();
cyclic.__reactFiber$test = { memoizedProps: { param: oldParameter } };
cyclic.__reactFiber$test.return = cyclic.__reactFiber$test;
assert.equal(site.getRowParameter(cyclic), null, "cyclic ancestry should terminate safely");
assert.equal(site.getRowParameter(element()), null, "non-React DOM should allow the existing reader fallback");
assert.equal(site.readComponentProps(row.host), null);

const deeplyNested = mount({ param: newParameter });
let nestedParent = deeplyNested.component;
for (let i = 0; i < 90; i++) {
  const wrapper = { memoizedProps: {}, return: nestedParent };
  nestedParent.child = wrapper;
  nestedParent = wrapper;
}
nestedParent.child = deeplyNested.leaf;
deeplyNested.leaf.return = nestedParent;
assert.equal(site.getRowParameter(deeplyNested.host), newParameter, "the site's deeply nested React wrappers must not hide committed row props");
for (let i = 0; i < 256; i++) {
  const wrapper = { memoizedProps: {}, return: nestedParent };
  nestedParent.child = wrapper;
  nestedParent = wrapper;
}
nestedParent.child = deeplyNested.leaf;
deeplyNested.leaf.return = nestedParent;
assert.equal(site.getRowParameter(deeplyNested.host), null, "excessive ancestry should still terminate at the bounded fallback");

const hospitalization = { id: "PATIENT-A", name: "Example" };
const flowsheet = { hospitalizationID: "patient-a", flowsheetID: "sheet-a" };
const patient = mount({ hospitalization, flowsheet, onChange() { throw new Error("must not be called"); } });
elements["#patient-table .patient-card-container"] = patient.host;
window.location.pathname = "/whiteboard/hosp/patient-a";
assert.equal(site.getPatientContext().hospitalization, hospitalization, "context should retain raw hospitalization references");
assert.equal(site.getPatientContext().flowsheet, flowsheet, "context should retain raw flowsheet references");
assert.equal(site.getPatientContext().source, "react");
window.location.pathname = "/whiteboard/hosp/patient-b";
assert.equal(site.getPatientContext(), null, "navigation must reject a previous patient's still-rendered context");
window.location.pathname = "/whiteboard/hosp/patient-a";
flowsheet.hospitalizationID = "patient-b";
assert.equal(site.getPatientContext(), null, "a mismatched flowsheet must not supply patient data");
flowsheet.hospitalizationID = "patient-a";
window.location.pathname = "/whiteboard";
assert.equal(site.getPatientContext().hospitalization, hospitalization, "matching card context remains usable without a patient route");

elements["#patient-table .patient-card-container"] = null;
assert.equal(site.getPatientContext(), null, "missing React patient context should preserve the existing reader fallback");

console.log("site-data-check: passed");
