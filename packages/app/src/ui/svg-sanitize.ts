const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
  "style",
  "animate",
  "animatemotion",
  "animatetransform",
  "set"
]);

const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);

function isSafeUrl(value: string): boolean {
  const normalized = stripControlAndWhitespace(value).toLowerCase();
  return normalized === "" || normalized.startsWith("#") || normalized.startsWith("data:image/png;base64,") ||
    normalized.startsWith("data:image/jpeg;base64,") || normalized.startsWith("data:image/webp;base64,") ||
    normalized.startsWith("data:image/gif;base64,");
}

function hasUnsafeCss(value: string): boolean {
  const normalized = stripControlAndWhitespace(value).toLowerCase();
  return normalized.includes("javascript:") || normalized.includes("expression(") ||
    (/url\(/i.test(normalized) && !/url\(['"]?#[-_a-z0-9:.]+['"]?\)/i.test(normalized));
}

function stripControlAndWhitespace(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || code === 0x7f ? "" : character;
  }).join("");
}

export function sanitizeSvgElement(root: SVGSVGElement): SVGSVGElement {
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (BLOCKED_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) ||
        ((name === "style" || name === "filter" || name === "clip-path" || name === "mask" || name === "fill" || name === "stroke") && hasUnsafeCss(attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return root;
}

export function sanitizeSvgMarkup(markup: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return markup;
  }
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName.toLowerCase() !== "svg") {
    throw new Error("The SVG markup could not be parsed safely.");
  }
  return new XMLSerializer().serializeToString(sanitizeSvgElement(parsed.documentElement as unknown as SVGSVGElement));
}

export function sanitizeSvgFragment(markup: string): string {
  const wrapped = sanitizeSvgMarkup(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  const parsed = new DOMParser().parseFromString(wrapped, "image/svg+xml");
  return parsed.documentElement.innerHTML;
}

