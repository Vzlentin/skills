#!/usr/bin/env node
// Checks a built page in headless Chrome: the errors of its scripts, the w- tags that did not start,
// the widgets that do not extend kit.Widget, the scripts that load code from outside the page,
// the players that do not move, the layout, and tiles of one viewport at 390, 1280 and 1728 px.
// The layout: one left edge, the shell's width and two tracks on a laptop, no side track left empty for long on a laptop, no sideways scroll on a phone,
// and the same colors in a light and in a dark setting of the viewer.
// Usage: check.mjs <page.html | url> [out dir] [--from <selector>]
// The tiles go to <directory of the page>/check/<width>-<n>.png by default. They start at the top of the page,
// or at the first element that matches --from, and each tile names the heading that it starts at.
// CHROME=<path> picks the browser.
// The exit code is 1 when the check finds a problem, and 2 for a wrong argument or a --from that matches no element.
//
// The tiles ask for reduced motion: CSS transitions do not run in headless Chrome, and players
// do not start by themselves. The player check presses play and waits one second of real time,
// because --virtual-time-budget does not move requestAnimationFrame.
// Fixed and sticky parts show where they are with the page at its top.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startChrome } from "./chrome.mjs";

// A phone, a small laptop, and a large laptop. The layout checks run on the large laptop.
const SIZES = [
	[390, 844],
	[1280, 800],
	[1728, 1117],
];
const LAPTOP = SIZES[2];
// The side track may stay empty beside this much text, in CSS pixels: a part of a screen.
const MAX_EMPTY_SIDE = 700;

// A wrong argument that the check finds in the page: it stops the check with exit 2, after Chrome closes.
class Stop extends Error {}

// Each w- tag of the page and of the widgets' own shadow roots, in the order it first appears, with its state:
// "stopped" when no script defined it, "kit" when its class extends kit.Widget, and "other" for any other class.
// The state belongs to the tag, because all its elements share one definition in the global registry.
const LIST_WIDGETS = `(() => {
	const Widget = window.kit?.Widget;
	const found = {};
	const visit = (root) => {
		for (const element of root.querySelectorAll("*")) {
			const tag = element.localName;
			const definition = customElements.get(tag);
			if (tag.startsWith("w-")) found[tag] = !definition ? "stopped" : Widget && definition.prototype instanceof Widget ? "kit" : "other";
			if (element.shadowRoot) visit(element.shadowRoot);
		}
	};
	visit(document);
	return found;
})()`;

// A page function: the text of an element on one line, cut at length characters.
const SNIPPET = `(element, length) => element.textContent.trim().replace(/\\s+/g, " ").slice(0, length)`;
// A page function: the top of an element in the page, rounded down to a whole px.
// The headings and --from share it, so that a --from on a heading names that heading in tile 1.
const TOP = `(element) => Math.floor(element.getBoundingClientRect().top + scrollY)`;

// The layout of main, in one pass. It gives { off, twoTracks, width, page, measure, empty }, or { ..., skipped } when main has no text.
// off: the parts of the flow that start left or right of the column, or end right of it: a page with them has more than one left edge.
//   The flow is the children of main, and of the plain blocks in it (no background, border, shadow, grid or flex).
// twoTracks: a probe .split puts its second child right of its first. A page that sets its own --page or --measure
//   gets one track: --measure:none makes the grid template invalid, and a narrow --page leaves main under the width of two tracks.
// empty: the stretches where the side track is empty, taller than MAX_EMPTY_SIDE: the text runs alone there, and the width goes unused.
//   The main track ends at the right edge of the probe's first child. Content right of it is text, an image, a control, a widget, or a box.
const LAYOUT = `(() => {
	const main = document.querySelector("main");
	const style = getComputedStyle(main);
	const box = main.getBoundingClientRect();
	const left = box.left + parseFloat(style.paddingLeft);
	const right = box.right - parseFloat(style.paddingRight);
	const snippet = ${SNIPPET};
	const plain = (element) => {
		const s = getComputedStyle(element);
		return s.display === "block" && s.backgroundColor === "rgba(0, 0, 0, 0)" && !(parseFloat(s.borderLeftWidth) > 0) && s.boxShadow === "none" && !element.localName.includes("-");
	};
	const off = [];
	const walk = (parent) => {
		for (const element of parent.children) {
			const s = getComputedStyle(element);
			if (!element.getClientRects().length || element.matches(".bar,.toast,script,style") || s.position === "absolute" || s.position === "fixed") continue;
			if (plain(element) && element.children.length && !element.matches("p,h1,h2,h3,h4,ul,ol,dl,blockquote,pre,table")) { walk(element); continue; }
			const rect = element.getBoundingClientRect();
			if (Math.abs(rect.left - left) > 1 || rect.right > right + 1)
				off.push(element.localName + (element.className ? "." + String(element.className).split(" ")[0] : "") + " at " + Math.round(rect.left - left) + ".." + Math.round(rect.right - right) + " px: " + snippet(element, 40));
		}
	};
	walk(main);

	const probe = main.appendChild(document.createElement("div"));
	probe.className = "split";
	probe.append(document.createElement("div"), document.createElement("div"));
	const [first, second] = [...probe.children].map((child) => child.getBoundingClientRect());
	probe.remove();
	const layout = {
		off,
		twoTracks: second.left > first.right,
		width: Math.round(right - left),
		page: style.getPropertyValue("--page").trim(),
		measure: style.getPropertyValue("--measure").trim(),
	};
	if (!layout.twoTracks) return layout;

	const track = first.right;
	const top = (rect) => rect.top + scrollY;
	const spans = [];
	const text = [];
	for (const element of main.querySelectorAll("*")) {
		if (element.closest(".bar,.reset,script,style")) continue;
		const rect = element.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		const s = getComputedStyle(element);
		const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
		const boxed = s.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== "none";
		const drawn = element.matches("img,svg,canvas,video,input,textarea,button,select") || element.localName.includes("-");
		if (own) text.push({ y: top(rect), text: snippet(element, 50) });
		if (rect.right > track + 8 && (own || boxed || drawn)) spans.push([top(rect), top(rect) + rect.height]);
	}
	if (!text.length) return { ...layout, skipped: "main has no text to check" };
	const start = Math.min(...text.map((item) => item.y));
	const end = top(box) + box.height - parseFloat(style.paddingBottom);
	spans.sort((a, b) => a[0] - b[0]);
	const empty = [];
	let from = start;
	for (const [a, b] of [...spans, [end, end]]) {
		if (a - from > ${MAX_EMPTY_SIDE}) empty.push({ from: Math.round(from), to: Math.round(a), text: text.find((item) => item.y >= from - 4)?.text ?? "" });
		from = Math.max(from, b);
	}
	return { ...layout, empty };
})()`;

// An import or import() of an http:, https: or // URL, with the URL in group 2.
const IMPORT = /\bimport\s*(?:\(\s*|[\w$\s{},*]*?\bfrom\s*)?(["'`])((?:https?:)?\/\/[^"'`\s]+)\1/gi;
// The code that the scripts of the page load from outside it: each src, and each import of a URL.
// Only the scripts that run as code: a JSON block or an import map is data.
const OUTSIDE_CODE = `(() => {
	const urls = [];
	for (const script of document.querySelectorAll("script")) {
		if (script.type && !/^(module|(text|application)\\/(x-)?(java|ecma)script)$/i.test(script.type.trim())) continue;
		if (script.hasAttribute("src")) urls.push(script.getAttribute("src"));
		for (const match of script.text.matchAll(${IMPORT})) urls.push(match[2]);
	}
	return [...new Set(urls)];
})()`;

// The page is wider than the phone: it scrolls sideways.
const SIDEWAYS = `document.documentElement.scrollWidth - innerWidth`;
const BACKGROUND = `getComputedStyle(document.body).backgroundColor`;

// The h1, h2 and h3 that the page shows, in page order, with their top in the page, rounded down, and their text.
// A heading in a closed details, or with display none, has a top too: checkVisibility() removes it.
const HEADINGS = `[...document.querySelectorAll("h1,h2,h3")].filter((element) => element.checkVisibility()).map((element) => ({
	top: (${TOP})(element),
	text: (${SNIPPET})(element, 60),
}))`;

// { top } of the first element that matches the selector, or { reason } when there is none.
// The selector goes in as a JSON string, so that no quote in it ends the code.
const FROM = (selector) => `(() => {
	let element;
	try {
		element = document.querySelector(${JSON.stringify(selector)});
	} catch {
		return { reason: "is not a valid selector" };
	}
	return element ? { top: (${TOP})(element) } : { reason: "matches no element" };
})()`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --from takes the next argument. The other arguments are the page and the out dir, in this order.
const positional = [];
let from;
let usage = false;
for (let i = 2; i < process.argv.length; i++) {
	if (process.argv[i] !== "--from") positional.push(process.argv[i]);
	else if (i + 1 < process.argv.length) from = process.argv[++i];
	else usage = true;
}
const [target, outArg] = positional;
if (!target || usage) {
	console.error("usage: check.mjs <page.html | url> [out dir] [--from <selector>]");
	process.exit(2);
}
const local = existsSync(target);
const url = local ? pathToFileURL(resolve(target)).href : target;
const out = resolve(outArg ?? (local ? join(dirname(resolve(target)), "check") : "check"));
mkdirSync(out, { recursive: true });

const cdp = await startChrome();
let problems = 0;
let stop;
try {
	const errors = new Set();
	cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: e }) => errors.add(e.exception?.description ?? e.text));
	cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
		if (type === "error") errors.add(args.map((arg) => arg.value ?? arg.description).join(" "));
	});
	cdp.on("Log.entryAdded", ({ entry }) => {
		if (entry.level === "error") errors.add(`${entry.text}${entry.url ? ` (${entry.url})` : ""}`);
	});
	await cdp.send("Runtime.enable");
	await cdp.send("Log.enable");

	const groups = [];
	let widgets;
	let outside;
	let sideways = 0;
	for (const [width, height] of SIZES) {
		await open(cdp, url, { width, height, scheme: "light", reduced: true });
		widgets ??= await evaluate(cdp, LIST_WIDGETS);
		outside ??= await evaluate(cdp, OUTSIDE_CODE);
		if (width < 500) sideways = await evaluate(cdp, SIDEWAYS);
		groups.push({ width, tiles: await tiles(cdp, width, height) });
	}
	// The light setting stays from the tiles: the dark one must give the same colors.
	const light = await evaluate(cdp, BACKGROUND);
	await open(cdp, url, { width: LAPTOP[0], height: LAPTOP[1], scheme: "dark", reduced: false });
	const dark = await evaluate(cdp, BACKGROUND);
	const layout = await evaluate(cdp, LAYOUT);
	const players = await checkPlayers(cdp);

	for (const group of groups) {
		console.log(`tiles at ${group.width} px:`);
		for (const { file, heading } of group.tiles) console.log(`  ${file}${heading ? `  ${heading}` : ""}`);
	}
	const tags = (...states) => Object.keys(widgets).filter((tag) => states.includes(widgets[tag]));
	const started = tags("kit", "other");
	console.log(`widgets: ${started.length ? started.join(", ") : "none"}`);
	const stopped = tags("stopped");
	if (stopped.length) {
		problems++;
		console.log(`not started: ${stopped.join(", ")}. Its script stopped, or no script defines it.`);
	}
	const foreign = tags("other");
	if (foreign.length) {
		problems++;
		console.log(`not a kit widget: ${foreign.join(", ")}. Extend kit.Widget, with the global Lit and kit`);
	}
	if (outside.length) {
		problems++;
		console.log(`outside code: ${outside.join(", ")}. Use the global Lit and kit, and put other code in a script of the page`);
	}
	const { off } = layout;
	if (off.length) {
		problems++;
		console.log(`off the column: ${off.length} parts at ${LAPTOP[0]} px do not start at its left edge, or end past its right edge (offsets from the edges):`);
		for (const part of off.slice(0, 8)) console.log(`  ${part}`);
	} else console.log("column: one left edge");
	if (!layout.twoTracks) {
		problems++;
		console.log(`own layout: at ${LAPTOP[0]} px main is ${layout.width} px wide, with --page ${layout.page || "unset"} and --measure ${layout.measure || "unset"}, and a .split has one track. Remove the layout CSS of the page`);
	} else if (layout.skipped) {
		problems++;
		console.log(`side track: not checked, ${layout.skipped}`);
	} else if (layout.empty.length) {
		problems++;
		console.log(`empty side: at ${LAPTOP[0]} px, text runs alone for more than ${MAX_EMPTY_SIDE} px ${layout.empty.length} times. Put beside it, in a .split, the view, example, table or card that goes with it:`);
		for (const stretch of layout.empty.slice(0, 8)) console.log(`  ${stretch.to - stretch.from} px from "${stretch.text}"`);
	} else console.log(`side track: used, main ${layout.width} px`);
	if (sideways > 1) {
		problems++;
		console.log(`sideways: at ${SIZES[0][0]} px the page is ${sideways} px wider than the screen. Give the wide part its own scroll box, or let it wrap`);
	}
	if (light !== dark) {
		problems++;
		console.log(`colors: the background is ${light} in a light setting and ${dark} in a dark one. The page keeps the terminal colors`);
	}
	const still = players.filter((player) => !(player.after > player.before));
	console.log(`players: ${players.length}${players.length ? `, ${players.length - still.length} move` : ""}`);
	for (const player of still) {
		problems++;
		console.log(`does not move: ${player.tag} #${player.index}, ${player.before} -> ${player.after}`);
	}
	if (errors.size) {
		problems++;
		console.log("errors:");
		for (const error of errors) console.log(`  ${error.split("\n")[0]}`);
	} else console.log("errors: none");
} catch (error) {
	if (!(error instanceof Stop)) throw error;
	console.error(error.message);
	stop = error;
} finally {
	await cdp.close();
}
process.exit(stop ? 2 : problems ? 1 : 0);

// ---------------------------------------------------------------- page

async function open(cdp, url, { width, height, scheme, reduced }) {
	await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
	await cdp.send("Emulation.setEmulatedMedia", {
		features: [
			{ name: "prefers-color-scheme", value: scheme },
			{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
		],
	});
	await cdp.load(url);
	// The module scripts ran before the load event. Lit renders on the next microtasks, images and fonts settle.
	await sleep(500);
}

// Cuts the page into tiles of one viewport, width x height, and writes them to <out>/<width>-<n>.png.
// The tiles start at the first element that matches --from, or at the top of the page, and go to its end.
// The last tile is shorter when the page ends. A tile names the last heading at or above its top,
// or the first heading when it is above all of them. It gives [{ file, heading }].
// A --from that is not a selector, or matches no element, throws a Stop.
async function tiles(cdp, width, height) {
	const { top: start = 0, reason } = from === undefined ? {} : await evaluate(cdp, FROM(from));
	if (reason) throw new Stop(`--from '${from}' ${reason} at ${width} px`);
	const headings = await evaluate(cdp, HEADINGS);
	const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
	const end = Math.ceil(cssContentSize.height);
	const result = [];
	for (let y = start; y < end; y += height) {
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { x: 0, y, width, height: Math.min(height, end - y), scale: 1 },
		});
		const file = join(out, `${width}-${result.length + 1}.png`);
		writeFileSync(file, Buffer.from(data, "base64"));
		result.push({ file, heading: (headings.findLast((heading) => heading.top <= y) ?? headings[0])?.text });
	}
	return result;
}

// Press play on each player of kit.players, wait one second of real time, and read its value again.
async function checkPlayers(cdp) {
	const count = await evaluate(cdp, "window.kit?.players?.size ?? 0");
	const results = [];
	for (let index = 0; index < count; index++) {
		const player = `[...kit.players][${index}]`;
		await evaluate(cdp, `${player}.host.scrollIntoView({ block: "center" })`);
		await sleep(300);
		const before = await evaluate(cdp, `(${player}.play(), ${player}.value)`);
		await sleep(1000);
		const after = await evaluate(cdp, `${player}.value`);
		const tag = await evaluate(cdp, `(${player}.pause(), ${player}.host.localName)`);
		results.push({ index, tag, before, after });
	}
	return results;
}

async function evaluate(cdp, expression) {
	const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (exceptionDetails) throw new Error(`check script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
	return result.value;
}
