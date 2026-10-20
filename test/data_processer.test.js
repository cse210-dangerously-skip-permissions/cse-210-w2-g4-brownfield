
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Load the existing browser JavaScript without modifying it.
const source = fs.readFileSync(
    path.join(__dirname, "../data_processer.js"),
    "utf8"
);
const { parseCSV, parseTextInput } = vm.runInThisContext(
    source + "\n({ parseCSV, parseTextInput });"
);

// Test 1: Valid CSV with a good format.
test("parses valid CSV", () => {
    const result = parseCSV("Time,Temperature\n1,72\n2,75");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.headers, {
        x: "Time",
        y: "Temperature"
    });
    assert.deepStrictEqual(result.data, [
        { x: 1, y: 72 },
        { x: 2, y: 75 }
    ]);
    assert.deepStrictEqual(result.warnings, []);
});

// Test 2: Invalid numeric value
test("rejects non-numeric values", () => {
    const result = parseCSV("Time,Temperature\n1,hello"); // invalid value "hello"

    assert.equal(result.success, false);
    assert.match(result.error, /not a valid number/);
});

// Test 3: Missing value
test("rejects missing values", () => {
    const result = parseCSV("Time,Temperature\n1,"); // missing value for Temperature

    assert.equal(result.success, false);
    assert.match(result.error, /missing value/);
});

//Test 4: CSV is empty
test("rejects empty CSV", () => {
    const result = parseCSV("");

    assert.equal(result.success, false);
});

// Test 5: CSV with extra columns
test("rejects CSV with four columns", () => {
    const result = parseCSV("Time,Temperature,Humidity,Wind\n1,72,50,3");

    assert.equal(result.success, false);
    assert.match(result.error, /two columns.*three columns/);
});

// Test 5b: column count is checked in the header row and in every data row
test("rejects one column and rows whose column count differs from the header", () => {
    for (const text of ["Time\n1\n2", "1\n2", "Time,Temperature\n1,72\n2,75,50", "a,x,y\nA,1,2\nA,3"]) {
        const result = parseCSV(text);
        assert.equal(result.success, false, text);
        assert.match(result.error, /two columns|two values|three values/, text);
    }
});

// Test 5c: a long-format CSV (series,x,y) tags each point with its series
test("parses three-column long-format CSV into points with a series", () => {
    const result = parseCSV("agent,day,bugs\nAgent A,1,4\nAgent A,2,7\nAgent B,1,2");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.headers, { x: "day", y: "bugs" });
    assert.deepStrictEqual(result.data, [
        { x: 1, y: 4, series: "Agent A" },
        { x: 2, y: 7, series: "Agent A" },
        { x: 1, y: 2, series: "Agent B" }
    ]);
});

// Test 5d: two-column points have no series key at all
test("two-column points carry no series", () => {
    const result = parseCSV("day,bugs\n1,4\n2,7");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.data, [{ x: 1, y: 4 }, { x: 2, y: 7 }]);
});

// Test 5e: a three-column file with no header is data from the first row
test("parses three columns without a header", () => {
    const result = parseCSV("A,1,4\nB,1,2");

    assert.deepStrictEqual(result.headers, { x: "X", y: "Y" });
    assert.equal(result.data.length, 2);
    assert.equal(result.data[1].series, "B");
});

// Test 5f: a missing series name is a missing value
test("rejects a three-column row with an empty series", () => {
    const result = parseCSV("agent,day,bugs\n,1,4");

    assert.equal(result.success, false);
    assert.match(result.error, /Row 2 contains a missing value/);
});


// Test 6: CSV with Windows line endings
test("handles Windows line endings", () => {
    const result = parseCSV("Time,Temperature\r\n1,72\r\n2,75");

    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);
});


// Test 7: CSV without a header row
test("parses CSV without a header", () => {
    const result = parseCSV("1,2\n3,4");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.headers, { x: "X", y: "Y" });
    assert.equal(result.data.length, 2);
});

// Test 8: only a header row
test("rejects header with no data", () => {
    const result = parseCSV("x,y");

    assert.equal(result.success, false);
    assert.match(result.error, /no data/);
});

// Test 9: negative, decimal, signed and exponent numbers
test("parses negative, decimal and exponent numbers", () => {
    const result = parseCSV("x,y\n-1.5,+2\n.5,5.\n1e3,2E-2");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.data, [
        { x: -1.5, y: 2 },
        { x: 0.5, y: 5 },
        { x: 1000, y: 0.02 }
    ]);
});

// Test 10: -0 is normalised to 0
test("normalises negative zero", () => {
    const result = parseCSV("-0,0");

    assert.equal(Object.is(result.data[0].x, 0), true);
});

// Test 11: whitespace, blank lines and a BOM are ignored
test("ignores whitespace, blank lines and BOM", () => {
    const result = parseCSV("﻿  x , y \n\n 1 , 2 \n\n3,4\n");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.headers, { x: "x", y: "y" });
    assert.equal(result.data.length, 2);
});

// Test 12: a single data point is allowed
test("accepts a single point", () => {
    const result = parseCSV("1,2");

    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);
});

// Test 13: NaN, Infinity, booleans, spaced numbers and malformed prefixes are not numbers
test("rejects NaN, Infinity, booleans, spaced numbers and bad prefixes", () => {
    for (const bad of ["NaN", "Infinity", "true", "1 2", "0x", "0b12", "0xG", "--0x1"]) {
        const result = parseCSV(`x,y\n1,${bad}`);
        assert.equal(result.success, false, bad);
        assert.match(result.error, /not a valid number/, bad);
    }
});

// Test 14: hex, octal and binary numbers are accepted with a warning
test("accepts hex, octal and binary numbers with a warning", () => {
    const result = parseCSV("x,y\n0x10,-0b11\n0o7,5\n1,2");

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.data, [
        { x: 16, y: -3 },
        { x: 7, y: 5 },
        { x: 1, y: 2 }
    ]);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /3 value\(s\).*row 2, "0x10" read as 16/);
});

// Test 14b: a first row of prefixed numbers is data, not a header
test("treats a prefixed first row as data", () => {
    const result = parseCSV("0x1,0x2\n3,4");

    assert.deepStrictEqual(result.headers, { x: "X", y: "Y" });
    assert.equal(result.data.length, 2);
});

// Test 15: a huge number in the first row is an error, not a header
test("treats an overflowing first row as an error, not a header", () => {
    const huge = "9".repeat(400);

    for (const text of [`1,${huge}`, "1,1e309"]) {
        const result = parseCSV(text);
        assert.equal(result.success, false, text);
        assert.match(result.error, /out of range/, text);
    }
});

// Test 16: values beyond the supported range are rejected
test("rejects values beyond the supported range", () => {
    assert.equal(parseCSV("x,y\n1,1e15").success, true);
    assert.equal(parseCSV("x,y\n1,1e16").success, false);
    assert.equal(parseCSV("x,y\n-1e16,1").success, false);
});

// Test 17: error messages use the line numbers of the original text
test("reports original line numbers when blank lines are skipped", () => {
    const result = parseCSV("x,y\n\n1,2\n\n3,oops");

    assert.equal(result.success, false);
    assert.match(result.error, /Row 5/);
});

// Test 18: old Mac line endings (\r only)
test("handles CR-only line endings", () => {
    const result = parseCSV("x,y\r1,2\r3,4");

    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);
});

// Test 19: quoted fields have their quotes removed
test("strips surrounding quotes", () => {
    const result = parseCSV('"x","y"\n"1","2"');

    assert.equal(result.success, true);
    assert.deepStrictEqual(result.headers, { x: "x", y: "y" });
    assert.deepStrictEqual(result.data, [{ x: 1, y: 2 }]);
});

// Test 20: unsupported delimiters and trailing commas
test("rejects other delimiters and trailing commas", () => {
    assert.equal(parseCSV("x;y\n1;2").success, false);
    assert.equal(parseCSV("x\ty\n1\t2").success, false);
    assert.equal(parseCSV("x,y\n1,2,").success, false);
});

// Test 21: non-string input returns an error instead of throwing
test("rejects non-string input", () => {
    for (const bad of [null, undefined, 5, {}]) {
        const result = parseCSV(bad);
        assert.equal(result.success, false);
    }
});

// Test 22: too many rows only produces a warning
test("warns when there are more than 10000 rows", () => {
    const many = Array.from({ length: 10001 }, (_, i) => `${i},${i}`).join("\n");
    const ok = Array.from({ length: 10000 }, (_, i) => `${i},${i}`).join("\n");

    const result = parseCSV(many);
    assert.equal(result.success, true);
    assert.equal(result.data.length, 10001);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /10001 rows/);

    assert.deepStrictEqual(parseCSV(ok).warnings, []);
});

// Test 23: duplicate x values are kept as they are
test("keeps duplicate x values", () => {
    const result = parseCSV("1,2\n1,3");

    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);
});

// Test 24: text box input uses the same rules as CSV
test("parseTextInput behaves like parseCSV", () => {
    assert.deepStrictEqual(parseTextInput("x,y\n3,7\n9,1"), parseCSV("x,y\n3,7\n9,1"));
    assert.equal(parseTextInput("").success, false);
});
