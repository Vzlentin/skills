// Headless Chrome for scripts, with a small DevTools protocol client.
// CHROME=<path> picks the browser. Without it, the script looks for the macOS apps, then for the Linux names on the PATH.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Starts Chrome on a new profile in the temp folder, and gives a client of its first page, with the Page domain on.
// load(url) opens url in the page and waits for its load event. close() stops Chrome and removes the profile.
// When the start fails, it removes the profile and throws the error.
export async function startChrome() {
	const path = findChrome();
	const profile = mkdtempSync(join(tmpdir(), "chrome-"));
	const chrome = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
	const stop = async () => {
		chrome.kill();
		await sleep(200);
		rmSync(profile, { recursive: true, force: true });
	};
	try {
		await once(chrome, "spawn");
		const cdp = await connect(await devtoolsPort(profile, chrome));
		await cdp.send("Page.enable");
		return {
			...cdp,
			load: async (url) => {
				const loaded = cdp.once("Page.loadEventFired");
				await cdp.send("Page.navigate", { url });
				await loaded;
			},
			close: async () => {
				cdp.close();
				await stop();
			},
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

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
async function devtoolsPort(profile, chrome) {
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
		socket.addEventListener("error", () => fail(new Error(`No DevTools connection to ${page.webSocketDebuggerUrl}`)), { once: true });
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
