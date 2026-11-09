#!/usr/bin/env node
// Builds the page of a parley from its decisions file, ${XDG_STATE_HOME:-$HOME/.local/state}/parley/<slug>.json, which decisions.mjs reads.
// Usage: build.mjs [--share] <slug> [out.html]
// The page: the title and the goal of the file, then /tmp/pages/<slug>/page.html when it exists, then the block of each
// decision that no tag places, in the order of n.
// - page.html is HTML with the building blocks of artifacts, with no Markdown.
// - <decision n="3">…</decision> places the block of decision 3 there. The block holds two tracks: the number, title,
//   kind and tension of the decision and the HTML inside the tag in the main track, and its card in the side track.
// - {?3} is a blank: the answer to decision 3, or its plan while it is open.
// A contract file and the share copy have no interactive part.
// The page goes to /tmp/pages/<slug>/index.html, or share.html with --share. It comes from artifacts, with the bar of the way back on a live page.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderPage, SourceError } from "../artifacts/render.mjs";
import { decisionsPath, readDecisions, shownLabel } from "./decisions.mjs";
import { blankKind, blankText, freshCard } from "./state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The one form of the decision tag, with no decision tag inside it. Any other <decision or </decision> is an error.
const DECISION = /<decision n="(\d+)">((?:(?!<\/?decision\b)[\s\S])*)<\/decision>/g;
// What keeps its text: a tag, and the code, scripts, styles and SVGs.
const KEPT = /<(?<element>pre|code|script|style|svg)\b[\s\S]*?<\/\k<element>>|<[^>]*>/g;

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const [slug, outPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const share = flags.has("--share");
if (!slug) {
	console.error("usage: build.mjs [--share] <slug> [out.html]");
	process.exit(2);
}

let file;
try {
	file = readDecisions(decisionsPath(slug));
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
// The contract and the share copy are read, not answered: they have no interactive part.
const live = file.status !== "contract" && !share;
// Each decision as the file has it, and as the page data has it.
const decisions = file.decisions.toSorted((a, b) => a.n - b.n).map((decision) => ({ decision, d: pageData(decision) }));
const data = { slug: file.slug, decisions: decisions.map(({ d }) => d) };
const byNumber = new Map(decisions.map((entry) => [entry.d.n, entry]));
const pagePath = join("/tmp/pages", file.slug, "page.html");

// The decisions that a tag of page.html places. The others come after page.html.
const placed = new Set();
let page;
try {
	const source = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";
	// A state line in the text ("Decided: …", "Open: …") goes stale at the first tap. The cards and the blanks show the state.
	const stateLabels = new Set([...source.replace(KEPT, " ").matchAll(/\b(Decided|Open|Next)\s*:/g)].map((match) => match[1]));
	if (stateLabels.size > 1) console.error(`Warning: the page writes the state as text (${[...stateLabels].join(", ")}). It goes stale at the first tap: use blanks {?N}, or leave the state to the cards`);
	const body = placeDecisions(fillBlanks(source));
	const rest = decisions.filter(({ d }) => !placed.has(d.n)).map((entry) => renderBlock(entry, ""));
	const html = `<div class="parley ${file.status}">
<h1>${escapeHtml(file.title)}</h1>
<p class="lead">${escapeHtml(file.goal)}</p>
${body}
${rest.join("\n")}
</div>
<style>${readFileSync(join(here, "cards.css"), "utf8")}</style>
${live ? script() : ""}`;
	// The saved taps belong to these decisions: when you apply answers or change an option, the page starts fresh. A change of wording keeps them.
	const round = createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 8);
	page = await renderPage({ slug: file.slug, key: `${file.slug} ${round}`, title: file.title, body: html, share, out: outPath, base: dirname(pagePath) });
} catch (error) {
	if (!(error instanceof SourceError)) throw error;
	console.error(`${pagePath}: ${error.message}`);
	process.exit(1);
}
const decided = data.decisions.filter((d) => d.decided).length;
console.log(`${page.target} ${page.bytes} bytes, ${decisions.length} decisions (${decided} decided, ${placed.size} placed), colors: ${page.colors}`);

// ---------------------------------------------------------------- data

// What state.mjs and cards.js read of a decision. whose: "your" or "my". answer: the key of the pick, or null for an
// own answer. shown: what the card and its blanks show before the user taps: the answer, or the plan while it is open.
function pageData(decision) {
	const decided = Object.hasOwn(decision, "answer");
	const picked = decided && decision.answer !== "own" ? decision.answer : null;
	return {
		n: decision.n,
		whose: decision.kind === "your call" ? "your" : "my",
		plan: decision.plan,
		decided,
		answer: decided ? picked : undefined,
		labels: Object.fromEntries(decision.options.map((option) => [option.key, option.label])),
		shown: shownLabel(decision),
	};
}

function script() {
	// The page has no modules: each `export function` of state.mjs becomes a plain function.
	const state = readFileSync(join(here, "state.mjs"), "utf8").replace(/^export function /gm, "function ");
	if (/^export\b/m.test(state)) throw new Error("state.mjs can export only with `export function`");
	return `<script type="application/json" id="parley-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
<script>(() => {
${state}
${readFileSync(join(here, "cards.js"), "utf8")}
})();</script>`;
}

// ---------------------------------------------------------------- page parts

// Each <decision n="N">…</decision> of page.html becomes the block of decision N, with the HTML inside the tag.
function placeDecisions(html) {
	const stray = html.replace(DECISION, "").match(/<\/?decision\b[^>]{0,80}>?/i);
	if (stray) throw new SourceError(`Bad decision tag: ${stray[0].replace(/\s+/g, " ")}. Write <decision n="3">…</decision>, with no decision tag inside it`);
	return html.replace(DECISION, (all, number, inside) => {
		const n = Number(number);
		if (!byNumber.has(n)) throw new SourceError(`<decision n="${number}"> names no decision. The decisions are ${[...byNumber.keys()].join(", ")}`);
		if (placed.has(n)) throw new SourceError(`Decision ${n} is placed two times. Write one <decision n="${n}"> tag`);
		placed.add(n);
		return renderBlock(byNumber.get(n), inside);
	});
}

// Alpine attributes go only on a live page: the contract and the share copy stay plain HTML.
// The HTML always gives the state at the start. A live page binds classes as objects, so Alpine can take them away.
function on(attributes) {
	return live ? ` ${attributes}` : "";
}

// A decision block is a .split: its text in the main track, its card in the side track.
function renderBlock(entry, inside) {
	const { decision } = entry;
	const n = decision.n;
	const state = on(`x-data :class="{ asked: $store.parley.card(${n}).ask, changed: $store.parley.changed(${n}) }"`);
	const tension = Object.hasOwn(decision, "tension") ? `<p class="tension">${escapeHtml(decision.tension)}</p>` : "";
	return `<section class="split decision" id="d-${n}"${state}>
<div class="main">
<header><h2><span class="num">${n}</span> ${escapeHtml(decision.title)}</h2> <span class="pill">${escapeHtml(decision.kind)}</span></header>
${tension}${inside}
</div>
<div class="side">${renderCard(entry)}</div>
</section>`;
}

// An open your call shows its options. A my call and a decided call fold to one line: open it to change it.
function renderCard({ decision, d }) {
	const n = d.n;
	const inner = `<div class="opts">${decision.options.map((option) => renderOption(d, option)).join("")}</div>${renderWhy(decision)}${live ? renderActs(d) : ""}`;
	if (d.whose === "your" && !d.decided) return `<div class="dec">${inner}</div>`;
	const shown = `<b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(d.shown)}</b>`;
	const was = d.decided ? "decided" : "my plan";
	const line = `<span class="planline"><span${on(`x-text="$store.parley.changed(${n}) ? 'your pick' : '${was}'"`)}>${was}</span>: ${shown}</span>`;
	return `<details class="dec"${live ? "" : " open"}><summary>${line}</summary>${renderReceipt(decision)}${inner}</details>`;
}

// How the user decided: the label of a pick that has one (an own answer shows it on its line), and his words.
function renderReceipt(decision) {
	const label = Object.hasOwn(decision, "label") && decision.answer !== "own" ? `<p>${escapeHtml(decision.label)}</p>` : "";
	const words = Object.hasOwn(decision, "words") ? `<blockquote>${decision.words.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</blockquote>` : "";
	return label || words ? `<div class="receipt">${label}${words}</div>` : "";
}

function renderOption(d, option) {
	const n = d.n;
	const selected = freshCard(d).pick === option.key;
	const binding = on(`:class="{ sel: $store.parley.card(${n}).pick === '${option.key}' }" @click.prevent="$store.parley.pick(${n}, '${option.key}')"`);
	const badge = option.key === d.plan ? ' <i class="planbadge">plan</i>' : "";
	return `<button class="opt${selected ? " sel" : ""}"${binding}><b class="key">${option.key}</b> ${escapeHtml(option.label)}${badge}</button>`;
}

// The gains and costs of each option that has them, behind a tap.
function renderWhy(decision) {
	const options = decision.options
		.filter((option) => option.gains || option.costs)
		.map((option) => {
			const gains = (option.gains ?? []).map((gain) => `<span class="gain">${escapeHtml(gain)}</span>`).join("");
			const costs = (option.costs ?? []).map((cost) => `<span class="cost">${escapeHtml(cost)}</span>`).join("");
			return `<div class="o"><span class="olabel"><b class="key">${option.key}</b> ${escapeHtml(option.label)}</span>${gains}${costs}</div>`;
		})
		.join("");
	return options && `<details class="why"${share ? " open" : ""}><summary>why</summary>${options}</details>`;
}

// Two small links: a note opens its field, and "explain first" asks for ?N.
function renderActs(d) {
	const n = d.n;
	const note = `$store.back.values['${n} note']`;
	const ask = `$store.back.values['${n} ask']`;
	const placeholder = d.decided ? "Your words: a correction" : "Your words: a note on your pick, or your own answer";
	return `<div class="acts" x-data="{ writing: false }"><a href="#" x-show="!writing && !${note}" @click.prevent="writing = true; $nextTick(() => $refs.note.focus())">add a note</a><a href="#" :class="{ on: ${ask} }" @click.prevent="${ask} = !${ask}">explain first</a>
<textarea rows="2" x-ref="note" x-show="writing || ${note}" x-cloak placeholder="${placeholder}" x-model="${note}"></textarea></div>`;
}

// "{?3}" in the text of page.html becomes a blank: the answer to decision 3, or its plan while it is open.
// Tags, code, scripts, styles and SVGs keep their text.
function fillBlanks(html) {
	return html.replace(new RegExp(`(${KEPT.source})|\\{\\?(\\d+)\\}`, "g"), (all, kept, element, n) => kept ?? renderBlank(Number(n)));
}

function renderBlank(n) {
	if (!byNumber.has(n)) throw new SourceError(`Blank {?${n}} names no decision`);
	const { d } = byNumber.get(n);
	const card = freshCard(d);
	return `<a class="blank ${blankKind(d, card)}"${on(`:class="$store.parley.blank(${n})"`)} href="#d-${n}"${on("x-data")}><b${on(`x-text="$store.parley.shown(${n})"`)}>${escapeHtml(blankText(d, card))}</b><sup>${n}</sup></a>`;
}
