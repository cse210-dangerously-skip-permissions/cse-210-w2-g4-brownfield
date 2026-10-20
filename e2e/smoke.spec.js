const { test, expect } = require('@playwright/test');

test('app loads and renders a graph after entering an X/Y pair', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Simpligraph/);
  await expect(page.locator('#chart .chart-empty')).toHaveText('Add at least one complete X/Y pair to see the graph.');

  await page.getByLabel('X 1').fill('1');
  await page.getByLabel('Y 1').fill('2');

  await expect(page.locator('#chart svg')).toBeVisible();
  await expect(page.locator('#chart svg circle.data-point')).toHaveCount(1);
});

test('a three-column CSV draws one line per series with a legend', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[name="csv"]').setInputFiles({
    name: 'agents-vs-bugs.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('agent,day,bugs\nAgent A,1,4\nAgent A,2,7\nAgent B,1,2\nAgent B,2,3\n'),
  });

  await expect(page.locator('#csv-status')).toHaveText(/Parsed 4 points/);
  await expect(page.locator('#chart svg polyline.data-line')).toHaveCount(2);
  await expect(page.locator('#chart svg .legend-label')).toHaveText(['Agent A', 'Agent B']);
  await expect(page.locator('#data-table tbody tr').first()).toContainText('Agent A');

  // Editing a value keeps the series grouping.
  await page.getByLabel('Y 1').fill('5');
  await expect(page.locator('#chart svg polyline.data-line')).toHaveCount(2);
});

test('long CSVs collapse to 10 rows and clicking a point reveals its row', async ({ page }) => {
  await page.goto('/');

  const rows = Array.from({ length: 30 }, (_, i) => `${i + 1},${(i * 7) % 13}`);
  await page.locator('input[name="csv"]').setInputFiles({
    name: 'long.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n' + rows.join('\n')),
  });

  await expect(page.locator('#data-table tbody tr')).toHaveCount(30);
  await expect(page.locator('#data-table tbody tr:visible')).toHaveCount(10);
  await expect(page.locator('#data-table .show-all')).toHaveText('Show all 30 rows');

  // Point 25 (0-based) is row 26, which is hidden until clicked.
  await page.locator('#chart .data-point[data-index="25"]').click();
  await expect(page.locator('#data-table tbody tr:visible')).toHaveCount(30);
  await expect(page.getByLabel('X 26')).toBeFocused();
  await expect(page.locator('#data-table tbody tr.selected-row')).toHaveCount(1);
  await expect(page.locator('#data-table tbody tr.selected-row input').first()).toHaveValue('26');
  await expect(page.locator('#chart .data-point[data-index="25"] title')).toHaveText(/Point 26: 26, /);

  // The same button collapses back to the first 10 rows.
  await expect(page.locator('#data-table .show-all')).toHaveText('Show first 10 rows');
  await page.locator('#data-table .show-all').click();
  await expect(page.locator('#data-table tbody tr:visible')).toHaveCount(10);
  await expect(page.locator('#data-table .show-all')).toHaveText('Show all 30 rows');
});
