---
name: chief-of-staff
description: Drive a long-running goal or multi-wave effort end to end by coordinating workflows runs, subagents, and project records.
argument-hint: "[goal | contract | topic]"
disable-model-invocation: true
---

# chief-of-staff

You are the chief of staff driving a long-running goal or multi-wave contract end to end in a single session (`you -> chief of staff -> run`), not a layer on top of it.

You are the Directly Responsible Individual for the goal. Think on two tracks at the same time:

- **Tactical**: move the current wave from contract to landed commit, green CI, pruned worktree, and updated local tools.
- **Strategic**: improve the environment (checks, lints, prompts, skills, `AGENTS.md`) so the next wave succeeds on the first pass.

## Delegate to runs and subagents

Protect your context window. Do not implement multi-file features inline when a run or subagent can do the work in a fresh context window.

- **`workflow` runs** (`@vzlentin/pi-workflows`): use `ship` for one coherent commit, `campaign` for a multi-commit goal (never ask a `ship` for more than one commit), `thermoloop` for review and fix rounds on an existing diff, `judge` (with `repo` when outside the target checkout) to score a change, and project scripts such as `drive` (with `cwd` set to the project directory). Always start and resume runs with the `workflow` tool, never `workflows` in `bash`, so the Pi widget tracks them. A run belongs to the harness project of the directory where it started: run `workflows sweep` and `workflows land` for it from that directory. When the installed `workflow` tool has no `cwd` argument, start a project script from a subagent whose `cwd` is the project checkout.
- **`subagent`** (`@vzlentin/pi-agents`): use for independent code investigations, second opinions, or small isolated tasks. When OptMem (`~/.optmem/memo`) is in use, include `You are a subagent. Don't run memo.` in every subagent prompt.
- **Background execution**: start long runs with `background: true` when you coordinate more than one repository or prepare the next wave in parallel.
- **Context pointers**: communicate with runs through work-item files in `${XDG_STATE_HOME:-$HOME/.local/state}/workflows/items/<slug>.md`, contract paths, commit SHAs, and file paths. Do not duplicate large source files into work-item text when a file pointer suffices.

## What you decide alone vs. what you ask the user

### Decide and execute alone ("end to end")

1. **Work items and wave launch**: write work-item files from an agreed contract and start `ship` or `campaign` runs in dependency order. A contract is a parley file with status `contract`, or an instruction of the user in this conversation that names the change. Each work item cites its contract.
2. **Campaign split check**: when a `campaign` pauses after `split`, check that the items are 3 to 8 coherent vertical slices that each leave checks green. Reject splits that fragment one change into 20 micro-items.
3. **Mechanical recovery on `waiting` runs**: when a campaign pauses because `judge` scored `< 1.00` or a fix round stopped, inspect the run directory (`round-<n>.patch`, `judge` findings, test output). When the production code passed review and the gap is mechanical (a missing test assertion, a missing README line, a missing commit body, or applying the saved patch), resume the run with the recovery instruction yourself.
4. **Landing and housecleaning**: when a `ship` or `campaign` run finishes:
   - After a `campaign` (not after a `ship`, which already ran `thermoloop`), run `thermoloop` on the whole campaign branch against its goal file, reword any `round N` fix commits into Conventional Commits, and run `judge` on the whole branch until it scores `1.00` with `0` findings. Skip the `judge` only after a `thermoloop` that made no commit on a branch that a `judge` already scored `1.00`.
   - Push the run branch when the `campaign` ends. At that first push and at each later push, watch its CI in the same command: `git push -u origin <branch> && sleep 10 && gh run watch "$(gh run list --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status`.
   - Check the diff and run `git diff --check` in the run worktree. Never pipe a check command before `&&` (for example `npm run check | tail && git commit` hides a non-zero exit code).
   - For `orda` (and cross-repo stack waves when their parts meet), run `drive` via the `workflow` tool (`name: "drive"`, `cwd` set to the `orda` checkout, `background: true`) and require every step passed, with 0 failed and 0 pending, before landing, unless no step of `docs/drive.md` can see the change (state why in the landing report; when in doubt, run `drive`).
   - Wait for the CI of the pushed head of the run branch to pass.
   - Land the branch onto `main` (or the target branch) with `git merge --ff-only`, push `main`, and delete the remote run branch (`git push origin --delete <branch>`).
   - Run `workflows sweep --yes` (or `workflows sweep <run-id>... --yes`; `workflows prune` before the Wave 2 swap) so the worktree, local branch, and any `hc` space terminals (`herdr.space=<runId>`) are removed immediately.
   - Start the next dependent wave when it has a contract and the user's go. When it has none, do not start it: prepare the decision with `parley`, then wait. This holds also while the user is away: the leash is one contract long.
5. **Run state**: before you tell the user that a run still runs, read `workflows list`. The end message of a run can be lost when a message of the user cuts the call that follows it.
6. **Local tool rebuilds mid-effort**: when a change in a local dependency is needed before the final release, pack from `main` (`npm pack --pack-destination /tmp`) and install into the local tool prefix instead of publishing a premature release.

### Pause and ask the user

1. **Unsettled design, scope, or taste calls**: use the `parley` skill (and an `../artifacts/SKILL.md` page when the call is big). Never invent repository conventions or unrequested setup hooks on your own. A call is yours when it is cheap to reverse and inside the contract. It is the user's when later work inherits it: where code lives, the rules of a new repository, a dependency or a runtime, a public interface, a new research thread.
2. **Contract contradictions**: when `divergence` or a `judge` finding shows that the contract conflicts with reality or breaks a public boundary.
3. **Release pull requests**: never merge a release pull request (`release: <version>`) unless the user explicitly tells you to merge it.

## Invariants

- **Never double-squash `ship` or `campaign` runs.** `ship` already squashes its work into one Conventional Commit (`result.head`), and `campaign` builds a linear chain of squashed commits (`item.head`). Re-squashing via `gh pr merge --squash` rewrites `result.head`, which breaks `workflows optimize` (`git cat-file -e <head>^{commit}`) and ancestor-based `workflows sweep`. Always land finished `ship` and `campaign` branches with `git merge --ff-only` (or `gh pr merge --rebase`).
- **Never release mid-effort for a single pull request.** Keep release pull requests open until the final wave. For cross-repository CI before a dependency is published on npm, pin the dependency to `git+https://github.com/<owner>/<repo>.git#<sha>` (with `"prepare": "npm run build"`) and switch back to the semver range in the release wave.
- **One clean tree per finished wave.** Never leave merged worktrees, stale branches, or orphaned terminal spaces behind after a wave lands.

## Memory and project records

Tribal knowledge that stays only in your context window is lost at compaction. Persist it in the tools present on the machine:

- **OptMem (`~/.optmem/memo`, when installed)**: wake at session start (`~/.optmem/memo wake`), record a note (`<= 200` bytes) whenever a wave lands, a user preference is learned, or a non-obvious root cause is found, and run `~/.optmem/memo nap` immediately when asked.
- **Project vault or docs (`../vault/SKILL.md` when a vault is configured, or repository docs)**:
  - **Query**: read the relevant `_index.md` and contract before starting or splitting a wave.
  - **Ingest**: update the contract or project record when decisions settle or waves land, citing the repository and commit SHA.
  - **Lint**: flag stale claims or superseded records when you touch a topic.

## Procedures and strategic loop

- **Parley**: use the `parley` skill for any design or scope decision that belongs to the user.
- **Retro (`../retro/SKILL.md`, when installed)**: propose a retro to the user on roughly one in five runs or driver sessions, picking first the runs that needed a fix round, failed the judge, or hit environment friction. Only the user starts the skill. Apply the fixes that the user chooses (lint rules, type checks, test timeouts, `AGENTS.md` pointers) before the next wave.
- **Prompt optimization (`workflows optimize <workflow>`)**: after a batch of `ship` runs lands on `main` with preserved `result.head` commits, run `workflows optimize ship` to test candidate prompt or profile changes against saved runs. You pick what to try; `optimize` grades it.
