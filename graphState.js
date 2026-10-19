//default value of the graph
const graph = {
  points: [],
  type: 'line',
  title: '',
  pointColor: '#000000',
  lineColor: '#000000',
  axesColor: '#000000',
  backgroundColor: '#ffffff',
  transparentBackground: false,
  showGrid: false,
  pointStyle: 'circle',
  xAxisName: '',
  yAxisName: '',
  range: { xMin: null, xMax: null, yMin: null, yMax: null },
};

const subscribers = [];

/**
 * 
 * @param {function} subscriber function to be called whenever graph changes
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
  if (!Object.hasOwn(graph, key)) throw new Error(`value does not exist in graph`);
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
