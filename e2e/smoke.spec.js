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
