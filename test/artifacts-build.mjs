import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RENDER = fileURLToPath(new URL("../skills/artifacts/render.mjs", import.meta.url));

// Writes page.html and its files in <root>/<slug>/, and builds it to <root>/<slug>/index.html.
export function buildPage(root, slug, page, files = {}) {
	const dir = join(root, slug);
	mkdirSync(dir);
	writeFileSync(join(dir, "page.html"), page);
	for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
	const out = join(dir, "index.html");
	const result = spawnSync(process.execPath, [RENDER, join(dir, "page.html"), out], { env: { ...process.env, PAGES_NO_PI: "1" }, encoding: "utf8" });
	return { ...result, out };
}
