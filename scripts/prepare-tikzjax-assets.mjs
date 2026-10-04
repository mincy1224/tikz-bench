import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreRequire = createRequire(path.join(repoRoot, "packages", "core", "package.json"));
const source = path.join(repoRoot, "node_modules", "@drgrice1", "tikzjax", "dist");
const destination = path.join(repoRoot, "packages", "app", "public", "vendor", "tikzjax");

await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });


const vendor = path.dirname(destination);
await cp(path.dirname(coreRequire.resolve("mathjax/package.json")), path.join(vendor, "mathjax"), { recursive: true });
await cp(path.dirname(coreRequire.resolve("@mathjax/mathjax-newcm-font/package.json")), path.join(vendor, "fonts", "mathjax-newcm-font"), { recursive: true });
