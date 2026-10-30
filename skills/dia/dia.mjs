#!/usr/bin/env node
// Drives the Dia browser on macOS through its AppleScript dictionary, with JavaScript for Automation.
// Run it with no arguments for the usage.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const BUNDLE_ID = "company.thebrowser.dia";
const FLAG = "--enable-applescript-javascript";
const RELAUNCH = `open -b ${BUNDLE_ID} --args ${FLAG}`;
const LAUNCHER_NAME = "Dia (JS).app";
const LAUNCHER_ID = "com.github.vzlentin.skills.dia-launcher";

const USAGE = `usage: dia.mjs <command>

  status                          Is Dia running, and is JavaScript automation on?
  tabs [--profile P]              List the tabs as JSON lines.
  read [tab] [--max N] [--html]   Print the text of a tab (N characters, default 20000, 0 for all).
                                  --html prints the page HTML only.
  eval [tab] <js | ->             Run JavaScript in a tab and print the result as JSON.
                                  - reads the JavaScript from stdin. A promise is awaited.
  open <url> [--profile P] [--focus]
                                  Open a tab, wait until it loads, print its id.
                                  The focus goes back to the tab you were on, unless --focus.
  close <tab-id>                  Close a tab.
  launcher [--dir D]              Make "${LAUNCHER_NAME}" in D (default ~/Applications): it opens
                                  Dia with JavaScript automation on.

[tab] is a tab id, or text that matches one tab title or URL. Without it: the active tab.
Options: --wait MS sets how long to wait for a page or a result (default 15000).`;

// One JSON line per tab, deduplicated by tab id: a profile can show in more than one window.
const LIST_TABS = String.raw`
function run(argv) {
	const dia = Application("${BUNDLE_ID}");
	const seen = new Set();
	const tabs = [];
	for (const window of dia.windows()) {
		const windowId = window.id();
		const windowIndex = window.index();
		const activeTab = window.activeTab.id();
		for (const profile of window.profiles()) {
			const name = profile.name();
			const ids = profile.tabs.id();
			const titles = profile.tabs.title();
			const urls = profile.tabs.url();
			ids.forEach((id, i) => {
				if (seen.has(id)) return;
				seen.add(id);
				tabs.push({ id, profile: name, title: titles[i], url: urls[i], active: id === activeTab, window: windowId, windowIndex });
			});
		}
	}
	return JSON.stringify(tabs);
}`;

// Dia drops a call that comes soon after another one and returns "" for it: the JavaScript does not run.
// A wrapped script never returns "", so "" means "try again".
const EXECUTE = String.raw`
function run(argv) {
	const [windowId, profileName, tabId, javascript, waitMs] = argv;
	const dia = Application("${BUNDLE_ID}");
	const tab = () => dia.windows.byId(windowId).profiles.byName(profileName).tabs.byId(tabId);
	const loadEnd = Date.now() + Number(waitMs);
	while (tab().loading() && Date.now() < loadEnd) delay(0.25);
	const retryEnd = Math.max(loadEnd, Date.now() + 3000);
	for (;;) {
		const out = dia.execute(tab(), { javascript });
		if (out !== "" || Date.now() >= retryEnd) return out;
		delay(0.3);
	}
}`;

const OPEN = String.raw`
function run(argv) {
	const [url, profileName, focus, waitMs] = argv;
	const dia = Application("${BUNDLE_ID}");
	const windows = dia.windows();
	if (windows.length === 0) throw new Error("Dia has no window open.");
	const window = windows.reduce((front, w) => (w.index() < front.index() ? w : front));
	const before = { tab: window.activeTab.id(), profile: window.activeProfile.name() };
	const names = window.profiles.name();
	if (profileName && !names.includes(profileName)) throw new Error('No profile is named "' + profileName + '". The profiles: ' + names.join(", ") + ".");
	const profile = window.profiles.byName(profileName || before.profile);
	const name = profile.name();
	const tab = dia.Tab({ url });
	profile.tabs.push(tab);
	const id = tab.id();
	if (focus !== "focus") window.profiles.byName(before.profile).tabs.byId(before.tab).focus();
	const end = Date.now() + Number(waitMs);
	while (profile.tabs.byId(id).loading() && Date.now() < end) delay(0.25);
	return JSON.stringify({ id, profile: name, url, window: window.id() });
}`;

const CLOSE = String.raw`
function run(argv) {
	const [windowId, profileName, tabId] = argv;
	Application("${BUNDLE_ID}").windows.byId(windowId).profiles.byName(profileName).tabs.byId(tabId).close();
	return "";
}`;

// The launcher asks before it restarts a Dia that runs without the flag. Dia opens its tabs again after a restart.
const LAUNCHER_SCRIPT = `on run
	set diaState to do shell script "for pid in $(pgrep -x Dia); do ps -ww -o command= -p $pid; done | grep -q -- '${FLAG}' && echo on || (pgrep -x Dia >/dev/null && echo off || echo stopped)"
	if diaState is "off" then
		set answer to button returned of (display dialog "Dia runs without JavaScript automation. Restart Dia to turn it on? Dia opens your tabs again." buttons {"Not now", "Restart"} default button "Restart" with icon note)
		if answer is "Restart" then
			tell application id "${BUNDLE_ID}" to quit
			repeat 100 times
				if (do shell script "pgrep -x Dia >/dev/null && echo up || echo down") is "down" then exit repeat
				delay 0.2
			end repeat
		end if
	end if
	do shell script "${RELAUNCH}"
end run
`;

function fail(message) {
	console.error(`dia: ${message}`);
	process.exit(1);
}

// Reads the arguments of the running Dia from ps. It never sends an Apple Event: one to a stopped Dia starts it without the flag.
function diaState() {
	const lines = execFileSync("ps", ["-axww", "-o", "command="], { encoding: "utf8" }).split("\n");
	const dia = lines.filter((line) => /\/Dia\.app\/Contents\/MacOS\/Dia( |$)/.test(line));
	return { running: dia.length > 0, javascript: dia.some((line) => line.split(" ").includes(FLAG)) };
}

function requireDia({ javascript = false } = {}) {
	const state = diaState();
	if (!state.running) fail(`Dia is not running. Open it with JavaScript automation on: ${RELAUNCH}`);
	if (javascript && !state.javascript) {
		fail(`Dia runs without JavaScript automation. Ask the user to quit Dia and open it again with: ${RELAUNCH}`);
	}
}

function jxa(script, args = []) {
	try {
		return execFileSync("osascript", ["-l", "JavaScript", "-e", script, "--", ...args], {
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		}).replace(/\n$/, "");
	} catch (error) {
		const stderr = String(error.stderr ?? error.message).trim();
		if (stderr.includes("-10006") || stderr.includes(FLAG)) {
			fail(`Dia runs without JavaScript automation. Ask the user to quit Dia and open it again with: ${RELAUNCH}`);
		}
		if (stderr.includes("-1743")) fail("macOS does not let this app control Dia: allow it in System Settings > Privacy & Security > Automation.");
		fail(stderr.replace(/^.*execution error: (Error: )*/, "").replace(/ \(-\d+\)$/, ""));
	}
}

function listTabs() {
	return JSON.parse(jxa(LIST_TABS)).sort((a, b) => a.windowIndex - b.windowIndex);
}

function findTab(target) {
	const tabs = listTabs();
	if (!target) {
		const active = tabs.find((tab) => tab.active);
		if (!active) fail("Dia has no active tab.");
		return active;
	}
	const byId = tabs.find((tab) => tab.id === target);
	if (byId) return byId;
	const needle = target.toLowerCase();
	const matches = tabs.filter((tab) => `${tab.title}\n${tab.url}`.toLowerCase().includes(needle));
	if (matches.length === 1) return matches[0];
	if (matches.length === 0) fail(`no tab matches "${target}".`);
	const lines = matches.slice(0, 20).map((tab) => `  ${tab.id}  [${tab.profile}]  ${tab.title}  ${tab.url.slice(0, 100)}`);
	fail(`${matches.length} tabs match "${target}". Pass a tab id:\n${lines.join("\n")}`);
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Dia returns the value of the script as JSON text, and does not wait for a promise.
// The page keeps a promise result under a key, and the next calls read it.
function runInTab(tab, source, waitMs) {
	const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const start = `(() => {
		const store = (window.__diaSkill ||= {});
		const done = (result) => { try { return JSON.stringify(result); } catch (error) { return JSON.stringify({ ok: false, error: String(error) }); } };
		try {
			const value = (0, eval)(${JSON.stringify(source)});
			if (value && typeof value.then === "function") {
				store[${JSON.stringify(key)}] = { pending: true };
				value.then(
					(result) => { store[${JSON.stringify(key)}] = { ok: true, value: result }; },
					(error) => { store[${JSON.stringify(key)}] = { ok: false, error: String((error && error.stack) || error) }; },
				);
				return done({ pending: true });
			}
			return done({ ok: true, value });
		} catch (error) {
			return done({ ok: false, error: String((error && error.stack) || error) });
		}
	})()`;
	const poll = `(() => {
		const store = window.__diaSkill || {};
		const result = store[${JSON.stringify(key)}];
		if (!result || result.pending) return JSON.stringify({ pending: true });
		delete store[${JSON.stringify(key)}];
		try { return JSON.stringify(result); } catch (error) { return JSON.stringify({ ok: false, error: String(error) }); }
	})()`;
	const end = Date.now() + waitMs;
	let result = callTab(tab, start, waitMs);
	while (result.pending) {
		if (Date.now() >= end) fail(`the promise did not settle in ${waitMs} ms. Use --wait to wait longer.`);
		sleep(300);
		result = callTab(tab, poll, Math.max(end - Date.now(), 0));
	}
	if (!result.ok) fail(`the JavaScript failed in the page: ${result.error}`);
	return result.value;
}

function callTab(tab, javascript, waitMs) {
	const out = jxa(EXECUTE, [tab.window, tab.profile, tab.id, javascript, String(waitMs)]);
	if (out === "") {
		fail("Dia gave no result. The tab may have no loaded page: a pinned tab loads only when the user opens it.");
	}
	// The wrapped script returns a string, and Dia encodes it as JSON one more time.
	return JSON.parse(JSON.parse(out));
}

function readStdin() {
	return execFileSync("cat", { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
}

function makeLauncher(dir) {
	const app = join(dir, LAUNCHER_NAME);
	const work = mkdtempSync(join(tmpdir(), "dia-launcher-"));
	try {
		const source = join(work, "launcher.applescript");
		writeFileSync(source, LAUNCHER_SCRIPT);
		execFileSync("mkdir", ["-p", dir]);
		execFileSync("rm", ["-rf", app]);
		execFileSync("osacompile", ["-o", app, source], { stdio: ["ignore", "ignore", "pipe"] });
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	const diaApp = execFileSync("mdfind", [`kMDItemCFBundleIdentifier == "${BUNDLE_ID}"`], { encoding: "utf8" }).split("\n")[0];
	const plist = join(app, "Contents/Info.plist");
	const icon = join(diaApp || "/Applications/Dia.app", "Contents/Resources/AppIcon.icns");
	try {
		execFileSync("cp", [icon, join(app, "Contents/Resources/applet.icns")]);
		// The icon in Assets.car wins over applet.icns.
		execFileSync("/usr/libexec/PlistBuddy", ["-c", "Delete :CFBundleIconName", plist]);
		rmSync(join(app, "Contents/Resources/Assets.car"), { force: true });
	} catch {
		console.error(`dia: no icon at ${icon}: the launcher keeps the script icon.`);
	}
	// macOS keeps the Automation permission for this id.
	execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :CFBundleIdentifier string ${LAUNCHER_ID}`, plist]);
	// The icon change breaks the signature that osacompile wrote.
	execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" });
	execFileSync("touch", [app]);
	return app;
}

function parseArgs(argv) {
	const options = { wait: 15000, max: 20000, html: false, focus: false, profile: "", dir: join(homedir(), "Applications") };
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--html") options.html = true;
		else if (arg === "--focus") options.focus = true;
		else if (["--wait", "--max", "--profile", "--dir"].includes(arg)) {
			const value = argv[++i];
			if (value === undefined) fail(`${arg} needs a value.`);
			const name = arg.slice(2);
			options[name] = ["wait", "max"].includes(name) ? Number(value) : value;
			if (Number.isNaN(options[name])) fail(`${arg} needs a number.`);
		} else positional.push(arg);
	}
	return { options, positional };
}

function main() {
	const [command, ...rest] = process.argv.slice(2);
	if (!command || command === "--help" || command === "-h") {
		console.log(USAGE);
		process.exit(command ? 0 : 2);
	}
	if (process.platform !== "darwin") fail("Dia automation works only on macOS.");
	const { options, positional } = parseArgs(rest);

	if (command === "status") {
		console.log(JSON.stringify(diaState()));
	} else if (command === "tabs") {
		requireDia();
		for (const tab of listTabs()) {
			if (options.profile && tab.profile !== options.profile) continue;
			console.log(JSON.stringify(tab));
		}
	} else if (command === "read") {
		requireDia({ javascript: true });
		const tab = findTab(positional[0]);
		const max = options.max > 0 ? options.max : Number.MAX_SAFE_INTEGER;
		const page = runInTab(
			tab,
			`(() => {
				const text = ${options.html} ? document.documentElement.outerHTML : (document.body ? document.body.innerText : "");
				return { title: document.title, url: location.href, length: text.length, text: text.slice(0, ${max}) };
			})()`,
			options.wait,
		);
		if (options.html) {
			process.stdout.write(page.text);
			return;
		}
		const cut = page.text.length < page.length ? `, cut to ${page.text.length}: use --max` : "";
		console.log(`# ${page.title}\n${page.url}\ntab ${tab.id} [${tab.profile}], ${page.length} characters${cut}\n\n${page.text}`);
	} else if (command === "eval") {
		requireDia({ javascript: true });
		if (positional.length === 0 || positional.length > 2) fail("usage: dia.mjs eval [tab] <js | ->");
		const [target, code] = positional.length === 2 ? positional : [undefined, positional[0]];
		const source = code === "-" ? readStdin() : code;
		const value = runInTab(findTab(target), source, options.wait);
		console.log(value === undefined ? "undefined" : JSON.stringify(value, null, 2));
	} else if (command === "open") {
		requireDia();
		if (positional.length !== 1) fail("usage: dia.mjs open <url> [--profile P] [--focus]");
		console.log(jxa(OPEN, [positional[0], options.profile, options.focus ? "focus" : "", String(options.wait)]));
	} else if (command === "close") {
		requireDia();
		if (positional.length !== 1) fail("usage: dia.mjs close <tab-id>");
		const tab = listTabs().find((candidate) => candidate.id === positional[0]);
		if (!tab) fail(`no tab has the id ${positional[0]}.`);
		jxa(CLOSE, [tab.window, tab.profile, tab.id]);
		console.log(`closed ${tab.id}`);
	} else if (command === "launcher") {
		console.log(makeLauncher(options.dir));
	} else {
		fail(`unknown command "${command}".\n${USAGE}`);
	}
}

main();
