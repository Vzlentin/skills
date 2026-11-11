#!/usr/bin/env node
// Renders one Mermaid diagram to SVG with Pele, from the global npm install.
// Usage: mermaid.mjs [--large] [--png] <diagram.mmd> <diagram.svg>
// --large: the text 30% larger, for a page that shows the SVG at its own size.
// --png: also writes <diagram>.png, the SVG at twice its size, to look at. It needs Chrome, Chromium or Edge, or CHROME=<path>.
// Other scripts import renderMermaid() from this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startChrome } from "../artifacts/chrome.mjs";

const peleDir = join(globalModules(), "pele");
const entry = join(peleDir, "dist", "pele.js");
const pele = existsSync(entry) ? await import(pathToFileURL(entry).href) : undefined;

// The global npm folder. Without npm, the folder next to this Node, as the Node install puts it.
function globalModules() {
	try {
		return execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return join(dirname(dirname(process.execPath)), "lib/node_modules");
	}
}

// The code of the error when Pele is not installed. A command shows its message in one line, not a stack trace.
export const PELE_MISSING = "PELE_MISSING";

// A Mermaid parse error throws: the source is wrong. Without Pele, the error has the code PELE_MISSING.
export function renderMermaid(source, { large = false } = {}) {
	if (!pele) {
		const message = `Mermaid needs Pele, and it is not in ${dirname(peleDir)}. Install it: npm install -g pele`;
		throw Object.assign(new Error(message), { code: PELE_MISSING });
	}
	const { svg } = pele.render(source, { padding: large ? 12 : 16 });
	// Pele leaves the background transparent, which is unreadable in GitHub's dark theme.
	// --_bg is --pele-bg: white on its own, the page color inside a page.
	const opened = svg.indexOf(">") + 1;
	const open = large ? larger(svg.slice(0, opened)) : svg.slice(0, opened);
	return `${open}<rect width="100%" height="100%" fill="var(--_bg)"/>${svg.slice(opened)}`;
}

// The width and height attributes of the <svg>, with the name in group 1 and the value in group 2.
const SIZE = / (width|height)="([\d.]+)"/g;

// Pele draws 12 px text: draw it 30% larger. A phone scrolls a wide diagram sideways.
function larger(open) {
	const sized = open.replace(SIZE, (all, name, value) => ` ${name}="${Math.round(value * 1.3)}"`);
	if (sized === open) throw new Error("Pele wrote no width and height on the <svg>");
	return sized;
}

// Writes the SVG file as a PNG at twice the width and height of its <svg>, in headless Chrome.
async function writePng(svgFile, pngFile) {
	const svg = readFileSync(svgFile, "utf8");
	const { width, height } = Object.fromEntries([...svg.slice(0, svg.indexOf(">")).matchAll(SIZE)].map(([, name, value]) => [name, Math.ceil(value)]));
	if (!width || !height) throw new Error(`${svgFile} has no width and height on its <svg>`);
	const cdp = await startChrome();
	try {
		await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
		await cdp.load(pathToFileURL(resolve(svgFile)).href);
		const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
		writeFileSync(pngFile, Buffer.from(data, "base64"));
	} finally {
		await cdp.close();
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const large = args.includes("--large");
	const png = args.includes("--png");
	const [input, output] = args.filter((arg) => arg !== "--large" && arg !== "--png");
	if (!input || !output) {
		console.error("usage: mermaid.mjs [--large] [--png] <diagram.mmd> <diagram.svg>");
		process.exit(2);
	}
	try {
		writeFileSync(output, renderMermaid(readFileSync(input, "utf8"), { large }));
	} catch (error) {
		if (error.code !== PELE_MISSING) throw error;
		console.error(error.message);
		process.exit(1);
	}
	console.log(output);
	if (png) {
		// A final .svg becomes .png, and any other name gets .png at its end, so the PNG never takes the place of the SVG.
		const pngFile = `${output.replace(/\.svg$/i, "")}.png`;
		try {
			await writePng(output, pngFile);
		} catch (error) {
			console.error(`No PNG: ${error.message.split("\n")[0]}`);
			process.exit(1);
		}
		console.log(pngFile);
	}
}
