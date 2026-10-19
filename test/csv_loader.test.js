const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(setGraphValue) {
  const parser = fs.readFileSync(path.join(__dirname, '../data_processer.js'), 'utf8');
  const loaderPath = path.join(__dirname, '../csv_loader.js');
  const source = fs.existsSync(loaderPath) ? fs.readFileSync(loaderPath, 'utf8') : '';
  const api = vm.runInNewContext(parser + '\n' + source +
    '\n({ parseCSV, create: typeof createCsvLoader === "function" ? createCsvLoader : undefined })');
  assert.equal(typeof api.create, 'function', 'CSV loading must be available');
  const messages = [];
  const loader = api.create({ parse: api.parseCSV, onStatus: message => messages.push(message), setGraphValue });
  return { loader, messages };
}

function delayedFile(name) {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { file: { name, text: () => promise }, resolve, reject };
}

const csvFile = (text, name = 'data.csv') => new File([text], name, { type: 'text/csv' });

test('loads a real CSV File into parser results', async () => {
  const { loader, messages } = setup();
  const result = await loader.load(csvFile('Time,Temperature\n1,72\n2,75'));
  assert.equal(result.success, true);
  assert.equal(result.headers.x, 'Time');
  assert.equal(result.data.length, 2);
  assert.equal(result.data[1].y, 75);
  assert.match(messages[0], /Reading/);
  assert.match(messages.at(-1), /Parsed 2 points/);
});

test('reports parser errors instead of returning partial successful data', async () => {
  const { loader, messages } = setup();
  const result = await loader.load(csvFile('x,y\n1,'));
  assert.equal(result.success, false);
  assert.equal(result.data, undefined);
  assert.match(messages.at(-1), /missing value/);
});

test('shows warnings while returning successful points', async () => {
  const { loader, messages } = setup();
  const result = await loader.load(csvFile('x,y\n0x10,5'));
  assert.equal(result.data[0].x, 16);
  assert.match(messages.at(-1), /Warning:.*hex/);
});

test('handles a failed file read without rejecting the event handler', async () => {
  const { loader, messages } = setup();
  const failed = delayedFile('unreadable.csv');
  const pending = loader.load(failed.file);
  failed.reject(new Error('Cannot read file'));
  assert.equal(await pending, null);
  assert.match(messages.at(-1), /Unable to read/);
});

test('cancelled file selection preserves existing feedback', async () => {
  const { loader, messages } = setup();
  await loader.load(csvFile('1,2'));
  const before = [...messages];
  assert.equal(await loader.load(null), null);
  assert.deepEqual(messages, before);
});

test('the same file can be loaded more than once', async () => {
  const { loader } = setup();
  const file = csvFile('1,2');
  assert.equal((await loader.load(file)).data[0].x, 1);
  assert.equal((await loader.load(file)).data[0].y, 2);
});

test('an older successful read cannot replace a newer result or feedback', async () => {
  const { loader, messages } = setup();
  const old = delayedFile('old.csv');
  const pending = loader.load(old.file);
  const current = await loader.load(csvFile('3,4', 'new.csv'));
  const before = [...messages];
  old.resolve('1,2');
  assert.equal(await pending, null);
  assert.equal(current.data[0].x, 3);
  assert.deepEqual(messages, before);
});

test('an older failed read cannot replace newer success feedback', async () => {
  const { loader, messages } = setup();
  const old = delayedFile('old.csv');
  const pending = loader.load(old.file);
  await loader.load(csvFile('3,4'));
  const before = [...messages];
  old.reject(new Error('Old read failed'));
  assert.equal(await pending, null);
  assert.deepEqual(messages, before);
});

test('manual input invalidates a pending read and clears file feedback', async () => {
  const { loader, messages } = setup();
  const old = delayedFile('old.csv');
  const pending = loader.load(old.file);
  loader.cancel();
  assert.equal(messages.at(-1), '');
  old.resolve('1,2');
  assert.equal(await pending, null);
  assert.equal(messages.at(-1), '');
});

test('a successful load clears previous error feedback', async () => {
  const { loader, messages } = setup();
  await loader.load(csvFile('x,y\n1,'));
  await loader.load(csvFile('1,2'));
  assert.match(messages.at(-1), /Parsed 1 points/);
  assert.doesNotMatch(messages.at(-1), /missing value|Warning:/);
});

let graphInstance = 0;
async function setupGraph() {
  const source = fs.readFileSync(path.join(__dirname, '../graphState.js'), 'utf8');
  const graphState = await import('data:text/javascript;base64,' +
    Buffer.from(source).toString('base64') + '#' + graphInstance++);
  const snapshots = [];
  graphState.subscribeToGraph(graph => snapshots.push(graph));
  graphState.updateGraph();
  return { ...setup(graphState.setGraphValue), graphState, snapshots };
}

test('publishes numeric points and headers while preserving plotting settings', async () => {
  const { loader, graphState, snapshots } = await setupGraph();
  const settings = {
    type: 'scatter', title: 'My chart', pointColor: '#123456',
    lineColor: '#abcdef', axesColor: '#654321', pointStyle: 'square',
    backgroundColor: '#aabbcc', transparentBackground: true, showGrid: true,
    range: { xMin: -10, xMax: 10, yMin: null, yMax: 100 },
  };
  for (const [key, value] of Object.entries(settings)) graphState.setGraphValue(key, value);
  const before = snapshots.length;
  await loader.load(csvFile('Time,Temperature\n3,8\n1,4\n3,9'));
  const graph = snapshots.at(-1);
  assert.deepEqual(graph.points, [{ x: 3, y: 8 }, { x: 1, y: 4 }, { x: 3, y: 9 }]);
  assert.equal(graph.xAxisName, 'Time');
  assert.equal(graph.yAxisName, 'Temperature');
  for (const [key, value] of Object.entries(settings)) assert.deepEqual(graph[key], value);
  assert.equal(snapshots.length - before, 3);
  assert.deepEqual(Object.keys(graph).sort(), [
    'points', 'type', 'title', 'pointColor', 'lineColor', 'axesColor',
    'pointStyle', 'xAxisName', 'yAxisName', 'range',
    'backgroundColor', 'transparentBackground', 'showGrid',
  ].sort());
});

test('CSV without headers replaces old axis names with X and Y', async () => {
  const { loader, snapshots } = await setupGraph();
  await loader.load(csvFile('Time,Temp\n1,2'));
  await loader.load(csvFile('3,4'));
  assert.equal(snapshots.at(-1).xAxisName, 'X');
  assert.equal(snapshots.at(-1).yAxisName, 'Y');
  assert.deepEqual(snapshots.at(-1).points, [{ x: 3, y: 4 }]);
});

test('invalid CSV never changes previously valid points or axis names', async () => {
  const { loader, snapshots } = await setupGraph();
  await loader.load(csvFile('Time,Temp\n5,6'));
  const count = snapshots.length;
  const valid = snapshots.at(-1);
  for (const invalid of ['x,y\n1,', 'x,y\n1,oops', 'x,y,z\n1,2,3', 'x,y\n1,1e16']) {
    assert.equal((await loader.load(csvFile(invalid))).success, false);
    assert.equal(snapshots.length, count);
    assert.deepEqual(snapshots.at(-1), valid);
  }
});

test('warnings still publish converted points without adding feedback to graph', async () => {
  const { loader, snapshots, messages } = await setupGraph();
  await loader.load(csvFile('x,y\n0x10,-0b11'));
  assert.deepEqual(snapshots.at(-1).points, [{ x: 16, y: -3 }]);
  assert.match(messages.at(-1), /Warning:/);
  assert.equal(Object.hasOwn(snapshots.at(-1), 'warnings'), false);
});

test('an outdated CSV read cannot publish over a newer CSV graph', async () => {
  const { loader, snapshots } = await setupGraph();
  const old = delayedFile('old.csv');
  const pending = loader.load(old.file);
  await loader.load(csvFile('NewX,NewY\n3,4'));
  const count = snapshots.length;
  old.resolve('OldX,OldY\n1,2');
  assert.equal(await pending, null);
  assert.equal(snapshots.length, count);
  assert.equal(snapshots.at(-1).xAxisName, 'NewX');
  assert.deepEqual(snapshots.at(-1).points, [{ x: 3, y: 4 }]);
});

test('manual edits stop pending CSV from replacing graph points', async () => {
  const { loader, graphState, snapshots } = await setupGraph();
  const old = delayedFile('old.csv');
  const pending = loader.load(old.file);
  loader.cancel();
  graphState.setGraphValue('points', [{ x: 7, y: 8 }]);
  const count = snapshots.length;
  old.resolve('FileX,FileY\n1,2');
  assert.equal(await pending, null);
  assert.equal(snapshots.length, count);
  assert.deepEqual(snapshots.at(-1).points, [{ x: 7, y: 8 }]);
});

test('read failure and cancelled selection never change a valid graph', async () => {
  const { loader, snapshots } = await setupGraph();
  await loader.load(csvFile('Time,Temp\n5,6'));
  const count = snapshots.length;
  const failed = delayedFile('unreadable.csv');
  const pending = loader.load(failed.file);
  failed.reject(new Error('Read failed'));
  assert.equal(await pending, null);
  assert.equal(await loader.load(null), null);
  assert.equal(snapshots.length, count);
  assert.deepEqual(snapshots.at(-1).points, [{ x: 5, y: 6 }]);
});
