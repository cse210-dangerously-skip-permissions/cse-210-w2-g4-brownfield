const SVG_NS = "http://www.w3.org/2000/svg";
const CHART = { width: 800, height: 400, margin: { top: 52, right: 32, bottom: 76, left: 92 } };
let clipIdCounter = 0;

/**
 * Chooses a simple number to put between each pair of tick marks.
 * This keeps the axis from being filled with messy decimal numbers.
 * @param {number} range The size of the axis range.
 * @returns {number} The gap between tick marks.
 */
function niceStep(range) {
  const roughStep = range / 4;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
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
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (Number.isFinite(requestedMin)) min = requestedMin;
  if (Number.isFinite(requestedMax)) max = requestedMax;
  if (max <= min) {
    const padding = Math.max(Math.abs(min) * 0.1, 1);
    if (Number.isFinite(requestedMin) && !Number.isFinite(requestedMax)) max = min + padding;
    else if (!Number.isFinite(requestedMin) && Number.isFinite(requestedMax)) min = max - padding;
    else { min -= padding; max += padding; }
  }

  const tickStep = niceStep(max - min);
  const ticks = [];
  // Start at the first clean label inside the range. The limit prevents a bad
  // range from creating an endless list of labels.
  for (let value = Math.ceil(min / tickStep) * tickStep, i = 0;
    value <= max + tickStep * 1e-8 && i < 100; value += tickStep, i++) {
    ticks.push(Number(value.toPrecision(12)));
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

function formatTick(value) {
  return Number(value.toPrecision(6)).toString();
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

// Preserve the shared axes and scale behavior used by the existing renderer.
/** Draws both axes, their ticks, and the configured axis labels. */
function drawAxes(svg, xBounds, yBounds, scaleX, scaleY, graph) {
  const { width, height, margin } = CHART;
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const axesColor = graph.axesColor || "var(--color-ink, #000000)";
  const axisStyle = { stroke: axesColor, "stroke-width": 2.5 };

  svg.appendChild(svgElement("line", { x1: left, y1: bottom, x2: right, y2: bottom, ...axisStyle }));
  svg.appendChild(svgElement("line", { x1: left, y1: top, x2: left, y2: bottom, ...axisStyle }));

  for (const tick of xBounds.ticks) {
    const x = scaleX(tick);
    svg.appendChild(svgElement("line", { x1: x, y1: bottom, x2: x, y2: bottom + 5, ...axisStyle }));
    addText(svg, formatTick(tick), x, bottom + 21, { "text-anchor": "middle", class: "tick-label" });
  }

  for (const tick of yBounds.ticks) {
    const y = scaleY(tick);
    svg.appendChild(svgElement("line", { x1: left - 5, y1: y, x2: left, y2: y, ...axisStyle }));
    addText(svg, formatTick(tick), left - 9, y + 4, { "text-anchor": "end", class: "tick-label" });
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
  const points = Array.isArray(graph.points)
    ? graph.points.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
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

function drawPoints(svg, points, scaleX, scaleY, graph) {
  const color = graph.pointColor || "var(--color-ink, #000000)";
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
    svg.appendChild(mark);
  }
}

function renderScatterPlot(graph, container) {
  const chart = prepareChart(graph, container, "Scatter graph");
  if (!chart) return;
  drawPoints(chart.svg, chart.points, chart.scaleX, chart.scaleY, graph);
  container.replaceChildren(chart.svg);
}

function renderLineChart(graph, container) {
  const chart = prepareChart(graph, container, "Line graph");
  if (!chart) return;

  const allSorted = [...chart.allPoints].sort((a, b) => a.x - b.x);
  if (allSorted.length > 1) {
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

    const coordinates = allSorted
      .map(point => `${chart.scaleX(point.x)},${chart.scaleY(point.y)}`)
      .join(" ");
    chart.svg.appendChild(svgElement("polyline", {
      points: coordinates,
      class: "data-line",
      stroke: graph.lineColor || "var(--color-ink, #000000)",
      "clip-path": `url(#${clipId})`,
    }));
  }

  // Dots: only the ones inside the range, sorted for consistency.
  const sortedPoints = [...chart.points].sort((a, b) => a.x - b.x);
  drawPoints(chart.svg, sortedPoints, chart.scaleX, chart.scaleY, graph);
  container.replaceChildren(chart.svg);
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
