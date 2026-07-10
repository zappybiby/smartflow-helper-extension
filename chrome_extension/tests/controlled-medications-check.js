const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "controlled-medications.js"), "utf8");
const context = {
  window: {}
};

vm.runInNewContext(source, context, {
  filename: "controlled-medications.js"
});

const medications = context.window.SmartFlowControlledMedications;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(medications.findControlledMedication("Fentanyl").id === "fentanyl", "fentanyl should match");
assert(medications.findControlledMedication("Fentanyl CRI") === null, "CRI suffix should be ignored");
assert(medications.findControlledMedication("CRI Ketamine") === null, "CRI prefix should be ignored");
assert(medications.findControlledMedication("Ketamine-CRI") === null, "CRI separated by punctuation should be ignored");
assert(medications.findControlledMedication("Dexmedetomidine") === null, "existing dexmed exclusion should still apply");

console.log("controlled-medications-check: passed");
