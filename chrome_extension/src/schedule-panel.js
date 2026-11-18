(function () {
  "use strict";

  window.SmartFlowSchedulePanel = function ({ createElement, getSheet, contextKey }) {
    const element = createElement("section", {
      className: "sf-helper-tab-panel sf-helper-schedule",
      attrs: { hidden: "", "data-sf-helper-panel": "schedule", "aria-label": "Bulk schedule" }
    });
    const selectLines = createElement("button", {
      className: "sf-helper-button", text: "Select lines", attrs: { type: "button" }
    });
    const summary = createElement("div", { className: "sf-helper-schedule-summary" });
    const names = createElement("span");
    summary.append(createElement("strong", { text: "Selected:" }), names);
    const actions = createElement("div", { className: "sf-helper-schedule-actions" });
    const cancel = createElement("button", {
      className: "sf-helper-button", text: "Cancel", attrs: { type: "button" }
    });
    const controls = createElement("div", { className: "sf-helper-schedule-controls" });
    const status = createElement("div", { attrs: { role: "status" } });
    const apply = createElement("button", {
      className: "sf-helper-button sf-helper-button-primary", attrs: { type: "button" }
    });
    const selected = new Set();
    let sheet = null;
    let sheetContext = "";
    let revision = 0;
    let running = false;
    let loading = false;
    let manualClearHour = false;
    let picking = false;
    let observer;

    function addPicker(label, start, end, format) {
      const wrapper = createElement("label", { text: label });
      const select = createElement("select", { attrs: { "aria-label": label } });
      select.add(new Option("Choose…", ""));
      for (let i = start; i <= end; i++) select.add(new Option(format(i), String(i)));
      select.addEventListener("change", update);
      wrapper.appendChild(select);
      controls.appendChild(wrapper);
      return select;
    }

    const hourLabel = h => (h % 12 || 12) + (h < 12 ? " AM" : " PM");
    const hour = addPicker("Start at", 0, 23, hourLabel);
    const interval = addPicker("Interval", 1, 24, n => n + (n === 1 ? " hour" : " hours"));
    const clearHour = addPicker("Clear old highlight", 0, 23, hourLabel);
    clearHour.options[0].text = "Keep";
    clearHour.addEventListener("change", () => { manualClearHour = true; });
    actions.append(cancel, apply);
    element.append(selectLines, summary, controls, actions, status);

    function suggestClearHour() {
      if (manualClearHour) return;
      const hours = new Set(sheet?.rows.filter(row => selected.has(row.id))
        .map(row => new Date(row.start || NaN).getHours()));
      const [common] = hours;
      clearHour.value = hours.size === 1 && Number.isInteger(common) ? String(common) : "";
    }

    function update() {
      const labels = (sheet?.rows || []).filter(row => selected.has(row.id)).map(row => row.name);
      names.textContent = labels.join(", ") || "None";
      names.title = names.textContent;
      selectLines.hidden = picking;
      summary.hidden = controls.hidden = actions.hidden = !picking;
      selectLines.disabled = running || loading || !sheet?.rows.length;
      cancel.disabled = running;
      apply.textContent = "Apply to " + selected.size + (selected.size === 1 ? " line" : " lines");
      apply.disabled = running || loading || !sheet || !selected.size || hour.value === "" || interval.value === "";
      hour.disabled = interval.disabled = clearHour.disabled = running;
    }

    const boxClass = "sf-helper-line-checkbox";
    function syncCheckboxes() {
      const eligible = new Map((sheet?.rows || []).map(row => [row.id, row]));
      for (const tr of document.querySelectorAll("#flowsheetTable tr.pr-item[data-id]")) {
        const heading = tr.querySelector(".pr-heading");
        const row = eligible.get(tr.dataset.id);
        let box = heading?.querySelector("." + boxClass);
        if (!row || !heading?.querySelector(".pb-name")) {
          box?.remove();
          continue;
        }
        if (!box) {
          box = createElement("input", { className: boxClass, attrs: { type: "checkbox" } });
          // The native row opens its editor on click and can also start a drag.
          for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) {
            box.addEventListener(type, event => event.stopPropagation());
          }
          box.addEventListener("change", () => {
            if (!picking || running || sheetContext !== contextKey()) return;
            if (box.checked) selected.add(tr.dataset.id);
            else selected.delete(tr.dataset.id);
            suggestClearHour();
            status.textContent = "";
            update();
          });
          heading.prepend(box);
        }
        box.setAttribute("aria-label", "Select " + row.name + (row.section ? " (" + row.section + ")" : ""));
        box.checked = selected.has(row.id);
        box.disabled = running;
      }
    }

    function stopPicking() {
      picking = false;
      observer?.disconnect();
      document.querySelectorAll("." + boxClass).forEach(box => box.remove());
      selected.clear();
      manualClearHour = false;
      clearHour.value = hour.value = interval.value = "";
    }

    selectLines.addEventListener("click", () => {
      if (selectLines.disabled || sheetContext !== contextKey()) return;
      picking = true;
      status.textContent = "";
      syncCheckboxes();
      // SmartFlow can replace rows or the entire table while the same sheet is open.
      const structure = "#flowsheetTable, tr.pr-group, tr.pr-item, .pr-heading, .pb-name";
      observer = new MutationObserver(records => {
        if (running || !picking || sheetContext !== contextKey()) return;
        const changed = records.some(record => {
          if (record.type === "attributes") return record.target.matches("tr.pr-item, tbody, .section-toggle");
          return [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && (node.matches(structure) || node.querySelector(structure) ||
              node.classList.contains(boxClass) && !node.isConnected && record.target.isConnected));
        });
        if (changed) refresh();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-id", "class", "hidden", "aria-expanded"] });
      refresh();
    });

    cancel.addEventListener("click", () => {
      stopPicking();
      status.textContent = "";
      update();
      selectLines.focus();
    });

    function reset() {
      revision++;
      loading = false;
      sheet = null;
      stopPicking();
      status.textContent = "";
      update();
    }

    async function refresh() {
      if (running) return;
      const ticket = ++revision;
      const key = contextKey();
      loading = true;
      update();
      try {
        const next = await getSheet();
        if (ticket !== revision || contextKey() !== key) return;
        if (!next || key !== sheetContext || sheet?.patient !== next.patient || sheet?.sheet !== next.sheet) {
          stopPicking();
        }
        sheet = next;
        sheetContext = key;
        for (const id of selected) {
          if (!sheet?.rows.some(row => row.id === id)) selected.delete(id);
        }
        suggestClearHour();
        status.textContent = !sheet ? "Open a patient flowsheet to change schedules." :
          !sheet.rows.length ? "No editable rows on this sheet." : "";
        if (picking) syncCheckboxes();
      } catch (error) {
        if (ticket !== revision) return;
        reset();
        status.textContent = error.message;
      } finally {
        if (ticket === revision) {
          loading = false;
          update();
        }
      }
    }

    apply.addEventListener("click", async event => {
      if (!event.isTrusted || apply.disabled || running) return;
      const ticket = revision;
      const batch = sheet.rows.filter(row => selected.has(row.id));
      const values = { hour: Number(hour.value), interval: Number(interval.value),
        oldHour: clearHour.value === "" ? null : Number(clearHour.value) };
      function guard() {
        if (ticket !== revision || contextKey() !== sheetContext) {
          throw new Error("The patient or sheet changed.");
        }
      }
      running = true;
      syncCheckboxes();
      update();
      let completed = 0;
      let cleared = 0;
      let protectedCount = 0;
      let current;
      try {
        for (const row of batch) {
          current = row;
          status.textContent = "Updating " + row.name + " (" + (completed + 1) + " of " + batch.length + ")…";
          async function checkSheet() {
            guard();
            const live = await getSheet(row.id, values.oldHour);
            guard();
            const item = live?.rows.find(item => item.id === row.id && item.name === row.name && item.section === row.section);
            if (!item || live.sheet !== sheet.sheet || live.patient !== sheet.patient) {
              throw new Error("The row is no longer available on this sheet.");
            }
            return item;
          }
          const outcome = await window.SmartFlowScheduleEditor.applyRow(row, values, guard, checkSheet);
          if (outcome === "cleared") cleared++;
          if (outcome === "protected") protectedCount++;
          guard();
          completed++;
          selected.delete(row.id);
        }
        status.textContent = "Verified " + completed + (completed === 1 ? " row." : " rows.");
      } catch (error) {
        if (ticket === revision) {
          status.textContent = "Verified " + completed + " of " + batch.length + ". Stopped at " +
            current.name + ". " + error.message;
        }
      } finally {
        if (ticket === revision && cleared) status.textContent += " Cleared " + cleared + " old highlight" + (cleared === 1 ? "." : "s.");
        if (ticket === revision && protectedCount) status.textContent += " Kept " + protectedCount + " recorded or protected cell" + (protectedCount === 1 ? "." : "s.");
        running = false;
        if (ticket === revision && completed === batch.length) stopPicking();
        if (picking) syncCheckboxes();
        update();
        if (ticket !== revision && !element.hidden) await refresh();
      }
    });

    update();
    return { element, refresh, reset };
  };
})();
