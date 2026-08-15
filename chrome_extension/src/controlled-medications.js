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
    "cri",
    "dexmedetomidine",
    "dexmed"
  ];

  // SmartFlow exposes these on parameterBase and treats dateEnded as a strict
  // cutoff: cells after it are discontinued, while the boundary cell remains.
  var DISCONTINUED_FLAG_FIELDS = {
    discontinued: true
  };

  var DISCONTINUED_AT_FIELDS = {
    dateended: true
  };

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

  function isTrueDiscontinuedFlag(value) {
    if (value === true || value === 1) {
      return true;
    }

    var normalized = String(value || "").toLowerCase().trim();

    return normalized === "true" ||
      normalized === "1" ||
      normalized === "discontinued";
  }

  function medicationDiscontinuedAt(parameter) {
    if (!parameter || typeof parameter !== "object") {
      return null;
    }

    var keys = Object.keys(parameter);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var normalizedKey = key.toLowerCase();

      if (!DISCONTINUED_AT_FIELDS[normalizedKey]) {
        continue;
      }

      if (!hasDiscontinuedFlag(parameter)) {
        continue;
      }

      var rawValue = parameter[key];
      if (rawValue === null || rawValue === undefined || rawValue === "" || rawValue === false || rawValue === 0) {
        continue;
      }

      var normalizedValue = String(rawValue).toLowerCase().trim();
      if (!normalizedValue || normalizedValue === "false" || normalizedValue === "0" || normalizedValue === "null") {
        continue;
      }

      var parsed = new Date(rawValue);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  }

  function hasDiscontinuedFlag(parameter) {
    if (!parameter || typeof parameter !== "object") {
      return false;
    }

    return Object.keys(parameter).some(function (key) {
      return DISCONTINUED_FLAG_FIELDS[key.toLowerCase()] && isTrueDiscontinuedFlag(parameter[key]);
    });
  }

  // SmartFlow can discontinue a treatment from an exact time. A timestamp takes
  // precedence over a general flag so doses through that boundary remain visible.
  function isMedicationDiscontinuedAt(parameter, dateLike) {
    var discontinuedAt = medicationDiscontinuedAt(parameter);

    if (discontinuedAt) {
      var date = new Date(dateLike);
      return !Number.isNaN(date.getTime()) && date > discontinuedAt;
    }

    return hasDiscontinuedFlag(parameter);
  }

  window.SmartFlowControlledMedications = {
    defaultMedications: DEFAULT_CONTROLLED_MEDICATIONS,
    defaultExcludedTerms: DEFAULT_EXCLUDED_TERMS,
    findControlledMedication: findControlledMedication,
    isControlledMedicationName: isControlledMedicationName,
    isMedicationDiscontinuedAt: isMedicationDiscontinuedAt,
    medicationDiscontinuedAt: medicationDiscontinuedAt,
    normalizeMedicationText: normalizeMedicationText
  };
})();
