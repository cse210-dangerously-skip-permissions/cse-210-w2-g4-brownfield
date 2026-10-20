// Beyond these limits the renderer's axis math overflows or the SVG becomes too slow to use.
const MAX_ABS_VALUE = 1e15;
const MAX_ROWS = 10000;
const DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PREFIXED_PATTERN = /^([+-]?)(0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$/;

// Commas inside quotes are not supported.
function splitFields(line) {
    return line.split(",").map(value => {
        const trimmed = value.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed.slice(1, -1).trim();
        }
        return trimmed;
    });
}

// Returns { number, prefixed } or null if the value is not a number.
// Only the format is checked, so overflowing values still parse (to Infinity) and are
// reported as out of range instead of making the first row look like a header.
function parseNumber(value) {
    if (DECIMAL_PATTERN.test(value)) {
        return { number: Number(value), prefixed: false };
    }
    const match = PREFIXED_PATTERN.exec(value);
    if (match) {
        const magnitude = Number(match[2]);
        return { number: match[1] === "-" ? -magnitude : magnitude, prefixed: true };
    }
    return null;
}

function parseCSV(text) {
    if (typeof text !== "string") {
        return {
            success: false,
            error: "Input must be text."
        };
    }
    // Keep original line numbers so messages match the user's file when blank lines are skipped.
    const lines = text
        .split(/\r\n|\n|\r/)
        .map((line, index) => ({ text: line.trim(), number: index + 1 }))
        .filter(line => line.text.length > 0);
    if (lines.length === 0) {
        return {
            success: false,
            error: "CSV must have data."
        };
    }
    const firstRow = splitFields(lines[0].text);
    // Two columns are x,y. Three columns are series,x,y (long format): the first
    // column names the series and the last two are the numbers, so all checks
    // below look at the last two fields only.
    const columnCount = firstRow.length;
    if (columnCount !== 2 && columnCount !== 3) {
        return {
            success: false,
            error: "CSV must have two columns (x,y) or three columns (series,x,y)."
        };
    }
    const hasSeries = columnCount === 3;
    const numericFields = firstRow.slice(-2);
    const hasHeader = parseNumber(numericFields[0]) === null || parseNumber(numericFields[1]) === null;
    let headers;
    let startRow;
    if (hasHeader) {
        if (firstRow.some(field => field === "")) {
            return {
                success: false,
                error: "Every column must have a header."
            };
        }
        headers = {
            x: numericFields[0],
            y: numericFields[1]
        };
        startRow = 1;
        if (lines.length < 2) {
            return {
                success: false,
                error: "CSV has headers but no data."
            };
        }
    } else {
        headers = {
            x: "X",
            y: "Y"
        };
        startRow = 0;
    }
    const warnings = [];
    const rowCount = lines.length - startRow;
    if (rowCount > MAX_ROWS) {
        warnings.push(`CSV has ${rowCount} rows; more than ${MAX_ROWS} may make the chart slow.`);
    }
    const prefixedValues = [];
    const data = [];
    for (let i = startRow; i < lines.length; i++) {
        const rowNumber = lines[i].number;
        const values = splitFields(lines[i].text);
        if (values.length !== columnCount) {
            return {
                success: false,
                error: `Row ${rowNumber} must contain exactly ${columnCount === 2 ? "two" : "three"} values.`
            };
        }
        if (values.some(value => value === "")) {
            return {
                success: false,
                error: `Row ${rowNumber} contains a missing value.`
            };
        }
        const numbers = [];
        for (const value of values.slice(-2)) {
            const parsed = parseNumber(value);
            if (parsed === null) {
                return {
                    success: false,
                    error: `Row ${rowNumber}: "${value}" is not a valid number.`
                };
            }
            if (!Number.isFinite(parsed.number) || Math.abs(parsed.number) > MAX_ABS_VALUE) {
                return {
                    success: false,
                    error: `Row ${rowNumber}: "${value}" is out of range (maximum absolute value ${MAX_ABS_VALUE}).`
                };
            }
            if (parsed.prefixed) {
                prefixedValues.push({ rowNumber, value, number: parsed.number });
            }
            numbers.push(parsed.number);
        }
        // "+ 0" turns -0 into 0
        const point = { x: numbers[0] + 0, y: numbers[1] + 0 };
        if (hasSeries) point.series = values[0];
        data.push(point);
    }
    if (prefixedValues.length > 0) {
        const first = prefixedValues[0];
        warnings.push(
            `${prefixedValues.length} value(s) use hex/octal/binary notation ` +
            `(first: row ${first.rowNumber}, "${first.value}" read as ${first.number}). ` +
            `Use decimal numbers if this was not intended.`
        );
    }
    return {
        success: true,
        headers,
        data,
        warnings
    };
}

// For now, text input has to be in CSV format, we can add more formats if wanted.
function parseTextInput(text) {
    return parseCSV(text);
}
