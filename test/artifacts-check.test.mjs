import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildPage, checkPage } from "./artifacts-build.mjs";

const root = mkdtempSync(join(tmpdir(), "artifacts-check-"));
after(() => rmSync(root, { recursive: true, force: true }));

// Builds page.html and its files in <root>/<slug>/, then runs check.mjs on the built page, with args after it.
// Each check takes a few seconds in Chrome, so the checks of the pages run side by side.
function check(slug, page, files, ...args) {
	const built = buildPage(root, slug, page, files);
	if (built.status !== 0) throw new Error(`render.mjs failed on ${slug}: ${built.stderr}`);
	return checkPage(built.out, ...args);
}

// The viewport height of each width of check.mjs.
const VIEWPORTS = { 390: 844, 1280: 800, 1728: 1117 };

// More than 10000 px high at each width. Its headings are more than 3000 px apart,
// and a closed details holds a heading that the page does not show.
const TALL = `<h1>Tall page</h1>
<div style="height: 3000px"></div>
<h2 id="second">Second part</h2>
<details><summary>More</summary><h2>Hidden part</h2></details>
<div style="height: 4000px"></div>
<h2 id="options">Options</h2>
<div style="height: 3000px"></div>
<h3>End</h3>
`;

// The tiles that check.mjs prints, by width: { <width>: [{ file, heading }] }.
function tilesOf(stdout) {
	const groups = {};
	let tiles;
	for (const line of stdout.split("\n")) {
		const group = line.match(/^tiles at (\d+) px:$/);
		const tile = line.match(/^  (\S+\.png)(?:  (.+))?$/);
		if (group) groups[group[1]] = tiles = [];
		else if (tile && tiles) tiles.push({ file: tile[1], heading: tile[2] });
		else tiles = undefined;
	}
	return groups;
}

const [lit, outside, kit, tall, from, nothing, invalid] = await Promise.all([
	check(
		"lit",
		`<h1>Widgets on Lit</h1>
<p>A widget on Lit, a kit widget that draws a widget on Lit, and a tag that no script defines.</p>
<w-plain></w-plain>
<w-outer></w-outer>
<w-missing></w-missing>
<script type="module">
const { html, LitElement } = Lit;
class Plain extends LitElement {
	render() { return html\`<p>plain</p>\`; }
}
class Inner extends LitElement {
	render() { return html\`<p>inner</p>\`; }
}
class Outer extends kit.Widget {
	render() { return html\`<w-inner></w-inner>\`; }
}
customElements.define("w-plain", Plain);
customElements.define("w-inner", Inner);
customElements.define("w-outer", Outer);
</script>
`,
	),
	// The import map gives the esm.sh import a data: module, so Chrome does not go to the network.
	// The check reads the imports as the script writes them. The import() is never called.
	check(
		"outside",
		`<h1>Outside code</h1>
<p>A script file next to the page, and a module script that imports Lit from a CDN.</p>
<script src="app.js"></script>
<script type="importmap">{ "imports": { "https://esm.sh/lit@3.2.1": "data:text/javascript,export const LitElement = HTMLElement;" } }</script>
<script type="module">
import { LitElement } from "https://esm.sh/lit@3.2.1";
const later = () => import("https://esm.sh/htm@3");
</script>
`,
		{ "app.js": "" },
	),
	check(
		"kit",
		`<h1>Kit widgets</h1>
<p>A ready widget and a widget on the kit.</p>
<w-aside>Why is this here?</w-aside>
<w-ok></w-ok>
<script type="module">
const { html } = Lit;
class Ok extends kit.Widget {
	render() { return html\`<p>ok</p>\`; }
}
customElements.define("w-ok", Ok);
</script>
`,
	),
	check("tall", TALL),
	check("from", TALL, {}, "--from", "#options"),
	check("nothing", "<h1>No match</h1>\n", {}, "--from", "#nothing"),
	check("invalid", "<h1>Not a selector</h1>\n", {}, "--from", "#["),
]);
const skip = lit.skip;

test("a widget class that does not extend kit.Widget is a problem that names its tag, in the page and in a shadow root", { skip }, () => {
	assert.equal(lit.status, 1, lit.stderr);
	assert.match(lit.stdout, /^not a kit widget: w-plain, w-inner\. Extend kit\.Widget, with the global Lit and kit$/m);
	assert.match(lit.stdout, /^not started: w-missing\. /m);
});

test("a script that loads code from outside the page is a problem that names each URL", { skip }, () => {
	assert.equal(outside.status, 1, outside.stderr);
	assert.match(outside.stdout, /^outside code: app\.js, https:\/\/esm\.sh\/lit@3\.2\.1, https:\/\/esm\.sh\/htm@3\. /m);
});

test("a ready widget and a kit widget give neither problem", { skip }, () => {
	assert.match(kit.stdout, /^widgets: w-aside, w-ok$/m);
	assert.doesNotMatch(kit.stdout, /^not a kit widget:/m);
	assert.doesNotMatch(kit.stdout, /^outside code:/m);
});

test("the check cuts the whole page into tiles of one viewport at each width", { skip }, () => {
	const groups = tilesOf(tall.stdout);
	for (const [width, viewport] of Object.entries(VIEWPORTS)) {
		const tiles = groups[width];
		assert.ok(tiles?.length, `no tiles at ${width} px:\n${tall.stdout}${tall.stderr}`);
		let total = 0;
		tiles.forEach(({ file }, index) => {
			assert.equal(file, join(root, "tall", "check", `${width}-${index + 1}.png`));
			const png = readFileSync(file);
			assert.equal(png.readUInt32BE(16), Number(width), file);
			const height = png.readUInt32BE(20);
			assert.ok(height > 0 && height <= viewport, `${file} is ${height} px high`);
			if (index < tiles.length - 1) assert.equal(height, viewport, file);
			total += height;
		});
		assert.ok(total > 10000, `the tiles at ${width} px are ${total} px high`);
	}
});

test("each tile names the last heading that the page shows at or above its top", { skip }, () => {
	const groups = tilesOf(tall.stdout);
	for (const width of Object.keys(VIEWPORTS)) assert.equal(groups[width]?.[0]?.heading, "Tall page", width);
	const laptop = groups[1728].map((tile) => tile.heading);
	assert.equal(laptop[2], "Tall page");
	assert.equal(laptop[4], "Second part");
	assert.equal(laptop[8], "Options");
});

test("--from starts the tiles at the first element that matches, at each width", { skip }, () => {
	const all = tilesOf(tall.stdout);
	const groups = tilesOf(from.stdout);
	for (const width of Object.keys(VIEWPORTS)) {
		assert.equal(groups[width]?.[0]?.heading, "Options", `${width}:\n${from.stdout}${from.stderr}`);
		assert.ok(groups[width].length < all[width].length, width);
	}
});

test("a --from that matches no element, or is not a selector, stops the check with exit 2 and one line that names it", { skip }, () => {
	assert.equal(nothing.status, 2, nothing.stderr);
	assert.match(nothing.stderr, /^[^\n]*#nothing[^\n]*\n$/);
	assert.equal(invalid.status, 2, invalid.stderr);
	assert.match(invalid.stderr, /^[^\n]*#\[[^\n]*\n$/);
});
