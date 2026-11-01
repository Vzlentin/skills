#!/usr/bin/env node
// Checks a built page in headless Chrome: the errors of its scripts, the w- tags that did not start,
// the players that do not move, and screenshots at 1280 and 390 px in light and dark.
// Usage: check.mjs <page.html | url> [out dir]
// The screenshots go to <directory of the page>/check/ by default. CHROME=<path> picks the browser.
// The exit code is 1 when the check finds a problem.
//
// The screenshots ask for reduced motion: CSS transitions do not run in headless Chrome, and players
// do not start by themselves. The player check presses play and waits one second of real time,
// because --virtual-time-budget does not move requestAnimationFrame.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SIZES = [
	[1280, 900],
	[390, 844],
];
const SCHEMES = ["light", "dark"];
// The tallest screenshot, in CSS pixels.
const MAX_HEIGHT = 8000;

// Each w- element of the page and of the widgets' own shadow roots, and whether a script defined it.
const LIST_WIDGETS = `(() => {
	const found = [];
	const visit = (root) => {
		for (const element of root.querySelectorAll("*")) {
			const tag = element.localName;
			if (tag.startsWith("w-")) found.push({ tag, defined: Boolean(customElements.get(tag)) });
			if (element.shadowRoot) visit(element.shadowRoot);
		}
	};
	visit(document);
	return found;
})()`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const [target, outArg] = process.argv.slice(2);
if (!target) {
	console.error("usage: check.mjs <page.html | url> [out dir]");
	process.exit(2);
}
const local = existsSync(target);
const url = local ? pathToFileURL(resolve(target)).href : target;
const out = resolve(outArg ?? (local ? join(dirname(resolve(target)), "check") : "check"));
mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "check-"));
const chrome = spawn(findChrome(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let problems = 0;
try {
	const cdp = await connect(await devtoolsPort());
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
	await cdp.send("Page.enable");

	const shots = [];
	let widgets;
	for (const scheme of SCHEMES) {
		for (const [width, height] of SIZES) {
			await open(cdp, url, { width, height, scheme, reduced: true });
			widgets ??= await evaluate(cdp, LIST_WIDGETS);
			shots.push(await screenshot(cdp, join(out, `${scheme}-${width}.png`), width));
		}
	}
	await open(cdp, url, { width: 1280, height: 900, scheme: "light", reduced: false });
	const players = await checkPlayers(cdp);

	console.log(`screenshots: ${shots.join(" ")}`);
	const stopped = widgets.filter((widget) => !widget.defined);
	const started = [...new Set(widgets.filter((widget) => widget.defined).map((widget) => widget.tag))];
	console.log(`widgets: ${started.length ? started.join(", ") : "none"}`);
	if (stopped.length) {
		problems++;
		console.log(`not started: ${[...new Set(stopped.map((widget) => widget.tag))].join(", ")}. Its script stopped, or no script defines it.`);
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
	cdp.close();
} finally {
	chrome.kill();
	await sleep(200);
	rmSync(profile, { recursive: true, force: true });
}
process.exit(problems ? 1 : 0);

// ---------------------------------------------------------------- page

async function open(cdp, url, { width, height, scheme, reduced }) {
	await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
	await cdp.send("Emulation.setEmulatedMedia", {
		features: [
			{ name: "prefers-color-scheme", value: scheme },
			{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
		],
	});
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url });
	await loaded;
	// The module scripts ran before the load event. Lit renders on the next microtasks, images and fonts settle.
	await sleep(500);
}

async function screenshot(cdp, file, width) {
	const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
	const height = Math.min(Math.ceil(cssContentSize.height), MAX_HEIGHT);
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: true,
		clip: { x: 0, y: 0, width, height, scale: 1 },
	});
	writeFileSync(file, Buffer.from(data, "base64"));
	return file;
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

// ---------------------------------------------------------------- chrome

function findChrome() {
	if (process.env.CHROME) return process.env.CHROME;
	const mac = [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	];
	if (process.platform === "darwin") {
		const found = mac.find((path) => existsSync(path));
		if (found) return found;
	}
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
		try {
			return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		} catch {}
	}
	throw new Error("No Chrome found. Install Chrome or Chromium, or set CHROME=<path>.");
}

// Chrome writes the port that it took into DevToolsActivePort in its profile.
async function devtoolsPort() {
	const file = join(profile, "DevToolsActivePort");
	for (let tries = 0; tries < 100; tries++) {
		if (existsSync(file)) {
			const [port] = readFileSync(file, "utf8").split("\n");
			if (port) return port;
		}
		if (chrome.exitCode !== null) throw new Error(`Chrome stopped (exit ${chrome.exitCode})`);
		await sleep(100);
	}
	throw new Error("Chrome did not open its DevTools port in 10 s");
}

// A small DevTools protocol client on the first page target. Node 22.19+ has a global WebSocket.
async function connect(port) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = targets.find((target) => target.type === "page");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((done, fail) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", fail, { once: true });
	});
	let id = 0;
	const pending = new Map();
	const listeners = new Map();
	socket.addEventListener("message", ({ data }) => {
		const message = JSON.parse(data);
		if (message.id) {
			const { done, fail } = pending.get(message.id);
			pending.delete(message.id);
			message.error ? fail(new Error(`${message.error.message}`)) : done(message.result);
		} else for (const listener of listeners.get(message.method) ?? []) listener(message.params);
	});
	const on = (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]);
	return {
		send: (method, params = {}) =>
			new Promise((done, fail) => {
				pending.set(++id, { done, fail });
				socket.send(JSON.stringify({ id, method, params }));
			}),
		on,
		once: (method) =>
			new Promise((done) => {
				const listener = (params) => {
					listeners.set(method, listeners.get(method).filter((other) => other !== listener));
					done(params);
				};
				on(method, listener);
			}),
		close: () => socket.close(),
	};
}
