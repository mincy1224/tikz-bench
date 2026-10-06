import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

test("dragging selected nodes and anchored arrows preserves connections and undoes once", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}
\node[draw,rectangle split,rectangle split parts=2] (A) at (0,0) {A\nodepart{two} B};
\node[draw] (B) at (3,1) {B};
\node[draw] (C) at (3,-1) {C};
\draw[->] (A.east) -- (B.west);
\draw[->] (A.east) -- (C.west);
\end{tikzpicture}`;
  await setSource(page, source);
  const canvas = page.getByTestId("canvas-svg-layer");
  const originalShape = await canvas.locator('[data-source-id="path:0"]').first().getAttribute("d");
  for (let i = 0; i < 5; i++) await canvas.locator(`[data-source-id="path:${i}"]`).first().click({ force: true, modifiers: ["Shift"] });
  await expect(page.getByText("设置格式 · 5 个对象", { exact: true })).toBeVisible();
  const arrow = canvas.locator('[data-source-id="path:3"]').first();
  const box = await arrow.boundingBox(); if (!box) throw new Error("Missing arrow bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(source);
  expect(await readSource(page)).toContain("(A.east) -- (B.west)");
  expect(await readSource(page)).toContain("(A.east) -- (C.west)");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
  await expect(canvas.locator('[data-source-id="path:0"]').first()).toHaveAttribute("d", originalShape!);
  await page.locator('[data-canvas-viewport="true"]').focus();
  await expect(page.locator('[data-canvas-viewport="true"]')).toBeFocused();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(100);
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => readSource(page)).not.toBe(source);
  expect(await readSource(page)).toContain("(A.east) -- (B.west)");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});
