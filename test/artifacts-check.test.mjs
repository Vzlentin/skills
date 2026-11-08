import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildPage, checkPage } from "./artifacts-build.mjs";

const root = mkdtempSync(join(tmpdir(), "artifacts-check-"));
after(() => rmSync(root, { recursive: true, force: true }));

// Builds page.html and its files in <root>/<slug>/, then runs check.mjs on the built page.
// Each check takes a few seconds in Chrome, so the checks of the pages run side by side.
function check(slug, page, files) {
	const built = buildPage(root, slug, page, files);
	if (built.status !== 0) throw new Error(`render.mjs failed on ${slug}: ${built.stderr}`);
	return checkPage(built.out);
}

const [lit, outside, kit] = await Promise.all([
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
