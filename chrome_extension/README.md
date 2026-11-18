# Smart Flow Sheet Helper

Chrome extension helpers for Smart Flow pages.

On a patient flowsheet, open **Schedule → Select lines**, then check the boxes to the left of the line names on the flowsheet. The compact Schedule panel lists the selected names on one line. To move Attitude, Resp. rate, and Diet from 1 AM to 3 AM every 6 hours, choose **Start at → 3 AM**, **Interval → 6 hours**, and **Clear old highlight → 1 AM**, then apply once. The old hour fills in when the selected rows share a start hour. Choose **Keep** to change only the schedule.

SmartFlow saves each row through its own planning editor. After the updated start and interval appear on the sheet, the helper clears the selected old block if it is still planned, empty, and outside the new schedule. Recorded values, media, and billed cells are preserved. If SmartFlow cannot confirm a save, the batch stops at that row. Applying again can finish a pending highlight change.

Load `chrome_extension` as an unpacked extension. On a Smart Flow page, the content script exposes:

```js
SmartFlowExt.inspect()
SmartFlowExt.getPatientPanel()
SmartFlowExt.getCurrentHour()
SmartFlowExt.getFlowsheetTable()
SmartFlowExt.getWhiteboardSummary()
SmartFlowExt.findRows("BG")
SmartFlowExt.findEntries("BG", { valuesOnly: true })
SmartFlowExt.latestValue("BG")
SmartFlowExt.getCurrentHourCells()
SmartFlowExt.getHighlightedCells()
SmartFlowExt.getBloodGlucoseResults()
SmartFlowExt.formatBloodGlucoseResults()
SmartFlowExt.getBloodPressureResults()
SmartFlowExt.formatBloodPressureResults()
SmartFlowExt.getFluidRateSummary(90)
SmartFlowExt.getTechNotes()
SmartFlowExt.formatTechNotes()
SmartFlowExt.getTechNotesSummary()
```

The helpers support the current React site at `app.smartflowsheet.com` and the older Angular site. Patient and treatment metadata use the current component data when available; rendered DOM text, classes, colors, and current-time ribbon geometry supply the visible sheet values. On the React site, Notes and Controlled Meds use Smart Flow's read-only API endpoints with the existing signed-in session. Controlled Meds filters the API patient list to the visible whiteboard, or the current patient on a patient page, before loading sheets; an incomplete or failed response is reported as an error rather than an empty schedule.
Value notation parsing lives in `src/value-parsers.js` so it can be reused by future tabs and tools.

The extension panel opens in the bottom-left. Its top-right minimize button collapses it to a small `SF` launcher in the same corner, and the centered `Refresh` button at the bottom manually refreshes the active tab. The active tab also refreshes after Smart Flow navigation, after a delayed patient/sheet load finishes, and when the selected sheet day changes; a full page reload reinitializes it, and while minimized the navigation refresh waits until the panel is reopened. Other same-page data changes wait for manual Refresh. Vitals shows Blood Glucose and Blood Pressure panes side by side, each with its own grouped copy list. Fluids uses a compact patient-to-maintenance-to-target flow; each calculation keeps its controls, formula, hourly rate, and daily total together without an internal scrollbar. Notes copies all patient tech notes newest-to-oldest and refreshes when the Notes tab or Smart Flow's native Notes button is opened. Controlled Meds omits treatments after their Smart Flow discontinuation time.

After updating the unpacked extension, reload it in Chrome's Extensions page and refresh the Smart Flow tab to load the new scripts.

Example:

```js
SmartFlowExt.latestValue("BG")
```

returns the latest visible Blood Glucose-style entry with its row, value, hour label, and recorded timestamp when the page data exposes one.

```js
SmartFlowExt.formatBloodGlucoseResults()
```

returns text in this shape:

```text
05/17/2026
7 PM: 55 mg/dL, IV
8 PM: 77 mg/dL, Libre
9 PM: Too High To Read
```

```js
SmartFlowExt.formatBloodPressureResults()
```

returns text in this shape:

```text
05/17/2026
7 PM: 95/101 (MAP 50), #5, Left Hind Limb
8 PM: 95 systolic, Doppler
```

```js
SmartFlowExt.getFluidRateSummary(90)
```

returns patient-weight-based fluid estimates. Dog maintenance uses `132 * kg^0.75`; cat maintenance uses `80 * kg^0.75`. The target argument can also be `{ mode: "hour", mlKgHour: 3.5 }`; target `mL/kg/day` displays as a whole number and target `mL/kg/hr` displays to the nearest tenth.

```js
SmartFlowExt.formatTechNotes()
```

fetches the current patient's notes when possible, then falls back to Smart Flow's cached or currently rendered notes. It returns text in this shape:

```text
Thursday, 06/04/2026
- 6:08 PM - P is in right lateral down and sedate.
- 3:26 PM - P had a 2nd degree AV block during surgery prep.
```

Future extension UI can call the same reader through the bridge:

```js
chrome.tabs.sendMessage(tabId, {
  type: "smartflow-helper",
  method: "latestValue",
  args: ["BG"]
})
```
