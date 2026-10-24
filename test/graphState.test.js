const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let moduleInstance = 0;

/*
 * graphState.js stores state and subscribers at module scope.
 * Importing a fresh module instance keeps tests isolated from one another.
 */
async function freshGraphState() {
  const url = pathToFileURL(path.join(__dirname, "../graphState.js"));
  // The query string gives a fresh module instance while keeping a real
  // file URL, so coverage is attributed to graphState.js.
  url.search = `instance=${moduleInstance++}`;
  return import(url.href);
}

test("publishes the default graph state", async () => {
  const graphState = await freshGraphState();
  let publishedGraph;

  graphState.subscribeToGraph((graph) => {
    publishedGraph = graph;
  });

  graphState.updateGraph();

  assert.deepEqual(publishedGraph, {
    points: [],
    type: "line",
    title: "",
    pointColor: "#000000",
    lineColor: "#000000",
    axesColor: "#000000",
    backgroundColor: "#ffffff",
    transparentBackground: false,
    showGrid: false,
    pointStyle: "circle",
    xAxisName: "",
    yAxisName: "",
    range: {
      xMin: null,
      xMax: null,
      yMin: null,
      yMax: null,
    },
  });
});

test("setGraphValue updates state and publishes the complete graph", async () => {
  const graphState = await freshGraphState();
  const snapshots = [];

  graphState.subscribeToGraph((graph) => {
    snapshots.push(graph);
  });

  graphState.setGraphValue("title", "Temperature over time");

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].title, "Temperature over time");

  // Updating one property should not remove unrelated graph settings.
  assert.equal(snapshots[0].type, "line");
  assert.deepEqual(snapshots[0].points, []);
  assert.equal(snapshots[0].pointColor, "#000000");
});

test("setGraphValue rejects unknown graph properties", async () => {
  const graphState = await freshGraphState();

  assert.throws(
    () => graphState.setGraphValue("notARealSetting", "value"),
    /does not exist in graph/,
  );
});

test("published snapshots cannot mutate the stored graph state", async () => {
  const graphState = await freshGraphState();
  const snapshots = [];

  graphState.subscribeToGraph((graph) => {
    snapshots.push(graph);
  });

  graphState.setGraphValue("points", [{ x: 1, y: 2 }]);

  // Simulate a subscriber accidentally modifying its received snapshot.
  snapshots[0].points[0].x = 999;
  snapshots[0].points.push({ x: 3, y: 4 });

  graphState.updateGraph();

  assert.deepEqual(snapshots[1].points, [{ x: 1, y: 2 }]);
});

test("all subscribers are notified after an update", async () => {
  const graphState = await freshGraphState();
  let firstSubscriberCalls = 0;
  let secondSubscriberCalls = 0;

  graphState.subscribeToGraph(() => {
    firstSubscriberCalls++;
  });

  graphState.subscribeToGraph(() => {
    secondSubscriberCalls++;
  });

  graphState.setGraphValue("type", "scatter");

  assert.equal(firstSubscriberCalls, 1);
  assert.equal(secondSubscriberCalls, 1);
});
