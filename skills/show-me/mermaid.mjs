#!/usr/bin/env node
// Renders one Mermaid diagram to SVG with Pele, from the global npm install.
// Usage: mermaid.mjs [--large] <diagram.mmd> <diagram.svg>
// --large: the text 30% larger, for a page that shows the SVG at its own size.
// Other scripts import renderMermaid() from this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

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

// A Mermaid parse error throws: the source is wrong. Without Pele, the script stops with one line, not a stack trace.
export function renderMermaid(source, { large = false } = {}) {
	if (!pele) {
		console.error(`Mermaid needs Pele, and it is not in ${dirname(peleDir)}. Install it: npm install -g pele`);
		process.exit(1);
	}
	const { svg } = pele.render(source, { padding: large ? 12 : 16 });
	// Pele leaves the background transparent, which is unreadable in GitHub's dark theme.
	// --_bg is --pele-bg: white on its own, the page color inside a page.
	const opened = svg.indexOf(">") + 1;
	const open = large ? larger(svg.slice(0, opened)) : svg.slice(0, opened);
	return `${open}<rect width="100%" height="100%" fill="var(--_bg)"/>${svg.slice(opened)}`;
}

// Pele draws 12 px text: draw it 30% larger. A phone scrolls a wide diagram sideways.
function larger(open) {
	const sized = open.replace(/ (width|height)="([\d.]+)"/g, (all, name, value) => ` ${name}="${Math.round(value * 1.3)}"`);
	if (sized === open) throw new Error("Pele wrote no width and height on the <svg>");
	return sized;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const large = args.includes("--large");
	const [input, output] = args.filter((arg) => arg !== "--large");
	if (!input || !output) {
		console.error("usage: mermaid.mjs [--large] <diagram.mmd> <diagram.svg>");
		process.exit(2);
	}
	writeFileSync(output, renderMermaid(readFileSync(input, "utf8"), { large }));
	console.log(output);
}
