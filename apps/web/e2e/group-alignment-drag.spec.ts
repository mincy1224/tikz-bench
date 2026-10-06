import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const six = Array.from({ length: 6 }, (_, i) => `\\draw[fill=blue!10] (${i % 3},${Math.floor(i / 3)}) rectangle (${i % 3 + 0.6},${Math.floor(i / 3) + 0.6});`).join("\n");
const groups = `\\begin{tikzpicture}\\begin{scope}[xshift=10pt]${six}\\end{scope}\\begin{scope}[xshift=140pt,yshift=65pt]${six}\\end{scope}\\end{tikzpicture}`;

test("two six-element groups align through the panel and menu, and undo once", async ({ page }) => {
  await gotoApp(page); await setSource(page, groups);
  const canvas = page.getByTestId("canvas-svg-layer");
  await canvas.locator('[data-source-id="path:1"]').first().click({ force: true, modifiers: ["Shift"] });
  await canvas.locator('[data-source-id="path:8"]').first().click({ force: true, modifiers: ["Shift"] });
  await expect(page.getByText("设置格式 · 2 个对象", { exact: true })).toBeVisible();
  const original = await canvas.locator('[data-source-id="path:8"]').first().getAttribute("d");
  await page.getByRole("button", { name: "左对齐", exact: true }).click();
  await expect.poll(() => readSource(page)).not.toBe(groups);
  await expect.poll(async () => {
    const a = await canvas.locator('[data-source-id="path:1"]').first().boundingBox();
    const b = await canvas.locator('[data-source-id="path:8"]').first().boundingBox();
    return a && b ? Math.abs(a.x - b.x) : 1000;
  }).toBeLessThan(1);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(groups);
  await expect(canvas.locator('[data-source-id="path:8"]').first()).toHaveAttribute("d", original!);
  await openMenuCommand(page, "edit", "edit.align-left");
  await expect.poll(() => readSource(page)).not.toBe(groups);
});

for (const grouped of [true, false]) test(`drag remains responsive, grouped=${grouped}`, async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on("pageerror", (error) => { errors.push(error.message); });
  await gotoApp(page);
  const filler = Array.from({ length: 200 }, (_, i) => `\\draw (${10 + i % 20},${Math.floor(i / 20)}) circle (0.15);`).join("\n");
  const source = `\\begin{tikzpicture}${grouped ? "\\begin{scope}" : ""}${six}${grouped ? "\\end{scope}" : ""}${filler}\\end{tikzpicture}`;
  await setSource(page, source);
  const canvas = page.getByTestId("canvas-svg-layer");
  const shape = canvas.locator(`[data-source-id="path:${grouped ? 1 : 0}"]`).first();
  if (grouped) await shape.click({ force: true });
  else for (let i = 0; i < 6; i++) await canvas.locator(`[data-source-id="path:${i}"]`).first().click({ force: true, modifiers: ["Shift"] });
  const initialBox = await shape.boundingBox();
  const viewport = await page.locator('[data-canvas-viewport="true"]').boundingBox();
  if (!initialBox || !viewport) throw new Error("Missing drag bounds");
  await page.evaluate(({ box, viewport }) => {
    const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getCanvasTransform: () => { scale: number; translateX: number; translateY: number }; setCanvasTransform: (value: { scale: number; translateX: number; translateY: number }) => void } }).__TIKZ_EDITOR_APP_TEST_API__;
    const old = api.getCanvasTransform(), ratio = 2 / old.scale;
    const x = box.x + box.width / 2 - viewport.x, y = box.y + box.height / 2 - viewport.y;
    api.setCanvasTransform({ scale: 2, translateX: x - (x - old.translateX) * ratio, translateY: y - (y - old.translateY) * ratio });
  }, { box: initialBox, viewport });
  await expect.poll(async () => (await shape.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  const box = await shape.boundingBox(); if (!box) throw new Error("Missing drag shape");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  const intervals = await page.evaluate(async ({ x, y }) => {
    const intervals: number[] = []; let previous = performance.now(), index = 0;
    const start = previous;
    await new Promise<void>((resolve) => {
      const frame = (time: number) => {
        if (index > 2) intervals.push(time - previous);
        previous = time; index++;
        for (let j = 0; j < 4; j++) window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x + index * 0.7 + j * 0.1, clientY: y + index * 0.3, ctrlKey: true }));
        if (time - start < 1200) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    return intervals;
  }, { x, y });
  const kind = await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveCanvasDragKind: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind());
  expect(kind).toBe("element");
  expect(await readSource(page)).toBe(source);
  expect((await shape.boundingBox())!.x - box.x).toBeGreaterThan(15);
  await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(source);
  const sorted = intervals.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`Drag grouped=${grouped}: frames=${intervals.length}, p95=${Math.round(p95)}ms, max=${Math.round(Math.max(...intervals))}ms`);
  expect(intervals.length).toBeGreaterThan(25);
  expect(p95).toBeLessThan(50);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(source);
  await expect.poll(async () => Math.abs((await shape.boundingBox())!.x - box.x)).toBeLessThan(1);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 40, y + 25, { steps: 6 });
  await expect.poll(async () => (await shape.boundingBox())!.x - box.x).toBeGreaterThan(15);
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await readSource(page)).toBe(source);
  await expect.poll(async () => Math.abs((await shape.boundingBox())!.x - box.x)).toBeLessThan(1);
  expect(errors).toEqual([]);
});
