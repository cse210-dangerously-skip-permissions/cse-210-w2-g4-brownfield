import js from "@eslint/js";
import globals from "globals";

// Based on matplotskib's eslint.config.js, adapted for this repo's mix of
// ES modules, classic browser scripts, and CommonJS (server.js, tests).
export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
  },
  // Classic browser scripts: loaded via <script> tags and sharing top-level
  // globals across files (index.html wires createCsvLoader/parseTextInput to
  // the rest of the app), so no-unused-vars is a false positive here.
  {
    files: ["csv_loader.js", "data_processer.js"],
    languageOptions: { sourceType: "script" },
    rules: { "no-unused-vars": "off" },
  },
  // graphExport.js intentionally matches control characters to strip them
  // from exported file names (in saveGraph); disable the rule for this file
  // instead of rewriting working export code.
  {
    files: ["graphExport.js"],
    rules: { "no-control-regex": "off" },
  },
  // CommonJS with Node globals: static server, unit tests, Playwright files.
  {
    files: [
      "server.js",
      "coverage-ratchet.js",
      "test/**/*.js",
      "e2e/**/*.js",
      "playwright.config.js",
    ],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
];
