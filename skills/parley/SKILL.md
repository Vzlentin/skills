---
name: parley
description: The user's decision primitive, and his way to be asked questions. Use when a design, a plan or a question has decisions that only the user can make (trade-offs, taste, priorities, how it must work for him), or when he says "parley".
---

# parley

A parley turns a question that only the user can answer into a contract that you both agree. It happens in the chat.

`{baseDir}` is the directory of this `SKILL.md`.

## How you talk

The user takes many decisions each day, on many systems. Brief him like an executive.

- BLUF, then Minto's pyramid principle.
- Start each round with the rundown: what is true today, concretely, as a `show-me` view. The calls come after it.
- Each call: your plan, and what each option costs, in outcomes and numbers, not code.
- Plain language. Define each term on first use.
- At most 5 open calls at a time. The others wait their turn.
- Each turn in the chat, give the state: the output of `decisions.mjs` (see Decisions file), then what comes next.
- Each round builds on the last one. When a view you already showed changes, show that same view again, updated, with the change highlighted.
- A side topic gets one line at the end.
- End with one thing to answer.

Use `show-me` for the views. Make a page when the rundown or a call is too complex for the chat, or when the user asks for it: load `artifacts`, then write, build, check and publish the page (see Page).

## Rules

- Do not make the user repeat himself. Read the decisions files, the earlier records and the memory first, when they exist.
- Get the facts yourself. Ask the user only what only he can answer.

## Design sense

Aim for evolvability: a system that stays cheap to change. Life is the best example of it, and four of its ideas guide your plan and each option. Treat them as lenses. When the problem asks for something else, follow the problem and say why.

**Tinkering** (Jacob). Evolution never starts from a blank page. It reuses what already works. Start from what exists, and prefer the answer that removes a decision to the one that adds machinery.

**Facilitated variation** (Kirschner and Gerhart). Life varies cheaply because a conserved core does the hard work, and its parts work alone and link weakly. Build the same way: standalone primitives with one job each, one source of truth for each fact, and a whole that comes from how they compose. A copy is a trial: it joins the core when a second user needs it, or it goes. Each primitive has a membrane: it validates what comes in once, at ingress, and trusts its own data inside. Parse, don't validate. Life's exploratory processes make many variants and keep the ones that a target selects: make variants cheap, and selection sharp.

**Canalization** (Waddington). No gene scripts an embryo step by step. Its landscape leads many paths to the same form. Shape the ground, with defaults, contracts and checks, not the path. The ground acts at every step: when a contract can be a check (a fitness function), make it a check. Check the invariant, not the form.

**The barrier** (Weismann). The body does not write the germline. Design so that the agent that does the work cannot change what selects it: its tests, checks, judge and skills. What it learns becomes heritable only after a selection. Without the barrier, Goodhart's law takes over.

Life also shapes by deletion: a hand gets its fingers when the cells between them die (apoptosis). Each change asks what can go. Write code that is easy to delete: no migration or compatibility code that will not make sense later. And design for where the system will live: the user's own machine and tools.

## Flow

1. Get the facts. Search `${XDG_STATE_HOME:-$HOME/.local/state}/parley/` and the earlier records on the topic. A settled decision stays settled until the user opens it again.
2. Sort the calls, and write them in the decisions file. A your call is taste, priority, or how it must work for the user: it has no answer until the user gives one. A my call is a choice that evidence can settle: its plan is yours, and one line of evidence goes in the `gains` of its plan option. A call that waits its turn goes into the file in the round that asks it.
3. Ask in the chat: the rundown, then the output of `decisions.mjs`. Its last line is the answer line that takes all your plans.
4. Apply each answer line to the file. For `?N`, explain N first.
5. When no call is open, the answers are the contract. Read back first only when an answer is in the user's own words or leaves your plan: the terms in your own words, with each answer, for his `ok` or his correction.
6. Set the contract in the file. Goal files come after it, and they cite its path.

## Answer line

```text
[slug] 1a 3:"own words" 4b:"a note" ?5 ok
```

- `1a` picks option a. `3:"..."` is an own answer. `4b:"..."` is a pick with a note.
- `?5` asks you to explain 5 first.
- `ok` accepts each my call that the line does not name, or a read-back.

## Decisions file

Each parley has one file, `${XDG_STATE_HOME:-$HOME/.local/state}/parley/<slug>.json`. It is the source of truth from Round 1 to the contract, and the only copy of the decisions. Write each decision once, in the file. Write the file yourself, and create the folder when it is missing.

After each write, run the command below. It checks the file, and prints one error line when the file is wrong. Its output is the state of the turn: one line for each decision, then the answer line that takes all your plans. Show it in the chat, and do not type the decisions again.

```sh
node {baseDir}/decisions.mjs <slug>
```

- Apply each answer line to the file. A pick sets `answer` to its letter. An own answer sets `answer: "own"` and a short `label`. Put the user's exact words in `words`, never a summary.
- At the contract, each decision has an answer. Set `status: "contract"` and `design_sense`: what the lenses changed in your plan, or `none`. The command then prints the path of the file in place of the answer line. Goals cite that path.
- Write no record copy, in the vault or in another place. The earlier records stay as they are.
- Decision numbers never change.

The fields. A key that is not in this list is an error.

- Top level: `slug` (lowercase words with hyphens, the file name), `status` (`"open"` or `"contract"`), `title`, `goal` and `decisions`. Optional: `evidence` (a list of strings) and `design_sense`.
- A decision: `n`, `title`, `kind` (`"your call"` or `"my call"`), `options` and `plan` (the key of an option). Optional: `tension`, `answer` (the key of an option, or `"own"`), `label` (required with `"own"`) and `words` (a list of strings).
- An option: `key` (one lowercase letter) and `label`. Optional: `gains` and `costs` (lists of strings).
- Strings are plain text: no Markdown, no backtick and no `**`. Only `words` keeps them, as the user wrote them. No string or list is empty: leave out an optional key in its place.

An open file in Round 1, with one your call and one my call:

```json
{
  "slug": "install-lock",
  "status": "open",
  "title": "install lock: who owns it",
  "goal": "One lock keeps two installs from writing the same folder at the same time.",
  "decisions": [
    {
      "n": 1,
      "title": "Lock owner",
      "kind": "your call",
      "tension": "Each package installs alone, but two installs write the same folder.",
      "options": [
        { "key": "a", "label": "harness owns the lock", "gains": ["one lock for all packages"], "costs": ["harness must ship first"] },
        { "key": "b", "label": "each package has its own lock", "costs": ["two installs can race"] }
      ],
      "plan": "a"
    },
    {
      "n": 2,
      "title": "Stale lock",
      "kind": "my call",
      "options": [
        { "key": "a", "label": "a dead PID is taken over", "gains": ["a spike: after kill -9 on the holder, the next install took the lock"] },
        { "key": "b", "label": "a timeout" }
      ],
      "plan": "a"
    }
  ]
}
```

The command prints:

```text
install-lock · open · install lock: who owns it
1 · Lock owner · your call · open · plan a · harness owns the lock
2 · Stale lock · my call · open · plan a · a dead PID is taken over
[install-lock] 1a ok
```

For a script or an app, `decisions.mjs` also exports its helpers. A bad file or a bad value throws one error line: the file or the slug, the JSON path of the bad value, and what is expected.

- `parleyDir()`: the folder of the decisions files.
- `decisionsPath(slug)`: the file of a slug, in `parleyDir()`.
- `readDecisions(path)`: the checked data of a file.
- `listDecisions(dir)`: the checked data of each file in `dir` (`parleyDir()` by default), in the order of `slug`.
- `writeDecisions(path, data)`: checks the data, then writes the file as JSON with tabs, and creates the folder when it is missing.
- `applyAnswers(data, answers, { status, design_sense })`: a new checked parley, with each `{ n, answer, label, words }` in place of the answer of decision `n`.
- `shownLabel(decision)`: the label of the answer, or of the plan while the decision is open.

## Page

`artifacts` owns the page: its layout, colors, check and bar. parley adds the decisions. Lay out, in order: what is true today, concretely; the options; then what he needs to answer.

`build.mjs` builds the page from the decisions file. The page has the title and the goal of the file, then `/tmp/pages/<slug>/page.html` when it exists, then the block of each decision that no tag places, in the order of `n`. With no `page.html`, the page has the title, the goal and every decision.

- `page.html` is HTML with the blocks of `artifacts` and `<decision n="N">…</decision>`, with no Markdown. It has no `<h1>`: the build writes the title and the goal.
- `<decision n="3">…</decision>` places the block of decision 3 there. The block is a `.split`: its number, title, kind and tension, and the HTML inside the tag, in the main track, and its card in the side track. Put the view that explains the decision inside the tag. Do not put a `.split` inside a decision tag.
- The card: an open your call shows its options as buttons, with a badge on the plan. A my call or a decided call folds to one line with its plan or its answer: open it to change it. A decided call also shows its `label` and the user's `words`. Under `why`, the card shows the gains and costs of each option. A live card has "add a note" and "explain first".
- `{?3}` is a blank: the answer to decision 3, or its plan while it is open. It follows the taps. Restate an answer only with a blank, and write no decided, open or next line: it goes stale at the first tap.
- Any control in an Alpine scope can pick: `@click="$store.parley.pick(3, 'b')"`. A decision block is a scope.
- A diagram is the `<diagram>` block of `artifacts`, with an SVG from `show-me` (`mermaid.mjs --large`) in the folder of `page.html`.
- A live page ends with the bar of `artifacts`: Copy gives the answer line, and Clear takes back the taps and notes. The share copy and a contract file have no cards to answer and no bar.
- An invalid decisions file, a tag that names no decision, a decision placed two times, or a missing diagram file stops the build with one error line.

The decisions are only in the decisions file: `page.html` holds no option, plan or answer. After each answer, apply it to the file, run `decisions.mjs`, then build the page again. The page is disposable.

```sh
node {baseDir}/build.mjs <slug> [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/build.mjs --share <slug>      # share.html: a light copy
```
