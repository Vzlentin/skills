import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyAnswers, decisionsPath, listDecisions, parleyDir, readDecisions, writeDecisions } from "../skills/parley/decisions.mjs";

const COMMAND = fileURLToPath(new URL("../skills/parley/decisions.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("fixtures/artifacts-retro.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

// The command finds its files from os.homedir(), which reads HOME, as XDG_STATE_HOME is empty.
const home = mkdtempSync(join(tmpdir(), "parley-decisions-"));
const state = join(home, ".local/state/parley");
const cases = join(home, "cases");
mkdirSync(state, { recursive: true });
mkdirSync(cases);
after(() => rmSync(home, { recursive: true, force: true }));

// Written in the file order 1, 2, 4, 3, 5: the summary goes in the order of n.
const OPEN = {
	slug: "stack-070",
	status: "open",
	title: "stack 070 roadmap",
	goal: "Ship the stack in waves, harness first.",
	decisions: [
		{
			n: 1,
			title: "Wave order",
			kind: "your call",
			options: [
				{ key: "a", label: "harness, then workflows", gains: ["one release a day"] },
				{ key: "b", label: "both at once" },
			],
			plan: "a",
		},
		{
			n: 2,
			title: "Lock file",
			kind: "your call",
			options: [
				{ key: "a", label: "in the repository" },
				{ key: "b", label: "in the state folder" },
			],
			plan: "b",
		},
		{
			n: 4,
			title: "Release notes",
			kind: "your call",
			options: [
				{ key: "a", label: "one note per wave" },
				{ key: "b", label: "one note at the end" },
			],
			plan: "a",
		},
		{
			n: 3,
			title: "Stale lock",
			kind: "my call",
			options: [
				{ key: "a", label: "a dead PID is taken over", gains: ["a spike took the lock of a killed install"] },
				{ key: "b", label: "a timeout" },
			],
			plan: "a",
		},
		{
			n: 5,
			title: "Docs",
			kind: "your call",
			options: [
				{ key: "a", label: "a page per package" },
				{ key: "b", label: "one page" },
			],
			plan: "a",
			answer: "own",
			label: "the README only",
			words: ["just the README"],
		},
	],
};

function write(name, text) {
	const path = join(state, `${name}.json`);
	writeFileSync(path, text);
	return path;
}

function run(...args) {
	return spawnSync(process.execPath, [COMMAND, ...args], { env: { ...process.env, HOME: home, XDG_STATE_HOME: "" }, encoding: "utf8" });
}

// Sets each variable of env, or deletes it when its value is undefined.
function setEnv(env) {
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

// Runs fn with the variables of env, then puts the old values back.
function withEnv(env, fn) {
	const old = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
	setEnv(env);
	try {
		return fn();
	} finally {
		setEnv(old);
	}
}

// An error check for assert.throws: one line that starts with prefix.
function oneLine(prefix) {
	return (error) => {
		assert.ok(error.message.startsWith(prefix), error.message);
		assert.doesNotMatch(error.message, /\n/);
		return true;
	};
}

// The fixture with one change fails, and the error names the file and the JSON path of the bad value, on one line.
function rejects(change, at, name = "artifacts-retro") {
	const data = structuredClone(fixture);
	change(data);
	const path = join(cases, `${name}.json`);
	writeFileSync(path, JSON.stringify(data, null, 2));
	assert.throws(() => readDecisions(path), oneLine(`${path}: ${at}: `));
}

test("the fixture passes as it is", () => {
	assert.deepEqual(readDecisions(FIXTURE), fixture);
});

test("the command prints each decision of the contract, then the path of the file", () => {
	const path = write("artifacts-retro", readFileSync(FIXTURE, "utf8"));
	const result = run("artifacts-retro");
	assert.equal(result.status, 0, result.stderr);
	const lines = result.stdout.trimEnd().split("\n");
	assert.equal(lines.length, 13);
	assert.equal(lines[0], "artifacts-retro · contract · artifacts and parley: decisions as data, pages as building blocks");
	for (let n = 1; n <= 11; n++) assert.ok(lines[n].startsWith(`${n} · `), lines[n]);
	assert.equal(lines[1], "1 · Page shape · your call · own · the cause is the Markdown base of pages: see 9 to 11");
	assert.equal(lines[10], "10 · Where the contract lives · your call · b · the state folder, ~/.local/state/parley/<slug>.json");
	assert.equal(lines[12], path);
	assert.ok(!lines.some((line) => line.startsWith("[")));
});

test("an unknown key fails at every level", () => {
	rejects((data) => (data.owner = "me"), "owner");
	rejects((data) => (data.decisions[2].owner = "me"), "decisions[2].owner");
	rejects((data) => (data.decisions[1].options[0].owner = "me"), "decisions[1].options[0].owner");
});

test("a plan that is not an option fails", () => {
	rejects((data) => (data.decisions[3].plan = "z"), "decisions[3].plan");
});

test("a duplicate number fails at the later decision", () => {
	rejects((data) => (data.decisions[4].n = 4), "decisions[4].n");
});

test("a duplicate option key fails at the later option", () => {
	rejects((data) => (data.decisions[0].options[1].key = "a"), "decisions[0].options[1].key");
});

test("an own answer with no label fails", () => {
	rejects((data) => delete data.decisions[0].label, "decisions[0].label");
});

test("a contract with an unanswered decision fails", () => {
	rejects((data) => delete data.decisions[5].answer, "decisions[5].answer");
});

test("a slug that is not the file name fails", () => {
	rejects(() => {}, "slug", "other-name");
});

test("Markdown in a string fails", () => {
	rejects((data) => (data.decisions[1].title = "What `w-*` widgets are for"), "decisions[1].title");
});

test("the command on an open file gives the answer line with each open your call and ok for the open my call", () => {
	write("stack-070", JSON.stringify(OPEN, null, 2));
	const result = run("stack-070");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		result.stdout,
		`stack-070 · open · stack 070 roadmap
1 · Wave order · your call · open · plan a · harness, then workflows
2 · Lock file · your call · open · plan b · in the state folder
3 · Stale lock · my call · open · plan a · a dead PID is taken over
4 · Release notes · your call · open · plan a · one note per wave
5 · Docs · your call · own · the README only
[stack-070] 1a 2b 4a ok
`,
	);
});

test("the answer line drops ok when no my call is open, and keeps only ok when nothing is open", () => {
	const data = structuredClone(OPEN);
	data.decisions[3].answer = "a";
	write("stack-070", JSON.stringify(data));
	assert.equal(run("stack-070").stdout.trimEnd().split("\n").at(-1), "[stack-070] 1a 2b 4a");
	for (const decision of data.decisions) decision.answer ??= decision.plan;
	write("stack-070", JSON.stringify(data));
	assert.equal(run("stack-070").stdout.trimEnd().split("\n").at(-1), "[stack-070] ok");
});

test("the command gives one error line and exit 1 for invalid JSON", () => {
	const path = write("broken", '{\n  "slug": "broken",\n  "status": \n}\n');
	const result = run("broken");
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr.trimEnd().split("\n").length, 1, result.stderr);
	assert.ok(result.stderr.startsWith(`${path}: not valid JSON: `), result.stderr);
});

test("the command gives one error line and exit 1 for a missing file", () => {
	const result = run("missing");
	assert.equal(result.status, 1);
	assert.equal(result.stderr.trimEnd().split("\n").length, 1, result.stderr);
	assert.match(result.stderr, /missing\.json/);
});

test("the command with no slug prints its usage and exits with 2", () => {
	const result = run();
	assert.equal(result.status, 2);
	assert.ok(result.stderr.startsWith("usage: decisions.mjs <slug>"), result.stderr);
});

// An open file with count decisions: 1 to 5 are open your calls, and the others are decided.
function writeCalls(count) {
	const slug = `calls-${count}`;
	const decisions = Array.from({ length: count }, (_, index) => ({ ...OPEN.decisions[0], n: index + 1, ...(index < 5 ? {} : { answer: "b" }) }));
	write(slug, JSON.stringify({ ...OPEN, slug, decisions }));
	return slug;
}

test("the command warns on one stderr line with the number when an open file has more than 9 decisions", () => {
	const result = run(writeCalls(10));
	assert.equal(result.status, 0, result.stderr);
	const lines = result.stdout.trimEnd().split("\n");
	assert.equal(lines.length, 12);
	assert.equal(lines[0], "calls-10 · open · stack 070 roadmap");
	assert.equal(lines[10], "10 · Wave order · your call · b · both at once");
	assert.equal(lines[11], "[calls-10] 1a 2a 3a 4a 5a");
	assert.match(result.stderr, /^.+\n$/);
	assert.match(result.stderr, /\b10\b/);
});

test("the warning comes before the state, so the answer line is the last line of stdout and stderr together", () => {
	const slug = writeCalls(10);
	// One file for both streams: file writes are synchronous, so the file keeps the order of the writes.
	const out = join(home, "merged.txt");
	const fd = openSync(out, "w");
	try {
		spawnSync(process.execPath, [COMMAND, slug], { env: { ...process.env, HOME: home, XDG_STATE_HOME: "" }, stdio: ["ignore", fd, fd] });
	} finally {
		closeSync(fd);
	}
	const lines = readFileSync(out, "utf8").trimEnd().split("\n");
	assert.equal(lines.length, 13);
	assert.equal(lines.at(-1), "[calls-10] 1a 2a 3a 4a 5a");
});

test("the command gives no warning for an open file with 9 decisions", () => {
	const result = run(writeCalls(9));
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
});

test("the command gives no warning for a contract, also above 9 decisions", () => {
	write("artifacts-retro", readFileSync(FIXTURE, "utf8"));
	const result = run("artifacts-retro");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
});

test("parleyDir is XDG_STATE_HOME/parley, or ~/.local/state/parley when XDG_STATE_HOME is unset or empty", () => {
	const xdg = join(home, "xdg");
	withEnv({ XDG_STATE_HOME: xdg }, () => {
		assert.equal(parleyDir(), join(xdg, "parley"));
		assert.equal(decisionsPath("stack-070"), join(xdg, "parley/stack-070.json"));
	});
	withEnv({ XDG_STATE_HOME: "", HOME: home }, () => assert.equal(parleyDir(), state));
	withEnv({ XDG_STATE_HOME: undefined, HOME: home }, () => assert.equal(parleyDir(), state));
});

test("the command reads the file from XDG_STATE_HOME/parley when it is set", () => {
	const xdg = join(home, "xdg");
	mkdirSync(join(xdg, "parley"), { recursive: true });
	writeFileSync(join(xdg, "parley/xdg-only.json"), JSON.stringify({ ...OPEN, slug: "xdg-only" }));
	const result = spawnSync(process.execPath, [COMMAND, "xdg-only"], { env: { ...process.env, HOME: home, XDG_STATE_HOME: xdg }, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.ok(result.stdout.startsWith("xdg-only · open · stack 070 roadmap\n"), result.stdout);
});

test("writeDecisions creates the folder, writes JSON with tabs and returns the data", () => {
	const path = join(home, "write/new/stack-070.json");
	assert.equal(writeDecisions(path, OPEN), OPEN);
	const text = readFileSync(path, "utf8");
	assert.ok(text.startsWith('{\n\t"slug": "stack-070",\n\t"status": "open",\n'), text);
	assert.equal(text, `${JSON.stringify(OPEN, null, "\t")}\n`);
	assert.deepEqual(readDecisions(path), OPEN);
});

test("writeDecisions with bad data throws one line and changes no file and no folder", () => {
	const path = join(home, "write/stack-070.json");
	writeDecisions(path, OPEN);
	const before = readFileSync(path, "utf8");
	const badPlan = structuredClone(OPEN);
	badPlan.decisions[0].plan = "z";
	for (const [data, at] of [
		[{ ...OPEN, slug: "other-name" }, "slug"],
		[badPlan, "decisions[0].plan"],
	]) {
		assert.throws(() => writeDecisions(path, data), oneLine(`${path}: ${at}: `));
		assert.equal(readFileSync(path, "utf8"), before);
	}
	const missing = join(home, "write/missing/stack-070.json");
	assert.throws(() => writeDecisions(missing, badPlan), oneLine(`${missing}: decisions[0].plan: `));
	assert.ok(!existsSync(join(home, "write/missing")));
});

test("writeDecisions with a gap in a list throws one line and changes no file", () => {
	const path = join(home, "write-gap/stack-070.json");
	writeDecisions(path, OPEN);
	const before = readFileSync(path, "utf8");
	const decisions = [];
	decisions[0] = OPEN.decisions[0];
	decisions[2] = OPEN.decisions[2];
	const gapOptions = structuredClone(OPEN);
	const options = gapOptions.decisions[0].options;
	options[2] = options[1];
	delete options[1];
	const words = [];
	words[1] = "just the README";
	const gapWords = structuredClone(OPEN);
	gapWords.decisions[4].words = words;
	for (const [data, at] of [
		[{ ...OPEN, decisions }, "decisions[1]"],
		[gapOptions, "decisions[0].options[1]"],
		[gapWords, "decisions[4].words[0]"],
	]) {
		assert.throws(() => writeDecisions(path, data), oneLine(`${path}: ${at}: `));
		assert.equal(readFileSync(path, "utf8"), before);
	}
});

test("listDecisions gives [] for a missing folder", () => {
	assert.deepEqual(listDecisions(join(home, "no-such-folder")), []);
});

test("listDecisions gives the checked data of each .json file, in the order of slug", () => {
	const dir = join(home, "list");
	for (const slug of ["b", "a-b", "a"]) writeDecisions(join(dir, `${slug}.json`), { ...OPEN, slug });
	writeFileSync(join(dir, "notes.txt"), "not a decisions file");
	const list = listDecisions(dir);
	// A sort by file name gives a-b.json first: "-" comes before ".".
	assert.deepEqual(list.map((data) => data.slug), ["a", "a-b", "b"]);
	assert.deepEqual(list[0], { ...OPEN, slug: "a" });
});

test("listDecisions throws the error of a bad file, with its path", () => {
	const dir = join(home, "list-bad");
	writeDecisions(join(dir, "good.json"), { ...OPEN, slug: "good" });
	const path = join(dir, "bad.json");
	writeFileSync(path, JSON.stringify({ ...OPEN, slug: "other-name" }));
	assert.throws(() => listDecisions(dir), oneLine(`${path}: slug: `));
});

test("listDecisions with no folder reads parleyDir()", () => {
	const xdg = join(home, "list-xdg");
	writeDecisions(join(xdg, "parley/only.json"), { ...OPEN, slug: "only" });
	withEnv({ XDG_STATE_HOME: xdg }, () => assert.deepEqual(listDecisions().map((data) => data.slug), ["only"]));
});

test("applyAnswers sets a pick with no label and no words, and an own answer with its label and words", () => {
	const next = applyAnswers(OPEN, [
		{ n: 1, answer: "b" },
		{ n: 2, answer: "own", label: "next to the store", words: ["put it next to `store.db`"] },
	]);
	assert.deepEqual(next.decisions[0], { ...OPEN.decisions[0], answer: "b" });
	assert.deepEqual(next.decisions[1], { ...OPEN.decisions[1], answer: "own", label: "next to the store", words: ["put it next to `store.db`"] });
	assert.deepEqual(next.decisions.slice(2), OPEN.decisions.slice(2));
	assert.equal(next.status, "open");
	assert.ok(!Object.hasOwn(next, "design_sense"));
});

test("a pick on an own answer removes its label and words, and a pick with a note keeps its words", () => {
	const next = applyAnswers(OPEN, [
		{ n: 5, answer: "b" },
		{ n: 4, answer: "b", words: ["b, one note is enough"] },
	]);
	const { label, words, ...docs } = OPEN.decisions[4];
	assert.deepEqual(next.decisions[4], { ...docs, answer: "b" });
	assert.deepEqual(next.decisions[2], { ...OPEN.decisions[2], answer: "b", words: ["b, one note is enough"] });
});

test("applyAnswers leaves its input as it is, also when it throws", () => {
	const data = structuredClone(OPEN);
	const answers = [
		{ n: 5, answer: "a" },
		{ n: 1, answer: "b" },
	];
	applyAnswers(data, answers);
	assert.throws(() => applyAnswers(data, [...answers, { n: 2, answer: "z" }]), oneLine("stack-070: decisions[1].answer: "));
	assert.deepEqual(data, OPEN);
	assert.deepEqual(answers, [
		{ n: 5, answer: "a" },
		{ n: 1, answer: "b" },
	]);
});

test("applyAnswers with status and design_sense gives a contract that writeDecisions accepts", () => {
	const answers = OPEN.decisions.filter((decision) => !Object.hasOwn(decision, "answer")).map((decision) => ({ n: decision.n, answer: decision.plan }));
	const next = applyAnswers(OPEN, answers, { status: "contract", design_sense: "none" });
	assert.equal(next.status, "contract");
	assert.equal(next.design_sense, "none");
	assert.deepEqual(next.decisions[4], OPEN.decisions[4]);
	const path = join(home, "contract/stack-070.json");
	writeDecisions(path, next);
	assert.deepEqual(readDecisions(path), next);
});

test("applyAnswers throws one line with the slug and the JSON path of the bad value", () => {
	const bad = [
		[[{ n: 9, answer: "a" }], "answers[0].n"],
		[[{ n: 1, answer: "a", note: "a note" }], "answers[0].note"],
		[[{ n: 1 }], "answers[0].answer"],
		[[{ n: 1, answer: "z" }], "decisions[0].answer"],
		[[{ n: 2, answer: "own" }], "decisions[1].label"],
		[
			[
				{ n: 1, answer: "a" },
				{ n: 1, answer: "b" },
			],
			"answers[1].n",
		],
	];
	for (const [answers, at] of bad) assert.throws(() => applyAnswers(OPEN, answers), oneLine(`stack-070: ${at}: `));
	assert.throws(() => applyAnswers(OPEN, [{ n: 9, answer: "a" }]), /\(1, 2, 3, 4, 5\)/);
	assert.throws(() => applyAnswers(OPEN, [], { status: "contract", design_sense: "none" }), oneLine("stack-070: decisions[0].answer: "));
});

test("applyAnswers with a gap in the words of an update throws one line", () => {
	const words = [];
	words[1] = "b, one note is enough";
	assert.throws(() => applyAnswers(OPEN, [{ n: 4, answer: "b", words }]), oneLine("stack-070: decisions[2].words[0]: "));
	assert.throws(() => applyAnswers(OPEN, [{ n: 1, answer: "b", words }]), oneLine("stack-070: decisions[0].words[0]: "));
});
