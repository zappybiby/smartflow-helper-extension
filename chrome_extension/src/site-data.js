(function (global) {
  "use strict";

  var MAX_ANCESTORS = 256;
  var MAX_SIBLINGS = 512;

  function reactFiber(element) {
    if (!element) {
      return null;
    }

    var keys = Object.keys(element);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("__reactFiber$") === 0) {
        return element[keys[i]] || null;
      }
    }

    return null;
  }

  function matchingChild(parent, candidate) {
    var child = parent && parent.child;
    var seen = [];

    for (var i = 0; child && i < MAX_SIBLINGS; i++) {
      if (child === candidate || child === candidate.alternate) {
        return child;
      }
      if (seen.indexOf(child) !== -1) {
        break;
      }
      seen.push(child);
      child = child.sibling;
    }

    return null;
  }

  // The DOM's fiber can be either side of React's alternating render trees.
  // Resolve its ancestry from the committed root, checking each immediate
  // child link. A root-only check is insufficient when a bailout shares children.
  function committedAncestry(element) {
    var fiber = reactFiber(element);
    var path = [];

    while (fiber && path.length < MAX_ANCESTORS) {
      if (path.indexOf(fiber) !== -1) {
        return [];
      }
      path.push(fiber);
      if (!fiber.return) {
        break;
      }
      fiber = fiber.return;
    }

    var root = path[path.length - 1];
    if (!root || root.return || !root.stateNode || !root.stateNode.current) {
      return [];
    }

    var current = root.stateNode.current;
    if (current !== root && current !== root.alternate) {
      return [];
    }

    var committed = [current];
    for (var i = path.length - 2; i >= 0; i--) {
      current = matchingChild(current, path[i]);
      if (!current) {
        return [];
      }
      committed.push(current);
    }

    return committed.reverse();
  }

  function readComponentProps(element, predicate) {
    if (typeof predicate !== "function") {
      return null;
    }

    var ancestors = committedAncestry(element);
    for (var i = 0; i < ancestors.length; i++) {
      var props = ancestors[i].memoizedProps;
      if (props && typeof props === "object" && predicate(props)) {
        return props;
      }
    }

    return null;
  }

  function normalizedId(value) {
    return String(value || "").toLowerCase();
  }

  function routeHospitalizationId() {
    var path = global.location ? global.location.pathname : "";
    var match = path.match(/\/whiteboard\/hosp\/([^/?#]+)/i);
    return match ? normalizedId(match[1]) : "";
  }

  function getPatientContext() {
    var element = global.document.querySelector("#patient-table .patient-card-container");
    var routeId = routeHospitalizationId();
    var props = readComponentProps(element, function (candidate) {
      var hospitalization = candidate.hospitalization;
      var flowsheet = candidate.flowsheet;
      if (!hospitalization || !hospitalization.id || !flowsheet) {
        return false;
      }

      var id = normalizedId(hospitalization.id);
      return (!routeId || id === routeId) &&
        (!flowsheet.hospitalizationID || normalizedId(flowsheet.hospitalizationID) === id);
    });

    return props ? {
      source: "react",
      hospitalization: props.hospitalization,
      flowsheet: props.flowsheet
    } : null;
  }

  function getRowParameter(row) {
    var props = readComponentProps(row, function (candidate) {
      return !!candidate.param && typeof candidate.param === "object";
    });
    return props ? props.param : null;
  }

  global.SmartFlowSiteData = {
    readComponentProps: readComponentProps,
    getPatientContext: getPatientContext,
    getRowParameter: getRowParameter
  };
})(typeof window !== "undefined" ? window : globalThis);
