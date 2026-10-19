const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * Minimal DOM element used by graphRender.js.
 * This intentionally implements only the browser behavior needed by the
 * renderer so the tests can run without adding a DOM library dependency.
 */
function makeElement(tagName) {
  const activeClasses = new Set();

  const element = {
    tagName,
    attributes: {},
    children: [],
    className: '',
    textContent: '',
    style: {},

    setAttribute(name, value) {
      this.attributes[name] = String(value);

      if (name === 'class') {
        this.className = String(value);
      }
    },

    appendChild(child) {
      this.children.push(child);
      return child;
    },

    append(...children) {
      this.children.push(...children);
    },

    replaceChildren(...children) {
      this.children = children;
    },
  };

  element.classList = {
    toggle(name, force) {
      const enabled = force === undefined
        ? !activeClasses.has(name)
        : Boolean(force);

      if (enabled) {
        activeClasses.add(name);
      } else {
        activeClasses.delete(name);
      }

      element.className = [...activeClasses].join(' ');
      return enabled;
    },

    contains(name) {
      return activeClasses.has(name);
    },
  };

  return element;
}

/*
 * Load graphRender.js in an isolated context with the minimal document above.
 * The renderer is browser code, so its ES module exports are removed before it
 * is evaluated by Node's vm module. Every `export function` is stripped (not
 * just renderGraph) so helpers like axisCrossing parse and are returned too.
 */
function setupRenderer() {
  const source = fs.readFileSync(
    path.join(__dirname, '../graphRender.js'),
    'utf8'
  );

  const document = {
    createElement(tagName) {
      return makeElement(tagName);
    },

    createElementNS(namespace, tagName) {
      return makeElement(tagName);
    },
  };

  const context = { document };

  const api = vm.runInNewContext(
    source.replace(/export function /g, 'function ') +
      '\n({ renderGraph, axisCrossing });',
    context,
    { filename: 'graphRender.js' }
  );

  return {
    renderGraph: api.renderGraph,
    axisCrossing: api.axisCrossing,
    container: makeElement('div'),
  };
}

function descendants(node) {
  return node.children.flatMap(child => [
    child,
    ...descendants(child),
  ]);
}

function classNames(element) {
  return (element.attributes.class || element.className || '')
    .split(/\s+/)
    .filter(Boolean);
}

function findByClass(node, className) {
  return descendants(node).filter(element =>
    classNames(element).includes(className)
  );
}

function findByTag(node, tagName) {
  return descendants(node).filter(element =>
    element.tagName === tagName
  );
}

test('shows an empty-state message when there are no valid points', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'line',
    points: [
      null,
      { x: 1, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 2 },
    ],
  }, container);

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].tagName, 'p');
  assert.equal(container.children[0].className, 'chart-empty');
  assert.match(
    container.children[0].textContent,
    /complete X\/Y pair/
  );
});

test('scatter graphs render valid points, labels and configured colors', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'scatter',
    title: 'Example graph',
    points: [
      { x: 2, y: 4 },
      { x: 1, y: 3 },
      { x: 'invalid', y: 8 },
    ],
    pointColor: '#123456',
    axesColor: '#654321',
    backgroundColor: '#ffeecc',
    pointStyle: 'circle',
    xAxisName: 'Time',
    yAxisName: 'Temperature',
  }, container);

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].tagName, 'svg');

  const points = findByClass(container, 'data-point');
  assert.equal(points.length, 2);
  assert.equal(points[0].tagName, 'circle');
  assert.equal(points[0].attributes.fill, '#123456');

  // Scatter graphs must not contain a connecting line.
  assert.equal(findByClass(container, 'data-line').length, 0);

  const title = findByClass(container, 'chart-title');
  assert.equal(title.length, 1);
  assert.equal(title[0].textContent, 'Example graph');

  const axisLabels = findByClass(container, 'axis-label')
    .map(label => label.textContent);

  assert.deepEqual(axisLabels, ['Time', 'Temperature']);

  const background = findByClass(container, 'chart-background');
  assert.equal(background.length, 1);
  assert.equal(background[0].attributes.fill, '#ffeecc');

  const coloredAxisLines = findByTag(container, 'line')
    .filter(line => line.attributes.stroke === '#654321');

  assert.ok(coloredAxisLines.length >= 2);
});

test('each point style produces the expected SVG element', () => {
  const styles = {
    circle: 'circle',
    square: 'rect',
    triangle: 'polygon',
    cross: 'path',
  };

  for (const [pointStyle, expectedTag] of Object.entries(styles)) {
    const { renderGraph, container } = setupRenderer();

    renderGraph({
      type: 'scatter',
      points: [{ x: 1, y: 2 }],
      pointStyle,
      pointColor: '#112233',
    }, container);

    const points = findByClass(container, 'data-point');

    assert.equal(points.length, 1, pointStyle);
    assert.equal(points[0].tagName, expectedTag, pointStyle);
  }
});

test('line graphs sort points by x and use a clipping path', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'line',
    points: [
      { x: 3, y: 30 },
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ],
    lineColor: '#abcdef',
    pointColor: '#123456',
    pointStyle: 'circle',
  }, container);

  const lines = findByClass(container, 'data-line');
  assert.equal(lines.length, 1);

  const graphLine = lines[0];
  assert.equal(graphLine.tagName, 'polyline');
  assert.equal(graphLine.attributes.stroke, '#abcdef');

  const lineXCoordinates = graphLine.attributes.points
    .split(' ')
    .map(coordinate => Number(coordinate.split(',')[0]));

  assert.deepEqual(
    lineXCoordinates,
    [...lineXCoordinates].sort((a, b) => a - b)
  );

  const pointXCoordinates = findByClass(container, 'data-point')
    .map(point => Number(point.attributes.cx));

  assert.deepEqual(
    pointXCoordinates,
    [...pointXCoordinates].sort((a, b) => a - b)
  );

  const clipPaths = findByTag(container, 'clipPath');
  assert.equal(clipPaths.length, 1);

  assert.equal(
    graphLine.attributes['clip-path'],
    `url(#${clipPaths[0].attributes.id})`
  );
});

test('custom ranges hide out-of-range markers while retaining a clipped line', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'line',
    points: [
      { x: -5, y: 0 },
      { x: 0, y: 1 },
      { x: 5, y: 2 },
    ],
    range: {
      xMin: -1,
      xMax: 1,
      yMin: null,
      yMax: null,
    },
  }, container);

  // Only x = 0 is inside the requested X range.
  assert.equal(findByClass(container, 'data-point').length, 1);

  /*
   * The line includes all three points and is clipped to the chart area.
   * This lets line segments enter and leave the visible range naturally.
   */
  const graphLine = findByClass(container, 'data-line')[0];
  const coordinates = graphLine.attributes.points.split(' ');

  assert.equal(coordinates.length, 3);
  assert.match(graphLine.attributes['clip-path'], /^url\(#line-clip-\d+\)$/);
});

test('a single point produces finite SVG coordinates', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'scatter',
    points: [{ x: 5, y: -2 }],
    pointStyle: 'circle',
  }, container);

  const point = findByClass(container, 'data-point')[0];

  assert.equal(Number.isFinite(Number(point.attributes.cx)), true);
  assert.equal(Number.isFinite(Number(point.attributes.cy)), true);

  for (const element of descendants(container)) {
    for (const value of Object.values(element.attributes)) {
      assert.doesNotMatch(String(value), /NaN|Infinity/);
    }
  }
});

test('transparent graphs omit the SVG background rectangle', () => {
  const { renderGraph, container } = setupRenderer();

  renderGraph({
    type: 'scatter',
    points: [{ x: 1, y: 2 }],
    transparentBackground: true,
    backgroundColor: '#aabbcc',
  }, container);

  assert.equal(findByClass(container, 'chart-background').length, 0);
  assert.equal(container.style.backgroundColor, 'transparent');
  assert.equal(
    container.classList.contains('transparent-background'),
    true
  );
});

/* ---------- Grid ---------- */

const gridPoints = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
const gridRange = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

function renderGrid(overrides = {}) {
  const { renderGraph, container } = setupRenderer();
  renderGraph({ type: 'scatter', points: gridPoints, ...overrides }, container);
  const svg = container.children[0];
  const grid = findByClass(svg, 'chart-grid')[0];
  return { svg, grid };
}

const gridLines = grid => grid.children.filter(node => node.attributes.class === 'grid-line');
const isVertical = node => node.attributes.x1 === node.attributes.x2;

// The first two top-level lines are the x axis and the y axis (grid lines sit inside a group).
function axisLines(svg) {
  const [xAxis, yAxis] = svg.children.filter(node => node.tagName === 'line');
  return { xAxis: xAxis.attributes, yAxis: yAxis.attributes };
}

const tickLabels = svg => findByClass(svg, 'tick-label')
  .map(node => node.textContent);

test('grid is hidden by default', () => {
  assert.equal(renderGrid().grid, undefined);
  assert.equal(renderGrid({ showGrid: false }).grid, undefined);
});

for (const type of ['scatter', 'line']) {
  test(`${type} chart draws a grid when enabled`, () => {
    const { grid } = renderGrid({ type, showGrid: true });
    assert.ok(grid);
    assert.equal(grid.attributes['aria-hidden'], 'true');
    assert.ok(gridLines(grid).length > 0);
  });
}

test('grid lines sit exactly on the axis ticks of a custom range', () => {
  const { grid } = renderGrid({ showGrid: true, range: gridRange });
  const lines = gridLines(grid);
  // x: 0, 5, 10 across the plot area (92 to 768); y: 0, 5, 10 (324 to 52).
  assert.deepEqual(lines.filter(isVertical).map(node => Number(node.attributes.x1)), [92, 430, 768]);
  assert.deepEqual(lines.filter(node => !isVertical(node)).map(node => Number(node.attributes.y1)), [324, 188, 52]);
});

test('grid lines span the whole plot area', () => {
  const { grid } = renderGrid({ showGrid: true, range: gridRange });
  for (const line of gridLines(grid)) {
    if (isVertical(line)) {
      assert.equal(Number(line.attributes.y1), 52);
      assert.equal(Number(line.attributes.y2), 324);
    } else {
      assert.equal(Number(line.attributes.x1), 92);
      assert.equal(Number(line.attributes.x2), 768);
    }
  }
});

test('grid lines match the tick labels when the range is automatic', () => {
  const { svg, grid } = renderGrid({ showGrid: true });
  const labels = findByClass(svg, 'tick-label');
  // The data starts at 0, so the padded range dips below 0 and the axes cross at
  // the origin. Both 0 ticks then share one "0" label there instead of one each.
  const originLabels = labels.filter(node => node.textContent === '0');
  assert.equal(originLabels.length, 1);
  const { xAxis, yAxis } = axisLines(svg);
  const tickX = labels.filter(node => node.attributes['text-anchor'] === 'middle')
    .map(node => Number(node.attributes.x))
    .concat(Number(yAxis.x1));
  // Y labels are drawn 4px below their tick so the text is vertically centred.
  const tickY = labels.filter(node => node.attributes['text-anchor'] === 'end' && node !== originLabels[0])
    .map(node => Number(node.attributes.y) - 4)
    .concat(Number(xAxis.y1));
  const lines = gridLines(grid);
  const sorted = values => [...values].sort((a, b) => a - b);
  assert.deepEqual(sorted(lines.filter(isVertical).map(node => Number(node.attributes.x1))), sorted(tickX));
  assert.deepEqual(sorted(lines.filter(node => !isVertical(node)).map(node => Number(node.attributes.y1))), sorted(tickY));
});

test('grid realigns when the axis range changes', () => {
  const narrow = gridLines(renderGrid({ showGrid: true, range: gridRange }).grid)
    .filter(isVertical).map(node => Number(node.attributes.x1));
  const wide = gridLines(renderGrid({ showGrid: true, range: { ...gridRange, xMax: 20 } }).grid)
    .filter(isVertical).map(node => Number(node.attributes.x1));
  assert.notDeepEqual(wide, narrow);
  assert.equal(wide[0], 92);
  assert.equal(wide.at(-1), 768);
});

test('grid uses the axes color, falling back to the page ink color', () => {
  const custom = renderGrid({ showGrid: true, axesColor: '#654321' });
  assert.ok(gridLines(custom.grid).every(node => node.attributes.stroke === '#654321'));
  const defaultGraph = renderGrid({ showGrid: true });
  assert.ok(gridLines(defaultGraph.grid).every(node => node.attributes.stroke === 'var(--color-ink, #000000)'));
});

test('grid is drawn behind the axes and data points', () => {
  const { svg, grid } = renderGrid({ showGrid: true });
  const gridIndex = svg.children.indexOf(grid);
  const axisIndex = svg.children.findIndex(node => node.tagName === 'line');
  const pointIndex = svg.children.findIndex(node => node.attributes.class === 'data-point');
  assert.ok(gridIndex >= 0);
  assert.ok(axisIndex >= 0);
  assert.ok(pointIndex > gridIndex);
  assert.ok(gridIndex < axisIndex);
});

test('grid is drawn on a transparent background too', () => {
  const { svg, grid } = renderGrid({ showGrid: true, transparentBackground: true });
  assert.equal(svg.children.some(node => node.attributes.class === 'chart-background'), false);
  assert.ok(grid);
});

/* ---------- Axis crossing ---------- */

function renderChart(overrides = {}) {
  const { renderGraph, container } = setupRenderer();
  renderGraph({ type: 'scatter', points: gridPoints, ...overrides }, container);
  return container.children[0];
}

test('axes cross at 0 when 0 is in range', () => {
  const { axisCrossing } = setupRenderer();
  assert.equal(axisCrossing({ min: -10, max: 10 }), 0);
  assert.equal(axisCrossing({ min: -10, max: 0 }), 0);
  assert.equal(axisCrossing({ min: 0, max: 10 }), 0);
});

test('axes stay on the low edge when 0 is out of range', () => {
  const { axisCrossing } = setupRenderer();
  assert.equal(axisCrossing({ min: 2, max: 10 }), 2);
  assert.equal(axisCrossing({ min: -10, max: -2 }), -10);
});

test('axes go through the origin for four-quadrant data', () => {
  const svg = renderChart({
    points: [{ x: -5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }, { x: 5, y: -5 }],
  });
  const { xAxis, yAxis } = axisLines(svg);
  // Symmetric data, so the origin is the centre of the plot area.
  assert.equal(Number(xAxis.y1), (52 + 324) / 2);
  assert.equal(Number(yAxis.x1), (92 + 768) / 2);
  // 0 is labelled once at the origin instead of once per axis.
  assert.equal(tickLabels(svg).filter(label => label === '0').length, 1);
  assert.ok(tickLabels(svg).includes('-5'));
});

test('axes stay bottom and left when the range starts at 0', () => {
  const svg = renderChart({ type: 'line', range: gridRange });
  const { xAxis, yAxis } = axisLines(svg);
  assert.equal(Number(xAxis.y1), 324);
  assert.equal(Number(yAxis.x1), 92);
});

test('only the axis whose range contains 0 moves', () => {
  const svg = renderChart({ range: { xMin: -4, xMax: 4, yMin: 2, yMax: 6 } });
  const { xAxis, yAxis } = axisLines(svg);
  assert.equal(Number(xAxis.y1), 324);
  assert.equal(Number(yAxis.x1), (92 + 768) / 2);
  // The x axis is still on the edge, so its 0 label does not hit the y axis.
  assert.ok(tickLabels(svg).includes('0'));
});
