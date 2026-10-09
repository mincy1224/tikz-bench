import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const objectCount = process.env.TIKZ_STRESS_5000 === "1" ? 5000 : 1000;
for (const grouped of [true, false]) test(`drag remains responsive, grouped=${grouped}`, async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on("pageerror", (error) => { errors.push(error.message); });
  await gotoApp(page);
  const filler = Array.from({ length: objectCount - (grouped ? 11 : 6) }, (_, i) => i % 3 === 0 ? `\\node[draw,circle] (F${i}) at (${10 + i % 40},${Math.floor(i / 40)}) {${i}};` : `\\draw (${10 + i % 40},${Math.floor(i / 40)}) ${i % 3 === 1 ? "circle (0.15)" : "rectangle +(0.3,0.2)"};`).join("\n");
  const moving = grouped ? Array.from({ length: 6 }, (_, i) => `\\node[draw,fill=blue!10] (N${i}) at (${i % 3},${Math.floor(i / 3)}) {${i}};`).join("\n") + Array.from({ length: 5 }, (_, i) => `\\draw[->] (N${i}.east)--(N${i + 1}.west);`).join("\n") : six;
  const source = `\\begin{tikzpicture}${grouped ? "\\begin{scope}" : ""}${moving}${grouped ? "\\end{scope}" : ""}${filler}\\end{tikzpicture}`;
  await setSource(page, source);
  const canvas = page.getByTestId("canvas-svg-layer");
  const shape = canvas.locator(`[data-source-id="path:${grouped ? 1 : 0}"]`).first();
  const selectionTimes: number[] = [];
  if (grouped) for (let i = 0; i < 12; i++) {
    await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { clearSelection: () => void } }).__TIKZ_EDITOR_APP_TEST_API__.clearSelection());
    await page.evaluate(() => {
      const state = window as unknown as { selectionPaintMs: number | null };
      state.selectionPaintMs = null;
      window.addEventListener("pointerdown", () => { const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { state.selectionPaintMs = performance.now() - start; })); }, { once: true, capture: true });
    });
    await shape.click({ force: true });
    await expect.poll(() => page.evaluate(() => (window as unknown as { selectionPaintMs: number | null }).selectionPaintMs)).not.toBeNull();
    selectionTimes.push((await page.evaluate(() => (window as unknown as { selectionPaintMs: number }).selectionPaintMs)));
  }
  if (selectionTimes.length) { selectionTimes.sort((a, b) => a - b); const p95 = selectionTimes[Math.floor(selectionTimes.length * .95)]; console.log(`Selection input-to-paint ${objectCount} objects: p95=${Math.round(p95)}ms`); if (objectCount === 1000 && process.env.TIKZ_PROFILE_BUILD !== "1") expect(p95).toBeLessThanOrEqual(100); }
  if (grouped) { /* Whole group remains selected after the response samples. */ }
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
  const profile = process.env.TIKZ_PROFILE_VERBOSE ? await page.context().newCDPSession(page) : null;
  if (profile) { await profile.send("Profiler.enable"); await profile.send("Profiler.start"); }
  await page.evaluate(() => {
    const state = window as unknown as { movementMetrics: { startMs: number; longTasks: number[] } };
    state.movementMetrics = { startMs: 0, longTasks: [] };
    const observer = new PerformanceObserver((list) => { state.movementMetrics.longTasks.push(...list.getEntries().map((entry) => entry.duration)); });
    observer.observe({ type: "longtask" });
    window.addEventListener("pointerdown", () => { const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { state.movementMetrics.startMs = performance.now() - start; })); }, { once: true, capture: true });
  });
  await page.mouse.move(x, y); await page.mouse.down();
  await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { resetProfilingSession: (name: string) => void } }).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("movement-1000"));
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
  const stats = await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getProfilingSnapshot: () => { counters: Record<string, number>; computeTimings: unknown[] } } }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  console.log(`Preview counters: ${JSON.stringify(stats.counters)}, computes=${stats.computeTimings.length}`);
  expect(stats.computeTimings).toHaveLength(0);
  const kind = await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveCanvasDragKind: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind());
  expect(kind).toBe("element");
  expect(await readSource(page)).toBe(source);
  expect((await shape.boundingBox())!.x - box.x).toBeGreaterThan(15);
  const releaseStart = Date.now();
  await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(source);
  await expect.poll(() => page.evaluate(() => {
    const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getSource: () => string; getSnapshotSource: () => string } }).__TIKZ_EDITOR_APP_TEST_API__;
    return api.getSource() === api.getSnapshotSource();
  }), { timeout: objectCount === 5000 ? 30000 : 10000 }).toBe(true);
  const metrics = await page.evaluate(() => (window as unknown as { movementMetrics: { startMs: number; longTasks: number[] } }).movementMetrics);
  console.log(`Gesture grouped=${grouped}: start-to-paint=${Math.round(metrics.startMs)}ms, release-to-ready=${Date.now() - releaseStart}ms, long-tasks=${metrics.longTasks.length}, max-long-task=${Math.round(Math.max(0, ...metrics.longTasks))}ms`);
  const releaseStats = await page.evaluate(() => (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getProfilingSnapshot: () => { computeTimings: unknown[] } } }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  console.log(`Release computations: ${JSON.stringify(releaseStats.computeTimings)}`);
  if (profile) { const result = await profile.send("Profiler.stop"); await writeFile(join(tmpdir(), `tikz-movement-${grouped}.cpuprofile`), JSON.stringify(result.profile)); await profile.detach(); }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`Drag grouped=${grouped}: frames=${intervals.length}, p95=${Math.round(p95)}ms, max=${Math.round(Math.max(...intervals))}ms`);
  expect(intervals.length).toBeGreaterThan(25);
  if (objectCount === 1000 && process.env.TIKZ_PROFILE_BUILD !== "1") expect(p95).toBeLessThanOrEqual(20);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(source);
  await expect.poll(async () => Math.abs(((await shape.boundingBox())?.x ?? Infinity) - box.x), { timeout: objectCount === 5000 ? 30000 : 10000 }).toBeLessThan(1);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 40, y + 25, { steps: 6 });
  await expect.poll(async () => (await shape.boundingBox())!.x - box.x).toBeGreaterThan(15);
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await readSource(page)).toBe(source);
  await expect.poll(async () => Math.abs(((await shape.boundingBox())?.x ?? Infinity) - box.x), { timeout: objectCount === 5000 ? 30000 : 10000 }).toBeLessThan(1);
  expect(errors).toEqual([]);
});
