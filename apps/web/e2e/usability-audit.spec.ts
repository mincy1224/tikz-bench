import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const node = String.raw`\begin{tikzpicture}\node[draw=blue,fill=blue!10,line width=0.8pt,font=\bfseries,minimum width=30pt] (A) {Hello $x^2$};\end{tikzpicture}`;
async function select(page: Page, ids = ["path:0"]) {
  await page.evaluate((sourceIds) => {
    const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void } }).__TIKZ_EDITOR_APP_TEST_API__;
    api.selectSourceIds(sourceIds);
  }, ids);
}

test("exact font size previews, cancels, preserves bold and undoes once", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  const size = page.getByRole("textbox", { name: "字号（pt）", exact: true });
  await expect(size).toBeVisible();
  await size.fill("18pt"); await size.press("Escape");
  await expect.poll(() => readSource(page)).toBe(node);
  await size.fill("24"); await size.press("Tab");
  expect(await readSource(page)).toContain(String.raw`\fontsize{24pt}{28.8pt}\selectfont\bfseries`);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(node);
});

test("line precision accepts units, cancellation and a single undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  const width = page.getByRole("textbox", { name: "线宽（pt / mm / cm）", exact: true });
  await width.fill("2mm"); await width.press("Escape");
  await expect.poll(() => readSource(page)).toBe(node);
  await width.fill("1.5pt"); await width.press("Tab");
  expect(await readSource(page)).toContain("line width=1.5pt");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(node);
});

test("length property input previews units and cancels without writing", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  const width = page.getByRole("textbox", { name: "Minimum width", exact: true });
  await width.fill("2cm"); await width.press("Escape");
  await expect.poll(() => readSource(page)).toBe(node);
  await width.fill("40pt"); await width.press("Tab");
  expect(await readSource(page)).toContain("minimum width=40pt");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(node);
});

test("color gesture previews and leaves one history entry", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  await page.getByRole("button", { name: "线条颜色", exact: true }).click();
  const brightness = page.getByRole("slider", { name: "线条颜色 brightness", exact: true });
  const box = await brightness.boundingBox(); if (!box) throw new Error("Missing color track");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up(); await page.keyboard.press("Escape");
  expect(await readSource(page)).not.toBe(node);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(node);
});

test("multiple font sizes show mixed values and preserve each object's style", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\node[draw,font=\small\bfseries] at(0,0) {A};\node[draw,font=\Large\itshape] at(3,0) {B};\end{tikzpicture}`;
  await gotoApp(page); await setSource(page, source); await select(page, ["path:0", "path:1"]);
  const size = page.getByRole("textbox", { name: "字号（pt）", exact: true });
  await expect(size).toHaveAttribute("placeholder", "多个值");
  await size.fill("16"); await size.press("Tab");
  const result = await readSource(page);
  expect(result.match(/fontsize\{16pt\}/gu)).toHaveLength(2);
  expect(result).toContain(String.raw`\bfseries`); expect(result).toContain(String.raw`\itshape`);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(source);
});

test("native preview failure has diagnostics and a reliable retry", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  let count = 0;
  await page.route("**/api/latex/status", (route) => route.fulfill({ json: { available: true, details: "fixture toolchain" } }));
  await page.route("**/api/latex/compile", (route) => {
    count++;
    return route.fulfill(count === 1 ? { status: 422, json: { ok: false, error: "fixture compilation failure", log: "input.tex:2: bad fixture" } } : { json: { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path data-preview="fixture" d="M0 0L10 10"/></svg>' } });
  });
  await gotoApp(page); await setSource(page, node);
  await openMenuCommand(page, "file", "file.show-compiled-picture");
  await expect(page.getByText("本地 LaTeX 编译失败，可查看诊断并重试。")).toBeVisible();
  await page.getByRole("button", { name: "重新编译当前草稿" }).click();
  await expect(page.locator('[data-preview="fixture"]')).toBeVisible();
  expect(count).toBe(2); expect(errors).toEqual([]);
});

test("advanced component warns about editability and unavailable native tools", async ({ page }) => {
  await page.route("**/api/latex/status", (route) => route.fulfill({ json: { available: false, details: "xelatex unavailable" } }));
  await gotoApp(page); await setSource(page, String.raw`\begin{tikzpicture}\begin{axis}\addplot {x^2};\end{axis}\end{tikzpicture}`);
  await page.getByRole("button", { name: "LaTeX 编译预览", exact: true }).click();
  await expect(page.getByText("本地 LaTeX 编译失败，可查看诊断并重试。")).toBeVisible();
  await expect(page.getByText("xelatex unavailable", { exact: false })).toBeVisible();
});

test("narrow and dark inspector remains usable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" }); await page.setViewportSize({ width: 1000, height: 760 });
  await gotoApp(page); await setSource(page, node); await select(page);
  const size = page.getByRole("textbox", { name: "字号（pt）", exact: true }); await expect(size).toBeVisible();
  const directory = path.resolve("artifacts/usability-audit"); await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "inspector-dark.png"), fullPage: true });
  const box = await size.boundingBox(); expect(box?.width).toBeGreaterThan(35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.getByRole("button", { name: "增大字号", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: path.join(directory, "inspector-light.png"), fullPage: true, animations: "disabled" });
});

test("property previews never autosave and export uses the committed draft before autosave", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "PATCH" && request.url().includes("/api/projects/")) writes.push(request.postData() ?? ""); });
  const size = page.getByRole("textbox", { name: "字号（pt）", exact: true });
  await size.fill("18");
  await page.waitForTimeout(900);
  expect(writes).toEqual([]);
  await size.press("Escape");
  await expect.poll(() => readSource(page)).toBe(node);
  await size.fill("24"); await size.press("Tab");
  const draft = await readSource(page);
  let exported = "";
  await page.route("**/export/tex", (route) => {
    exported = (route.request().postDataJSON() as { source: string }).source;
    return route.fulfill({ body: exported, contentType: "text/plain" });
  });
  await page.getByRole("button", { name: "Download TeX", exact: true }).click();
  await expect.poll(() => exported).toBe(draft);
  expect(draft).toContain("fontsize{24pt}");
});

test("font preset hover can leave, resume and commit with one undo", async ({ page }) => {
  await gotoApp(page); await setSource(page, node); await select(page);
  await page.getByRole("button", { name: "Font size", exact: true }).click();
  const small = page.getByRole("option", { name: /^small\b/u });
  await small.hover();
  await expect.poll(() => readSource(page)).toContain(String.raw`\small`);
  await page.mouse.move(300, 110);
  await expect.poll(() => readSource(page)).toBe(node);
  await small.hover();
  await expect.poll(() => readSource(page)).toContain(String.raw`\small`);
  await small.click();
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(node);
});
