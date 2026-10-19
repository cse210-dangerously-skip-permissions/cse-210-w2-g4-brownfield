const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  const { grid } = render({ showGrid: true, range: { xMin: 0, xMax: 20, yMin: 0, yMax: 20 } });
  const lines = gridLines(grid);
  // x: 0, 5, 10, 15, 20 across the plot area (92 to 768); y: the same values (324 to 52).
  assert.deepEqual(lines.filter(isVertical).map(node => node.attributes.x1), [92, 261, 430, 599, 768]);
  assert.deepEqual(lines.filter(node => !isVertical(node)).map(node => node.attributes.y1), [324, 256, 188, 120, 52]);
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

// X tick labels are centred under their tick; y labels are right-aligned beside it.
const xTickLabels = svg => findAll(svg, node => node.attributes.class === 'tick-label'
  && node.attributes['text-anchor'] === 'middle');
const yTickLabels = svg => findAll(svg, node => node.attributes.class === 'tick-label'
  && node.attributes['text-anchor'] === 'end');

test('every tick label sits where its value is on the scale', () => {
  const ranges = [
    { xMin: 0, xMax: 10, yMin: -3, yMax: 7 },
    { xMin: 2.5, xMax: 97.3, yMin: 0.1, yMax: 0.4 },
    { xMin: 1e9, xMax: 1e9 + 5, yMin: -0.15, yMax: 0.15 },
  ];
  for (const r of ranges) {
    const { svg } = render({ range: r });
    for (const label of xTickLabels(svg)) {
      const expected = 92 + (Number(label.textContent) - r.xMin) / (r.xMax - r.xMin) * 676;
      assert.ok(Math.abs(label.attributes.x - expected) < 1e-6, `x label ${label.textContent}`);
    }
    for (const label of yTickLabels(svg)) {
      // Y labels are drawn 4px below their tick so the text is vertically centred.
      const expected = 324 - (Number(label.textContent) - r.yMin) / (r.yMax - r.yMin) * 272;
      assert.ok(Math.abs(label.attributes.y - 4 - expected) < 1e-6, `y label ${label.textContent}`);
    }
  }
});

test('an awkward custom range still gets several tick labels', () => {
  const { svg } = render({ range: { xMin: 2.5, xMax: 97.3, yMin: 0, yMax: 10 } });
  assert.deepEqual(xTickLabels(svg).map(node => node.textContent), ['20', '40', '60', '80']);
});

test('tick labels stay distinct for large values with a small range', () => {
  const { svg } = render({ points: [{ x: 1e9, y: 0 }, { x: 1e9 + 5, y: 10 }] });
  const labels = xTickLabels(svg).map(node => node.textContent);
  assert.ok(labels.length >= 2);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes('1000000001'));
});

test('decimal tick labels have no floating point noise', () => {
  const { svg } = render({ range: { xMin: 0.1, xMax: 0.4, yMin: 0, yMax: 0.0003 } });
  assert.deepEqual(xTickLabels(svg).map(node => node.textContent),
    ['0.1', '0.15', '0.2', '0.25', '0.3', '0.35', '0.4']);
  assert.deepEqual(yTickLabels(svg).map(node => node.textContent),
    ['0', '0.00005', '0.0001', '0.00015', '0.0002', '0.00025', '0.0003']);
});
