import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readDecisions } from "../skills/parley/decisions.mjs";

const COMMAND = fileURLToPath(new URL("../skills/parley/decisions.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("fixtures/artifacts-retro.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

// The command finds its files from os.homedir(), which reads HOME.
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
	return spawnSync(process.execPath, [COMMAND, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" });
}

// The fixture with one change fails, and the error names the file and the JSON path of the bad value, on one line.
function rejects(change, at, name = "artifacts-retro") {
	const data = structuredClone(fixture);
	change(data);
	const path = join(cases, `${name}.json`);
	writeFileSync(path, JSON.stringify(data, null, 2));
	assert.throws(
		() => readDecisions(path),
		(error) => {
			assert.ok(error.message.startsWith(`${path}: ${at}: `), error.message);
			assert.doesNotMatch(error.message, /\n/);
			return true;
		},
	);
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
