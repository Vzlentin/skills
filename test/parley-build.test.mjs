import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPage } from "./artifacts-build.mjs";

const BUILD = fileURLToPath(new URL("../skills/parley/build.mjs", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("fixtures/artifacts-retro.json", import.meta.url)), "utf8"));

// build.mjs reads the decisions file from os.homedir(), which reads HOME, and page.html from /tmp/pages/<slug>/.
const home = mkdtempSync(join(tmpdir(), "parley-build-"));
const state = join(home, ".local/state/parley");
mkdirSync(state, { recursive: true });
const prefix = `parley-build-test-${process.pid}`;
const slugs = [];
after(() => {
	rmSync(home, { recursive: true, force: true });
	for (const slug of slugs) rmSync(join("/tmp/pages", slug), { recursive: true, force: true });
});

// Decision 1 is an open your call with gains and costs, 2 an open my call with gains and costs, 3 a decided your call.
// The file has them in the order 2, 1, 3. Its strings hold HTML characters: the page shows them as text.
const DECISIONS = [
	{
		n: 2,
		title: "Stale lock",
		kind: "my call",
		options: [
			{ key: "a", label: "a dead PID is taken over", gains: ["after kill -9 on the holder, the next install took the lock"] },
			{ key: "b", label: "a timeout", costs: ["a slow install loses its lock"] },
		],
		plan: "a",
	},
	{
		n: 1,
		title: "Lock owner",
		kind: "your call",
		tension: "Two installs write the same <folder> & race.",
		options: [
			{ key: "a", label: "harness owns the lock", gains: ["one lock for all packages"], costs: ["harness must ship first"] },
			{ key: "b", label: "each package has its own lock", costs: ["two installs can race"] },
		],
		plan: "a",
	},
	{
		n: 3,
		title: "Lock file",
		kind: "your call",
		options: [
			{ key: "a", label: "in the state folder" },
			{ key: "b", label: "in the repository" },
		],
		plan: "a",
		answer: "b",
		words: ["b, it must be in Git"],
	},
];

// Writes the decisions file of a new slug, and its page.html when there is one, then runs build.mjs.
// The page goes to its default place, /tmp/pages/<slug>/index.html, or share.html with --share.
function build(name, file, page, { flags = [], files = {} } = {}) {
	const slug = `${prefix}-${name}`;
	slugs.push(slug);
	writeFileSync(join(state, `${slug}.json`), JSON.stringify({ ...file, slug }));
	const dir = join("/tmp/pages", slug);
	mkdirSync(dir, { recursive: true });
	if (page !== undefined) writeFileSync(join(dir, "page.html"), page);
	for (const [fileName, text] of Object.entries(files)) writeFileSync(join(dir, fileName), text);
	const result = spawnSync(process.execPath, [BUILD, ...flags, slug], { env: { ...process.env, HOME: home, PAGES_NO_PI: "1" }, encoding: "utf8" });
	const out = join(dir, flags.includes("--share") ? "share.html" : "index.html");
	return { ...result, slug, dir, out, html: existsSync(out) ? readFileSync(out, "utf8") : undefined };
}

const open = { status: "open", title: "install lock: who owns it", goal: "One lock for two installs.", decisions: DECISIONS };

// The block of decision n, from its tag to the end of its section.
function block(html, n) {
	return html.match(new RegExp(`<section class="split decision" id="d-${n}"[\\s\\S]*?</section>`))?.[0] ?? "";
}

function why(html, n) {
	return block(html, n).match(/<details class="why"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
}

// About 1500 px of text inside the tag of decision 1, on a live page: the card beside it keeps the side track in use.
const long = build("long", open, `<decision n="1">\n${`<p>${"The install writes the folder, then the lock file, then the manifest. ".repeat(6)}</p>\n`.repeat(9)}</decision>\n`);
const checked = await checkPage(long.out);
const skip = checked.skip;

const placed = build("placed", open, `<p>The lock: {?1}. A stale lock: {?2}. The file: {?3}.</p>\n<decision n="1"><p id="view-1">The view of decision 1.</p><diagram src="flow.svg" alt="the lock"></diagram></decision>\n`, { files: { "flow.svg": '<svg xmlns="http://www.w3.org/2000/svg" id="flow"></svg>' } });

test("a placed decision and an unplaced decision show the gains and costs of their options under why", () => {
	assert.equal(placed.status, 0, placed.stderr);
	assert.match(why(placed.html, 1), /<span class="gain">one lock for all packages<\/span><span class="cost">harness must ship first<\/span>/);
	assert.match(why(placed.html, 1), /<span class="cost">two installs can race<\/span>/);
	assert.match(why(placed.html, 2), /<span class="gain">after kill -9 on the holder, the next install took the lock<\/span>/);
	assert.match(why(placed.html, 2), /<span class="cost">a slow install loses its lock<\/span>/);
	assert.doesNotMatch(block(placed.html, 3), /class="why"/);
});

test("the HTML inside the tag goes into the main track of the block, and the file strings are text", () => {
	const main = block(placed.html, 1).match(/<div class="main">[\s\S]*?<div class="side">/)?.[0] ?? "";
	assert.match(main, /<p id="view-1">The view of decision 1\.<\/p><figure class="fig" role="img" aria-label="the lock"><svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" id="flow"><\/svg><\/figure>/);
	assert.match(main, /Two installs write the same &lt;folder&gt; &amp; race\./);
});

test("each decision is on the page one time: the placed one where its tag is, the others after page.html in the order of n", () => {
	const order = [...placed.html.matchAll(/<section class="split decision" id="d-(\d+)"/g)].map((match) => match[1]);
	assert.deepEqual(order, ["1", "2", "3"]);
	assert.ok(placed.html.indexOf('id="view-1"') < placed.html.indexOf('id="d-2"'));
	assert.match(placed.stdout, /3 decisions \(1 decided, 1 placed\)/);
});

test("a blank shows the label of the plan while the decision is open, and the label of the answer once it is decided", () => {
	assert.match(placed.html, /<a class="blank open"[^>]*href="#d-1"[^>]*><b[^>]*>harness owns the lock<\/b><sup>1<\/sup><\/a>/);
	assert.match(placed.html, /<a class="blank plan"[^>]*href="#d-2"[^>]*><b[^>]*>a dead PID is taken over<\/b><sup>2<\/sup><\/a>/);
	assert.match(placed.html, /<a class="blank set"[^>]*href="#d-3"[^>]*><b[^>]*>in the repository<\/b><sup>3<\/sup><\/a>/);
});

test("a tag that names no decision stops the build with an error that names it", () => {
	const result = build("unknown", open, `<decision n="9"><p>Nine.</p></decision>`);
	assert.equal(result.status, 1);
	assert.equal(result.stderr, `${join(result.dir, "page.html")}: <decision n="9"> names no decision. The decisions are 1, 2, 3\n`);
	assert.equal(result.html, undefined);
});

test("a decision placed two times stops the build with an error that names it", () => {
	const result = build("twice", open, `<decision n="2"><p>One.</p></decision>\n<decision n="2"><p>Two.</p></decision>`);
	assert.equal(result.status, 1);
	assert.equal(result.stderr, `${join(result.dir, "page.html")}: Decision 2 is placed two times. Write one <decision n="2"> tag\n`);
	assert.equal(result.html, undefined);
});

test("an invalid decisions file stops the build with the message of the validator, and writes no page", () => {
	const { goal, ...noGoal } = open;
	const result = build("invalid", noGoal, `<p>A page.</p>`);
	assert.equal(result.status, 1);
	assert.equal(result.stderr, `${join(state, `${result.slug}.json`)}: goal: missing, expected a value\n`);
	assert.equal(result.html, undefined);
});

test("the contract of the fixture builds with its 11 decisions and no interactive part", () => {
	const result = build("fixture", FIXTURE);
	assert.equal(result.status, 0, result.stderr);
	for (let n = 1; n <= 11; n++) assert.equal(result.html.split(`id="d-${n}"`).length, 2, `decision ${n}`);
	assert.doesNotMatch(result.html, /id="parley-data"|\$store\.parley/);
	// Decision 10 picks b and also has a label: the line gives the option, the card gives the label and the words.
	assert.match(block(result.html, 10), /decided<\/span>: <b>the state folder, ~\/\.local\/state\/parley\/&lt;slug&gt;\.json<\/b>/);
	assert.match(block(result.html, 10), /<p>one file with 9: the file of the first round/);
	assert.match(block(result.html, 10), /<blockquote><p>\[artifacts-retro\] 1a 2b 3a ok<\/p>/);
});

test("the share copy has no interactive part", () => {
	const result = build("share", open, `<decision n="1"><p>The view.</p></decision>`, { flags: ["--share"] });
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.html, /id="parley-data"|\$store\.parley/);
	assert.match(why(result.html, 1), /^<details class="why" open>/);
});

test("a long decision keeps one left edge, a used side track, no sideways scroll and no script error", { skip }, () => {
	assert.equal(long.status, 0, long.stderr);
	assert.match(checked.stdout, /^column: one left edge$/m);
	assert.match(checked.stdout, /^side track: used, main \d+ px$/m);
	assert.doesNotMatch(checked.stdout, /^sideways:/m);
	assert.match(checked.stdout, /^errors: none$/m);
});
