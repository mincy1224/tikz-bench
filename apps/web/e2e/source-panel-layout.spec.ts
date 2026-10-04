import { expect, test } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("source editor keeps gutter and content aligned without an outer scroll", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`);

  const metrics = await page.locator(".cm-editor").first().evaluate((editor) => {
    const content = editor.querySelector<HTMLElement>(".cm-content .cm-line");
    const gutter = editor.querySelector<HTMLElement>(".cm-lineNumbers .cm-gutterElement");
    const tab = editor.closest<HTMLElement>(".flexlayout__tab");
    if (!content || !gutter || !tab) throw new Error("Source editor layout was not mounted");
    return {
      contentTop: content.getBoundingClientRect().top,
      gutterTop: gutter.getBoundingClientRect().top,
      tabScrollHeight: tab.scrollHeight,
      tabClientHeight: tab.clientHeight,
      tabOverflowY: getComputedStyle(tab).overflowY,
      scrollerOverflowY: getComputedStyle(editor.querySelector<HTMLElement>(".cm-scroller")!).overflowY,
      scrollerOverflowX: getComputedStyle(editor.querySelector<HTMLElement>(".cm-scroller")!).overflowX,
      lineHeight: content.getBoundingClientRect().height
    };
  });

  expect(Math.abs(metrics.contentTop - metrics.gutterTop)).toBeLessThanOrEqual(2);
  expect(metrics.tabScrollHeight).toBeLessThanOrEqual(metrics.tabClientHeight + 1);
  expect(metrics.tabOverflowY).toBe("hidden");
  expect(metrics.scrollerOverflowY).toBe("auto");
  expect(metrics.scrollerOverflowX).toBe("auto");
  expect(metrics.lineHeight).toBeGreaterThan(8);
  expect(metrics.lineHeight).toBeLessThan(40);
});
