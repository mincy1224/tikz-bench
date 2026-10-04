import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readSource, setSource } from "./helpers";

const multipart = String.raw`\begin{tikzpicture}\node[rectangle split,rectangle split parts=3,rectangle split horizontal,draw,rectangle split part fill={white,none,red!15}] (A) {First\nodepart{two}$\frac{x^2}{\sqrt{y}}$\nodepart{three}中文};\draw[-{Stealth[length=8pt]}] (A.east)--++(1,0);\end{tikzpicture}`;

test("offline formula, independent partition editing and undo", async ({ page, context }) => {
  const external: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^https?:/u.test(url) && !url.startsWith("http://127.0.0.1:4173/")) { external.push(url); await route.abort(); }
    else await route.continue();
  });
  await gotoApp(page);
  await setSource(page, multipart);
  const canvas = page.getByTestId("canvas-svg-layer");
  await expect(canvas.locator('[data-text-renderer="mathjax"]')).not.toHaveCount(0);
  await canvas.locator('[data-source-id="path:0"]').first().click({ force: true });
  const first = page.getByRole("textbox", { name: "分区 1 内容" });
  await expect(first).toBeVisible();
  await first.fill("First changed");
  await first.press("Tab");
  expect(await readSource(page)).toContain(String.raw`First changed\nodepart{two}$\frac{x^2}{\sqrt{y}}$\nodepart{three}中文`);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(multipart);
  await first.fill("Cancelled preview");
  await first.press("Escape");
  await expect.poll(() => readSource(page)).toBe(multipart);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});

test("arrow precision values preserve opposite end and round option", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}\draw[{Circle[open]}-{Stealth[round,length=8pt]}] (0,0)--(3,0);\end{tikzpicture}`);
  await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:0"]').first().click({ force: true });
  const width = page.getByRole("textbox", { name: "end:width", exact: true });
  await expect(width).toBeVisible();
  await width.fill("3mm");
  await width.press("Tab");
  const source = await readSource(page);
  expect(source).toContain("Circle[open]");
  expect(source).toContain("round");
  expect(source).toContain("width=");
});
