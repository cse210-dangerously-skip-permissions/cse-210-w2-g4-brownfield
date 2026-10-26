/* exported createCsvLoader */
/**
 * Creates a CSV loader that reads a file, parses it, and publishes the result to the graph.
 * Only the most recent load can publish: a newer load or a cancel discards older reads.
 * @param {Object} options - Loader dependencies.
 * @param {(text: string) => any} options.parse - CSV parser, normally parseCSV.
 * @param {(message: string) => void} options.onStatus - Shows progress, errors, and warnings.
 * @param {(key: string, value: any) => void} [options.setGraphValue] - Publishes points and axis names; does nothing if omitted.
 * @returns {{ load: (file: File | null) => Promise<any>, cancel: () => void }} The loader.
 */
function createCsvLoader({ parse, onStatus, setGraphValue = () => {} }) {
  let requestId = 0;

  /**
   * Reads and parses a CSV file, then publishes its points and axis names on success.
   * @param {File | null} file - The selected file; null when selection was cancelled.
   * @returns {Promise<any>} The parse result, including failures, or null if there was
   * no file, the read failed, or a newer load or cancel replaced this one.
   */
  async function load(file) {
    if (!file) return null;
    const currentId = ++requestId;
    onStatus(`Reading ${file.name}...`);
    let text;
    try {
      text = await file.text();
    } catch {
      if (currentId === requestId) {
        onStatus("Unable to read CSV file. Please try again.");
      }
      return null;
    }
    // A newer file or manual edit takes precedence over this read.
    if (currentId !== requestId) return null;
    const result = parse(text);
    if (!result.success) {
      onStatus(result.error);
      return result;
    }
    setGraphValue("points", result.data);
    setGraphValue("xAxisName", result.headers.x);
    setGraphValue("yAxisName", result.headers.y);
    onStatus(
      `Parsed ${result.data.length} points. X: ${result.headers.x}, Y: ${result.headers.y}` +
        result.warnings.map((warning) => ` Warning: ${warning}`).join(""),
    );
    return result;
  }

  /**
   * Discards any pending read and clears the status message. Called on manual edits.
   * @returns {void}
   */
  function cancel() {
    requestId++;
    onStatus("");
  }

  return { load, cancel };
}
