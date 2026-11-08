import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const RENDER = fileURLToPath(new URL("../skills/artifacts/render.mjs", import.meta.url));
// A 1x1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="probe-rect" width="10" height="10"/></svg>';

const root = mkdtempSync(join(tmpdir(), "artifacts-render-"));
after(() => rmSync(root, { recursive: true, force: true }));

// Writes page.html and its files in <root>/<slug>/, and builds it to an explicit out path.
function build(slug, page, files = {}) {
	const dir = join(root, slug);
	mkdirSync(dir);
	writeFileSync(join(dir, "page.html"), page);
	for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
	const out = join(dir, "index.html");
	const result = spawnSync(process.execPath, [RENDER, join(dir, "page.html"), out], { env: { ...process.env, PAGES_NO_PI: "1" }, encoding: "utf8" });
	return { ...result, html: result.status === 0 ? readFileSync(out, "utf8") : "" };
}

test("the HTML goes into the page with no Markdown conversion", () => {
	const { status, html } = build("plain", "<h1>Plain</h1>\n<p>Some **bold** text</p>\n# heading\n");
	assert.equal(status, 0);
	assert.match(html, /<p>Some \*\*bold\*\* text<\/p>\n# heading\n/);
	assert.doesNotMatch(html, /<strong>bold<\/strong>/);
});

test("the title is the text of the first h1, and the slug is the name of the folder", () => {
	const { status, html } = build("titled", "<h1>Plan &amp; <em>build</em></h1>\n<h1>Second</h1>\n");
	assert.equal(status, 0);
	assert.match(html, /<title>Plan &amp; build<\/title>/);
	assert.match(html, /data-page="titled"/);
});

test("the title reads each named reference of the h1 as HTML does", () => {
	const { status, html, stderr } = build("named", "<h1>Caf&eacute; &rarr; bar &copy 2026 &notit; &constructor;</h1>\n");
	assert.equal(status, 0, stderr);
	assert.match(html, /<title>Café → bar © 2026 ¬it; &amp;constructor;<\/title>/);
});

test("a source with no h1 fails", () => {
	const { status, stderr } = build("untitled", "<h2>Not a title</h2>\n");
	assert.equal(status, 1);
	assert.match(stderr, /<h1>/);
});

test("a diagram with an SVG puts the SVG in the page", () => {
	const { status, html } = build("svg", '<h1>Flow</h1>\n<diagram src="flow.svg" alt="what it shows"></diagram>\n', { "flow.svg": SVG });
	assert.equal(status, 0);
	assert.ok(html.includes(`<figure class="fig" role="img" aria-label="what it shows">${SVG}</figure>`));
	assert.doesNotMatch(html, /<\/?diagram/);
});

test("a diagram alt can hold a >", () => {
	const { status, html, stderr } = build("arrow", '<h1>Arrow</h1>\n<diagram src="flow.svg" alt="A -> B"></diagram>\n', { "flow.svg": SVG });
	assert.equal(status, 0, stderr);
	assert.ok(html.includes('aria-label="A -&gt; B"'));
});

test("a diagram with a PNG gives a data URL", () => {
	const { status, html } = build("png", '<h1>Dot</h1>\n<diagram src="dot.png" alt="a dot"></diagram>\n', { "dot.png": Buffer.from(PNG, "base64") });
	assert.equal(status, 0);
	assert.ok(html.includes(`<img src="data:image/png;base64,${PNG}" alt="a dot">`));
});

test("a diagram with a missing src fails on one line that names the src", () => {
	const { status, stderr } = build("missing", '<h1>Missing</h1>\n<diagram src="nope.svg" alt="x"></diagram>\n');
	assert.equal(status, 1);
	assert.match(stderr, /nope\.svg/);
	assert.equal(stderr.trim().split("\n").length, 1);
});
