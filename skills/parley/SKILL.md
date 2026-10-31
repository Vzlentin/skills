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
- Each call: your plan, and what each option costs, in outcomes and numbers, not code.
- Plain language. Define each term on first use.
- At most 5 open calls at a time. The others wait their turn.
- Each turn in the chat, give the state: decided, open, next.
- Each round builds on the last one. When a view you already showed changes, show that same view again, updated, with the change marked.
- A side topic gets one line at the end.
- End with one thing to answer.

Use `show-me` for the views. Make a page only when the user asks for it: load `artifacts`, then write, build, check and publish the page (see Page).

## Rules

Apply these rules to your plan and to each option that you recommend:

- Do not overengineer.
- Take the lazy answer first. Look for the answer that removes a decision.
- No vestigial code: no migration or compatibility code that will not make sense later.
- One copy of each thing.
- It must work for the user first: his own machine and tools. When Herdr, Ghostty or a vault is there, use it.
- Do not make the user repeat himself. Read the earlier records and the memory first, when they exist.
- Get the facts yourself. Ask the user only what only he can answer.

## Flow

1. Get the facts. Search for earlier records on the topic where records go (see Record). A settled decision stays settled until the user opens it again.
2. Sort the calls. A your call is taste, priority, or how it must work for the user: it starts empty. A my call is a choice that evidence can settle: it starts set to your plan, with one line of evidence.
3. Ask in the chat, with the answer line that takes all your plans.
4. Apply each answer line. For `?N`, explain N first.
5. When no call is open, the answers are the contract. Read back first only when an answer is in the user's own words or leaves your plan: the terms in your own words, with each answer, for his `ok` or his correction.
6. Write the record. Goal files come after it, and they cite it.

## Answer line

```text
[slug] 1a 3:"own words" 4b:"a note" ?5 ok
```

- `1a` picks option a. `3:"..."` is an own answer. `4b:"..."` is a pick with a note.
- `?5` asks you to explain 5 first.
- `ok` accepts each my call that the line does not name, or a read-back.

## Record

Write it at the contract, in the format of `{baseDir}/template.md`, with `status: contract` and plain words in place of each blank. If you have a notes or vault skill, the record goes there: load that skill. If not, it goes in `/tmp/pages/<slug>/record.md`.

- Below the options of each decision: `Answer: <letter>`, or `Answer: own · <short label>`. Under it, quote the user's exact words, never a summary: `> "words"`. Decision numbers never change.

## Page

Design the page for its topic, as `artifacts` says. Lay out, in order: what is true today, concretely; the options; then what he needs to answer, each decision next to the view that explains it.

Write the page source in `/tmp/pages/<slug>/page.md`: an `artifacts` source with a `## Decisions` section in the format of `{baseDir}/template.md`. Until the contract, that section is the only copy of the decisions: apply each answer line there, then build again. `build.mjs` adds the parley parts:

- `## Decisions` becomes the cards: an open your call shows its options as buttons; a my call or a decided call folds to one line. `{{card 3}}`, alone on its line, places card 3 next to its view. A placed card carries only its option labels and the Plan line; its view holds the reasons.
- `{?3}` is a blank: the answer to decision 3, or its plan while it is open. It follows the taps. Restate an answer only with a blank, and write no decided, open or next line: it goes stale at the first tap.
- Any control can pick: `@click="$store.parley.pick(3, 'b')"`.
- A ` ```mermaid ` block becomes a `show-me` diagram. It needs Pele: `npm install -g pele`.
- A live page ends with the bar: Copy gives the answer line. The share copy and a `status: contract` source have no cards to answer and no bar: build the record for the contract page.

```sh
node {baseDir}/build.mjs <page.md> [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/build.mjs --share <page.md>      # light copy
```
