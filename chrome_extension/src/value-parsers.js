(function () {
  "use strict";

  function normalizeQuery(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function parseNumber(value) {
    if (value === null || value === undefined) {
      return null;
    }

    var match = String(value).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDate(dateLike) {
    var date = new Date(dateLike);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return [
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
      date.getFullYear()
    ].join("/");
  }

  function formatTime(dateLike, fallbackLabel) {
    var date = new Date(dateLike);

    if (Number.isNaN(date.getTime())) {
      return String(fallbackLabel || "").trim();
    }

    var hours = date.getHours();
    var minutes = date.getMinutes();
    var part = hours >= 12 ? "PM" : "AM";
    var hour12 = hours % 12;

    if (hour12 === 0) {
      hour12 = 12;
    }

    if (minutes === 0) {
      return hour12 + " " + part;
    }

    return hour12 + ":" + pad2(minutes) + " " + part;
  }

  function detectBloodGlucoseSource(value, context) {
    var text = normalizeQuery([value, context].join(" "));

    if (/\blibre\b/.test(text)) {
      return "Libre";
    }

    if (/\biv\b/.test(text) || /\bspot bg\b/.test(text) || /\bspot blood glucose\b/.test(text)) {
      return "IV";
    }

    return "";
  }

  function parseBloodGlucose(rawValue, context) {
    var raw = String(rawValue || "").trim();
    var normalized = normalizeQuery(raw);
    var high = /\b(thtr|hi|high|too high to read)\b/.test(normalized);
    var numericValue = high ? null : parseNumber(raw);
    var source = detectBloodGlucoseSource(raw, context);
    var valueText = "";

    if (high) {
      valueText = "Too High To Read";
    } else if (numericValue !== null) {
      valueText = numericValue + " mg/dL";
    } else {
      valueText = raw;
    }

    return {
      raw: raw,
      value: numericValue,
      high: high,
      source: source,
      valueText: valueText,
      recognized: high || numericValue !== null
    };
  }

  function detectBloodPressureMethod(value) {
    var text = normalizeQuery(value);

    if (/\bdoppler\b/.test(text)) {
      return "Doppler";
    }

    if (/\boscillometric\b/.test(text) || /\bosc\b/.test(text)) {
      return "Oscillometric";
    }

    return "";
  }

  function detectBloodPressureCuff(value) {
    var match = String(value || "").match(/(?:#|size|cuff)\s*#?\s*(\d{1,2})\b/i);
    return match ? "#" + match[1] : "";
  }

  function detectBloodPressureLocation(value) {
    var text = normalizeQuery(value);
    var padded = " " + text + " ";
    var patterns = [
      { rx: /\bright front limb\b|\bright front\b|\bfront right\b|\brfl\b|\brf\b|\bfr\b/, text: "Right Front Limb" },
      { rx: /\bleft front limb\b|\bleft front\b|\bfront left\b|\blfl\b|\blf\b|\bfl\b/, text: "Left Front Limb" },
      { rx: /\bright hind limb\b|\bright hind\b|\bhind right\b|\bright rear\b|\brear right\b|\brhl\b|\brh\b|\bhr\b|\brr\b/, text: "Right Hind Limb" },
      { rx: /\bleft hind limb\b|\bleft hind\b|\bhind left\b|\bleft rear\b|\brear left\b|\blhl\b|\blh\b|\bhl\b|\brl\b/, text: "Left Hind Limb" }
    ];

    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].rx.test(padded)) {
        return patterns[i].text;
      }
    }

    return "";
  }

  function parseBloodPressure(rawValue) {
    var raw = String(rawValue || "").trim();
    var pairMatch = raw.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/);
    var mapMatch = raw.match(/\bMAP\s*[:=]?\s*(\d{1,3})\b/i) || raw.match(/\((\d{1,3})\)/);
    var scrubbed = raw
      .replace(/\bMAP\s*[:=]?\s*\d{1,3}\b/ig, " ")
      .replace(/\(\d{1,3}\)/g, " ")
      .replace(/(?:#|size|cuff)\s*#?\s*\d{1,2}\b/ig, " ")
      .replace(/\b(doppler|oscillometric|osc)\b/ig, " ");
    var singleMatch = pairMatch ? null : scrubbed.match(/\b(\d{2,3})\b/);
    var cuff = detectBloodPressureCuff(raw);
    var location = detectBloodPressureLocation(raw);
    var method = detectBloodPressureMethod(raw);
    var systolic = pairMatch ? Number(pairMatch[1]) : singleMatch ? Number(singleMatch[1]) : null;
    var diastolic = pairMatch ? Number(pairMatch[2]) : null;
    var map = mapMatch ? Number(mapMatch[1]) : null;
    var valueText = "";

    if (pairMatch) {
      valueText = systolic + "/" + diastolic;
    } else if (systolic !== null) {
      valueText = systolic + " systolic";
    } else {
      valueText = raw;
    }

    if (map !== null) {
      valueText += " (MAP " + map + ")";
    }

    return {
      raw: raw,
      systolic: systolic,
      diastolic: diastolic,
      map: map,
      cuff: cuff,
      location: location,
      method: method,
      valueText: valueText,
      recognized: !!pairMatch || systolic !== null
    };
  }

  window.SmartFlowValueParsers = {
    normalizeQuery: normalizeQuery,
    parseNumber: parseNumber,
    formatDate: formatDate,
    formatTime: formatTime,
    parseBloodGlucose: parseBloodGlucose,
    parseBloodPressure: parseBloodPressure
  };
})();
