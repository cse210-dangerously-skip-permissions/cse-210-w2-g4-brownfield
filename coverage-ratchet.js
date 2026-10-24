// Runs the unit tests with coverage and fails if coverage is below
// coverage-baseline.json, or above it without the baseline being raised.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-exclude=test/**",
    "--test-coverage-exclude=e2e/**",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=lcov.info",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const sums = {};
for (const line of fs.readFileSync("lcov.info", "utf8").split("\n")) {
  const [key, value] = line.split(":");
  if (["LF", "LH", "BRF", "BRH", "FNF", "FNH"].includes(key)) {
    sums[key] = (sums[key] ?? 0) + Number(value);
  }
}
/**
 * Converts hit/found counts into a percentage, rounded down to two decimals,
 * so a tiny drop can't round up and pass the check.
 * @param {number} hit
 * @param {number} found
 * @returns {number}
 */
const pct = (hit, found) => Math.floor((hit / found) * 10000) / 100;
const current = {
  lines: pct(sums.LH, sums.LF),
  branches: pct(sums.BRH, sums.BRF),
  functions: pct(sums.FNH, sums.FNF),
};
const baseline = JSON.parse(fs.readFileSync("coverage-baseline.json", "utf8"));

console.log("\nBaseline:", baseline, "\nCurrent: ", current);
for (const metric of Object.keys(current)) {
  if (current[metric] < baseline[metric]) {
    console.error(`Coverage dropped (${metric}). Add tests.`);
    process.exit(1);
  }
  if (current[metric] > baseline[metric]) {
    console.error(
      "Coverage went up. Set coverage-baseline.json to the current numbers.",
    );
    process.exit(1);
  }
}
