import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readCanvasTransform, readSelectedSourceIds, readSource, setCanvasTransform, setSource } from "./helpers";

const matrix = String.raw`\begin{tikzpicture}\begin{scope}[rotate=35,xscale=1.5,yscale=0.8]\matrix[matrix of nodes,matrix anchor=west,nodes={draw},row sep=10pt,column sep=12pt] (M) at (0,0) {A & Long text \\ C & D \\};\end{scope}\end{tikzpicture}`;

test("moving outside the original SVG bounds remains visibly painted", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}\node[fill=red,minimum width=24pt,minimum height=24pt] (A) at (0,0) {};\end{tikzpicture}`);
  const viewport = page.locator('[data-canvas-viewport="true"]');
  const shape = page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:0"]').first();
  const original = await shape.boundingBox(), bounds = await viewport.boundingBox();
  if (!original || !bounds) throw new Error("Missing shape bounds");
  const old = await readCanvasTransform(page), ratio = 1 / old.scale;
  await setCanvasTransform(page, {
    scale: 1,
    translateX: 80 - (original.x - bounds.x - old.translateX) * ratio,
    translateY: 140 - (original.y - bounds.y - old.translateY) * ratio
  });
  await shape.click({ force: true });
  const before = await shape.boundingBox();
  if (!before) throw new Error("Missing initial shape");
  await viewport.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await shape.boundingBox())!.x - before.x).toBeGreaterThan(90);
  const moved = await shape.boundingBox();
  if (!moved) throw new Error("Missing moved shape");
  // DOM bounds alone do not detect SVG clipping. Check actual composited pixels.
  const pixel = await page.screenshot({ clip: { x: moved.x + moved.width / 3, y: moved.y + moved.height / 3, width: 2, height: 2 } });
  const rgb = await page.evaluate(async (base64) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, pixel.toString("base64"));
  expect(rgb).toEqual([255, 0, 0]);
});

test("matrix moves by its placement anchor, cancels and edits cells", async ({ page }) => {
  await gotoApp(page); await setSource(page, matrix);
  const canvas = page.getByTestId("canvas-svg-layer");
  const cell = canvas.locator('[data-source-id*="matrix-cell"]').first();
  await cell.click({ force: true });
  // Nested matrices use the ordinary outermost group selection rule.
  await cell.click({ force: true });
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);
  const initial = await cell.boundingBox(); if (!initial) throw new Error("Missing matrix cell");
  await page.locator('[data-canvas-viewport="true"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => readSource(page)).not.toBe(matrix);
  await expect.poll(async () => (await cell.boundingBox())!.x).toBeGreaterThan(initial.x);
  const moved = await cell.boundingBox(); if (!moved) throw new Error("Missing moved cell");
  expect(moved.y).toBeCloseTo(initial.y, 0);
  expect(moved.x).toBeGreaterThan(initial.x);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(matrix);
  await page.locator('[data-canvas-viewport="true"]').focus();
  await page.keyboard.down("ArrowRight"); await page.keyboard.press("Escape"); await page.keyboard.up("ArrowRight");
  expect(await readSource(page)).toBe(matrix);
  await cell.dblclick({ force: true });
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([expect.stringContaining("matrix-cell")]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([]);
});

test("matrix layout handles resize, cancel and undo without changing cell font", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}\matrix[matrix of nodes,nodes={draw},row sep=14pt,column sep=18pt] (M) {A & B \\ C & D \\};\end{tikzpicture}`;
  await setSource(page, source);
  const cell = page.getByTestId("canvas-svg-layer").locator('[data-source-id*="matrix-cell"]').first();
  await cell.click({ force: true });
  const handles = page.locator('[data-handle-kind="resize-element"][data-source-id="path:0"]');
  await expect(handles).toHaveCount(8);
  const right = page.locator('[data-handle-kind="resize-element"][data-source-id="path:0"][data-resize-role="right"]');
  const box = await right.boundingBox(); if (!box) throw new Error("Missing matrix resize handle");
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const font = page.getByRole("textbox", { name: "字号", exact: true });
  const beforeFont = await font.inputValue();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await expect.poll(() => readSource(page)).not.toBe(source);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);
  await expect.poll(() => readSource(page)).toBe(source);
  await expect.poll(() => right.boundingBox()).not.toBeNull();
  const again = await right.boundingBox(); if (!again) throw new Error("Missing restored resize handle");
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2); await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2 + 40, again.y + again.height / 2, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(source);
  await expect(font).toHaveValue(beforeFont);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(source);
});

test("30 second keyboard gesture is one source commit and one undo", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await gotoApp(page); await setSource(page, String.raw`\begin{tikzpicture}\node[draw] (A) at (0,0) {A};\node[draw] (B) at (2,0) {B};\draw (A.east) -- (B.west);\end{tikzpicture}`);
  await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:0"]').first().click({ force: true });
  await page.locator('[data-canvas-viewport="true"]').focus(); const baseline = await readSource(page);
  let saves = 0; page.on("request", (request) => { if (request.method() === "PATCH" && request.url().includes("/api/projects/")) saves++; });
  await page.waitForTimeout(900); saves = 0;
  await page.evaluate(async () => {
    const host = document.querySelector('[data-canvas-viewport="true"]')!;
    const start = performance.now();
    await new Promise<void>((resolve) => { const tick = () => { host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: performance.now() - start > 30, bubbles: true })); if (performance.now() - start < 30000) setTimeout(tick, 30); else resolve(); }; tick(); });
  });
  // A one-ended dependent connector may use semantic previews, but never a
  // persistent history entry during the gesture.
  expect(saves).toBe(0);
  await page.keyboard.up("ArrowRight"); await expect.poll(() => readSource(page)).not.toBe(baseline);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(baseline);
  expect(errors).toEqual([]);
});
