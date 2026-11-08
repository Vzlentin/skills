import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const BUILD = fileURLToPath(new URL("../skills/parley/build.mjs", import.meta.url));

// Card 1 has gains and costs, card 2 has only the reason. The page places both.
// No Mermaid block: it needs Pele.
const SOURCE = `---
page: placed-why
---

# Placed cards

{{card 1}}

{{card 2}}

## Decisions

### 1 · Lock owner · your call

- a · **harness owns the lock** · plan
  + one lock for all packages
  - harness must ship first
- b · **each package has its own lock**
  - two installs can race

Plan: a, because one lock is simpler.

### 2 · Lock file · your call

- a · **in the state folder** · plan
- b · **in the repository**

Plan: a, because the state folder is not in Git.
`;

const dir = mkdtempSync(join(tmpdir(), "parley-test-"));
let cards;

// build.mjs builds when it loads, so it runs as a child process.
before(() => {
	const source = join(dir, "page.md");
	const out = join(dir, "index.html");
	writeFileSync(source, SOURCE);
	execFileSync(process.execPath, [BUILD, source, out], { env: { ...process.env, PAGES_NO_PI: "1" }, stdio: "pipe" });
	const html = readFileSync(out, "utf8");
	cards = Object.fromEntries([...html.matchAll(/<article class="dec" id="d-(\d+)"[\s\S]*?<\/article>/g)].map((match) => [Number(match[1]), match[0]]));
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("a placed card shows the gains and costs of its options under why", () => {
	const why = cards[1].match(/<details class="why"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
	assert.match(why, /<span class="gain">one lock for all packages<\/span>/);
	assert.match(why, /<span class="cost">harness must ship first<\/span>/);
	assert.match(why, /<span class="cost">two installs can race<\/span>/);
});

test("a placed card keeps its reason in view", () => {
	assert.match(cards[1], /<div class="reason"><p>Plan: a, because one lock is simpler.<\/p>\s*<\/div>/);
	assert.match(cards[2], /<div class="reason"><p>Plan: a, because the state folder is not in Git.<\/p>\s*<\/div>/);
	assert.doesNotMatch(cards[2], /<details class="why"/);
});
