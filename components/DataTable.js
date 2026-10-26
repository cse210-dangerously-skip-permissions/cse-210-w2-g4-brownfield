const doNothing = () => {};

/**
 * The data table, with methods the page calls when the graph state changes.
 * @typedef {HTMLDivElement & {
 *   setPoints: (points: {x: number, y: number, series?: string}[]) => void,
 *   focusRow: (pointIndex: number) => void,
 *   setAxisNames: (xName: string, yName: string) => void,
 * }} DataTableElement
 */

// Loaded CSVs show this many rows until the user asks for all of them.
const COLLAPSED_ROWS = 10;

/**
 * Builds a numeric input element for an axis coordinate cell.
 * @param {string} axis - The axis name identifier ('X' or 'Y').
 * @param {number} rowNumber - The row index/number for accessibility labeling.
 * @returns {HTMLInputElement} The constructed number input DOM element.
 */
function createNumberInput(axis, rowNumber) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.setAttribute("aria-label", `${axis} ${rowNumber}`);
  return input;
}

/**
 * Builds a data table for graphing.
 * @param {Object} [options={}] - The callback configuration object.
 * @param {Function} [options.onPointsChange=doNothing] - Callback triggered when any point value changes.
 * @param {number} [options.startingRowCount=3] - The number of rows to start with.
 * @returns {DataTableElement} The constructed DOM.
 */
export function DataTable({
  onPointsChange = doNothing,
  startingRowCount = 3,
} = {}) {
  const dataTable = /** @type {DataTableElement} */ (
    document.createElement("div")
  );
  dataTable.className = "data-table";
  dataTable.innerHTML = `
    <div class="table-scroll">
      <table class="coordinate-table">
        <thead>
          <tr><th class="series-header" hidden>Series</th><th>X axis</th><th>Y axis</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
    <button type="button" class="show-all" hidden></button>
    <button type="button" class="add-row">Add row</button>
  `;
  const tableBody = dataTable.querySelector("tbody");
  /** @type {HTMLButtonElement} */
  const showAllButton = dataTable.querySelector(".show-all");
  const [seriesHeader, xHeader, yHeader] = dataTable.querySelectorAll("th");
  let expanded = false;

  // Hide rows past the limit unless expanded; the button toggles between the two.
  function applyCollapse() {
    const rows = [...tableBody.rows];
    rows.forEach((row, i) => {
      row.hidden = !expanded && i >= COLLAPSED_ROWS;
    });
    showAllButton.hidden = rows.length <= COLLAPSED_ROWS;
    showAllButton.textContent = expanded
      ? `Show first ${COLLAPSED_ROWS} rows`
      : `Show all ${rows.length} rows`;
  }

  // Series names come only from a three-column CSV, so they are shown read-only.
  function addRow(series) {
    const rowNumber = tableBody.rows.length + 1;
    const row = tableBody.insertRow();
    if (series !== undefined) {
      row.insertCell().textContent = series;
      row.dataset.series = series;
    }
    for (const axis of ["X", "Y"]) {
      row.insertCell().append(createNumberInput(axis, rowNumber));
    }
    return row;
  }

  // Rows with both values filled, in order: the same rows readPoints turns into points.
  function completeRows() {
    return [...tableBody.rows].filter((row) =>
      [...row.querySelectorAll("input")].every((input) => input.value !== ""),
    );
  }

  // Read every valid row-pair into a list
  function readPoints() {
    return completeRows()
      .map((row) => ({
        series: row.dataset.series,
        inputs: row.querySelectorAll("input"),
      }))
      .map(({ series, inputs: [xInput, yInput] }) => {
        const point = { x: Number(xInput.value), y: Number(yInput.value) };
        if (series !== undefined) point.series = series;
        return point;
      })
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  // Checking if two lists of points have the same points
  function samePoints(a, b) {
    return (
      a.length === b.length &&
      a.every(
        (point, i) =>
          point.x === b[i].x &&
          point.y === b[i].y &&
          point.series === b[i].series,
      )
    );
  }

  // rebuild data table from points only when they differ from the current ppoits
  dataTable.setPoints = function (points) {
    if (samePoints(points, readPoints())) return;
    tableBody.replaceChildren();
    seriesHeader.hidden = !points.some((point) => point.series !== undefined);
    for (const point of points) {
      const [xInput, yInput] = addRow(point.series).querySelectorAll("input");
      xInput.value = String(point.x);
      yInput.value = String(point.y);
    }
    expanded = false;
    applyCollapse();
  };

  // Jump to the row behind the nth point (as numbered by readPoints), expanding if hidden.
  dataTable.focusRow = function (pointIndex) {
    const row = completeRows()[pointIndex];
    if (!row) return;
    if (row.hidden) {
      expanded = true;
      applyCollapse();
    }
    tableBody.querySelector(".selected-row")?.classList.remove("selected-row");
    row.classList.add("selected-row");
    row.scrollIntoView({ block: "center" });
    row.querySelector("input").focus();
  };

  // Column headers show the axis names or "X axis" / "Y axis" if empty
  dataTable.setAxisNames = function (xName, yName) {
    xHeader.textContent = xName || "X axis";
    yHeader.textContent = yName || "Y axis";
  };

  for (let i = 0; i < startingRowCount; i++) addRow();
  dataTable.querySelector(".add-row").addEventListener("click", () => addRow());
  showAllButton.addEventListener("click", () => {
    expanded = !expanded;
    applyCollapse();
  });
  tableBody.addEventListener("input", () => onPointsChange(readPoints()));

  return dataTable;
}
