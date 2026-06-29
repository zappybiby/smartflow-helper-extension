(function () {
  "use strict";

  var DEFAULT_CONTROLLED_MEDICATIONS = [
    {
      id: "buprenorphine",
      label: "Buprenorphine",
      terms: ["buprenorphine", "buprenophrine", "bupren"]
    },
    {
      id: "butorphanol",
      label: "Butorphanol",
      terms: ["butorphanol", "butor"]
    },
    {
      id: "gabapentin",
      label: "Gabapentin",
      terms: ["gabapentin", "gabap"]
    },
    {
      id: "hydromorphone",
      label: "Hydromorphone",
      terms: ["hydromorphone", "hydro morphone", "hydromor"]
    },
    {
      id: "methadone",
      label: "Methadone",
      terms: ["methadone"]
    },
    {
      id: "fentanyl",
      label: "Fentanyl",
      terms: ["fentanyl"]
    },
    {
      id: "ketamine",
      label: "Ketamine",
      terms: ["ketamine"]
    },
    {
      id: "midazolam",
      label: "Midazolam",
      terms: ["midazolam", "midaz"]
    },
    {
      id: "diazepam",
      label: "Diazepam",
      terms: ["diazepam"]
    },
    {
      id: "morphine",
      label: "Morphine",
      terms: ["morphine"]
    },
    {
      id: "tramadol",
      label: "Tramadol",
      terms: ["tramadol"]
    },
    {
      id: "phenobarbital",
      label: "Phenobarbital",
      terms: ["phenobarbital", "phenobarb"]
    }
  ];

  var DEFAULT_EXCLUDED_TERMS = [
    "dexmedetomidine",
    "dexmed"
  ];

  // SmartFlow labels may start with "O " for owner-provided medications.
  // Keep matching by medication name and preserve the original label for display.
  function normalizeMedicationText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasTerm(normalizedText, term) {
    var normalizedTerm = normalizeMedicationText(term);

    return normalizedTerm && (" " + normalizedText + " ").indexOf(" " + normalizedTerm + " ") !== -1;
  }

  function isExcludedMedicationName(value, excludedTerms) {
    var normalizedText = normalizeMedicationText(value);
    var terms = excludedTerms || DEFAULT_EXCLUDED_TERMS;

    return terms.some(function (term) {
      return hasTerm(normalizedText, term);
    });
  }

  function findControlledMedication(value, medications, excludedTerms) {
    var normalizedText = normalizeMedicationText(value);

    if (!normalizedText || isExcludedMedicationName(normalizedText, excludedTerms)) {
      return null;
    }

    return (medications || DEFAULT_CONTROLLED_MEDICATIONS).find(function (medication) {
      return medication.terms.some(function (term) {
        return hasTerm(normalizedText, term);
      });
    }) || null;
  }

  function isControlledMedicationName(value, medications, excludedTerms) {
    return !!findControlledMedication(value, medications, excludedTerms);
  }

  window.SmartFlowControlledMedications = {
    defaultMedications: DEFAULT_CONTROLLED_MEDICATIONS,
    defaultExcludedTerms: DEFAULT_EXCLUDED_TERMS,
    findControlledMedication: findControlledMedication,
    isControlledMedicationName: isControlledMedicationName,
    normalizeMedicationText: normalizeMedicationText
  };
})();
