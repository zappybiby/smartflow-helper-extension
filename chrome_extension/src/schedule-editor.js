(function () {
  "use strict";

  const dialogs = "[id$='-planning-dialog']";
  const fields = {
    hour: /^start at\b/i,
    interval: /^continue every\b/i
  };

  function visible(element) {
    return element && element.checkVisibility({ visibilityProperty: true }) && element.getClientRects().length > 0;
  }

  function only(elements) {
    return elements.length === 1 ? elements[0] : null;
  }

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function parse(label, field) {
    const text = clean(label);
    if (field === "interval") {
      const match = /^(\d{1,2})\s*(?:h|hr|hrs|hour|hours)?\.?$/i.exec(text);
      return match && +match[1] >= 1 && +match[1] <= 24 ? +match[1] : null;
    }
    const match = /^(\d{1,2})(?::00)?\s*(am|pm)?$/i.exec(text);
    if (!match) return null;
    const hour = +match[1];
    if (!match[2]) return hour < 24 ? hour : null;
    if (hour < 1 || hour > 12) return null;
    return hour % 12 + (match[2].toLowerCase() === "pm" ? 12 : 0);
  }

  async function waitFor(read, message, guard) {
    const deadline = Date.now() + 4500;
    do {
      guard();
      const result = read();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(message);
  }

  function control(editor, field) {
    const selector = "select, input:not([type=hidden]):not([type=button]):not([type=submit]), button[aria-haspopup=listbox]";
    const label = only(Array.from(editor.querySelectorAll("label")).filter(node => fields[field].test(clean(node.textContent))));
    if (!label) return null;
    if (label.control && label.control.matches(selector) && visible(label.control)) return label.control;
    // SmartFlow also renders captions beside a wrapped Mantine dropdown.
    const next = label.nextElementSibling;
    if (next && next.matches(selector) && visible(next)) return next;
    const adjacent = next && only(Array.from(next.querySelectorAll(selector)).filter(visible));
    if (adjacent) return adjacent;
    return only(Array.from(label.parentElement.querySelectorAll(selector)).filter(visible));
  }

  function displayed(input) {
    if (!input) return "";
    if (input.tagName === "SELECT") return input.options[input.selectedIndex]?.label || "";
    return input.value || input.textContent;
  }

  function enabled(input) {
    return input && !input.matches(":disabled, [aria-disabled=true], [data-disabled=true]");
  }

  async function setField(editor, field, target, guard) {
    const input = control(editor, field);
    if (!enabled(input)) throw new Error("SmartFlow did not enable both schedule fields.");
    if (parse(displayed(input), field) === target) return;
    const matches = node => parse(node.label || node.textContent, field) === target && enabled(node);
    if (input.tagName === "SELECT") {
      const option = only(Array.from(input.options).filter(matches));
      if (!option) throw new Error("SmartFlow does not offer the selected " + field + ".");
      input.selectedIndex = option.index;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      input.click();
      const list = await waitFor(() => {
        const linked = document.getElementById(input.getAttribute("aria-controls") || input.getAttribute("aria-owns"));
        if (visible(linked)) return linked;
        return only(Array.from(document.querySelectorAll("[role=listbox]")).filter(visible));
      }, "The SmartFlow dropdown did not open.", guard);
      const option = only(Array.from(list.querySelectorAll("[role=option]")).filter(visible).filter(matches));
      if (!option) throw new Error("SmartFlow does not offer the selected " + field + ".");
      option.click();
    }
    await waitFor(() => parse(displayed(control(editor, field)), field) === target,
      "SmartFlow did not accept the selected " + field + ".", guard);
  }

  function editorButton(editor, pattern) {
    return only(Array.from(editor.querySelectorAll("button, input[type=button], input[type=submit], a"))
      .filter(node => visible(node) && enabled(node) && pattern.test(clean(node.value || node.textContent))));
  }

  function matchesSchedule(editor, values) {
    return Object.keys(fields).every(field => parse(displayed(control(editor, field)), field) === values[field]);
  }

  async function applyRow(row, values, guard, checkSheet) {
    function heading() {
      const tr = document.querySelector("#flowsheetTable tr.pr-item[data-id=" + CSS.escape(row.id) + "]");
      const name = tr?.querySelector(".pr-heading .pb-name");
      if (!visible(name) || clean(name.textContent) !== row.name ||
          tr.matches(".pb-locked, .locked, .discontinued, [data-discontinued=true], [data-discontinued='1']")) {
        throw new Error("The selected row changed or is unavailable.");
      }
      return name;
    }

    async function open() {
      guard();
      if (Array.from(document.querySelectorAll(dialogs)).some(visible)) {
        throw new Error("Close the open SmartFlow editor before applying a schedule.");
      }
      heading().click();
      return waitFor(() => {
        const editor = only(Array.from(document.querySelectorAll(dialogs)).filter(visible));
        if (!editor) return null;
        const title = editor.querySelector("h1, h2, [role=heading]");
        if (clean(title?.textContent) !== row.name) throw new Error("SmartFlow opened a different row editor.");
        if (!control(editor, "hour") || !control(editor, "interval")) throw new Error("Cannot identify both schedule fields.");
        return editor;
      }, "SmartFlow did not open the selected row.", guard);
    }

    async function close(editor, pattern) {
      const button = editorButton(editor, pattern);
      if (!button) throw new Error("The SmartFlow editor action is unavailable.");
      button.click();
      await waitFor(() => !visible(editor), "SmartFlow kept the editor open. Review this row.", guard);
    }

    await checkSheet();
    const editor = await open();
    if (matchesSchedule(editor, values)) {
      await close(editor, /^cancel$/i);
      return;
    }
    const lock = editor.querySelector(".planning-lock-btn:not(.planning-lock-unlocked)");
    if (visible(lock) && enabled(lock)) {
      lock.click();
      await waitFor(() => !visible(lock) || lock.classList.contains("planning-lock-unlocked") ||
        Object.keys(fields).every(field => enabled(control(editor, field))),
      "SmartFlow kept the schedule locked.", guard);
    }
    await setField(editor, "hour", values.hour, guard);
    await setField(editor, "interval", values.interval, guard);
    await checkSheet();
    guard();
    heading();
    if (!visible(editor) || clean(editor.querySelector("h1, h2, [role=heading]")?.textContent) !== row.name ||
        !matchesSchedule(editor, values)) throw new Error("The editor changed before saving.");
    await close(editor, /^(done|save)$/i);
    await checkSheet();
    const saved = await open();
    if (!matchesSchedule(saved, values)) throw new Error("SmartFlow did not confirm the saved schedule. Review this row.");
    await close(saved, /^cancel$/i);
  }

  window.SmartFlowScheduleEditor = { applyRow };
})();
