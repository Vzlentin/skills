import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PELE_MISSING, renderMermaid } from "../skills/show-me/mermaid.mjs";

const MERMAID = fileURLToPath(new URL("../skills/show-me/mermaid.mjs", import.meta.url));

const root = mkdtempSync(join(tmpdir(), "show-me-mermaid-"));
after(() => rmSync(root, { recursive: true, force: true }));
const source = join(root, "flow.mmd");
writeFileSync(source, "flowchart LR\n  A[Source] --> B[SVG]\n  B --> C[PNG]\n");

// The reason to skip all the tests when Pele is not installed, or undefined.
let pele;
try {
	renderMermaid("flowchart LR\n  A --> B\n");
} catch (error) {
	if (error.code !== PELE_MISSING) throw error;
	pele = error.message;
}

// Runs mermaid.mjs with the arguments, and with the variables of env added to the environment.
function mermaid(env, ...args) {
	return spawnSync(process.execPath, [MERMAID, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
}

// The width and height attributes of the <svg> of an SVG file, and the width and height of its viewBox.
function svgSize(file) {
	const open = readFileSync(file, "utf8").split(">")[0];
	const attribute = (name) => Number(open.match(new RegExp(` ${name}="([\\d.]+)"`))?.[1]);
	const [, , viewWidth, viewHeight] = open.match(/ viewBox="([^"]+)"/)[1].split(" ").map(Number);
	return { width: attribute("width"), height: attribute("height"), viewWidth, viewHeight };
}

const svg = join(root, "plain.svg");
const png = join(root, "plain.png");
const plain = pele ? undefined : mermaid({}, "--png", source, svg);
// mermaid.mjs names the missing browser in its stderr line.
const skip = pele ?? plain.stderr.match(/No Chrome found[^\n]*/)?.[0];

test("--png prints the SVG path, then the PNG path", { skip }, () => {
	assert.equal(plain.status, 0, plain.stderr);
	assert.equal(plain.stdout, `${svg}\n${png}\n`);
	assert.equal(plain.stderr, "");
});

test("the PNG is the SVG at twice the width and height of its <svg>, also with --large", { skip }, () => {
	const largeSvg = join(root, "large.SVG");
	const largePng = join(root, "large.png");
	const large = mermaid({}, "--large", "--png", source, largeSvg);
	assert.equal(large.status, 0, large.stderr);
	assert.equal(large.stdout, `${largeSvg}\n${largePng}\n`);
	const sizes = svgSize(largeSvg);
	assert.notEqual(sizes.width, sizes.viewWidth);
	for (const [svgFile, pngFile] of [
		[svg, png],
		[largeSvg, largePng],
	]) {
		const image = readFileSync(pngFile);
		assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", pngFile);
		const { width, height } = svgSize(svgFile);
		assert.equal(image.readUInt32BE(16), 2 * width, pngFile);
		assert.equal(image.readUInt32BE(20), 2 * height, pngFile);
	}
});

test("with no browser, the SVG stays and one stderr line says why there is no PNG", { skip: pele }, () => {
	const svgFile = join(root, "no-browser.svg");
	const result = mermaid({ CHROME: join(root, "no-browser") }, "--png", source, svgFile);
	assert.equal(result.status, 1, result.stderr);
	assert.equal(result.stdout, `${svgFile}\n`);
	assert.match(result.stderr, /^.+\n$/);
	assert.ok(readFileSync(svgFile, "utf8").startsWith("<svg"));
	assert.ok(!existsSync(join(root, "no-browser.png")));
});

// A browser that writes its port to DevToolsActivePort, and lists a page whose WebSocket URL refuses the connection:
// its own HTTP server, which answers with JSON and not with a WebSocket.
const NO_DEVTOOLS = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const profile = process.argv.find((arg) => arg.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
const server = createServer((request, response) => {
	const url = \`ws://127.0.0.1:\${server.address().port}/devtools/page/1\`;
	response.end(JSON.stringify([{ type: "page", webSocketDebuggerUrl: url }]));
});
server.listen(0, "127.0.0.1", () => writeFileSync(join(profile, "DevToolsActivePort"), \`\${server.address().port}\\n\`));
`;

test("when the browser refuses the DevTools connection, the stderr line gives a reason", { skip: pele }, () => {
	const script = join(root, "no-devtools.mjs");
	writeFileSync(script, NO_DEVTOOLS);
	const browser = join(root, "no-devtools");
	writeFileSync(browser, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
	const svgFile = join(root, "no-devtools.svg");
	const result = mermaid({ CHROME: browser }, "--png", source, svgFile);
	assert.equal(result.status, 1, result.stderr);
	assert.equal(result.stdout, `${svgFile}\n`);
	assert.match(result.stderr, /^No PNG: \S.*\n$/);
	assert.ok(!existsSync(join(root, "no-devtools.png")));
});
