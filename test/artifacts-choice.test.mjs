import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { startChrome } from "../skills/artifacts/chrome.mjs";
import { buildPage } from "./artifacts-build.mjs";

const root = mkdtempSync(join(tmpdir(), "artifacts-choice-"));

const PAGE = `<h1>Cache</h1>
<section class="choice" data-name="cache" data-plan="b" x-data="choice">
<p class="question">Where does the cache live?</p>
<div class="body"><p>The cache is read on each start.</p></div>
<label class="option"><input type="radio" value="a" x-model="value"><span class="key">a</span><span class="label">In the package folder</span><span class="gains">One folder to remove</span><span class="costs">Lost on each update</span></label>
<label class="option"><input type="radio" value="b" x-model="value"><span class="key">b</span><span class="label">In the home folder</span><span class="gains">Kept on each update</span><span class="costs">One more folder</span></label>
<input class="own" type="text" placeholder="Or your own answer" x-model="own">
</section>
<section class="choice" data-name="lock" data-plan="a" x-data="choice">
<p class="question">Who owns the lock?</p>
<div class="body"><p>Two installs can run at the same time.</p></div>
<label class="option"><input type="radio" value="a" x-model="value"><span class="key">a</span><span class="label">Each package</span><span class="gains">No new tool</span><span class="costs">Two installs can race</span></label>
<label class="option"><input type="radio" value="b" x-model="value"><span class="key">b</span><span class="label">The installer</span><span class="gains">One lock</span><span class="costs">The installer ships first</span></label>
</section>
<section class="choice" data-name="log" x-data="choice">
<p class="question">Where does the log go?</p>
<div class="body"><p>The install writes one log.</p></div>
<label class="option"><input type="radio" value="a" x-model="value"><span class="key">a</span><span class="label">Next to the cache</span><span class="gains">One place</span><span class="costs">The cache grows</span></label>
<label class="option"><input type="radio" value="b" x-model="value"><span class="key">b</span><span class="label">On the terminal</span><span class="gains">No file</span><span class="costs">Lost at the end</span></label>
<input class="own" type="text" placeholder="Or your own answer" x-model="own">
</section>
`;

// The checked option of each choice, as "<name>:<key>".
const CHECKED = `[...document.querySelectorAll(".choice")].map((choice) => choice.dataset.name + ":" + (choice.querySelector(".option input:checked")?.value ?? "")).join(" ")`;
const CACHE = `document.querySelector(".choice[data-name=cache]")`;

let chrome;
let skip;
try {
	chrome = await startChrome();
} catch (error) {
	if (!/No Chrome found/.test(error.message)) throw error;
	skip = error.message;
}

after(async () => {
	await chrome?.close();
	rmSync(root, { recursive: true, force: true });
});

async function evaluate(expression) {
	const { result, exceptionDetails } = await chrome.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	return result.value;
}

// The value of expression once it is truthy, polled for 5 s.
async function until(expression) {
	for (let tries = 0; tries < 50; tries++) {
		const value = await evaluate(expression);
		if (value) return value;
		await sleep(100);
	}
	throw new Error(`still false after 5 s: ${expression}`);
}

const TEXT = `window.Alpine?.store("back")?.text`;

test("a choice gives its plan with no click, or its name with an empty value when it has no plan, then the picked key, then the reader's own words, and leaves the other choice as it is", { skip }, async () => {
	const built = buildPage(root, "choice", PAGE);
	assert.equal(built.status, 0, built.stderr);
	await chrome.load(`file://${built.out}`);

	assert.match(await until(TEXT), /^cache:\nb\n\nlock:\na\n\nlog:\n$/m);
	assert.equal(await evaluate(CHECKED), "cache:b lock:a log:");
	assert.equal(await evaluate(`${CACHE}.querySelector(".option.plan input").value`), "b");
	assert.equal(await evaluate(`document.querySelector(".choice[data-name=log] .own").value`), "");
	assert.equal(await evaluate(`document.querySelectorAll(".choice[data-name=log] .option.plan").length`), 0);

	await evaluate(`${CACHE}.querySelector(".option input[value=a]").click()`);
	assert.match(await until(`${TEXT}.includes("cache:\\na") && ${TEXT}`), /^cache:\na\n\nlock:\na\n\nlog:\n$/m);
	assert.equal(await evaluate(CHECKED), "cache:a lock:a log:");

	await evaluate(`(() => {
		const own = document.querySelector(".own");
		own.value = "next to the lock";
		own.dispatchEvent(new Event("input", { bubbles: true }));
	})()`);
	assert.match(await until(`${TEXT}.includes("to the lock") && ${TEXT}`), /^cache:\nnext to the lock$/m);
	assert.equal(await evaluate(CHECKED), "cache: lock:a log:");
});
