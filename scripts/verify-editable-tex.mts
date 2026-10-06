import { loadConfig } from "../apps/server/src/config.js";
import { compileLatex, compileLatexPdf } from "../apps/server/src/latex/compiler.js";
import { instrumentAdvancedDocument } from "../packages/core/src/edit/advanced-instrumentation.js";

const fixtures = [
  ["forest", String.raw`\begin{forest}for tree={rectangle split,rectangle split parts=2,rectangle split horizontal,draw,font=\small}
[{Root \nodepart{two} 根节点} [{A \nodepart{two} 内容},rectangle split uses custom fill,rectangle split part fill={none,red!15}] [{B},draw=blue]]\end{forest}`],
  ["plots", String.raw`\begin{tikzpicture}\begin{axis}[xlabel={$x$},ylabel={$y$}]\addplot+[red] coordinates {(1,2)(2,3)(3,1)};\addplot[blue,domain=1:3] {x^2};\end{axis}\end{tikzpicture}`],
  ["circuit", String.raw`\begin{circuitikz}\draw (0,0) to[R,l=$R$,name=resistor] (2,0) to[C,l=$C$] (2,2);\end{circuitikz}`]
] as const;
const config = loadConfig([]);
for (const [label, source] of fixtures) {
  const compilation = instrumentAdvancedDocument(source);
  const result = await compileLatex(compilation.source, config);
  for (const binding of compilation.bindings) {
    const markers = result.markers.filter((marker) => marker.key === binding.key);
    const plot = new RegExp(`id=['"]tb-plot-${binding.key}['"]`, "u").test(result.svg);
    if (!markers.length && !plot) throw new Error(`${label}: no mapping for ${binding.id}`);
    if (binding.pointCount && markers.filter((marker) => marker.anchor.startsWith("point")).length !== binding.pointCount) throw new Error(`${label}: incomplete point mapping`);
    if (markers.some((marker) => !Number.isFinite(marker.x) || !Number.isFinite(marker.y))) throw new Error(`${label}: invalid geometry`);
  }
  // Export the user snapshot, never the instrumented compile copy.
  const pdf = await compileLatexPdf(source, config);
  console.log(`${label}: ${compilation.bindings.length} mappings; SVG ${result.svg.length} bytes; PDF ${pdf.pdf.length} bytes`);
}
console.log("TeX editable mapping checks passed.");
