import js from "@eslint/js";
import globals from "globals";

// Based on matplotskib's eslint.config.js, adapted for this repo's mix of
// ES modules, classic browser scripts, and CommonJS (server.js, tests).
export default [
  js.configs.recommended,
  // Team style on top of the recommended rules: always === and !==, and no
  // console output in the app. Formatting (quotes, semicolons, indentation)
  // is left to Prettier.
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      eqeqeq: "error",
      "no-console": "error",
    },
  },
  // Classic browser scripts: loaded via <script> tags and sharing top-level
  // globals with the inline scripts in index.html. Each file
  // lists the names it shares in an `/* exported */` comment, which ESLint
  // only honors in script mode.
  {
    files: ["csv_loader.js", "data_processer.js"],
    languageOptions: { sourceType: "script" },
  },
  // graphExport.js intentionally matches control characters to strip them
  // from exported file names (in saveGraph); disable the rule for this file
  // instead of rewriting working export code.
  {
    files: ["graphExport.js"],
    rules: { "no-control-regex": "off" },
  },
  // CommonJS with Node globals: static server, unit tests, Playwright files.
  // They run in a terminal, so they may log with console.
  {
    files: [
      "server.js",
      "coverage-ratchet.js",
      "test/**/*.js",
      "e2e/**/*.js",
      "playwright.config.js",
    ],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "no-console": "off" },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
];
