import { expect, test } from "@playwright/test";
import { gotoApp, setSource } from "./helpers";

for (const count of [400, 1000]) test(`selecting objects in a ${count}-node document stays responsive`, async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  await gotoApp(page);
  const source = "\\begin{tikzpicture}\n" + Array.from({ length: count }, (_, i) => `\\node[draw,minimum width=5mm] (n${i}) at (${i % 20},${Math.floor(i / 20)}) {${i}};`).join("\n") + "\n\\end{tikzpicture}";
  await setSource(page, source);
  const canvas = page.getByTestId("canvas-svg-layer");
  await expect(canvas.locator(`[data-source-id="path:${count - 1}"]`).first()).toBeAttached();
  const timings: number[] = [];
  for (const index of [0, count / 4, count / 2, count * 3 / 4, count - 1]) {
    const start = Date.now();
    await canvas.locator(`[data-source-id="path:${index}"]`).first().click({ force: true });
    await expect(page.getByText("设置格式 · rectangle", { exact: true })).toBeVisible();
    timings.push(Date.now() - start);
  }
  console.log(`${count}-node selection, milliseconds:`, timings.map(Math.round));
  expect(Math.max(...timings)).toBeLessThan(count === 400 ? 500 : 750);
  expect(errors).toEqual([]);
});
