import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const groups = String.raw`\begin{tikzpicture}\begin{scope}\draw[fill=red!15] (0,0) rectangle (1,1);\draw (1,0)--(2,0);\end{scope}\begin{scope}\draw[fill=blue!15] (4,2) rectangle (5,3);\end{scope}\end{tikzpicture}`;
test("group drag and a 30-second continuous nudge each undo once", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", (error) => { errors.push(error.message); });
  await gotoApp(page); await setSource(page, groups);
  const shape = page.getByTestId("canvas-svg-layer").locator('[data-source-id^="path:"]').first();
  await shape.click({ force: true });
  const box = await shape.boundingBox(); if (!box) throw new Error("Missing group shape");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 25, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(groups);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(groups);
  await shape.click({ force: true });
  const viewport = page.locator('[data-canvas-viewport="true"]'); await viewport.focus();
  let saves = 0; page.on("request", (request) => { if (request.method() === "PATCH" && request.url().includes("/api/projects/")) saves++; });
  await page.keyboard.down("ArrowRight");
  const start = Date.now();
  while (Date.now() - start < Number(process.env.NUDGE_DURATION ?? 30000)) { await page.keyboard.down("ArrowRight"); await page.waitForTimeout(40); }
  const previewSaves = saves;
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => readSource(page)).not.toBe(groups);
  expect(previewSaves).toBeLessThanOrEqual(1);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(groups);
  expect(errors).toEqual([]);
});

test("new-project cancellation creates nothing and duplicates preserve form input", async ({ page }) => {
  await page.goto("/");
  const before = await page.request.get("/api/projects").then((response) => response.json()) as { projects: unknown[] };
  await page.getByRole("button", { name: "新建项目" }).click(); await page.getByRole("button", { name: "取消", exact: true }).click();
  const after = await page.request.get("/api/projects").then((response) => response.json()) as { projects: unknown[] };
  expect(after.projects.length).toBe(before.projects.length);
  const name = `Duplicate-${Date.now()}`;
  await page.request.post("/api/projects", { data: { name, source: "" } });
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill(name); await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("同名");
  await expect(page.getByRole("textbox", { name: "项目名称" })).toHaveValue(name);
});


test("format painter stays active, refuses another type and undoes each application", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}\node[draw=red,fill=red!15,line width=2pt,font=\fontsize{12pt}{14pt}\selectfont] (A) at (0,0) {A};\node[draw=blue,fill=white] (B) at (3,0) {B};\node[circle,draw] (C) at (6,0) {C};\end{tikzpicture}`;
  await setSource(page, source);
  const canvas = page.getByTestId("canvas-svg-layer");
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  const brush = page.getByRole("button", { name: "格式刷", exact: true });
  await brush.click(); await expect(brush).toHaveAttribute("aria-pressed", "true");
  await canvas.locator('[data-source-id="path:2"]').first().click({ force: true });
  await expect.poll(() => readSource(page)).toBe(source);
  await expect(page.getByRole("status").filter({ hasText: "相同组件类型" })).toBeVisible();
  await canvas.locator('[data-source-id="path:1"]').first().click({ force: true });
  await expect.poll(() => readSource(page)).not.toBe(source);
  const painted = await readSource(page); expect(painted).toContain("{B}");
  await expect(brush).toHaveAttribute("aria-pressed", "true");
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(source);
  await expect(brush).toHaveAttribute("aria-pressed", "true");
  await brush.click(); await expect(brush).toHaveAttribute("aria-pressed", "false");
});

test("compiled Forest mapping selects and writes only the chosen node", async ({ page }) => {
  let compilations = 0;
  await page.route("**/api/latex/compile", async (route) => {
    compilations++;
    const markers = [0, 1].map((key) => `<circle id="tb-${key}-center" cx="${30 + key * 50}" cy="30" r="0"/><circle id="tb-${key}-south-west" cx="${10 + key * 50}" cy="40" r="0"/><circle id="tb-${key}-north-east" cx="${50 + key * 50}" cy="20" r="0"/>`).join("");
    await route.fulfill({ json: { sourceVersion: route.request().postDataJSON().sourceVersion, markers: [], svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 70"><rect x="10" y="20" width="40" height="20"/>${markers}</svg>` } });
  });
  await gotoApp(page);
  const source = String.raw`\begin{forest}for tree={draw}[{Root}[{Child},fill=white]]\end{forest}`;
  await setSource(page, source);
  await expect(page.getByRole("status").filter({ hasText: "主画布 · TeX" })).toBeVisible();
  await page.getByRole("button", { name: "Child", exact: true }).click();
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const content = page.getByRole("textbox", { name: "内容", exact: true });
  await content.fill("Changed"); await content.press("Tab");
  await expect.poll(() => readSource(page)).toContain("[{Changed},fill=white]");
  expect(await readSource(page)).toContain("[{Root}");
  await expect.poll(() => compilations).toBeGreaterThan(1);
});

test("format panel remains usable in a narrow dark window", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" }); await page.setViewportSize({ width: 1000, height: 760 });
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}\node[draw,rectangle split,rectangle split parts=2,rectangle split horizontal] (A) {Left\nodepart{two}Right};\end{tikzpicture}`);
  await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:0"]').first().click({ force: true });
  await expect(page.getByRole("combobox", { name: "分区排列方向" })).toBeVisible();
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const size = page.getByRole("textbox", { name: "字号", exact: true }); await expect(size).toBeVisible();
  await size.fill("14pt"); await size.press("Tab");
  expect(await readSource(page)).toContain("\\fontsize{14pt}");
  await expect(size).toHaveValue("14pt");
  await expect(page.getByRole("button", { name: "文字颜色", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("format-panel-dark.png"), fullPage: true });
});
