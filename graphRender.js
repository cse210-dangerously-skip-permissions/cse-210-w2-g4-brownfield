const SVG_NS = "http://www.w3.org/2000/svg";
const CHART = { width: 800, height: 400, margin: { top: 52, right: 32, bottom: 76, left: 92 } };
// Used only when a CSV has a series column; a single series keeps the user's colors.
const SERIES_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd", "#8c564b"];
let clipIdCounter = 0;

/**
 * Groups points by their series name, keeping first-appearance order.
 * Points without a series (two-column CSV or the data table) form one unnamed group.
 * @param {Object[]} points
 * @returns {Map<string, Object[]>}
 */
function groupBySeries(points) {
  const groups = new Map();
  for (const point of points) {
    const name = point.series ?? "";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(point);
  }
  return groups;
}

/** Picks a color for a series: the user's color for one series, a fixed palette for many. */
function seriesColor(index, seriesCount, fallback) {
  return seriesCount > 1 ? SERIES_COLORS[index % SERIES_COLORS.length] : fallback;
}

/** Draws a legend in the top-right corner of the plot area, one row per series. */
function drawLegend(svg, names, colorFor) {
  const { width, margin } = CHART;
  const right = width - margin.right - 8;
  names.forEach((name, i) => {
    const y = margin.top + 10 + i * 20;
    svg.appendChild(svgElement("rect", { x: right - 12, y: y - 10, width: 12, height: 12, fill: colorFor(i) }));
    addText(svg, name, right - 18, y, { "text-anchor": "end", class: "legend-label" });
  });
}

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
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
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
  const decimals = Math.min(100, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
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
  return Math.max(...ticks.map(tick => formatTick(tick).length));
}

/**
 * Finds the start, end, and labels for one axis.
 * We leave a little room around the points so they do not touch the edge.
 * @param {Object[]} points The points currently in the graph.
 * @param {string} key Use "x" for the horizontal axis or "y" for the vertical axis.
 * @param {?number} requestedMin A minimum entered in the UI, if there is one.
 * @param {?number} requestedMax Same above（but it's mamimum)
 * @returns {{min: number, max: number, ticks: number[]}} The axis limits and labels.
 */
function calculateBounds(points, key, requestedMin, requestedMax) {
  const values = points.map(point => point[key]);
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
    if (Number.isFinite(requestedMin) && !Number.isFinite(requestedMax)) max = min + padding;
    else if (!Number.isFinite(requestedMin) && Number.isFinite(requestedMax)) min = max - padding;
    else { min -= padding; max += padding; }
  }

  // Labels are about 10px per character at the tick font size. When the x
  // labels are too wide to fit side by side, use the next nice step instead.
  const roomPerLabel = key === "x" ? (CHART.width - CHART.margin.left - CHART.margin.right) : Infinity;
  let tickStep = niceStep(max - min);
  let ticks = buildTicks(min, max, tickStep);
  while (ticks.length > 2 && ticks.length * (longestLabel(ticks) * 10 + 12) > roomPerLabel) {
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
function createScale(min, max, pixelMin, pixelMax, invert = false) {
  return value => {
    const ratio = (value - min) / (max - min);
    return invert ? pixelMax - ratio * (pixelMax - pixelMin) : pixelMin + ratio * (pixelMax - pixelMin);
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function addText(svg, text, x, y, attributes = {}) {
  const element = svgElement("text", { x, y, ...attributes });
  element.textContent = text;
  svg.appendChild(element);
}

// Ticks are already rounded to their step, so print them in full. Cutting
// them to a few significant digits made labels like 1000000001 and
// 1000000002 both show as 1000000000.
function formatTick(value) {
  return String(value);
}

/**
 * Draws light grid lines at every axis tick so the grid matches the tick labels exactly.
 * Call before drawing the axes and points so the grid sits behind them.
 * @param {SVGSVGElement} svg The chart SVG.
 * @param {{ticks: number[]}} xBounds Bounds and tick values for the x axis.
 * @param {{ticks: number[]}} yBounds Bounds and tick values for the y axis.
 * @param {(value: number) => number} scaleX Turns an x value into an SVG x position.
 * @param {(value: number) => number} scaleY Turns a y value into an SVG y position.
 * @param {Object} graph Graph settings from graphState.js.
 */
function drawGrid(svg, xBounds, yBounds, scaleX, scaleY, graph) {
  if (!graph.showGrid) return;
  const { width, height, margin } = CHART;
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const axesColor = graph.axesColor || "var(--color-ink, #000000)";
  const group = svgElement("g", { class: "chart-grid", "aria-hidden": "true" });

  for (const tick of xBounds.ticks) {
    const x = scaleX(tick);
    group.appendChild(svgElement("line", {
      x1: x, y1: top, x2: x, y2: bottom, stroke: axesColor, class: "grid-line"
    }));
  }
  for (const tick of yBounds.ticks) {
    const y = scaleY(tick);
    group.appendChild(svgElement("line", {
      x1: left, y1: y, x2: right, y2: y, stroke: axesColor, class: "grid-line"
    }));
  }
  svg.appendChild(group);
}

/**
 * Finds where the other axis should cross this one.
 * Axes cross at 0 when 0 is in range, so graphs with negative values show all
 * four quadrants. Otherwise the axis stays on the low edge like before.
 * @param {{min: number, max: number}} bounds The axis limits.
 * @returns {number} The graph value where the other axis is drawn.
 */
export function axisCrossing(bounds) {
  return bounds.min <= 0 && 0 <= bounds.max ? 0 : bounds.min;
}

/** Draws both axes, their ticks, and the configured axis labels. */
function drawAxes(svg, xBounds, yBounds, scaleX, scaleY, graph) {
  const { width, height, margin } = CHART;
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const axesColor = graph.axesColor || "var(--color-ink, #000000)";
  const axisStyle = { stroke: axesColor, "stroke-width": 2.5 };

  // Screen positions of the x axis (horizontal line) and y axis (vertical line).
  const xAxisY = scaleY(axisCrossing(yBounds));
  const yAxisX = scaleX(axisCrossing(xBounds));
  // When both axes move off the edges, the two 0 labels would land on the axis
  // lines, so they are replaced by one 0 at the origin.
  const originInside = axisCrossing(yBounds) !== yBounds.min && axisCrossing(xBounds) !== xBounds.min;

  svg.appendChild(svgElement("line", { x1: left, y1: xAxisY, x2: right, y2: xAxisY, ...axisStyle }));
  svg.appendChild(svgElement("line", { x1: yAxisX, y1: top, x2: yAxisX, y2: bottom, ...axisStyle }));

  for (const tick of xBounds.ticks) {
    const x = scaleX(tick);
    svg.appendChild(svgElement("line", { x1: x, y1: xAxisY, x2: x, y2: xAxisY + 5, ...axisStyle }));
    if (originInside && tick === 0) continue;
    addText(svg, formatTick(tick), x, xAxisY + 21, { "text-anchor": "middle", class: "tick-label" });
  }

  for (const tick of yBounds.ticks) {
    const y = scaleY(tick);
    svg.appendChild(svgElement("line", { x1: yAxisX - 5, y1: y, x2: yAxisX, y2: y, ...axisStyle }));
    if (originInside && tick === 0) continue;
    addText(svg, formatTick(tick), yAxisX - 9, y + 4, { "text-anchor": "end", class: "tick-label" });
  }

  if (originInside) {
    addText(svg, "0", yAxisX - 9, xAxisY + 21, { "text-anchor": "end", class: "tick-label" });
  }

  addText(svg, graph.xAxisName || "X", (left + right) / 2, height - 12, {
    "text-anchor": "middle", class: "axis-label", fill: axesColor
  });
  addText(svg, graph.yAxisName || "Y", 19, (top + bottom) / 2, {
    "text-anchor": "middle", class: "axis-label", fill: axesColor,
    transform: `rotate(-90 19 ${(top + bottom) / 2})`
  });
}

/** Filters input points and prepares the SVG, scales, and axes. */
function prepareChart(graph, container, title) {
  if (!container || typeof container.replaceChildren !== "function") return null;
  container.classList.toggle('transparent-background', Boolean(graph.transparentBackground));
  container.style.backgroundColor = graph.transparentBackground ? 'transparent' : (graph.backgroundColor || '#ffffff');
  // Each point remembers its position in graph.points so a click on a mark can find its table row.
  const points = Array.isArray(graph.points)
    ? graph.points.map((point, index) => ({ ...point, index }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
  if (points.length === 0) {
    container.replaceChildren();
    const message = document.createElement("p");
    message.className = "chart-empty";
    message.textContent = "Add at least one complete X/Y pair to see the graph.";
    container.appendChild(message);
    return null;
  }

  const { width, height, margin } = CHART;
  const range = graph.range && typeof graph.range === "object" ? graph.range : {};
  const xBounds = calculateBounds(points, "x", range.xMin, range.xMax);
  const yBounds = calculateBounds(points, "y", range.yMin, range.yMax);

  const visiblePoints = points.filter(p =>
    p.x >= xBounds.min && p.x <= xBounds.max &&
    p.y >= yBounds.min && p.y <= yBounds.max
  );

  const scaleX = createScale(xBounds.min, xBounds.max, margin.left, width - margin.right);
  const scaleY = createScale(yBounds.min, yBounds.max, margin.top, height - margin.bottom, true);
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "font-family": "var(--font-body, inherit)",
    "aria-label": graph.title || title
  });

  if (!graph.transparentBackground) {
    svg.appendChild(svgElement('rect', {
      x: 0, y: 0, width, height,
      fill: graph.backgroundColor || '#ffffff', class: 'chart-background',
    }));
  }
  if (graph.title) addText(svg, graph.title, width / 2, 30, { "text-anchor": "middle", class: "chart-title" });
  drawGrid(svg, xBounds, yBounds, scaleX, scaleY, graph);
  drawAxes(svg, xBounds, yBounds, scaleX, scaleY, graph);
  return { svg, points: visiblePoints, allPoints: points, scaleX, scaleY };
}

function drawPoints(svg, points, scaleX, scaleY, graph, color) {
  for (const point of points) {
    const x = scaleX(point.x);
    const y = scaleY(point.y);
    let mark;
    if (graph.pointStyle === "square") {
      mark = svgElement("rect", { x: x - 7, y: y - 7, width: 14, height: 14, fill: color, class: "data-point" });
    } else if (graph.pointStyle === "triangle") {
      mark = svgElement("polygon", { points: `${x},${y - 8} ${x - 7},${y + 6} ${x + 7},${y + 6}`, fill: color, class: "data-point" });
    } else if (graph.pointStyle === "cross") {
      mark = svgElement("path", {
        d: `M ${x - 6} ${y - 6} L ${x + 6} ${y + 6} M ${x + 6} ${y - 6} L ${x - 6} ${y + 6}`,
        stroke: color, class: "data-point data-point-cross"
      });
    } else {
      mark = svgElement("circle", { cx: x, cy: y, r: 7, fill: color, class: "data-point" });
    }
    mark.setAttribute("data-index", point.index);
    // Native SVG tooltip: hover shows which point this is before clicking it.
    const title = svgElement("title");
    title.textContent = `Point ${point.index + 1}${point.series ? ` (${point.series})` : ""}: ${point.x}, ${point.y}. Click to edit.`;
    mark.appendChild(title);
    svg.appendChild(mark);
  }
}

/** Legend only when the data actually has named series. */
function finishChart(chart, container, groups, colorFor) {
  const names = [...groups.keys()];
  if (names.some(name => name !== "")) drawLegend(chart.svg, names, colorFor);
  container.replaceChildren(chart.svg);
}

function renderScatterPlot(graph, container) {
  const chart = prepareChart(graph, container, "Scatter graph");
  if (!chart) return;
  const groups = groupBySeries(chart.points);
  const pointColor = i => seriesColor(i, groups.size, graph.pointColor || "var(--color-ink, #000000)");
  [...groups.values()].forEach((points, i) =>
    drawPoints(chart.svg, points, chart.scaleX, chart.scaleY, graph, pointColor(i)));
  finishChart(chart, container, groups, pointColor);
}

function renderLineChart(graph, container) {
  const chart = prepareChart(graph, container, "Line graph");
  if (!chart) return;

  // Lines use every point so a segment can run off the edge; the clip hides the overflow.
  const allGroups = groupBySeries(chart.allPoints);
  const lineColor = i => seriesColor(i, allGroups.size, graph.lineColor || "var(--color-ink, #000000)");
  const pointColor = i => seriesColor(i, allGroups.size, graph.pointColor || "var(--color-ink, #000000)");
  const { width, height, margin } = CHART;
  const clipId = `line-clip-${++clipIdCounter}`;
  const clipPath = svgElement("clipPath", { id: clipId });
  clipPath.appendChild(svgElement("rect", {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  }));
  chart.svg.appendChild(clipPath);

  [...allGroups.values()].forEach((points, i) => {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length < 2) return;
    const coordinates = sorted
      .map(point => `${chart.scaleX(point.x)},${chart.scaleY(point.y)}`)
      .join(" ");
    chart.svg.appendChild(svgElement("polyline", {
      points: coordinates,
      class: "data-line",
      stroke: lineColor(i),
      "clip-path": `url(#${clipId})`,
    }));
  });

  // Dots: only the ones inside the range, sorted for consistency. Keyed by the
  // same series order as the lines so colors match.
  const visible = groupBySeries(chart.points);
  [...allGroups.keys()].forEach((name, i) => {
    const sorted = [...(visible.get(name) ?? [])].sort((a, b) => a.x - b.x);
    drawPoints(chart.svg, sorted, chart.scaleX, chart.scaleY, graph, pointColor(i));
  });
  finishChart(chart, container, allGroups, lineColor);
}

/**
 * Renders graph state from the UI into the chart container.
 * @param {Object} data Graph settings and point data from graphState.js.
 * @param {Element} container The chart section.
 */
export function renderGraph(data, container) {
  const graph = data && typeof data === "object" ? data : {};
  if (graph.type === "line") return renderLineChart(graph, container);
  return renderScatterPlot(graph, container);
}
