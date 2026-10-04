import { describe, expect, it } from "vitest";
import { localizeAppMenuDefinition, translateUiText } from "../../packages/app/src/i18n/ui-localization.js";
import type { AppMenuDefinition } from "../../packages/app/src/app-menu/types.js";

describe("UI localization", () => {
  it("uses accurate bilingual labels for domain terms", () => {
    expect(translateUiText("Inspector", "zh-CN")).toBe("属性检查器（Inspector）");
    expect(translateUiText("Node", "zh-CN")).toBe("节点（Node）");
    expect(translateUiText("Export SVG", "zh-CN")).toBe("导出 SVG");
    expect(translateUiText("TikZ", "zh-CN")).toBe("TikZ");
  });

  it("keeps English labels unchanged", () => {
    expect(translateUiText("Inspector", "en")).toBe("Inspector");
  });

  it("localizes nested menu labels without changing command ids", () => {
    const menu: AppMenuDefinition = [{
      id: "file",
      label: "File",
      items: [{ kind: "submenu", label: "Export", items: [{ kind: "command", commandId: "file.export-svg-download", label: "Export SVG" }] }]
    }];
    const localized = localizeAppMenuDefinition(menu, "zh-CN");
    expect(localized[0]?.label).toBe("文件");
    expect(localized[0]?.items[0]).toMatchObject({ label: "导出", items: [{ commandId: "file.export-svg-download", label: "导出 SVG" }] });
  });
});
