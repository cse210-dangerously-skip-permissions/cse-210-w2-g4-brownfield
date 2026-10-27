const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let calculateBounds, createScale, formatTick;
test.before(async () => {
  ({ calculateBounds, createScale, formatTick } = await import(
    pathToFileURL(path.join(__dirname, "../graphMath.js")).href
  ));
});

// Native module imports run without a document or a simulated DOM.
const points = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
];
const plotWidth = 676;

test("automatic bounds preserve padding and evenly spaced ticks", () => {
  assert.deepEqual(calculateBounds(points, "x", null, null, plotWidth), {
    min: -2,
    max: 12,
    ticks: [-2, 0, 2, 4, 6, 8, 10, 12],
  });
});

test("a single constant value still has a finite padded range", () => {
  assert.deepEqual(calculateBounds([{ x: 5 }], "x", null, null, plotWidth), {
    min: 4.9,
    max: 5.1,
    ticks: [4.9, 4.95, 5, 5.05, 5.1],
  });
});

test("custom bounds keep only whole step multiples inside the range", () => {
  assert.deepEqual(calculateBounds(points, "x", 2.5, 97.3, plotWidth), {
    min: 2.5,
    max: 97.3,
    ticks: [20, 40, 60, 80],
  });
});

test("decimal ticks are rounded without accumulated floating point noise", () => {
  assert.deepEqual(
    calculateBounds(points, "y", 0.1, 0.4, plotWidth).ticks,
    [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
  );
});

test("impossible requested limits retain the existing fallback rules", () => {
  assert.deepEqual(calculateBounds(points, "y", 100, null, plotWidth), {
    min: 100,
    max: 110,
    ticks: [100, 102, 104, 106, 108, 110],
  });
  assert.deepEqual(calculateBounds(points, "y", null, -50, plotWidth), {
    min: -51,
    max: -50,
    ticks: [-51, -50.8, -50.6, -50.4, -50.2, -50],
  });
  assert.deepEqual(calculateBounds(points, "y", 5, 5, plotWidth), {
    min: 4,
    max: 6,
    ticks: [4, 4.5, 5, 5.5, 6],
  });
});

test("horizontal tick density follows the supplied width; vertical ticks ignore it", () => {
  const wide = calculateBounds(points, "x", 0, 10, plotWidth);
  const narrow = calculateBounds(points, "x", 0, 10, 100);
  assert.deepEqual(wide.ticks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(narrow.ticks, [0, 5, 10]);
  assert.deepEqual(calculateBounds(points, "y", 0, 10, 100), wide);
});

test("large nearby tick values retain distinct full labels", () => {
  const bounds = calculateBounds(points, "x", 1e9, 1e9 + 5, plotWidth);
  assert.deepEqual(bounds.ticks.map(formatTick), [
    "1000000000",
    "1000000001",
    "1000000002",
    "1000000003",
    "1000000004",
    "1000000005",
  ]);
});

test("scales map endpoints and intermediate values, including inverted y", () => {
  const x = createScale(-10, 10, 92, 768);
  const y = createScale(-10, 10, 52, 324, true);
  assert.deepEqual([-10, 0, 10].map(x), [92, 430, 768]);
  assert.deepEqual([-10, 0, 10].map(y), [324, 188, 52]);
  assert.equal(x(20), 1106);
  assert.equal(y(20), -84);
});
