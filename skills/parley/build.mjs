#!/usr/bin/env node
// Builds the page of a parley from one source: Markdown and HTML that you lay out for the topic,
// with a `## Decisions` section in the format of template.md. The record is the same format.
// Usage: build.mjs [--share] <page.md> [out.html]
// - `## Decisions` becomes the cards that no {{card N}} line places elsewhere.
// - {{card 3}}, alone on its line, places card 3 there, with only its options and the reason for its plan: its view holds the rest.
// - {?3} is a blank: the answer to decision 3, or its plan while it is open.
// A live page ends with the bar of the way back. A source with `status: contract` and the share copy have no interactive part.
// The page itself comes from artifacts, diagrams from show-me.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown, escapeHtml, frontmatter, plainText, renderPage } from "../artifacts/render.mjs";
import { renderMermaid } from "../show-me/mermaid.mjs";
import { blankKind, blankText, freshCard } from "./state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The lines of a decision.
const HEADING = /^(\d+) · (.+?) · (your|my) call$/;
const OPTION = /^- ([a-z]) · (.+?)(?: · (plan))?\s*$/;
const GAIN = /^\s+\+ (.*)$/;
const COST = /^\s+- (.*)$/;
const ANSWER = /^Answer: ([a-z]|own)(?: · (.+?))?\s*$/;
// Where cards go: {{card 3}} for one card, {{decisions}} (the `## Decisions` section) for the others.
const PLACE = /^\{\{(?:card (\d+)|decisions)\}\}[ \t]*(?:\n|$)/;

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [sourcePath, outPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const share = flags.has("--share");
if (!sourcePath) {
	console.error("usage: build.mjs [--share] <page.md> [out.html]");
	process.exit(2);
}

const { meta, body } = frontmatter(readFileSync(sourcePath, "utf8"));
if (!meta.page) throw new Error("The source needs a `page:` slug in its frontmatter");
const status = meta.status ?? "open";
if (!["open", "contract"].includes(status)) throw new Error(`Unknown status: ${status}. Write open or contract`);
// The contract and the share copy are read, not answered: they have no interactive part.
const live = status !== "contract" && !share;

// The `## Decisions` section, up to the next `## ` heading, holds the decisions. The page shows cards in its place.
const lines = body.split("\n");
const headings = unfenced(lines).filter((at) => lines[at].startsWith("## "));
const start = headings.find((at) => lines[at].trim() === "## Decisions");
if (start === undefined) throw new Error("The source needs a `## Decisions` section, in the format of template.md");
const end = headings.find((at) => at > start) ?? lines.length;
const decisions = splitAt(lines.slice(start + 1, end).join("\n"), "### ").slice(1).map(parseDecision);
const byNumber = new Map(decisions.map((decision) => [decision.n, decision]));
const pageLines = [...lines.slice(0, start), "", "{{decisions}}", "", ...lines.slice(end)];

// The cards that a {{card N}} line places. The decisions section shows the others.
const placed = new Set();
for (const at of unfenced(pageLines)) {
	const n = Number(pageLines[at].match(PLACE)?.[1]);
	if (!n) continue;
	if (!byNumber.has(n)) throw new Error(`{{card ${n}}} names no decision`);
	if (placed.has(n)) throw new Error(`{{card ${n}}} is on the page twice`);
	placed.add(n);
}

const cards = {
	name: "cards",
	level: "block",
	// Ends a paragraph at a {{card N}} line, so the line needs no blank line before it.
	start: (src) => src.match(/^\{\{(?:card \d+|decisions)\}\}/m)?.index,
	tokenizer(src) {
		const match = src.match(PLACE);
		return match ? { type: "cards", raw: match[0], n: Number(match[1]) } : undefined;
	},
	renderer: ({ n }) => (n ? renderCards([byNumber.get(n)]) : renderSection()),
};
const { markdown: block, inline } = createMarkdown({ base: dirname(resolve(sourcePath)), code: drawDiagram, extensions: [cards] });
// The cards are a part of the page, so this one pass fills the blanks of the page and of the cards.
const pageHtml = fillBlanks(block(pageLines.join("\n")));
const title = plainText(body.match(/^# (.+)$/m)?.[1] ?? meta.title ?? meta.page);

const data = {
	slug: meta.page,
	decisions: decisions.map(({ n, whose, plan, decided, answer, labels, shown }) => ({ n, whose, plan, decided, answer, labels, shown })),
};
const script = () => {
	// The page has no modules: each `export function` of state.mjs becomes a plain function.
	const state = readFileSync(join(here, "state.mjs"), "utf8").replace(/^export function /gm, "function ");
	if (/^export\b/m.test(state)) throw new Error("state.mjs can export only with `export function`");
	return `<script type="application/json" id="parley-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
<script>(() => {
${state}
${readFileSync(join(here, "cards.js"), "utf8")}
})();</script>`;
};

const html = `<div class="parley ${status}">
${pageHtml}
${live ? bar() : ""}
</div>
<style>${readFileSync(join(here, "cards.css"), "utf8")}</style>
${live ? script() : ""}`;

// The saved taps belong to these decisions: when you apply answers or change an option, the page starts fresh. A change of wording keeps them.
const round = createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 8);
const page = await renderPage({ slug: meta.page, key: `${meta.page} ${round}`, title, body: html, share, out: outPath });
const decided = decisions.filter((decision) => decision.decided).length;
console.log(`${page.target} ${page.bytes} bytes, ${decisions.length} decisions (${decided} decided, ${placed.size} placed), colors: ${page.colors}`);

// ---------------------------------------------------------------- source

// The indexes of the lines outside a fenced code block.
function unfenced(lines) {
	let fenced = false;
	return lines.flatMap((line, at) => {
		if (/^(```|~~~)/.test(line)) fenced = !fenced;
		return fenced || /^(```|~~~)/.test(line) ? [] : [at];
	});
}

// Splits before each line that starts with `marker`, but not inside a fenced code block.
function splitAt(text, marker) {
	const lines = text.split("\n");
	const starts = new Set(unfenced(lines).filter((at) => lines[at].startsWith(marker)));
	const parts = [[]];
	lines.forEach((line, at) => (starts.has(at) ? parts.push([line.slice(marker.length)]) : parts.at(-1).push(line)));
	return parts.map((part) => part.join("\n"));
}

// A decision, in this order:
// - "### 3 · How you answer · your call"
// - the tension, the options with their gains and costs, and the reason for the plan
// - on a decided card: "Answer: <letter or own>", the user's words as a quote, then the follow-up
function parseDecision(chunk) {
	const [heading, ...lines] = chunk.split("\n");
	const match = heading.trim().match(HEADING);
	if (!match) throw new Error(`Bad decision heading: "### ${heading.trim()}". Write "### <n> · <title> · your call" or "· my call"`);
	const n = Number(match[1]);

	const answerAt = lines.findIndex((line) => ANSWER.test(line));
	const card = answerAt < 0 ? lines : lines.slice(0, answerAt);
	const optionsAt = indexFrom(card, 0, (line) => OPTION.test(line));
	const whyAt = indexFrom(card, optionsAt, (line) => line.trim() !== "" && ![OPTION, GAIN, COST].some((pattern) => pattern.test(line)));
	const options = parseOptions(card.slice(optionsAt, whyAt));

	const answer = answerAt < 0 ? undefined : lines[answerAt].match(ANSWER);
	const rest = answerAt < 0 ? [] : lines.slice(answerAt + 1);
	const afterAt = indexFrom(rest, 0, (line) => line.trim() !== "" && !line.startsWith(">"));
	const receipt = rest.slice(0, afterAt).join("\n");

	const planned = options.filter((option) => option.plan);
	if (planned.length !== 1) {
		throw new Error(`Decision ${n} has ${planned.length} plan options, it needs 1. Write each option on its own line as "- a · **label**", and end one of them with " · plan"`);
	}
	const decided = Boolean(answer);
	const picked = decided && answer[1] !== "own" ? answer[1] : null;
	if (picked && !options.some((option) => option.key === picked)) throw new Error(`Decision ${n} answers "${picked}", which is not an option`);
	if (decided && !receipt.trim()) console.error(`Warning: decision ${n} has an answer but not the user's words. Under "Answer:", quote them: > "words"`);
	const own = decided && !picked ? (answer[2] ?? receipt.match(/"([^"]+)"/)?.[1]) : undefined;
	const labels = Object.fromEntries(options.map((option) => [option.key, label(option.label)]));
	const plan = planned[0].key;
	return {
		n,
		title: match[2],
		whose: match[3],
		options,
		tension: card.slice(0, optionsAt).join("\n"),
		why: card.slice(whyAt).join("\n"),
		decided,
		answer: decided ? picked : undefined,
		own,
		receipt,
		after: rest.slice(afterAt).join("\n"),
		plan,
		labels,
		// What the card and its blanks show before the user picks: the answer, or the plan while the decision is open.
		shown: !decided ? labels[plan] : picked ? labels[picked] : (own ?? "your own answer"),
	};
}

function parseOptions(lines) {
	const options = [];
	for (const line of lines) {
		const [option, gain, cost] = [OPTION, GAIN, COST].map((pattern) => line.match(pattern));
		if (option) options.push({ key: option[1], label: option[2], plan: Boolean(option[3]), gains: [], costs: [] });
		else if (gain) options.at(-1).gains.push(gain[1]);
		else if (cost) options.at(-1).costs.push(cost[1]);
	}
	return options;
}

// The index of the first line from `from` that passes `test`, or the length.
function indexFrom(lines, from, test) {
	const at = lines.findIndex((line, index) => index >= from && test(line));
	return at < 0 ? lines.length : at;
}

// ---------------------------------------------------------------- page parts

// A Mermaid block becomes the SVG of show-me, in the page colors.
function drawDiagram({ text, lang }) {
	if ((lang ?? "").trim().split(/\s+/)[0] === "mermaid") return `<figure class="fig">${renderMermaid(text, { large: true })}</figure>\n`;
}

// Alpine attributes go only on a live page: the contract and the share copy stay plain HTML.
// The HTML always gives the state at the start. A live page binds classes as objects, so Alpine can take them away.
function on(attributes) {
	return live ? ` ${attributes}` : "";
}

// The section shows the cards that no {{card N}} placed, under its own heading.
function renderSection() {
	const rest = decisions.filter((decision) => !placed.has(decision.n));
	return rest.length ? `<h2 id="decisions">Decisions</h2>\n${renderCards(rest)}` : "";
}

// An open your call is a card. A my call and a decided call fold to one line, in one box.
function renderCards(list) {
	const isCard = (decision) => decision.whose === "your" && !decision.decided;
	const open = list.filter(isCard).map(renderCard).join("\n");
	const folded = list.filter((decision) => !isCard(decision)).map(renderCard).join("\n");
	return `${open && `<div class="cards">${open}</div>`}${folded && `<div class="rows">${folded}</div>`}\n`;
}

function renderCard(decision) {
	const n = decision.n;
	const state = on(`x-data :class="{ asked: $store.parley.card(${n}).ask, changed: $store.parley.changed(${n}) }"`);
	const head = `<span class="num">${n}</span><span class="dtitle">${inline(decision.title)}</span>`;
	const tension = decision.tension.trim() && !placed.has(n) ? `<div class="tension">${block(decision.tension)}</div>` : "";
	const opts = `<div class="opts">${decision.options.map((option) => renderOption(decision, option)).join("")}</div>`;
	const inner = `${opts}${renderWhy(decision)}${live ? renderActs(decision) : ""}`;
	if (decision.whose === "your" && !decision.decided) return `<article class="dec" id="d-${n}"${state}><header>${head}</header>${tension}${inner}</article>`;
	const shown = `<b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(decision.shown)}</b>`;
	const was = decision.decided ? "decided" : "my plan";
	const line = `<span class="planline"><span${on(`x-text="$store.parley.changed(${n}) ? 'your pick' : '${was}'"`)}>${was}</span>: ${shown}</span>`;
	const receipt = decision.receipt.trim() ? `<div class="receipt">${block(decision.receipt)}</div>` : "";
	const after = decision.after.trim() ? `<div class="after">${block(decision.after)}</div>` : "";
	return `<details class="dec" id="d-${n}"${state}${live ? "" : " open"}><summary>${head}${line}</summary>${receipt}${after}${tension}${inner}</details>`;
}

function renderOption(decision, option) {
	const n = decision.n;
	const selected = freshCard(decision).pick === option.key;
	const binding = on(`:class="{ sel: $store.parley.card(${n}).pick === '${option.key}' }" @click.prevent="$store.parley.pick(${n}, '${option.key}')"`);
	const badge = option.plan ? ' <i class="planbadge">plan</i>' : "";
	return `<button class="opt${selected ? " sel" : ""}"${binding}><b class="key">${option.key}</b> ${inline(option.label)}${badge}</button>`;
}

// The gains and costs of each option, and the reason for the plan, behind a tap. A placed card shows only the reason.
function renderWhy(decision) {
	const why = decision.why.trim() ? block(decision.why) : "";
	if (placed.has(decision.n)) return why && `<div class="reason">${why}</div>`;
	const options = decision.options
		.filter((option) => option.gains.length || option.costs.length)
		.map((option) => {
			const gains = option.gains.map((gain) => `<span class="gain">${inline(gain)}</span>`).join("");
			const costs = option.costs.map((cost) => `<span class="cost">${inline(cost)}</span>`).join("");
			return `<div class="o"><span class="olabel"><b class="key">${option.key}</b> ${inline(option.label)}</span>${gains}${costs}</div>`;
		})
		.join("");
	return options || why ? `<details class="why"${share ? " open" : ""}><summary>why</summary>${options}${why}</details>` : "";
}

// Two small links: a note opens its field, and "explain first" asks for ?N.
function renderActs(decision) {
	const n = decision.n;
	const note = `$store.back.values['${n} note']`;
	const ask = `$store.back.values['${n} ask']`;
	const placeholder = decision.decided ? "Your words: a correction" : "Your words: a note on your pick, or your own answer";
	return `<div class="acts" x-data="{ writing: false }"><a href="#" x-show="!writing && !${note}" @click.prevent="writing = true; $nextTick(() => $refs.note.focus())">add a note</a><a href="#" :class="{ on: ${ask} }" @click.prevent="${ask} = !${ask}">explain first</a>
<textarea rows="2" x-ref="note" x-show="writing || ${note}" x-cloak placeholder="${placeholder}" x-model="${note}"></textarea></div>`;
}

// "{?3}" in the text of the page becomes a blank: the answer to decision 3, or its plan while it is open.
// Tags, code, scripts, styles and SVGs keep their text.
function fillBlanks(html) {
	return html.replace(/(<(pre|code|script|style|svg)\b[\s\S]*?<\/\2>|<[^>]*>)|\{\?(\d+)\}/g, (all, kept, name, n) => kept ?? renderBlank(Number(n)));
}

function renderBlank(n) {
	const decision = byNumber.get(n);
	if (!decision) throw new Error(`Blank {?${n}} names no decision`);
	const card = freshCard(decision);
	return `<a class="blank ${blankKind(decision, card)}"${on(`:class="$store.parley.blank(${n})"`)} href="#d-${n}"${on("x-data")}><b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(blankText(decision, card))}</b><sup>${n}</sup></a>`;
}

// The bar of the way back of artifacts: one row with the answer line and Copy. Clear sits above it, once there is something to clear.
function bar() {
	return `<p class="reset" x-data x-show="Object.keys($store.back.edits).length" x-cloak><a href="#" @click.prevent="confirm('Clear your answers and notes?') && $store.back.reset()">Clear my answers</a></p>
<div class="bar" x-data>
  <div class="line" x-text="$store.back.text"></div>
  <button class="primary" x-show="typeof sendPrompt === 'function'" x-cloak @click="sendPrompt($store.back.text)">Send</button><button class="primary" @click="$store.back.copy()">Copy</button>
</div>`;
}

// ---------------------------------------------------------------- text helpers

// A label for a blank, a button or a title: plain text, with no closing "(...)".
function label(markdown) {
	return plainText(markdown).replace(/\s*\(.*?\)\s*$/, "");
}
