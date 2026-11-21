(function () {
  "use strict";

  // These are SmartFlow's seven single-cell execution-editor swatches.
  const palette = [
    ["Yellow", 0xffff00], ["Orange", 0xffd885], ["Green", 0xc1ffc0], ["Cyan", 0xabfaff],
    ["Purple", 0xd3b2fc], ["Pink", 0xffb4c4], ["Pale yellow", 0xfcffa4]
  ].map(([name, color], i) => ({ name, color, button: "button" + (i + 1) }));
  const hourMs = 3600000;

  function sameOrder(row, sourceRows, dayRows) {
    const exact = dayRows.find(candidate => candidate.id === row.id);
    if (exact) return exact;
    if (!row.orderKey || sourceRows.filter(candidate => candidate.orderKey === row.orderKey).length !== 1) return null;
    const matches = dayRows.filter(candidate => candidate.orderKey === row.orderKey);
    return matches.length === 1 ? matches[0] : null;
  }

  function slots(day) {
    if (!Number.isSafeInteger(day.hours) || day.hours < 1 || !Number.isFinite(day.date)) {
      throw new Error("SmartFlow did not provide the sheet hours.");
    }
    return Array.from({ length: day.hours }, (_, index) => day.date + index * hourMs);
  }

  async function apply({ origin, selected, hour, interval, swatch, future, getSheet, guard, progress }) {
    const { waitFor, colorCell } = window.SmartFlowScheduleEditor;
    const anchor = slots(origin).find(time => new Date(time).getHours() === hour);
    if (anchor === undefined) throw new Error("That hour is unavailable on the starting sheet.");
    const ids = origin.days;
    const first = ids.indexOf(origin.sheet);
    if (first < 0) throw new Error("The starting sheet is unavailable.");
    let day = origin;
    let changed = 0;
    let unmatched = 0;

    async function readDay(id, index) {
      guard();
      const live = await getSheet(id, index, true);
      guard();
      if (live?.patient !== origin.patient || live.sheet !== day.sheet || live.date !== day.date) {
        throw new Error("The patient or sheet changed.");
      }
      return live;
    }

    async function goTo(id) {
      const current = await readDay();
      const index = current.days.indexOf(id);
      if (index < 0) throw new Error("The selected day is no longer available.");
      const trigger = document.querySelector('[data-testid="flowsheet-day-picker-trigger"], [data-testid="flowsheet-phone-day-select"]');
      if (!trigger) throw new Error("SmartFlow’s day selector is unavailable.");
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      const options = '[data-testid="flowsheet-day-picker"] tbody tr, [data-testid="flowsheet-phone-day-option"]';
      const option = await waitFor(() => document.querySelectorAll(options)[index],
        guard, "SmartFlow did not open the day selector.");
      const beforeSwitch = await readDay();
      if (beforeSwitch.days[index] !== id) throw new Error("The list of sheet days changed.");
      option.click();
      const next = await waitFor(async () => {
        const live = await getSheet(null, null, true);
        if (!live) return null;
        if (live.patient !== origin.patient || (live.sheet !== id && live.sheet !== day.sheet)) {
          throw new Error("The patient or sheet changed.");
        }
        return live.sheet === id && live;
      }, guard, "SmartFlow did not open the requested day.");
      day = next;
    }

    try {
      for (const id of future ? ids.slice(first) : [origin.sheet]) {
        if (id !== day.sheet) await goTo(id);
        const times = slots(day);
        const dayNumber = ids.indexOf(id) + 1;
        for (const original of selected) {
          const row = sameOrder(original, origin.rows, day.rows);
          if (!row) { unmatched++; continue; }
          for (const [index, time] of times.entries()) {
            if (time < anchor || (time - anchor) % (interval * hourMs) !== 0) continue;
            progress("Day " + dayNumber + " · " + row.name + " · " +
              new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
            const read = async () => {
              const live = (await readDay(row.id, index)).rows.find(item => item.id === row.id && item.orderKey === row.orderKey);
              if (!live || live.syncing || live.error) throw new Error("The line changed or is still syncing.");
              return live;
            };
            if (await colorCell(row, index, swatch, guard, read)) changed++;
          }
        }
      }
    } catch (error) {
      throw new Error(changed + " colored. " + error.message);
    }
    // After a successful run restore the sheet on which the user chose the start hour.
    if (day.sheet !== origin.sheet) {
      try { await goTo(origin.sheet); }
      catch (error) { throw new Error(changed + " colored. " + error.message); }
    }
    return changed + (changed === 1 ? " cell colored." : " cells colored.") +
      (unmatched ? " Skipped " + unmatched + " unmatched line/day combinations." : "");
  }

  window.SmartFlowRecurringColor = { palette, apply };
})();
