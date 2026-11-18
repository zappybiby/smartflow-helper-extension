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

    const hour = addPicker("Start at", 0, 23, h => (h % 12 || 12) + (h < 12 ? " AM" : " PM"));
    const interval = addPicker("Continue every", 1, 24, n => n + (n === 1 ? " hour" : " hours"));
    controls.appendChild(apply);
    element.append(list, controls, status);

    function update() {
      apply.textContent = "Apply to " + selected.size + (selected.size === 1 ? " row" : " rows");
      apply.disabled = running || loading || !sheet || !selected.size || hour.value === "" || interval.value === "";
      hour.disabled = interval.disabled = running || !sheet;
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
      hour.value = interval.value = status.textContent = "";
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
          hour.value = interval.value = "";
        }
        sheet = next;
        sheetContext = key;
        for (const id of selected) {
          if (!sheet?.rows.some(row => row.id === id)) selected.delete(id);
        }
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
      const values = { hour: Number(hour.value), interval: Number(interval.value) };
      function guard() {
        if (ticket !== revision || contextKey() !== sheetContext) {
          throw new Error("The patient or sheet changed.");
        }
      }
      running = true;
      update();
      let completed = 0;
      let current;
      try {
        for (const row of batch) {
          current = row;
          status.textContent = "Updating " + row.name + " (" + (completed + 1) + " of " + batch.length + ")…";
          async function checkSheet() {
            guard();
            const live = await getSheet();
            guard();
            if (!live || live.sheet !== sheet.sheet || live.patient !== sheet.patient ||
                !live.rows.some(item => item.id === row.id && item.name === row.name && item.section === row.section)) {
              throw new Error("The row is no longer available on this sheet.");
            }
          }
          await window.SmartFlowScheduleEditor.applyRow(row, values, guard, checkSheet);
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
        running = false;
        render();
        if (ticket !== revision && !element.hidden) await refresh();
      }
    });

    update();
    return { element, refresh, reset };
  };
})();
