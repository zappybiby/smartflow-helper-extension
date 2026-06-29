(function (global) {
  "use strict";

  var DEFAULT_MARGIN = 20;
  var NARROW_MARGIN = 12;
  var GAP = 12;
  var DEFAULT_PANEL_WIDTH = 360;
  var MIN_PANEL_WIDTH = 300;
  var MIN_PANEL_HEIGHT = 300;
  var DEFAULT_PANEL_MAX_HEIGHT = 620;

  var WHITEBOARD_TABLE_SELECTORS = [
    "#flowsheetTable",
    "#whiteboard-table table",
    ".whiteboard-table-holder table.pr-table",
    ".whiteboard-table-holder table"
  ];

  function numberOrZero(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function toPlainRect(rect) {
    return {
      left: numberOrZero(rect.left),
      top: numberOrZero(rect.top),
      right: numberOrZero(rect.right),
      bottom: numberOrZero(rect.bottom),
      width: numberOrZero(rect.width !== undefined ? rect.width : rect.right - rect.left),
      height: numberOrZero(rect.height !== undefined ? rect.height : rect.bottom - rect.top)
    };
  }

  function hasArea(rect) {
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function overlaps(a, b, gap) {
    gap = Number.isFinite(gap) ? gap : 0;

    return hasArea(a) &&
      hasArea(b) &&
      a.left < b.right + gap &&
      a.right > b.left - gap &&
      a.top < b.bottom + gap &&
      a.bottom > b.top - gap;
  }

  function verticallyOverlaps(a, b, gap) {
    gap = Number.isFinite(gap) ? gap : 0;

    return hasArea(a) &&
      hasArea(b) &&
      a.top < b.bottom + gap &&
      a.bottom > b.top - gap;
  }

  function horizontallyOverlaps(left, width, rect, gap) {
    gap = Number.isFinite(gap) ? gap : 0;

    return hasArea(rect) &&
      left < rect.right + gap &&
      left + width > rect.left - gap;
  }

  function placedRect(left, bottom, width, height, viewport) {
    var safeWidth = Math.max(0, width);
    var safeHeight = Math.max(0, height);
    var safeLeft = Math.max(0, Math.min(left, Math.max(0, viewport.width - safeWidth)));
    var safeBottom = Math.max(0, Math.min(bottom, Math.max(0, viewport.height - safeHeight)));
    var top = viewport.height - safeBottom - safeHeight;

    return {
      left: safeLeft,
      top: top,
      right: safeLeft + safeWidth,
      bottom: viewport.height - safeBottom,
      width: safeWidth,
      height: safeHeight
    };
  }

  function firstBlockingTableLeft(rect, tableRects) {
    return tableRects.reduce(function (left, tableRect) {
      if (!verticallyOverlaps(rect, tableRect, 0) || tableRect.left <= rect.left) {
        return left;
      }

      return Math.min(left, tableRect.left);
    }, Infinity);
  }

  function fitWidthBeforeTables(left, bottom, width, height, viewport, tableRects) {
    var rect = placedRect(left, bottom, width, height, viewport);
    var tableLeft = firstBlockingTableLeft(rect, tableRects);

    if (!Number.isFinite(tableLeft)) {
      return width;
    }

    return Math.min(width, Math.max(0, tableLeft - left - GAP));
  }

  function maxHeightBelowBugPanels(left, bottom, width, viewport, bugPanelRects) {
    var topLimit = 0;

    bugPanelRects.forEach(function (bugPanelRect) {
      if (!horizontallyOverlaps(left, width, bugPanelRect, 0)) {
        return;
      }

      topLimit = Math.max(topLimit, bugPanelRect.bottom + GAP);
    });

    return Math.max(0, viewport.height - bottom - topLimit);
  }

  function rightOfBugPanels(margin, bugPanelRects) {
    return bugPanelRects.reduce(function (left, bugPanelRect) {
      if (!hasArea(bugPanelRect)) {
        return left;
      }

      return Math.max(left, bugPanelRect.right + GAP);
    }, margin);
  }

  function collisionReport(rect, tableRects, bugPanelRects) {
    var tableOverlaps = tableRects.filter(function (tableRect) {
      return overlaps(rect, tableRect, 0);
    });
    var bugPanelOverlaps = bugPanelRects.filter(function (bugPanelRect) {
      return overlaps(rect, bugPanelRect, 0);
    });

    return {
      hasOverlap: tableOverlaps.length > 0 || bugPanelOverlaps.length > 0,
      tableOverlaps: tableOverlaps,
      bugPanelOverlaps: bugPanelOverlaps
    };
  }

  function choosePlacement(options) {
    var viewport = options.viewport;
    var margin = options.margin;
    var helperSize = options.helperSize;
    var tableRects = options.tableRects || [];
    var bugPanelRects = options.bugPanelRects || [];
    var bottom = margin;
    var desiredWidth = options.open ? DEFAULT_PANEL_WIDTH : helperSize.width;

    function candidate(left) {
      var maxViewportWidth = Math.max(0, viewport.width - left - margin);
      var width = Math.min(desiredWidth, maxViewportWidth);
      var maxHeight = options.open ?
        Math.min(
          DEFAULT_PANEL_MAX_HEIGHT,
          Math.max(0, viewport.height - bottom - margin),
          maxHeightBelowBugPanels(left, bottom, width, viewport, bugPanelRects)
        ) :
        helperSize.height;
      var height = options.open ?
        Math.min(helperSize.height || maxHeight, maxHeight) :
        helperSize.height;

      if (options.open) {
        width = fitWidthBeforeTables(left, bottom, width, height, viewport, tableRects);
      }

      return {
        left: left,
        width: width,
        height: height,
        maxHeight: maxHeight,
        rect: placedRect(left, bottom, width, height, viewport)
      };
    }

    var placementCandidate = candidate(margin);

    if (
      options.open &&
      placementCandidate.maxHeight < MIN_PANEL_HEIGHT &&
      bugPanelRects.length
    ) {
      var shiftedLeft = Math.min(
        rightOfBugPanels(margin, bugPanelRects),
        Math.max(margin, viewport.width - desiredWidth - margin)
      );
      var shiftedCandidate = candidate(shiftedLeft);

      if (shiftedCandidate.width >= Math.min(MIN_PANEL_WIDTH, desiredWidth)) {
        placementCandidate = shiftedCandidate;
      }
    }

    var rect = placementCandidate.rect;
    var collisions = collisionReport(rect, tableRects, bugPanelRects);

    return {
      left: Math.round(rect.left),
      bottom: Math.round(viewport.height - rect.bottom),
      panelWidth: Math.round(placementCandidate.width),
      panelMaxHeight: Math.round(placementCandidate.maxHeight),
      compact: false,
      rect: rect,
      collisions: collisions
    };
  }

  function isVisible(element) {
    var style = element ? global.getComputedStyle(element) : null;

    return !!element &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length) &&
      style &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }

  function uniqueElements(selectors, doc) {
    var seen = [];
    var elements = [];

    selectors.forEach(function (selector) {
      Array.prototype.slice.call(doc.querySelectorAll(selector)).forEach(function (element) {
        if (seen.indexOf(element) !== -1) {
          return;
        }

        seen.push(element);
        elements.push(element);
      });
    });

    return elements;
  }

  function elementRects(elements) {
    return elements
      .filter(isVisible)
      .map(function (element) {
        return toPlainRect(element.getBoundingClientRect());
      })
      .filter(hasArea);
  }

  function getBugPanelRects(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll(".bug-panel"))
      .filter(function (element) {
        return isVisible(element) && !(element.matches && element.matches(":hover"));
      })
      .map(function (element) {
        return toPlainRect(element.getBoundingClientRect());
      })
      .filter(hasArea);
  }

  function getViewport(doc) {
    var element = doc.documentElement;

    return {
      width: element.clientWidth || global.innerWidth || 0,
      height: element.clientHeight || global.innerHeight || 0
    };
  }

  function getMargin(viewport) {
    return viewport.width <= 720 ? NARROW_MARGIN : DEFAULT_MARGIN;
  }

  function getHelperElement(root, open) {
    return open ?
      root.querySelector(".sf-helper-panel") :
      root.querySelector(".sf-helper-launcher");
  }

  function measure(root) {
    var doc = root.ownerDocument;
    var viewport = getViewport(doc);
    var open = root.classList.contains("sf-helper-open");
    var helperElement = getHelperElement(root, open);
    var helperRect = helperElement ?
      toPlainRect(helperElement.getBoundingClientRect()) :
      { width: 0, height: 0 };
    var tableRects = elementRects(uniqueElements(WHITEBOARD_TABLE_SELECTORS, doc));
    var bugPanelRects = getBugPanelRects(doc);

    return {
      viewport: viewport,
      margin: getMargin(viewport),
      open: open,
      helperSize: {
        width: helperRect.width,
        height: helperRect.height
      },
      tableRects: tableRects,
      bugPanelRects: bugPanelRects
    };
  }

  function apply(root) {
    if (!root) {
      return null;
    }

    var options = measure(root);
    var placement = choosePlacement(options);

    root.style.left = placement.left + "px";
    root.style.right = "auto";
    root.style.bottom = placement.bottom + "px";
    root.classList.toggle("sf-helper-compact", !!placement.compact);

    if (options.open) {
      root.style.setProperty("--sf-helper-panel-width", placement.panelWidth + "px");
      root.style.setProperty("--sf-helper-panel-max-height", placement.panelMaxHeight + "px");
    } else {
      root.style.removeProperty("--sf-helper-panel-width");
      root.style.removeProperty("--sf-helper-panel-max-height");
    }

    root.setAttribute("data-sf-helper-layout-overlap", placement.collisions.hasOverlap ? "true" : "false");

    return placement;
  }

  function getOverlapReport(root) {
    if (!root) {
      return null;
    }

    var options = measure(root);
    var helperElement = getHelperElement(root, options.open);
    var rect = helperElement ?
      toPlainRect(helperElement.getBoundingClientRect()) :
      placedRect(options.margin, options.margin, options.helperSize.width, options.helperSize.height, options.viewport);

    return {
      rect: rect,
      tableRects: options.tableRects,
      bugPanelRects: options.bugPanelRects,
      collisions: collisionReport(rect, options.tableRects, options.bugPanelRects)
    };
  }

  global.SmartFlowHelperLayout = {
    apply: apply,
    choosePlacement: choosePlacement,
    getOverlapReport: getOverlapReport,
    overlaps: overlaps
  };
})(typeof window !== "undefined" ? window : globalThis);
