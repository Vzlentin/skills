import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RENDER = fileURLToPath(new URL("../skills/artifacts/render.mjs", import.meta.url));
const CHECK = fileURLToPath(new URL("../skills/artifacts/check.mjs", import.meta.url));

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

// Runs check.mjs on a built page, with no block, as a check takes a few seconds in Chrome.
// skip is the reason to skip a test that needs Chrome, or undefined.
export function checkPage(out) {
	return new Promise((done) =>
		execFile(process.execPath, [CHECK, out], (error, stdout, stderr) => {
			// check.mjs stops with this message when the machine has no Chrome.
			const skip = stderr.match(/^Error: (No Chrome found.*)$/m)?.[1];
			done({ status: error ? error.code : 0, stdout, stderr, skip });
		}),
	);
}
