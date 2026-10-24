const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Small DOM doubles let the browser-only download boundary run under node --test.
function element(tag, computed = {}) {
  return {
    tag,
    computed,
    attributes: {},
    styles: {},
    children: [],
    textContent: "",
    style: {
      setProperty(key, value) {
        this.owner.styles[key] = value;
      },
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    querySelectorAll() {
      return this.children;
    },
    querySelector(selector) {
      return selector === ".chart-title"
        ? this.children.find((child) => child.tag === "text")
        : null;
    },
    prepend(child) {
      this.children.unshift(child);
    },
    cloneNode() {
      const copy = makeElement(this.tag, this.computed);
      copy.attributes = { ...this.attributes };
      copy.textContent = this.textContent;
      copy.children = this.children.map((child) => child.cloneNode(true));
      return copy;
    },
  };
}
function makeElement(tag, computed) {
  const node = element(tag, computed);
  node.style.owner = node;
  return node;
}
function setup({
  empty = false,
  failClick = false,
  title = "Temperature & Time",
  failImage = false,
  failEncode = false,
  backgroundColor = "#ffffff",
  transparent = false,
  showGrid = false,
} = {}) {
  const svg = makeElement("svg");
  svg.viewBox = { baseVal: { x: 0, y: 0, width: 800, height: 400 } };
  svg.setAttribute("viewBox", "0 0 800 400");
  const label = makeElement("text", { "font-size": "28px" });
  label.textContent = title;
  const line = makeElement("polyline", {
    fill: "none",
    stroke: "rgb(255, 0, 0)",
    "stroke-width": "3.5px",
  });
  line.setAttribute("clip-path", "url(#line-clip-1)");
  const background = makeElement("rect", { fill: backgroundColor });
  background.setAttribute("fill", backgroundColor);
  background.setAttribute("class", "chart-background");
  const gridLine = makeElement("line", {
    stroke: "rgb(101, 67, 33)",
    "stroke-width": "1px",
    "stroke-opacity": "0.2",
  });
  gridLine.setAttribute("class", "grid-line");
  const arrChildren = [label, line];
  if (showGrid) arrChildren.unshift(gridLine);
  if (!transparent) arrChildren.unshift(background);
  svg.children = arrChildren;
  // svg.children = transparent ? [label, line] : [background, label, line];
  const record = { urls: [], revoked: [], removed: 0, clicked: 0, timers: [] };
  const context = {
    Blob,
    Image: class {
      set src(value) {
        if (failImage) this.onerror();
        else this.onload();
      }
    },
    getComputedStyle: (node) => ({
      getPropertyValue: (key) => node.computed[key] || "",
    }),
    XMLSerializer: class {
      serializeToString(node) {
        record.serialized = node;
        return "<svg/>";
      }
    },
    document: {
      createElementNS: (_, tag) => makeElement(tag),
      createElement: (tag) =>
        tag === "canvas"
          ? {
              getContext: () => ({
                fillRect(...args) {
                  record.background = args;
                },
                drawImage(...args) {
                  record.draw = args.slice(1);
                },
              }),
              toBlob(callback, type) {
                callback(failEncode ? null : new Blob(["jpeg"], { type }));
              },
            }
          : {
              click() {
                record.clicked++;
                if (failClick) throw new Error("Download blocked");
              },
              remove() {
                record.removed++;
              },
            },
      body: {
        append(link) {
          record.link = link;
        },
      },
    },
    URL: {
      createObjectURL(blob) {
        record.urls.push(blob);
        return "blob:graph";
      },
      revokeObjectURL(url) {
        record.revoked.push(url);
      },
    },
    setTimeout(callback) {
      record.timers.push(callback);
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../graphExport.js"),
    "utf8",
  );
  const api = vm.runInNewContext(
    source.replace(/export (async )?function /g, "$1function ") +
      "\n({ serializeGraph, saveGraph })",
    context,
    { filename: path.join(__dirname, "../graphExport.js") }, // Naming the script lets coverage attribute lines to the source file
  );
  return {
    ...api,
    svg,
    record,
    container: { querySelector: () => (empty ? null : svg) },
  };
}

test("empty graph reports an actionable error without starting a download", async () => {
  const { saveGraph, container, record } = setup({ empty: true });
  await assert.rejects(saveGraph(container), /complete X\/Y pair/);
  assert.equal(record.urls.length, 0);
});

test("export includes standalone dimensions, background, styles and clipping without mutating the graph", () => {
  const { serializeGraph, svg, record } = setup();
  serializeGraph(svg);
  const copy = record.serialized;
  assert.equal(copy.attributes.xmlns, "http://www.w3.org/2000/svg");
  assert.equal(copy.attributes.width, 800);
  assert.equal(copy.attributes.height, 400);
  assert.equal(copy.attributes.viewBox, "0 0 800 400");
  assert.equal(copy.children[0].attributes.fill, "#ffffff");
  assert.equal(copy.children[1].textContent, "Temperature & Time");
  assert.equal(copy.children[1].styles["font-size"], "28px");
  assert.equal(copy.children[2].styles.fill, "none");
  assert.equal(copy.children[2].styles.stroke, "rgb(255, 0, 0)");
  assert.equal(copy.children[2].styles["stroke-width"], "3.5px");
  assert.equal(copy.children[2].attributes["clip-path"], "url(#line-clip-1)");
  assert.equal(svg.children.length, 3);
  assert.deepEqual(svg.children[2].styles, {});
});

test("downloads latest title with a safe filename and releases resources after the click", async () => {
  const { saveGraph, container, svg, record } = setup();
  svg.querySelector(".chart-title").textContent = "New/Temperature & Time";
  assert.equal(await saveGraph(container), "New_Temperature & Time.svg");
  assert.equal(record.link.download, "New_Temperature & Time.svg");
  assert.equal(record.link.href, "blob:graph");
  assert.equal(record.urls[0].type, "image/svg+xml;charset=utf-8");
  assert.equal(await record.urls[0].text(), "<svg/>");
  assert.equal(record.clicked, 1);
  assert.equal(record.removed, 1);
  assert.deepEqual(record.revoked, []);
  record.timers[0]();
  assert.deepEqual(record.revoked, ["blob:graph"]);
});

test("untitled graph uses a default filename", async () => {
  const { saveGraph, container } = setup({ title: "" });
  assert.equal(await saveGraph(container), "graph.svg");
});

test("failed download still removes its link and releases its URL", async () => {
  const { saveGraph, container, record } = setup({ failClick: true });
  await assert.rejects(saveGraph(container), /Download blocked/);
  assert.equal(record.removed, 1);
  record.timers[0]();
  assert.deepEqual(record.revoked, ["blob:graph"]);
});

for (const format of ["jpeg", "png"]) {
  test(`${format} export produces an image at double resolution and releases the source URL`, async () => {
    const { saveGraph, container, record } = setup();
    const extension = format === "jpeg" ? "jpg" : format;
    assert.equal(
      await saveGraph(container, format),
      `Temperature & Time.${extension}`,
    );
    assert.equal(record.urls[1].type, `image/${format}`);
    if (format === "jpeg")
      assert.deepEqual(record.background, [0, 0, 1600, 800]);
    else assert.equal(record.background, undefined);
    assert.deepEqual(record.draw, [0, 0, 1600, 800]);
    assert.equal(record.clicked, 1);
    assert.equal(record.revoked.length, 1);
    record.timers[0]();
    assert.equal(record.revoked.length, 2);
  });

  for (const failure of ["failImage", "failEncode"]) {
    test(`${format} ${failure} reports failure and cleans up without downloading`, async () => {
      const { saveGraph, container, record } = setup({ [failure]: true });
      await assert.rejects(saveGraph(container, format));
      assert.equal(record.clicked, 0);
      assert.equal(record.revoked.length, 1);
    });
  }
}

test("unsupported formats are rejected before creating a file", async () => {
  const { saveGraph, container, record } = setup();
  await assert.rejects(saveGraph(container, "pdf"), /Unsupported/);
  assert.equal(record.urls.length, 0);
});

test("SVG export keeps the chosen background color", () => {
  const { serializeGraph, svg, record } = setup({ backgroundColor: "#aabbcc" });
  serializeGraph(svg);
  assert.equal(record.serialized.children[0].styles.fill, "#aabbcc");
});

for (const format of ["svg", "png", "jpeg"]) {
  test(`${format} transparent export only adds a white underlay for JPEG`, async () => {
    const { saveGraph, container, record } = setup({ transparent: true });
    await saveGraph(container, format);
    assert.equal(
      record.serialized.children.some((child) => child.tag === "rect"),
      false,
    );
    if (format === "jpeg")
      assert.deepEqual(record.background, [0, 0, 1600, 800]);
    else assert.equal(record.background, undefined);
  });
}

test("SVG export inlines grid line styles", () => {
  const { serializeGraph, svg, record } = setup({ showGrid: true });
  serializeGraph(svg);
  const grid = record.serialized.children[1];
  assert.equal(grid.attributes.class, "grid-line");
  assert.equal(grid.styles.stroke, "rgb(101, 67, 33)");
  assert.equal(grid.styles["stroke-width"], "1px");
  assert.equal(grid.styles["stroke-opacity"], "0.2");
});

for (const format of ["svg", "png", "jpeg"]) {
  test(`${format} export keeps the grid on a transparent background`, async () => {
    const { saveGraph, container, record } = setup({
      transparent: true,
      showGrid: true,
    });
    await saveGraph(container, format);
    assert.equal(
      record.serialized.children.some(
        (child) => child.attributes.class === "grid-line",
      ),
      true,
    );
    assert.equal(
      record.serialized.children.some((child) => child.tag === "rect"),
      false,
    );
  });
}
