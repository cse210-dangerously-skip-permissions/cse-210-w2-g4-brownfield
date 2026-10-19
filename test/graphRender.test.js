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
 * The renderer is browser code, so its ES module export is removed before it
 * is evaluated by Node's vm module.
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
    source.replace(
      'export function renderGraph',
      'function renderGraph'
    ) + '\n({ renderGraph });',
    context,
    { filename: 'graphRender.js' }
  );

  return {
    renderGraph: api.renderGraph,
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
// Small DOM doubles let the SVG renderer run under node --test.
function makeNode(tag) {
  return {
    tag, attributes: {}, children: [], textContent: '', style: {},
    classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
  };
}

function findAll(node, match) {
  const found = match(node) ? [node] : [];
  for (const child of node.children) found.push(...findAll(child, match));
  return found;
}

const { renderGraph } = (() => {
  const source = fs.readFileSync(path.join(__dirname, '../graphRender.js'), 'utf8');
  const context = {
    document: {
      createElementNS: (_, tag) => makeNode(tag),
      createElement: tag => makeNode(tag),
    },
  };
  return vm.runInNewContext(
    source.replace(/export function /g, 'function ') + '\n({ renderGraph })', context);
})();

const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
const range = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

function render(overrides = {}) {
  const container = makeNode('div');
  renderGraph({ type: 'scatter', points, ...overrides }, container);
  const svg = container.children[0];
  const grid = findAll(svg, node => node.attributes.class === 'chart-grid')[0];
  return { svg, grid };
}

const gridLines = grid => grid.children.filter(node => node.attributes.class === 'grid-line');
const isVertical = node => node.attributes.x1 === node.attributes.x2;

test('grid is hidden by default', () => {
  assert.equal(render().grid, undefined);
  assert.equal(render({ showGrid: false }).grid, undefined);
});

for (const type of ['scatter', 'line']) {
  test(`${type} chart draws a grid when enabled`, () => {
    const { grid } = render({ type, showGrid: true });
    assert.ok(grid);
    assert.equal(grid.attributes['aria-hidden'], 'true');
    assert.ok(gridLines(grid).length > 0);
  });
}

test('grid lines sit exactly on the axis ticks of a custom range', () => {
  const { grid } = render({ showGrid: true, range });
  const lines = gridLines(grid);
  // x: 0, 5, 10 across the plot area (92 to 768); y: 0, 5, 10 (324 to 52).
  assert.deepEqual(lines.filter(isVertical).map(node => node.attributes.x1), [92, 430, 768]);
  assert.deepEqual(lines.filter(node => !isVertical(node)).map(node => node.attributes.y1), [324, 188, 52]);
});

test('grid lines span the whole plot area', () => {
  const { grid } = render({ showGrid: true, range: range });
  for (const line of gridLines(grid)) {
    if (isVertical(line)) {
      assert.equal(line.attributes.y1, 52);
      assert.equal(line.attributes.y2, 324);
    } else {
      assert.equal(line.attributes.x1, 92);
      assert.equal(line.attributes.x2, 768);
    }
  }
});

test('grid lines match the tick labels when the range is automatic', () => {
  const { svg, grid } = render({ showGrid: true });
  const labels = findAll(svg, node => node.attributes.class === 'tick-label');
  const tickX = labels.filter(node => node.attributes['text-anchor'] === 'middle')
    .map(node => node.attributes.x);
  // Y labels are drawn 4px below their tick so the text is vertically centred.
  const tickY = labels.filter(node => node.attributes['text-anchor'] === 'end')
    .map(node => node.attributes.y - 4);
  const lines = gridLines(grid);
  assert.deepEqual(lines.filter(isVertical).map(node => node.attributes.x1), tickX);
  assert.deepEqual(lines.filter(node => !isVertical(node)).map(node => node.attributes.y1), tickY);
});

test('grid realigns when the axis range changes', () => {
  const narrow = gridLines(render({ showGrid: true, range: range }).grid)
    .filter(isVertical).map(node => node.attributes.x1);
  const wide = gridLines(render({ showGrid: true, range: { ...range, xMax: 20 } }).grid)
    .filter(isVertical).map(node => node.attributes.x1);
  assert.notDeepEqual(wide, narrow);
  assert.equal(wide[0], 92);
  assert.equal(wide.at(-1), 768);
});

test('grid uses the axes color, falling back to the page ink color', () => {
  const custom = render({ showGrid: true, axesColor: '#654321' });
  assert.ok(gridLines(custom.grid).every(node => node.attributes.stroke === '#654321'));
  const defaultGraph = render({ showGrid: true });
  assert.ok(gridLines(defaultGraph.grid).every(node => node.attributes.stroke === 'var(--color-ink, #000000)'));
});

test('grid is drawn behind the axes and data points', () => {
  const { svg, grid } = render({ showGrid: true });
  const gridIndex = svg.children.indexOf(grid);
  const axisIndex = svg.children.findIndex(node => node.tag === 'line');
  const pointIndex = svg.children.findIndex(node => node.attributes.class === 'data-point');
  assert.ok(gridIndex >= 0);
  assert.ok(axisIndex >= 0);
  assert.ok(pointIndex > gridIndex);
  assert.ok(gridIndex < axisIndex);
});

test('grid is drawn on a transparent background too', () => {
  const { svg, grid } = render({ showGrid: true, transparentBackground: true });
  assert.equal(svg.children.some(node => node.attributes.class === 'chart-background'), false);
  assert.ok(grid);
});