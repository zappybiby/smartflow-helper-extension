(function () {
  "use strict";

  window.SmartFlowSchedulePanel = function ({ createElement, getSheet, contextKey }) {
    const element = createElement("section", {
      className: "sf-helper-tab-panel sf-helper-schedule",
      attrs: { hidden: "", "data-sf-helper-panel": "schedule", "aria-label": "Bulk schedule" }
    });
    const list = createElement("div", { className: "sf-helper-schedule-list" });
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

    function addPicker(label, start, end, format) {
      const wrapper = createElement("label", { text: label });
      const select = createElement("select");
      select.add(new Option("Choose…", ""));
      for (let i = start; i <= end; i++) select.add(new Option(format(i), String(i)));
      select.addEventListener("change", update);
      wrapper.appendChild(select);
      controls.appendChild(wrapper);
      return select;
    }

    const hourLabel = h => (h % 12 || 12) + (h < 12 ? " AM" : " PM");
    const hour = addPicker("Start at", 0, 23, hourLabel);
    const interval = addPicker("Continue every", 1, 24, n => n + (n === 1 ? " hour" : " hours"));
    const clearHour = addPicker("Clear old highlight", 0, 23, hourLabel);
    clearHour.options[0].text = "Keep";
    clearHour.addEventListener("change", () => { manualClearHour = true; });
    controls.appendChild(apply);
    element.append(list, controls, status);

    function suggestClearHour() {
      if (manualClearHour) return;
      const hours = new Set(sheet?.rows.filter(row => selected.has(row.id))
        .map(row => new Date(row.start || NaN).getHours()));
      const [common] = hours;
      clearHour.value = hours.size === 1 && Number.isInteger(common) ? String(common) : "";
    }

    function update() {
      apply.textContent = "Apply to " + selected.size + (selected.size === 1 ? " row" : " rows");
      apply.disabled = running || loading || !sheet || !selected.size || hour.value === "" || interval.value === "";
      hour.disabled = interval.disabled = clearHour.disabled = running || !sheet;
      for (const box of list.querySelectorAll("input")) box.disabled = running;
    }

    function render() {
      list.replaceChildren();
      let group;
      for (const row of sheet?.rows || []) {
        if (group !== row.section) {
          group = row.section;
          list.appendChild(createElement("strong", { text: group || "Flowsheet" }));
        }
        const label = createElement("label");
        const box = createElement("input", { attrs: { type: "checkbox" } });
        box.checked = selected.has(row.id);
        box.addEventListener("change", () => {
          if (box.checked) selected.add(row.id);
          else selected.delete(row.id);
          suggestClearHour();
          status.textContent = "";
          update();
        });
        label.append(box, document.createTextNode(row.name));
        list.appendChild(label);
      }
      update();
    }

    function reset() {
      revision++;
      loading = false;
      sheet = null;
      selected.clear();
      manualClearHour = false;
      clearHour.value = hour.value = interval.value = status.textContent = "";
      render();
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
          selected.clear();
          manualClearHour = false;
          clearHour.value = hour.value = interval.value = "";
        }
        sheet = next;
        sheetContext = key;
        for (const id of selected) {
          if (!sheet?.rows.some(row => row.id === id)) selected.delete(id);
        }
        suggestClearHour();
        status.textContent = !sheet ? "Open a patient flowsheet to change schedules." :
          !sheet.rows.length ? "No editable rows on this sheet." : "";
        render();
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
        render();
        if (ticket !== revision && !element.hidden) await refresh();
      }
    });

    update();
    return { element, refresh, reset };
  };
})();
