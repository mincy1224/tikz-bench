/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { sanitizeSvgFragment, sanitizeSvgMarkup } from "../../packages/app/src/ui/svg-sanitize";

describe("SVG sanitization", () => {
  it("removes executable elements and event handlers", () => {
    const result = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><path onclick="alert(2)" d="M0 0"/></svg>'
    );
    expect(result).not.toMatch(/script|onload|onclick/i);
    expect(result).toContain("<path");
  });

  it("removes external URLs while preserving local SVG references", () => {
    const result = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/><image href="https://example.com/track.png"/><path fill="url(#gradient)"/></svg>'
    );
    expect(result).toContain('href="#shape"');
    expect(result).not.toContain("https://example.com");
    expect(result).toContain("url(#gradient)");
  });

  it("sanitizes fragments without discarding safe drawing elements", () => {
    const result = sanitizeSvgFragment('<g><foreignObject><div>bad</div></foreignObject><circle r="4"/></g>');
    expect(result).not.toMatch(/foreignObject|<div/i);
    expect(result).toContain("circle");
  });
});
