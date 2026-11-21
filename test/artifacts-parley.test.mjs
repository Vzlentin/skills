import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { startChrome } from "../skills/artifacts/chrome.mjs";
import { buildPage } from "./artifacts-build.mjs";

const root = mkdtempSync(join(tmpdir(), "artifacts-parley-"));

const PARLEY = { id: 1, slug: "lock-owner", title: "Lock owner", goal: "One owner of the install lock", status: "open", at: 0, by: "test" };
const FIELDS = { asker: "test", at: 0, by: "test" };

// Three asks, out of the order of their numbers: a read-back, an open your call, and an answered ask.
const ASKS = [
	{ ...FIELDS, id: 13, parley: { id: 1, n: 3 }, title: "The terms: harness owns the lock", state: "open" },
	{
		...FIELDS,
		id: 11,
		parley: { id: 1, n: 1 },
		title: "Who owns the lock",
		kind: "your call",
		tension: "One lock is simple, but harness must ship first",
		state: "open",
		plan: "b",
		options: [
			{ key: "a", label: "each package has its own lock", costs: ["two installs can race"] },
			{ key: "b", label: "harness owns the lock", gains: ["one lock for all packages"], costs: ["harness must ship first"] },
		],
	},
	{
		...FIELDS,
		id: 12,
		parley: { id: 1, n: 2 },
		title: "Where the lock lives",
		kind: "my call",
		state: "answered",
		author: { kind: "user" },
		answer: "a",
		words: ["keep it next to the package"],
		plan: "b",
		options: [
			{ key: "a", label: "in the package folder" },
			{ key: "b", label: "in the home folder" },
		],
	},
];

const DATA = JSON.stringify({ parley: PARLEY, asks: ASKS }).replaceAll("<", "\\u003c");

// The live page: readAsks gives DATA, and sendAnswers keeps its answers and gives the asks with ask 1 and ask 3 answered.
const LIVE = `<h1>Live parley</h1>
<script>
window.readAsks = async () => (${DATA});
window.sendAnswers = async (answers) => {
	window.sent = answers;
	const { parley, asks } = ${DATA};
	const answered = asks.map((ask) =>
		ask.state === "open" ? { ...ask, state: "answered", author: { kind: "user" }, answer: ask.options ? "b" : "ok" } : ask,
	);
	return { parleys: [{ parley, asks: answered }], asks: [] };
};
</script>
<w-parley></w-parley>
`;

const STATIC = `<h1>Static parley</h1>
<w-parley><script type="application/json">${DATA}</script></w-parley>
`;

let chrome;
let skip;
try {
	chrome = await startChrome();
} catch (error) {
	if (!/No Chrome found/.test(error.message)) throw error;
	skip = error.message;
}

after(async () => {
	await chrome?.close();
	rmSync(root, { recursive: true, force: true });
});

async function evaluate(expression) {
	const { result, exceptionDetails } = await chrome.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	return result.value;
}

// The value of expression once it is truthy, polled for 5 s.
async function until(expression) {
	for (let tries = 0; tries < 50; tries++) {
		const value = await evaluate(expression);
		if (value) return value;
		await sleep(100);
	}
	throw new Error(`still false after 5 s: ${expression}`);
}

// The cards of the widget, in their order on the page.
const CARDS = `(() => {
	const root = document.querySelector("w-parley").shadowRoot;
	const cards = [...root.querySelectorAll("section.ask")].map((card) => ({
		title: card.querySelector(".title b").textContent.trim(),
		decided: card.querySelector(".decided")?.textContent.trim(),
		firstAfterTitle: card.querySelector(".title").nextElementSibling?.className,
		words: card.querySelector(".words")?.textContent.trim(),
		detailsOpen: card.querySelector("details")?.open,
		on: [...card.querySelectorAll("details .opt.on .key")].map((key) => key.textContent),
		buttons: [...card.querySelectorAll("button.opt")].map((button) => ({
			key: button.querySelector(".key").textContent,
			text: button.textContent.replace(/\\s+/g, " ").trim(),
			plan: Boolean(button.querySelector(".badge")),
		})),
	}));
	return cards.length ? cards : undefined;
})()`;

const SHADOW = `document.querySelector("w-parley").shadowRoot`;

async function open(slug, page) {
	const built = buildPage(root, slug, page);
	assert.equal(built.status, 0, built.stderr);
	await chrome.load(`file://${built.out}`);
	return until(CARDS);
}

test("a live parley shows each ask, and one Send sends the plan and the ok", { skip }, async () => {
	const cards = await open("live", LIVE);
	assert.deepEqual(
		cards.map((card) => card.title),
		["1. Who owns the lock", "2. Where the lock lives", "3. The terms: harness owns the lock"],
	);

	const [first, second, third] = cards;
	const b = first.buttons.find((button) => button.key === "b.");
	assert.match(b.text, /\+ one lock for all packages/);
	assert.match(b.text, /− harness must ship first/);
	assert.equal(b.plan, true);
	assert.equal(first.buttons.find((button) => button.key === "a.").plan, false);

	assert.equal(second.decided, "✓ a. in the package folder");
	assert.equal(second.firstAfterTitle, "decided");
	assert.equal(second.detailsOpen, false);
	assert.deepEqual(second.on, ["a."]);
	assert.equal(second.words, "“keep it next to the package”");

	assert.deepEqual(
		third.buttons.map((button) => button.key),
		["ok"],
	);

	await evaluate(`${SHADOW}.querySelectorAll("section.ask")[2].querySelector("button.opt").click()`);
	await until(`${SHADOW}.querySelectorAll("section.ask")[2].querySelector("button.opt.on")`);
	await evaluate(`[...${SHADOW}.querySelectorAll(".foot .btn")].find((button) => button.textContent === "Send").click()`);
	const status = await until(`${SHADOW}.querySelector(".status")?.textContent || ${SHADOW}.querySelector(".foot .count")?.textContent`);
	assert.deepEqual(await evaluate("window.sent"), [
		{ n: 1, answer: "b" },
		{ n: 3, answer: "ok" },
	]);
	assert.equal(status, "sent 2 answers");
	const settled = await until(CARDS);
	assert.equal(settled[0].decided, "✓ b. harness owns the lock");
	assert.equal(settled[2].decided, "✓ ok");
});

test("a static parley shows the answer line of the choices, and Copy", { skip }, async () => {
	await open("static", STATIC);
	const line = () => evaluate(`${SHADOW}.querySelector(".line").textContent`);
	assert.equal(await line(), "[lock-owner] 1b");

	await evaluate(`${SHADOW}.querySelectorAll("section.ask")[2].querySelector("button.opt").click()`);
	await until(`${SHADOW}.querySelector(".line").textContent.endsWith(" ok")`);
	assert.equal(await line(), "[lock-owner] 1b ok");

	await evaluate(`(() => {
		const card = ${SHADOW}.querySelectorAll("section.ask")[0];
		[...card.querySelectorAll("button.opt")].find((button) => button.querySelector(".key").textContent === "own").click();
	})()`);
	await until(`${SHADOW}.querySelector("section.ask input[type=text]")`);
	await evaluate(`(() => {
		const card = ${SHADOW}.querySelectorAll("section.ask")[0];
		const type = (field, text) => {
			field.value = text;
			field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
		};
		type(card.querySelector("input[type=text]"), "no lock");
		type(card.querySelector("textarea"), 'say "never"');
	})()`);
	await until(`${SHADOW}.querySelector(".line").textContent.includes("no lock")`);
	assert.equal(await line(), `[lock-owner] 1:"no lock: say 'never'" ok`);

	assert.ok(await evaluate(`[...${SHADOW}.querySelectorAll(".foot .btn")].some((button) => button.textContent === "Copy")`));
	assert.equal(await evaluate(`[...${SHADOW}.querySelectorAll(".foot .btn")].some((button) => button.textContent === "Send")`), false);
});

test("a static parley with a blank own label gives no answer line, and Copy is disabled", { skip }, async () => {
	await open("static-blank", STATIC);
	await evaluate(`(() => {
		const card = ${SHADOW}.querySelectorAll("section.ask")[0];
		[...card.querySelectorAll("button.opt")].find((button) => button.querySelector(".key").textContent === "own").click();
	})()`);
	const status = await until(`${SHADOW}.querySelector(".status").textContent.includes("ask 1") && ${SHADOW}.querySelector(".status").textContent`);
	assert.match(status, /ask 1: the label is blank/);
	assert.equal(await evaluate(`${SHADOW}.querySelector(".line")?.textContent ?? ""`), "");
	assert.equal(await evaluate(`[...${SHADOW}.querySelectorAll(".foot .btn")].find((button) => button.textContent === "Copy").disabled`), true);
});
