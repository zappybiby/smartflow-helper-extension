(function () {
  "use strict";

  const planning = "[id$='-planning-dialog']";
  const execution = "#execute-treatment-dialog";
  const hourMs = 3600000;

  function visible(element) {
    return element && element.checkVisibility({ visibilityProperty: true }) && element.getClientRects().length > 0;
  }

  async function waitFor(read, guard, message) {
    const deadline = Date.now() + 15000;
    do {
      guard();
      const result = await read();
      guard();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 120));
    } while (Date.now() < deadline);
    throw new Error(message);
  }

  function rowElement(row) {
    const element = document.querySelector("#flowsheetTable tr.pr-item[data-id=" + CSS.escape(row.id) + "]");
    if (!visible(element)) throw new Error("The selected flowsheet row is unavailable.");
    return element;
  }

  function checkClosed() {
    if (Array.from(document.querySelectorAll(planning + ", " + execution)).some(visible)) {
      throw new Error("Close the open SmartFlow editor to continue.");
    }
  }

  function done(editor) {
    const button = Array.from(editor.querySelectorAll(".bottom-buttons button")).find(el => el.textContent.trim() === "Done");
    if (!visible(editor) || !visible(button) || button.disabled) throw new Error("SmartFlow has not enabled Done.");
    button.click();
  }

  // The planning form uses the sheet's local start date. On a 7 AM sheet,
  // choosing 3 AM means the following calendar morning.
  function startTime(sheetDate, hour) {
    const start = new Date(sheetDate);
    if (hour < start.getHours()) start.setDate(start.getDate() + 1);
    start.setHours(hour, 0, 0, 0);
    if (start.getHours() !== hour) throw new Error("That hour is unavailable on this sheet.");
    return start.getTime();
  }

  function hasSchedule(row, start, interval) {
    return Math.floor(Date.parse(row.start) / hourMs) === Math.floor(start / hourMs) && row.frequency === interval;
  }

  async function setInterval(input, interval, guard) {
    // SmartFlow's searchable Mantine select pages the results. Type the
    // requested interval first so even late options (e.g. 24 hrs.) are mounted.
    input.focus();
    input.click();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(interval));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const label = interval + (interval === 1 ? " hr." : " hrs.");
    const option = await waitFor(() => {
      const list = document.getElementById(input.getAttribute("aria-controls"));
      return Array.from(list?.querySelectorAll("[data-combobox-option]") || [])
        .find(el => visible(el) && el.textContent.trim() === label);
    }, guard, "SmartFlow did not offer the requested interval.");
    option.click();
    await waitFor(() => input.value === label, guard, "SmartFlow did not accept the interval.");
  }

  async function saveSchedule(row, values, read, guard) {
    checkClosed();
    rowElement(row).querySelector(".pr-heading .pb-name").click();
    const editor = await waitFor(async () => {
      const dialog = (await read()).dialog;
      if (dialog?.id.endsWith("-planning-dialog")) return document.getElementById(dialog.id);
    }, guard, "SmartFlow did not open this row’s planning editor.");
    const hour = editor.querySelector("select[id$='start-time']");
    const interval = editor.querySelector("input[id$='continue-every']");
    if (!hour || !interval) throw new Error("This row does not offer a repeating schedule.");
    // Existing editable rows initialize locked in a React effect after the first render.
    const unlock = await waitFor(() => editor.querySelector("[aria-label='Unlock planning']"),
      guard, "The existing planning form did not finish loading.");
    unlock.click();
    await waitFor(() => !hour.disabled && !interval.disabled, guard, "The schedule is locked.");
    hour.value = String(values.hour); // Midnight is displayed as 24:00 but has option value 0.
    hour.dispatchEvent(new Event("change", { bubbles: true }));
    if (row.frequency !== values.interval) await setInterval(interval, values.interval, guard);
    const current = await read();
    if (current.dialog?.id !== editor.id || hour.value !== String(values.hour) ||
        current.start !== row.start || current.frequency !== row.frequency) {
      throw new Error("The schedule changed while its editor was open.");
    }
    guard();
    done(editor);
  }

  function dueAt(sheetDate, cell, start, interval) {
    const offset = Math.floor(sheetDate / hourMs) + cell?.index - Math.floor(start / hourMs);
    return offset === 0 || (offset > 0 && interval > 0 && offset % interval === 0);
  }

  async function clearHighlight(row, start, interval, original, read, guard) {
    if (!original || dueAt(row.sheetDate, original, start, interval)) return;
    if (original.state === "protected") return "protected";
    if (original.state !== "planned") return;
    const current = await read();
    if (current.cell?.state === "clear") return;
    if (current.cell?.state === "protected") return "protected";

    function sameCell(snapshot) {
      return snapshot.cell?.state === "planned" && snapshot.cell.id === original.id &&
        snapshot.cell.index === original.index && hasSchedule(snapshot, start, interval);
    }
    if (!sameCell(current)) throw new Error("The old cell changed. Review its highlight.");
    checkClosed();
    const target = rowElement(row).querySelector('td[data-hour-index="' + original.index + '"]');
    if (!target) throw new Error("The old time block is unavailable.");
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    const editor = await waitFor(async () => {
      const dialog = (await read()).dialog;
      return dialog?.id === "execute-treatment-dialog" && dialog.index === original.index && document.querySelector(execution);
    }, guard, "SmartFlow did not open the old time block.");
    const off = editor.querySelector("#highlight input[value=Off]");
    const on = editor.querySelector("#highlight input[value=On]");
    // The execution form copies the saved status into its controls after mounting.
    await waitFor(() => on?.checked && off && !off.disabled, guard, "The old highlight cannot be edited.");
    const latest = await read();
    if (latest.cell?.state === "protected") {
      editor.querySelector("a.close")?.click();
      return "protected";
    }
    if (!sameCell(latest)) throw new Error("The old cell changed. Review its highlight.");
    off.click();
    const beforeSave = await read();
    if (!off.checked || beforeSave.dialog?.index !== original.index || !sameCell(beforeSave)) {
      throw new Error("The old cell changed before saving.");
    }
    guard();
    done(editor);
    await waitFor(async () => {
      const result = await read();
      if (result.cell?.state === "error") throw new Error("SmartFlow could not save the old highlight.");
      return !visible(editor) && result.cell?.state === "clear";
    }, guard, "Schedule saved. SmartFlow has not confirmed the old highlight was cleared.");
    return "cleared";
  }

  async function applyRow(row, values, guard, read, pendingCleanup = new Map()) {
    const live = await read();
    if (live.id !== row.id || live.error || live.syncing) {
      throw new Error("The row is unavailable. Refresh and review it.");
    }
    const start = startTime(live.sheetDate, values.hour);
    const pending = pendingCleanup.get(row.id);
    if (pending && pending.sheetDate === live.sheetDate && hasSchedule(live, pending.start, pending.interval)) {
      // The planning save can succeed even if switching off the old square fails.
      const result = await clearHighlight(live, pending.start, pending.interval, pending.cell, () => read(pending.hour), guard);
      pendingCleanup.delete(row.id);
      if (hasSchedule(live, start, values.interval)) return result;
    }
    pendingCleanup.delete(row.id);
    if (hasSchedule(live, start, values.interval)) return;

    const hour = live.start ? new Date(live.start).getHours() : NaN;
    const readOldCell = () => read(Number.isInteger(hour) ? hour : null);
    const before = await readOldCell();
    if (before.start !== live.start || before.frequency !== live.frequency || before.sheetDate !== live.sheetDate ||
        before.error || before.syncing || ["ambiguous", "error", "saving"].includes(before.cell?.state)) {
      throw new Error("The row or its old time block changed. Refresh and review it.");
    }
    const oldCell = dueAt(before.sheetDate, before.cell, Date.parse(before.start), before.frequency) ? before.cell : null;
    if (oldCell?.state === "planned") {
      pendingCleanup.set(row.id, { hour, start, interval: values.interval, sheetDate: before.sheetDate, cell: oldCell });
    }
    await saveSchedule(before, values, readOldCell, guard);
    // Done closes immediately. The row data changes after the planning POST finishes.
    await waitFor(async () => {
      const result = await readOldCell();
      if (result.error) throw new Error("SmartFlow could not save this schedule.");
      return !result.dialog && !result.syncing && hasSchedule(result, start, values.interval);
    }, guard, "SmartFlow has not confirmed the new schedule.");
    const result = await clearHighlight(before, start, values.interval, oldCell, readOldCell, guard);
    pendingCleanup.delete(row.id);
    return result;
  }

  window.SmartFlowScheduleEditor = { applyRow };
})();
