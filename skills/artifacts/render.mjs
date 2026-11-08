#!/usr/bin/env node
// Builds one self-contained HTML page: the theme, the base shell, Alpine and the widget kit when the page uses them.
// Usage: render.mjs [--share] <page.html> [out.html]
//        render.mjs --theme
// The source is the HTML of <main>. The slug is the name of its folder, and the title is the text of its first <h1>.
// The page goes to /tmp/pages/<slug>/index.html by default, or share.html with --share.
// --share: a light copy for other people and for print. --theme: the colors as CSS variables.
// The HTML goes into the shell as it is, except <diagram>: renderPage() puts the image of its src in the page.
// A page gets Alpine when its body has an Alpine attribute, and Lit with kit.js when its body has a <w-…> tag.
// Each <w-name> tag with a widgets/w-name.js file gets that file, and the files that its own tags name.
//
// Other scripts import renderPage(), escapeHtml() and SourceError from this file.
// Colors: Pi's `system` theme computed from the Ghostty colors.
//   Without Pi: the terminal theme (Ghostty colors, mapped by color number). Without Ghostty: saved colors.
//   The page keeps these colors in each light or dark setting of the viewer.
// PAGES_NO_PI=1 renders as if Pi were not installed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// A light page: the colors of a terminal with a white background.
const LIGHT = {
	name: "light",
	background: "#ffffff",
	foreground: "#1b1f24",
	palette: ["#1b1f24", "#b42318", "#2e7d32", "#8a5a00", "#0055a5", "#7b1fa2", "#00796b", "#5f6b7a", "#5f6b7a", "#d92d20", "#43a047", "#a66f00", "#1565c0", "#8e24aa", "#00897b", "#1b1f24"],
};
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
// An Alpine attribute with a plain quote. A code sample writes its quotes as &quot;, so it does not count.
const ALPINE_ATTRIBUTE = /\s(x-[a-z][\w:.-]*|@[a-z][\w:.-]*|:[a-z][\w-]*)="/;
// A widget tag with a plain "<". In a code block the "<" is escaped, so a code sample does not count.
const WIDGET_TAG = /<(w-[a-z][\w-]*)/;
// The one form of the diagram block: lowercase attribute names, double-quoted values. Any other <diagram or </diagram> is an error.
const DIAGRAM = /<diagram((?:\s+[a-z-]+="[^"]*")*)\s*>\s*<\/diagram>/g;
// The named character references of HTML, from https://html.spec.whatwg.org/entities.json.
// A name with no semicolon is a legacy name: HTML also reads it with no semicolon.
const ENTITIES = JSON.parse(readFileSync(join(here, "vendor/entities.json"), "utf8"));

// An error in the source: the command prints its message on one line. A script that builds pages can catch it and do the same.
// A class is not hoisted, and the command below runs when the file loads: it must come before the command.
export class SourceError extends Error {}

export function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// body is HTML. key: the name of the state that the browser keeps for the page. Another key starts from the defaults.
// base: the directory that the src of a <diagram> resolves from.
export async function renderPage({ slug, key = slug, title, body: source, share = false, out, base = process.cwd() }) {
	const body = drawBlocks(source, base);
	const theme = share ? { source: "light", colors: terminalTokens(LIGHT) } : await loadTheme();
	const interactive = ALPINE_ATTRIBUTE.test(body);
	const vendor = (name) => readFileSync(join(here, name), "utf8");
	const widgets = widgetFiles(body);
	const kit = WIDGET_TAG.test(body);
	if (/x-text="\$store\.back\.text"/.test(body)) throw new SourceError("The page writes its own bar of the way back. The build adds it: remove the one of the page");
	const head = [];
	// Alpine starts when its own script runs: the plugin and the store of the way back come first, the page last.
	if (interactive) head.push(`<script>${vendor("vendor/alpine-persist.min.js")}</script>`, `<script>${vendor("back.js")}</script>`);
	// Module scripts run in order after the page is parsed: the widget files, then the widget scripts of the page.
	if (kit) head.push(`<script>${vendor("vendor/lit.min.js")}</script>`, `<script>${vendor("kit.js")}</script>`);
	for (const [name, text] of widgets) head.push(`<script type="module" data-widget="${name}">${text}</script>`);
	const parts = {
		title: escapeHtml(title),
		slug: escapeHtml(slug),
		key: escapeHtml(key),
		theme: `:root{${pageTokens(theme.colors)}}`,
		head: head.join("\n"),
		alpine: interactive ? `<script>${vendor("vendor/alpine.min.js")}</script>` : "",
		body,
		bodyClass: share ? "share" : "",
	};
	// A replacer function: page parts contain "$" sequences that a replacement string would expand.
	const page = vendor("shell.html").replace(/\{\{(\w+)\}\}/g, (all, name) => {
		if (!(name in parts)) throw new Error(`shell.html names an unknown part: ${all}`);
		return parts[name];
	});
	const target = out ?? join("/tmp/pages", slug, share ? "share.html" : "index.html");
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, page);
	return { target, bytes: page.length, colors: theme.source, interactive, kit, widgets: [...widgets.keys()] };
}

// <diagram src="flow.svg" alt="what it shows"></diagram> becomes the image of src, as localImage() puts it in the page.
function drawBlocks(body, base) {
	const oneLine = (text) => text.replace(/\s+/g, " ");
	const stray = body.replace(DIAGRAM, "").match(/<\/?diagram\b[^>]{0,80}>?/i);
	if (stray) throw new SourceError(`Bad diagram tag: ${oneLine(stray[0])}. Write <diagram src="file.svg" alt="what it shows"></diagram>`);
	return body.replace(DIAGRAM, (all, attributes) => {
		const { src, alt = "" } = Object.fromEntries([...attributes.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decodeEntities(value)]));
		if (!src) throw new SourceError(`A diagram needs a src: ${oneLine(all)}`);
		return localImage(src, alt, base);
	});
}

// A local SVG goes into the page as it is, so it takes the page colors. Other local images become data URLs.
function localImage(src, text, base) {
	const path = resolve(base, src.replace(/^~(?=\/)/, homedir()));
	const type = extname(path).toLowerCase();
	if (type !== ".svg" && !IMAGE_TYPES[type]) throw new SourceError(`Unknown image type: ${src}`);
	if (!existsSync(path)) throw new SourceError(`${src}: no file at ${path}`);
	if (type === ".svg") return `<figure class="fig" role="img" aria-label="${escapeHtml(text)}">${readFileSync(path, "utf8")}</figure>`;
	return `<img src="data:${IMAGE_TYPES[type]};base64,${readFileSync(path).toString("base64")}" alt="${escapeHtml(text)}">`;
}

// The text of the first <h1>, with its tags removed.
function pageTitle(html) {
	const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
	if (!heading) throw new SourceError("The page needs an <h1>: its text is the title");
	const title = decodeEntities(heading[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
	if (!title) throw new SourceError("The <h1> of the page has no text: its text is the title");
	return title;
}

// The named references as HTML reads them in text, and the numeric references with a semicolon.
// A name that is not in the table gives the longest legacy name that starts it: &notit; is ¬it;.
function decodeEntities(text) {
	return text.replace(/&(?:([a-z][a-z0-9]*;?)|#(\d+);|#x([0-9a-f]+);)/gi, (all, name, decimal, hex) => {
		if (name) {
			for (let end = name.length; end > 1; end--) {
				const known = name.slice(0, end);
				if (Object.hasOwn(ENTITIES, known)) return ENTITIES[known] + name.slice(end);
			}
			return all;
		}
		const code = decimal ? Number(decimal) : parseInt(hex, 16);
		return code <= 0x10ffff ? String.fromCodePoint(code) : all;
	});
}

// The widgets/ files that the tags of the body name, and the files that their own tags name.
function widgetFiles(body) {
	const found = new Map();
	const visit = (text) => {
		for (const [, name] of text.matchAll(new RegExp(WIDGET_TAG, "g"))) {
			const file = join(here, "widgets", `${name}.js`);
			if (found.has(name) || !existsSync(file)) continue;
			found.set(name, readFileSync(file, "utf8"));
			visit(found.get(name));
		}
	};
	visit(body);
	return found;
}

if (import.meta.main) {
	const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
	const [sourcePath, out] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
	if (flags.has("--theme")) {
		console.log(`:root{${pageTokens((await loadTheme()).colors)}}`);
		process.exit(0);
	}
	if (!sourcePath) {
		console.error("usage: render.mjs [--share] <page.html> [out.html] | render.mjs --theme");
		process.exit(2);
	}
	const source = readFileSync(sourcePath, "utf8");
	const base = dirname(resolve(sourcePath));
	let page;
	try {
		page = await renderPage({ slug: basename(base), title: pageTitle(source), body: source, share: flags.has("--share"), out, base });
	} catch (error) {
		if (!(error instanceof SourceError)) throw error;
		console.error(`${sourcePath}: ${error.message}`);
		process.exit(1);
	}
	const widgets = page.widgets.length ? ` (${page.widgets.join(", ")})` : "";
	console.log(`${page.target} ${page.bytes} bytes, ${page.interactive ? "Alpine" : "no Alpine"}, ${page.kit ? `kit${widgets}` : "no kit"}, colors: ${page.colors}`);
}

// ---------------------------------------------------------------- colors

// The Pi install whose system theme gives the colors, or undefined with PAGES_NO_PI=1.
function piInstall() {
	if (process.env.PAGES_NO_PI === "1") return undefined;
	const root = join(homedir(), ".pi/agent/install");
	try {
		const version = readFileSync(join(root, "current-version"), "utf8").trim();
		const modules = join(root, "releases", version, "node_modules");
		return existsSync(modules) ? { version, modules } : undefined;
	} catch {
		return undefined;
	}
}

async function loadTheme() {
	const pi = piInstall();
	let terminal;
	try {
		terminal = ghosttyColors();
	} catch (error) {
		// Without Ghostty, the saved colors are the expected result.
		if (error.code !== "ENOENT") console.error(`No terminal colors (${error.message})`);
	}
	if (terminal && pi) {
		try {
			const generator = join(pi.modules, "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/system-theme.js");
			const { generateSystemThemeColors } = await import(pathToFileURL(generator).href);
			const { colors } = generateSystemThemeColors({
				name: terminal.name,
				background: rgb(terminal.background),
				foreground: rgb(terminal.foreground),
				palette: terminal.palette.map(rgb),
			});
			return {
				source: `Pi ${pi.version} system theme, from Ghostty ${terminal.name}`,
				colors: { ...colors, bg: terminal.background, fg: terminal.foreground },
			};
		} catch (error) {
			console.error(`Pi theme not available (${error.message})`);
		}
	}
	if (terminal) return { source: `terminal theme, Ghostty ${terminal.name}`, colors: terminalTokens(terminal) };
	return { source: "saved colors", colors: savedColors() };
}

function savedColors() {
	return JSON.parse(readFileSync(join(here, "saved-colors.json"), "utf8"));
}

// The tokens that the shell and pages use, the same names in both schemes, --sunk for wells and code,
// and --series-1 to --series-4 for the series of a chart.
function pageTokens(colors) {
	const dark = isDark(colors.bg);
	const picked = Object.fromEntries(Object.keys(terminalTokens(LIGHT)).map((name) => [name, colors[name]]));
	return `color-scheme:${dark ? "dark" : "light"};${cssTokens({ ...picked, sunk: mix("#000000", colors.bg, dark ? 0.22 : 0.04), ...seriesTokens(colors, dark) })}`;
}

// A categorical palette: four colors that differ in each scheme. Without Pi, syntaxVariable is the text color:
// series 2 takes success. Series 4 is the theme color farthest from the other three and from the accent.
function seriesTokens(colors, dark) {
	const variable = colors.syntaxVariable;
	const plain = !variable || variable.toLowerCase() === colors.fg.toLowerCase();
	const first = dark ? [colors.mdLink, plain ? colors.success : variable, colors.error] : [colors.syntaxKeyword, colors.success, colors.warning];
	const taken = [...first, colors.accent].filter(Boolean).map(rgb);
	const distance = (hex) => Math.min(...taken.map((other) => Math.hypot(...["r", "g", "b"].map((key) => rgb(hex)[key] - other[key]))));
	const candidates = [colors.syntaxType, colors.syntaxFunction, colors.syntaxString, colors.syntaxNumber, colors.mdCode, colors.mdHeading, colors.warning, colors.success, colors.error];
	const fourth = candidates.filter((hex) => /^#[0-9a-f]{6}$/i.test(hex ?? "")).sort((a, b) => distance(b) - distance(a))[0];
	return Object.fromEntries([...first, fourth].map((hex, index) => [`series-${index + 1}`, hex]));
}

function isDark(hex) {
	const { r, g, b } = rgb(hex);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

// a and b mixed, with `share` of a.
function mix(a, b, share) {
	const [x, y] = [rgb(a), rgb(b)];
	const channel = (key) => Math.round(x[key] * share + y[key] * (1 - share)).toString(16).padStart(2, "0");
	return `#${channel("r")}${channel("g")}${channel("b")}`;
}

// Ghostty's own values; `+show-config` omits the defaults, so read those from `--default` first.
function ghosttyColors() {
	const values = { ...showConfig(["--default"]), ...showConfig([]) };
	const palette = Array.from({ length: 16 }, (_, index) => values[`palette ${index}`]);
	for (const color of [values.background, values.foreground, ...palette]) rgb(color);
	return { name: values.theme || "default", background: values.background, foreground: values.foreground, palette };
}

function showConfig(extra) {
	const values = {};
	for (const line of execFileSync("ghostty", ["+show-config", ...extra], { encoding: "utf8" }).split("\n")) {
		const match = line.match(/^([a-z-]+) = (.*)$/);
		if (!match) continue;
		const palette = match[1] === "palette" && match[2].match(/^(\d+)=(#[0-9a-f]{6})$/i);
		if (palette) values[`palette ${palette[1]}`] = palette[2];
		else values[match[1]] = match[2];
	}
	return values;
}

// The terminal theme without Pi: the same token names, taken from the color numbers.
function terminalTokens({ background: bg, foreground: fg, palette: p }) {
	return {
		bg,
		fg,
		text: fg,
		accent: p[4],
		success: p[2],
		warning: p[3],
		error: p[1],
		muted: mix(fg, bg, 0.65),
		dim: mix(fg, bg, 0.5),
		border: p[4],
		borderMuted: mix(fg, bg, 0.35),
		selectedBg: mix(p[4], bg, 0.25),
		userMessageBg: mix(p[4], bg, 0.2),
		toolPendingBg: mix(fg, bg, 0.07),
		toolSuccessBg: mix(p[2], bg, 0.16),
		mdHeading: p[3],
		mdLink: p[12],
		mdCode: p[6],
		mdCodeBlockBorder: mix(fg, bg, 0.25),
		mdListBullet: p[4],
		syntaxKeyword: p[5],
		syntaxString: p[2],
		syntaxComment: mix(fg, bg, 0.5),
		syntaxNumber: p[3],
		syntaxFunction: p[4],
		syntaxType: p[6],
		syntaxVariable: fg,
		syntaxPunctuation: mix(fg, bg, 0.65),
		toolDiffAdded: p[2],
		toolDiffRemoved: p[1],
		toolDiffContext: mix(fg, bg, 0.65),
	};
}

function rgb(hex) {
	if (!/^#[0-9a-f]{6}$/i.test(hex ?? "")) throw new Error(`not a color: ${hex}`);
	return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

// Tokens -> CSS variables. An empty Pi token means the terminal's own foreground.
function cssTokens(colors) {
	return Object.entries(colors)
		.map(([name, value]) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value || colors.fg};`)
		.join("");
}
