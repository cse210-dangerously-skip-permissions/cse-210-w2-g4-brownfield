//default value of the graph
/**
 * @typedef {Object} GraphState
 * @property {{x: number, y: number, series?: string}[]} points
 * @property {"line" | "scatter"} type
 * @property {string} title
 * @property {string} pointColor
 * @property {string} lineColor
 * @property {string} axesColor
 * @property {string} backgroundColor
 * @property {boolean} transparentBackground
 * @property {boolean} showGrid
 * @property {"circle" | "square" | "triangle" | "cross"} pointStyle
 * @property {string} xAxisName
 * @property {string} yAxisName
 * @property {{
 *   xMin: number | null,
 *   xMax: number | null,
 *   yMin: number | null,
 *   yMax: number | null
 * }} range
 */
/** @type {GraphState} */
const graph = {
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
  range: { xMin: null, xMax: null, yMin: null, yMax: null },
};

/** @type {Array<(graph: GraphState) => void>} */
const subscribers = [];

/**
 * @param {(graph: GraphState) => void} subscriber
 *   Function called whenever the graph changes.
 */
export function subscribeToGraph(subscriber) {
  subscribers.push(subscriber);
}

/**
 *
 * @param {string} key key identifying the correct graph attribute to change
 * @param {*} value new value to set for the specified key
 */
export function setGraphValue(key, value) {
  if (!Object.hasOwn(graph, key))
    throw new Error(`value does not exist in graph`);
  graph[key] = value;
  updateGraph();
}

/**
 * Updates the graph and calls all subscribed functions.
 */
export function updateGraph() {
  const graphCopy = structuredClone(graph);
  for (const subscriber of subscribers) subscriber(graphCopy);
}
