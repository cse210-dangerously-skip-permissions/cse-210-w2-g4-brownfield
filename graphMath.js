/**
 * Chooses a simple number to put between each pair of tick marks.
 * This keeps the axis from being filled with messy decimal numbers.
 * @param {number} range The size of the axis range.
 * @returns {number} The gap between tick marks.
 */
function niceStep(range) {
  // Round to the closest nice number instead of always rounding up. Rounding
  // up could pick a step almost as big as the range and leave one label.
  const roughStep = range / 5;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / power;
  const niceFraction =
    fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return niceFraction * power;
}

/**
 * Rounds a tick value to the number of decimals its step needs, so floating
 * point noise like 0.30000000000000004 becomes 0.3.
 * @param {number} value The tick value.
 * @param {number} step The gap between tick marks.
 * @returns {number} The rounded tick value.
 */
function roundToStep(value, step) {
  const decimals = Math.min(
    100,
    Math.max(0, -Math.floor(Math.log10(step) + 1e-9)),
  );
  return Number(value.toFixed(decimals));
}

/**
 * Lists the tick values between min and max for one step size.
 * Ticks are whole multiples of the step. Multiplying instead of adding the
 * step each time keeps rounding errors from piling up, and the small tolerance
 * keeps a tick that sits exactly on min or max. The limit prevents a bad range
 * from creating an endless list of labels.
 * @param {number} min Smallest axis value.
 * @param {number} max Largest axis value.
 * @param {number} step The gap between tick marks.
 * @returns {number[]} The tick values.
 */
function buildTicks(min, max, step) {
  const ticks = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let i = first; i <= last && ticks.length < 100; i++) {
    ticks.push(roundToStep(i * step, step));
  }
  return ticks;
}

/** Goes from one nice step to the next bigger one: 1, 2, 5, 10, 20, ... */
function nextNiceStep(step) {
  const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const fraction = Math.round(step / power);
  return (fraction === 1 ? 2 : fraction === 2 ? 5 : 10) * power;
}

/** Number of characters in the longest tick label. */
function longestLabel(ticks) {
  return Math.max(...ticks.map((tick) => formatTick(tick).length));
}

/**
 * Finds the start, end, and labels for one axis.
 * We leave a little room around the points so they do not touch the edge.
 * @param {Object[]} points The points currently in the graph.
 * @param {string} key Use "x" for the horizontal axis or "y" for the vertical axis.
 * @param {?number} requestedMin A minimum entered in the UI, if there is one.
 * @param {?number} requestedMax A maximum entered in the UI, if there is one.
 * @param {number} axisWidth Available horizontal space for tick labels, in pixels.
 * @returns {{min: number, max: number, ticks: number[]}} The axis limits and labels.
 */
export function calculateBounds(
  points,
  key,
  requestedMin,
  requestedMax,
  axisWidth,
) {
  const values = points.map((point) => point[key]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(min) * 0.2, 1);
  min -= span * 0.08;
  max += span * 0.08;

  const step = niceStep(max - min);
  min = roundToStep(Math.floor(min / step) * step, step);
  max = roundToStep(Math.ceil(max / step) * step, step);
  if (Number.isFinite(requestedMin)) min = requestedMin;
  if (Number.isFinite(requestedMax)) max = requestedMax;
  if (max <= min) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    if (Number.isFinite(requestedMin) && !Number.isFinite(requestedMax))
      max = min + padding;
    else if (!Number.isFinite(requestedMin) && Number.isFinite(requestedMax))
      min = max - padding;
    else {
      min -= padding;
      max += padding;
    }
  }

  // Labels are about 10px per character at the tick font size. When the x
  // labels are too wide to fit side by side, use the next nice step instead.
  const roomPerLabel = key === "x" ? axisWidth : Infinity;
  let tickStep = niceStep(max - min);
  let ticks = buildTicks(min, max, tickStep);
  while (
    ticks.length > 2 &&
    ticks.length * (longestLabel(ticks) * 10 + 12) > roomPerLabel
  ) {
    tickStep = nextNiceStep(tickStep);
    ticks = buildTicks(min, max, tickStep);
  }
  return { min, max, ticks };
}

/**
 * Turns a graph value into the right spot on the SVG.
 * SVG counts down from the top, so the y values need to be flipped.
 * @param {number} min Smallest graph value.
 * @param {number} max Largest graph value.
 * @param {number} pixelMin First screen position.
 * @param {number} pixelMax Last screen position.
 * @param {boolean} invert Flip the result for the y axis.
 * @returns {(value: number) => number} A function that turns values into positions.
 */
export function createScale(min, max, pixelMin, pixelMax, invert = false) {
  return (value) => {
    const ratio = (value - min) / (max - min);
    return invert
      ? pixelMax - ratio * (pixelMax - pixelMin)
      : pixelMin + ratio * (pixelMax - pixelMin);
  };
}

/**
 * Prints a tick value in full. Ticks are already rounded to their step, and cutting
 * them to a few significant digits made labels like 1000000001 and 1000000002 both
 * show as 1000000000.
 * @param {number} value Tick value.
 * @returns {string} The label text.
 */
export function formatTick(value) {
  return String(value);
}
