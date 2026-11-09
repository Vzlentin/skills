#!/usr/bin/env node
// The decisions file of a parley, ${XDG_STATE_HOME:-$HOME/.local/state}/parley/<slug>.json. It is the only copy of the
// decisions, from the first round to the contract. Each script that reads a decisions file reads it with readDecisions(),
// and each script that writes one writes it with writeDecisions().
// Usage: decisions.mjs <slug>
// Checks the file of the slug, then prints the state for the chat: the slug, status and title, one line for each
// decision, and the answer line that takes all the plans. At the contract, the path of the file replaces the answer line.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z]$/;
const STATUSES = ["open", "contract"];
const KINDS = ["your call", "my call"];

// The folder of the decisions files: $XDG_STATE_HOME/parley, or ~/.local/state/parley when XDG_STATE_HOME is unset or
// empty. It reads the environment at each call.
export function parleyDir() {
	return join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "parley");
}

export function decisionsPath(slug) {
	return join(parleyDir(), `${slug}.json`);
}

// Returns the data as the file has it. A bad file throws one Error, on one line: the file, the JSON path of the
// bad value and what is expected. A read error passes as Node gives it.
export function readDecisions(path) {
	const text = readFileSync(path, "utf8");
	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		// V8 quotes the source in the message, with its line breaks.
		throw new Error(`${path}: not valid JSON: ${error.message.replace(/\s+/g, " ")}`);
	}
	check(path, () => checkFile(data, basename(path, ".json")));
	return data;
}

// Checks the data, creates the folder when it is missing, writes the file as JSON with tabs, and returns the data.
// Bad data throws the same Error as readDecisions, and the file and the folder do not change.
export function writeDecisions(path, data) {
	check(path, () => checkFile(data, basename(path, ".json")));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
	return data;
}

// The checked data of each .json file in the folder, in the code-unit order of the slugs, or [] when the folder does
// not exist. A bad file throws its readDecisions error.
export function listDecisions(dir = parleyDir()) {
	let names;
	try {
		names = readdirSync(dir);
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	return names
		.filter((name) => name.endsWith(".json"))
		.map((name) => readDecisions(join(dir, name)))
		.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// Returns a new parley with the answers in it, checked, and leaves data as it is. Each update { n, answer, label, words }
// replaces the answer of decision n as one unit: a label or words that the update does not give go. Two updates with
// the same n are an error. status and design_sense replace those of data when they are given. A bad update or result
// throws one Error, on one line: the slug, the JSON path of the bad value and what is expected.
export function applyAnswers(data, answers, { status, design_sense } = {}) {
	const next = structuredClone(data);
	check(next.slug, () => {
		const updated = new Set();
		answers.forEach((update, index) => {
			const at = `answers[${index}]`;
			checkKeys(update, at, ["n", "answer"], ["label", "words"]);
			const decision = next.decisions.find((candidate) => candidate.n === update.n);
			if (!decision) {
				const numbers = next.decisions.map((candidate) => candidate.n).toSorted((a, b) => a - b);
				fail(`${at}.n`, `expected the number of a decision (${numbers.join(", ")})`);
			}
			if (updated.has(update.n)) fail(`${at}.n`, `expected a number that no other update has, ${update.n} is taken`);
			updated.add(update.n);
			decision.answer = update.answer;
			for (const key of ["label", "words"]) {
				if (Object.hasOwn(update, key)) decision[key] = update[key];
				else delete decision[key];
			}
		});
		if (status !== undefined) next.status = status;
		if (design_sense !== undefined) next.design_sense = design_sense;
		checkFile(next, next.slug);
	});
	return next;
}

// Runs a check of the schema. A bad value throws one Error, on one line, with where in front: a file or a slug.
function check(where, run) {
	try {
		run();
	} catch (error) {
		if (!(error instanceof Invalid)) throw error;
		throw new Error(`${where}: ${error.message}`);
	}
}

// A value that breaks the schema. check() puts the file or the slug in front of the message.
class Invalid extends Error {}

// The schema. A key that it does not name is an error at every level. Each string is plain text, and no string or
// list is empty: a file leaves out an optional key in its place. Each loop visits a gap in a list as undefined, so a
// gap fails here: forEach skips a gap, and JSON.stringify writes it as null.
// Top level: slug, status, title, goal and decisions. Optional: evidence, and design_sense, which a contract needs.
function checkFile(data, name) {
	if (!isObject(data)) throw new Invalid("expected a JSON object");
	checkKeys(data, "", ["slug", "status", "title", "goal", "decisions"], ["evidence", "design_sense"]);
	checkText(data.slug, "slug");
	if (!SLUG.test(data.slug)) fail("slug", "expected lowercase words with hyphens");
	if (data.slug !== name) fail("slug", `expected ${name}, the file name without .json`);
	checkChoice(data.status, "status", STATUSES);
	checkText(data.title, "title");
	checkText(data.goal, "goal");
	if (Object.hasOwn(data, "evidence")) checkTexts(data.evidence, "evidence");
	if (Object.hasOwn(data, "design_sense")) checkText(data.design_sense, "design_sense");
	else if (data.status === "contract") fail("design_sense", "expected a string, as the status is contract");
	checkList(data.decisions, "decisions");
	const numbers = new Set();
	for (const [index, decision] of data.decisions.entries()) {
		const at = `decisions[${index}]`;
		checkDecision(decision, at, data.status);
		if (numbers.has(decision.n)) fail(`${at}.n`, `expected a number that no other decision has, ${decision.n} is taken`);
		numbers.add(decision.n);
	}
}

// A decision: n, title, kind, options and plan. Optional: tension, answer, label, which an own answer needs, and
// words, the user's exact words.
function checkDecision(decision, at, status) {
	checkKeys(decision, at, ["n", "title", "kind", "options", "plan"], ["tension", "answer", "label", "words"]);
	if (!Number.isInteger(decision.n) || decision.n <= 0) fail(`${at}.n`, "expected a positive integer");
	checkText(decision.title, `${at}.title`);
	checkChoice(decision.kind, `${at}.kind`, KINDS);
	if (Object.hasOwn(decision, "tension")) checkText(decision.tension, `${at}.tension`);
	checkList(decision.options, `${at}.options`);
	const keys = [];
	for (const [index, option] of decision.options.entries()) {
		checkOption(option, `${at}.options[${index}]`);
		if (keys.includes(option.key)) fail(`${at}.options[${index}].key`, `expected a key that no other option has, ${option.key} is taken`);
		keys.push(option.key);
	}
	if (!keys.includes(decision.plan)) fail(`${at}.plan`, `expected a key of its options (${keys.join(", ")})`);
	if (Object.hasOwn(decision, "answer")) {
		if (decision.answer !== "own" && !keys.includes(decision.answer)) fail(`${at}.answer`, `expected own or a key of its options (${keys.join(", ")})`);
	} else if (status === "contract") {
		fail(`${at}.answer`, "expected an answer, as the status is contract");
	}
	if (Object.hasOwn(decision, "label")) checkText(decision.label, `${at}.label`);
	else if (decision.answer === "own") fail(`${at}.label`, "expected a label, as the answer is own");
	// The exact words can quote code or Markdown.
	if (Object.hasOwn(decision, "words")) checkTexts(decision.words, `${at}.words`, { plain: false });
}

// An option: key and label. Optional: gains and costs.
function checkOption(option, at) {
	checkKeys(option, at, ["key", "label"], ["gains", "costs"]);
	if (typeof option.key !== "string" || !KEY.test(option.key)) fail(`${at}.key`, "expected one lowercase letter");
	checkText(option.label, `${at}.label`);
	if (Object.hasOwn(option, "gains")) checkTexts(option.gains, `${at}.gains`);
	if (Object.hasOwn(option, "costs")) checkTexts(option.costs, `${at}.costs`);
}

function checkKeys(object, at, required, optional) {
	if (!isObject(object)) fail(at, "expected an object");
	const names = [...required, ...optional];
	for (const key of Object.keys(object)) {
		if (!names.includes(key)) fail(child(at, key), `unknown key, expected one of ${names.join(", ")}`);
	}
	for (const key of required) {
		if (!Object.hasOwn(object, key)) fail(child(at, key), "missing, expected a value");
	}
}

function checkText(value, at, { plain = true } = {}) {
	if (typeof value !== "string" || !/\S/.test(value)) fail(at, "expected a string that is not empty");
	if (plain && /`|\*\*/.test(value)) fail(at, "expected plain text, with no backtick and no **");
}

function checkTexts(value, at, options) {
	checkList(value, at);
	for (const [index, entry] of value.entries()) checkText(entry, `${at}[${index}]`, options);
}

function checkList(value, at) {
	if (!Array.isArray(value) || value.length === 0) fail(at, "expected a list that is not empty");
}

function checkChoice(value, at, choices) {
	if (!choices.includes(value)) fail(at, `expected ${choices.map((choice) => JSON.stringify(choice)).join(" or ")}`);
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function child(at, key) {
	return at ? `${at}.${key}` : key;
}

function fail(at, expected) {
	throw new Invalid(`${at}: ${expected}`);
}

// The answer line takes the plan of each open your call, then ok while a my call is open or when nothing is open.
function summary(data, path) {
	const decisions = data.decisions.toSorted((a, b) => a.n - b.n);
	const lines = [[data.slug, data.status, data.title].join(" · ")];
	for (const decision of decisions) lines.push([decision.n, decision.title, decision.kind, ...answered(decision)].join(" · "));
	if (data.status === "contract") {
		lines.push(path);
	} else {
		const open = decisions.filter((decision) => !Object.hasOwn(decision, "answer"));
		const parts = open.filter((decision) => decision.kind === "your call").map((decision) => `${decision.n}${decision.plan}`);
		if (!open.length || open.some((decision) => decision.kind === "my call")) parts.push("ok");
		lines.push(`[${data.slug}] ${parts.join(" ")}`);
	}
	return lines.join("\n");
}

function answered(decision) {
	if (!Object.hasOwn(decision, "answer")) return ["open", `plan ${decision.plan}`, shownLabel(decision)];
	return [decision.answer, shownLabel(decision)];
}

// What stands for a decision: the label of its answer, or of its plan while it is open.
export function shownLabel(decision) {
	if (decision.answer === "own") return decision.label;
	const key = Object.hasOwn(decision, "answer") ? decision.answer : decision.plan;
	return decision.options.find((option) => option.key === key).label;
}

if (import.meta.main) {
	const slug = process.argv[2];
	if (!slug) {
		console.error("usage: decisions.mjs <slug>");
		process.exit(2);
	}
	const path = decisionsPath(slug);
	let data;
	try {
		data = readDecisions(path);
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
	console.log(summary(data, path));
}
