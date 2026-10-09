import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const node = String.raw`\begin{tikzpicture}\node[draw,font=\small\bfseries] (A) at (0,0) {A};\node[draw,font=\Large\itshape] (B) at (3,0) {B};\end{tikzpicture}`;

test("mixed font, units, IME, cancellation and one-step undo share field behavior", async ({ page }) => {
  await gotoApp(page); await setSource(page, node);
  const canvas = page.getByTestId("canvas-svg-layer");
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  await canvas.locator('[data-source-id="path:1"]').first().click({ force: true, modifiers: ["Shift"] });
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const size = page.getByRole("textbox", { name: "字号", exact: true });
  await expect(size).toHaveAttribute("placeholder", "多个值");
  await size.fill("16pt"); await size.press("Escape");
  await expect.poll(() => readSource(page)).toBe(node);
  await size.fill("16pt"); await size.press("Tab");
  const changed = await readSource(page);
  expect(changed.match(/fontsize\{16pt\}/gu)).toHaveLength(2);
  expect(changed).toContain("\\bfseries"); expect(changed).toContain("\\itshape");
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(node);
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  const content = page.getByRole("textbox", { name: "内容", exact: true });
  await content.dispatchEvent("compositionstart"); await content.fill("中文");
  expect(await readSource(page)).toBe(node);
  await content.dispatchEvent("compositionend"); await content.press("Tab");
  await expect.poll(() => readSource(page)).toContain("{中文}");
  await page.getByRole("tab", { name: "图形", exact: true }).click();
  const width = page.getByRole("textbox", { name: "线宽", exact: true });
  await width.fill("2mm"); await width.press("Tab");
  expect(await readSource(page)).toContain("line width=5.690551181");
});

test("property previews never save; draft export, retry and undo preserve the current source", async ({ page }) => {
  await gotoApp(page); await setSource(page, node);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:0"]').first().click({ force: true });
  await page.getByRole("tab", { name: "文字", exact: true }).click();
  const size = page.getByRole("textbox", { name: "字号", exact: true });
  let saves = 0, fail = true;
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    saves++;
    if (fail) return route.fulfill({ status: 503, json: { error: "offline fixture" } });
    return route.continue();
  });
  await size.fill("18pt"); await page.waitForTimeout(900); expect(saves).toBe(0);
  await size.press("Escape"); await expect.poll(() => readSource(page)).toBe(node);
  await size.fill("24pt"); await size.press("Tab"); const draft = await readSource(page);
  let exported = "";
  await page.route("**/export/tex", async (route) => {
    exported = (route.request().postDataJSON() as { source: string }).source;
    await route.fulfill({ body: exported, contentType: "text/plain" });
  });
  await page.getByRole("button", { name: "Download TeX", exact: true }).click();
  await expect.poll(() => exported).toBe(draft);
  await expect(page.getByRole("alert").filter({ hasText: "草稿未保存" })).toBeVisible();
  fail = false; await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(await readSource(page)).toBe(draft);
  await openMenuCommand(page, "edit", "edit.undo"); await expect.poll(() => readSource(page)).toBe(node);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const project = await page.request.get(`/api/projects/${page.url().split("/").at(-1)}`).then((response) => response.json()) as { project: { source: string } };
  expect(project.project.source).toBe(node);
});

test("an old slow save cannot overwrite a newly opened project", async ({ page }) => {
  await gotoApp(page); await setSource(page, node);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const oldId = page.url().split("/").at(-1);
  let release!: () => void, started = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/projects/${oldId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    started = true; await gate; await route.continue();
  });
  await setSource(page, node.replace("{A}", "{Old draft}"));
  await expect.poll(() => started).toBe(true);
  const newSource = String.raw`\begin{tikzpicture}\node[draw] {New project};\end{tikzpicture}`;
  const response = await page.request.post("/api/projects", { data: { name: `Switch ${Date.now()}`, source: newSource } });
  const created = await response.json() as { project: { id: string } };
  await page.goto(`/project/${created.project.id}`); await expect.poll(() => readSource(page)).toBe(newSource);
  release(); await page.waitForTimeout(1100); expect(await readSource(page)).toBe(newSource);
});
