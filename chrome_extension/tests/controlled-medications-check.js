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

const beforeDiscontinuation = "2026-08-01T14:59:59.999Z";
const atDiscontinuation = "2026-08-01T15:00:00.000Z";
const afterDiscontinuation = "2026-08-01T15:00:00.001Z";
const timestampedDiscontinuation = {
  discontinued: true,
  dateEnded: atDiscontinuation
};

assert(
  medications.isMedicationDiscontinuedAt(timestampedDiscontinuation, beforeDiscontinuation) === false,
  "a dose before the discontinuation time should remain visible"
);
assert(
  medications.isMedicationDiscontinuedAt(timestampedDiscontinuation, atDiscontinuation) === false,
  "a dose at the discontinuation time should remain visible"
);
assert(
  medications.isMedicationDiscontinuedAt(timestampedDiscontinuation, afterDiscontinuation) === true,
  "a dose after the discontinuation time should be hidden"
);
assert(
  medications.isMedicationDiscontinuedAt({ discontinued: true }, beforeDiscontinuation) === true,
  "an explicit discontinued flag without a time should hide the treatment"
);
assert(
  medications.isMedicationDiscontinuedAt({ discontinued: "false" }, afterDiscontinuation) === false,
  "the string false should not count as discontinued"
);
assert(
  medications.isMedicationDiscontinuedAt({ Discontinued: "0" }, afterDiscontinuation) === false,
  "the string zero should not count as discontinued"
);
assert(
  medications.isMedicationDiscontinuedAt({ Discontinued: true, DateEnded: atDiscontinuation }, afterDiscontinuation) === true,
  "SmartFlow discontinuation fields should be recognized case-insensitively"
);
assert(
  medications.isMedicationDiscontinuedAt({ discontinued: true, DateEnded: atDiscontinuation }, atDiscontinuation) === false,
  "SmartFlow dateEnded should keep the dose at the cutoff visible"
);
assert(
  medications.isMedicationDiscontinuedAt({ discontinued: true, DateEnded: atDiscontinuation }, afterDiscontinuation) === true,
  "SmartFlow dateEnded should hide doses after the cutoff"
);
assert(
  medications.isMedicationDiscontinuedAt({ DateEnded: atDiscontinuation }, afterDiscontinuation) === false,
  "dateEnded without SmartFlow's discontinued flag should not hide a treatment"
);

console.log("controlled-medications-check: passed");
