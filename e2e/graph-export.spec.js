/**
 * @file Browser coverage for issue #12: export JPEG, PNG, and SVG through the
 * UI with colored and transparent backgrounds. Verify the actual downloaded
 * files and ensure exporting leaves the preview and form controls unchanged.
 */
const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

/**
 * Decodes a downloaded image in Chromium and samples its background and a point.
 * Checking a data point catches blank exports with otherwise valid dimensions.
 * No export functions or browser image APIs are mocked.
 * @param {import('@playwright/test').Page} page - Browser page used for decoding.
 * @param {Buffer} bytes - Contents of the completed download.
 * @param {string} mime - MIME type used to load the image.
 * @param {{x: number, y: number}} point - Point center in the 800 × 400 SVG viewBox.
 * @returns {Promise<{width: number, height: number, background: number[], point: number[]}>}
 * Image dimensions and RGBA samples (channel values from 0 to 255).
 */
async function inspectImage(page, bytes, mime, point) {
  return page.evaluate(async ({ base64, mime, point }) => {
    const image = new Image();
    image.src = `data:${mime};base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data);
    return {
      width: canvas.width,
      height: canvas.height,
      background: pixel(4, 4),
      point: pixel(Math.round(point.x * canvas.width / 800),
        Math.round(point.y * canvas.height / 400)),
    };
  }, { base64: bytes.toString('base64'), mime, point });
}

/**
 * Captures preview markup and live control values for a before/after comparison.
 * Live properties are read separately because HTML attributes do not reflect
 * every user edit. Export status and format controls are outside this snapshot.
 * @param {import('@playwright/test').Page} page - Page containing the graph editor.
 * @returns {Promise<{chart: string, controls: Array<{value: string, checked: (boolean|undefined), disabled: boolean}>}>}
 * Preview markup and editable graph settings/data at the time of capture.
 */
async function previewSnapshot(page) {
  return page.evaluate(() => ({
    chart: document.querySelector('#chart').outerHTML,
    controls: Array.from(document.querySelectorAll('#graph-settings input, #graph-settings select, #data-table input'))
      .map(input => ({ value: input.value, checked: input.checked, disabled: input.disabled })),
  }));
}

// Six independent cases exercise each format with an opaque color and with
// transparency. JPEG must flatten transparency to white; PNG and SVG retain it.
for (const format of ['jpeg', 'png', 'svg']) {
  for (const transparent of [false, true]) {
    test(`${format} download with ${transparent ? 'transparent' : 'colored'} background preserves the graph`, async ({ page }, testInfo) => {
      // Fonts are intentionally external to the app; exports must work offline.
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.route('https://fonts.gstatic.com/**', route => route.abort());
      await page.goto('/');
      // Build a nonempty line graph through the UI. The title also exercises
      // replacement of filename characters that are invalid on some platforms.
      await page.getByLabel('X 1', { exact: true }).fill('1');
      await page.getByLabel('Y 1', { exact: true }).fill('2');
      await page.getByLabel('X 2', { exact: true }).fill('3');
      await page.getByLabel('Y 2', { exact: true }).fill('4');
      await page.getByLabel('Title', { exact: true }).fill('Export: browser/test');
      await page.getByLabel('Background color', { exact: true }).fill('#336699');
      await page.getByLabel('Transparent background', { exact: true }).setChecked(transparent);
      await page.getByLabel('Format', { exact: true }).selectOption(format);
      const svg = page.locator('#chart svg');
      await expect(svg.locator('.data-point')).toHaveCount(2);
      await expect(svg.locator('.data-line')).toHaveCount(1);
      const backgroundControl = page.getByLabel('Background color', { exact: true });
      if (transparent) await expect(backgroundControl).toBeDisabled();
      else await expect(backgroundControl).toBeEnabled();
      if (transparent && format === 'jpeg') {
        await expect(page.locator('#export-hint')).toBeVisible();
      } else {
        await expect(page.locator('#export-hint')).toBeHidden();
      }
      const point = await svg.locator('circle.data-point').first().evaluate(element => ({
        x: element.cx.baseVal.value, y: element.cy.baseVal.value,
      }));
      const before = await previewSnapshot(page);
      // Register before clicking so even an immediate download is captured.
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save graph', exact: true }).click();
      const download = await downloadPromise;
      const filename = `Export_ browser_test.${format === 'jpeg' ? 'jpg' : format}`;
      expect(download.suggestedFilename()).toBe(filename);
      const path = testInfo.outputPath(filename);
      await download.saveAs(path);
      expect(await download.failure()).toBeNull();
      const bytes = await readFile(path);

      // Validate the file contents independently of the suggested extension:
      // SVG must parse with graph elements; raster files need format signatures.
      if (format === 'svg') {
        const documentInfo = await page.evaluate(source => {
          const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
          return {
            error: !!doc.querySelector('parsererror'),
            namespace: doc.documentElement.namespaceURI,
            title: doc.querySelector('.chart-title')?.textContent,
            points: doc.querySelectorAll('.data-point').length,
            lines: doc.querySelectorAll('.data-line').length,
            backgrounds: doc.querySelectorAll('.chart-background').length,
          };
        }, bytes.toString('utf8'));
        expect(documentInfo).toEqual({
          error: false, namespace: 'http://www.w3.org/2000/svg',
          title: 'Export: browser/test', points: 2, lines: 1,
          backgrounds: transparent ? 0 : 1,
        });
      } else if (format === 'png') {
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      } else {
        expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
        expect(bytes.subarray(-2).toString('hex')).toBe('ffd9');
      }

      // Decode every format, including SVG, to verify visible content and alpha.
      // Raster exports use 2× resolution; SVG retains its source dimensions.
      const image = await inspectImage(page, bytes,
        format === 'svg' ? 'image/svg+xml' : `image/${format}`, point);
      expect([image.width, image.height]).toEqual(format === 'svg' ? [800, 400] : [1600, 800]);
      const background = transparent
        ? (format === 'jpeg' ? [255, 255, 255, 255] : [0, 0, 0, 0])
        : [51, 102, 153, 255];
      // JPEG is lossy, so allow small rounding differences in RGB channels.
      const tolerance = format === 'jpeg' ? 5 : 0;
      for (let channel = 0; channel < 4; channel++) {
        expect(Math.abs(image.background[channel] - background[channel])).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(image.point[channel] - [0, 0, 0, 255][channel])).toBeLessThanOrEqual(tolerance);
      }
      // Export must finish successfully, restore the toolbar, and leave the
      // rendered graph, entered data, and graph settings exactly as they were.
      await expect(page.locator('#save-status')).toHaveText(`Download started: ${filename}`);
      await expect(page.getByRole('button', { name: 'Save graph', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Format', { exact: true })).toBeEnabled();
      expect(await previewSnapshot(page)).toEqual(before);
    });
  }
}
