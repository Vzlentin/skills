---
name: artifacts
description: "Make HTML pages for the user and get them to him: pages that teach, with widgets that the reader plays, pages that ask for his edits, and copies to share. Covers the approach, the terminal theme, the base shell, Alpine and widgets, the way back, the check, and the hosts (local file, Radius, Claude Artifact)."
---

# artifacts

An artifact is a page that you make for the user, outside the terminal: to explain, to ask for his edits, or to share. He reads it on his computer or on his phone.

`{baseDir}` is the directory of this `SKILL.md`.

## Approach

- Progressive disclosure: each section answers one question in its heading, gives the answer in its first line, and puts the rest behind a tap.
- Plain language. Define each term on first use.
- Concrete before abstract: start from what is true today.
- The page uses the width of the screen it is on. On a laptop (1280 to 1728 px), text and the part that shows it sit side by side: put each view, example, code block, table or card beside the text that explains it (`.split`). On a phone, they stack in one column. Both must work.
- Creative: build the parts that the point needs, in HTML in the source. Nothing is fixed.
- The terminal theme: Pi's colors from Ghostty, when Ghostty is there. If not, the saved colors. The page keeps these colors in each light or dark setting of the viewer. Only the share copy is light. Use no other colors.

## Build

```sh
node {baseDir}/render.mjs <source.md> [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/render.mjs --share <source.md>      # light copy for other people, and for a PDF
node {baseDir}/render.mjs --theme                  # the theme as CSS variables, for a page by hand
```

- The source: frontmatter with a `page:` slug, then Markdown and HTML. `<style>` and `<script>` blocks go in as they are.
- The base shell gives the theme as CSS variables (`--accent`, `--text`, `--muted`, `--card`, `--line`, ...), the type, the spacing, the code style and the layout. Do not write layout CSS of your own (widths, margins, columns, media queries): use the parts of the shell.
- The layout: the page takes the width of the screen, up to 1760 px, with one left edge for every part. It has two tracks: the main track holds text at a readable measure (`--measure`, 70 ch), and the side track takes the rest of the width. Under 1080 px, it has one track.
  - Text goes in the main track by itself.
  - `.split` puts its first child in the main track and its second child in the side track, side by side. On a phone, the second child comes under the first. It is the part to use most: the text of a section on the left, and its view, example, code, table or card on the right.
  - Tables, figures, code, `.grid` and `.card` outside a `.split` take the full width.

  ```html
  <div class="split">
  <div>

  ## Why the test passed

  The text, in Markdown, with a blank line after each tag.

  </div>
  <div>
  <w-trace></w-trace>
  </div>
  </div>
  ```

- Other parts: `.grid` (columns that wrap on a phone), `.card`, `.kicker` (a small label above a heading), `.lead` (the answer under it), `.pill` with `.good`, `.warn` or `.bad`, `.term` with `.s1` to `.s4` (a word in the color of a series), `.muted`, `.no-share`.
- Code blocks: `diff`, and each language that highlight.js knows.
- A local image goes into the page. A local SVG goes in as it is and takes the page colors. For a diagram, draw it with `show-me` (`mermaid.mjs --large`) and link the SVG: `![what it shows](diagram.svg)`.
- A PDF: `<chrome> --headless=new --no-pdf-header-footer --print-to-pdf=<file.pdf> file:///tmp/pages/<slug>/share.html`. `<chrome>` is `google-chrome` or `chromium` on Linux and WSL, and `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` on macOS.

## Interaction: Alpine connects, widgets draw

A page that moves uses one model:

- Alpine holds what the page knows: the state that the text, the fields and the widgets share, and the way back. Write it as attributes in the HTML.
- A widget draws one part that the reader plays, moves or points at: a chart, a timeline, a process that runs. It is a `<w-…>` tag.
- They meet in one attribute: `<w-days x-model="day">`. Alpine sets the value of the widget, and the widget tells Alpine when the reader changes it.

```html
<div x-data="{ day: 2 }">
	<p>On day <b x-text="day"></b>, the forecast uses the data of day <b x-text="day - 1"></b>.</p>
	<w-days x-model="day"></w-days>
</div>
```

A page gets only what it uses. Alpine weighs 56 KB and the widget kit 27 KB: a page with a toggle or two uses `<details>`, and a page without a part that draws uses no widget.

### Alpine

When the source has an Alpine attribute (`x-data`, `x-model`, `@click`, ...), the page gets Alpine.js with its persist plugin (`{baseDir}/vendor`). Write tabs, steps, toggles and fields as Alpine attributes in the HTML.

### The way back

The way back is how the user's edits come back to you: one store, `$store.back`, kept in his browser.

```html
<textarea x-data x-init="$store.back.field('reply 1', $el.value)" x-model="$store.back.values['reply 1']">Draft</textarea>
<span x-data x-show="$store.back.changed('reply 1')">edited <a @click="$store.back.undo('reply 1')">undo</a></span>
```

- An interactive page ends with the bar: the block, Copy, Send in a host that has `sendPrompt`, and Clear once there is an edit. The build adds it, and it shows once the page has a field or a part.
- `$store.back.text` is the block that Copy gives: the lines of each part, then each changed field as `key:` and its text. With no part, it starts with `[slug]`.
- A page that builds its own lines adds a part: `Alpine.store("back").part(() => "a line")`, in an `alpine:init` listener. Its fields take `{ list: false }`, so that only the part reports them.
- A widget value goes back as a field: `<w-lags x-data x-init="$store.back.field('lag', 3)" x-model="$store.back.values['lag']"></w-lags>`.
- The browser keeps only the user's edits. When you build the page again with new defaults, a field that he did not edit shows the new default.
- The user pastes the block to you. Read it, then apply it.

### Widgets

When the body has a `<w-…>` tag, the page gets Lit (`{baseDir}/vendor/lit.min.js`) and the kit (`{baseDir}/kit.js`). A code sample does not count: its `<` is escaped.

Ready widgets are in `{baseDir}/widgets/`: the page gets `widgets/w-<name>.js` for each `<w-name>` tag. Use them as tags, with no script.

- `<w-aside>The question that the reader asks here</w-aside>`: answer it in the text after it.

A new widget goes in a `<script type="module">` of the page. Each module script has its own scope, so two widgets can use the same names.

```html
<script type="module">
const { css, html } = Lit;
const { Widget, Player, slider } = kit;

class Days extends Widget {
	static styles = css`.big { font: 700 40px var(--mono); color: var(--c); }`;
	player = new Player(this, { min: 0, max: 10, speed: 2, bind: true });
	render() {
		const day = Math.floor(this.player.value);
		return html`<div class="card">
			<div class="head">Day ${day}</div>
			<div class="body"><div class="big s1">${day}</div></div>
			<div class="foot">
				${this.player.button()} ${this.player.backButton()}
				${slider({ min: 0, max: 10, value: day, label: "Day", onInput: (v) => { this.player.pause(); this.emit(v); } })}
				${this.player.nextButton()}
			</div>
		</div>`;
	}
}
customElements.define("w-days", Days);
</script>
```

- `kit.Widget`: the base of a widget. It gives the kit styles before its own `static styles`, a `value` that Alpine binds with `x-model`, and `this.emit(value)`, which sets the value and tells the page. An attribute such as `value="3"` is JSON when it parses: the number 3.
- The kit styles: `.card` with `.head`, `.body` and `.foot`, `.btn` (`.ghost`, `.on`), `.seg` (a group of buttons), `.count`, `.note`, `.mono`, and `.s1` to `.s4`, which set `--c` to the color of series 1 to 4.
- `kit.slider({ min, max, step, value, label, onInput })`, `kit.icon(name)` and `kit.iconButton(name, { label, disabled, ghost, onClick })`. The icons: `play`, `pause`, `back`, `next`, `replay`.
- `new kit.Player(this, { min, max, value, speed, autoplay, bind })` moves a value from `min` to `max` at `speed` units per second. It stops at `max` and pauses when the widget is off the screen. It does not start by itself when the reader asks for reduced motion. With `bind: true`, it moves the value of the widget, and the page gets each whole unit. `player.button()` is play, pause and replay. `player.backButton()` and `player.nextButton()` call `player.step(-1)` and `player.step(1)`.
- The colors: the theme variables, and `--series-1` to `--series-4`, four colors that differ in each scheme.
- Lit draws, Alpine connects: a widget does not keep the state of the page, and Alpine does not draw inside a widget.
- When a widget is useful outside its page, move its script to `{baseDir}/widgets/w-<name>.js` and add it to the list above.

## Check

Before you publish, run the check on the built page:

```sh
node {baseDir}/check.mjs /tmp/pages/<slug>/index.html
```

It takes screenshots at 390, 1280 and 1728 px into `/tmp/pages/<slug>/check/`. It lists the errors of the scripts, the `<w-…>` tags that did not start, and the players that do not move. It checks the layout: one left edge, the shell's `--page` and `--measure` with two tracks at 1728 px, no text alone for more than 700 px with the side track empty at 1728 px, no sideways scroll at 390 px, and the same colors in a light and a dark setting. Its exit code is 1 when it finds a problem. It needs Chrome, Chromium or Edge: set `CHROME=<path>` when it does not find one.

- Look at each screenshot. Ask: what covers the screen on the phone? Is the laptop screen full, with each view next to its text?
- Open the page and use each control once.
- One error in a script stops all the widgets of that script.
- A script contains no `</script`: it would end the script.

## Hosts

When the user is at this machine, the local file works. When he is not (on his phone, in a remote session), the host must give him a link: Radius when its tools (`artifacts_create`, ...) are there, else the Claude Code Artifact.

**Radius**:

- Create the artifact once: `artifacts_create` with `content`, `content_type: "text/html"`, `title`, `visibility: "private"` and a `note`.
- For each new version, use `artifacts_versions_publish` on the same slug, with a note that says what changed.
- The title cannot change after the create. Name the topic, not the state.
- A page with Alpine or widgets is larger than one tool output (50 KB). In codemode, read it as base64 in parts of 40 KB, then decode it with `decodeURIComponent(escape(atob(b64)))`.
- After each publish, read it back: `artifacts_versions_read` (`latest`), then `artifacts_files_download`, `curl` the URL and `cmp` the result with the local file.
- Never publish while an edit runs.
- Radius keeps an artifact 90 days after its last publish.
- If the Radius tools fail, or the user cannot open the link (a client VPN can block it), use another host.

**Local file**: open `/tmp/pages/<slug>/index.html`. On macOS: `open <file>`. On Linux: `xdg-open <file>`. On WSL: `wslview <file>`, or `explorer.exe "$(wslpath -w <file>)"`.

**Claude Code**: publish the page as an Artifact. If the `artifact-capabilities` skill exists, load it first. If the account has them, keep the answers in the page database (`ArtifactData`) and use comment threads (`ArtifactComments`). Copy stays as the fallback. In an inline widget, the page shows Send (`sendPrompt`). The page meets the Artifact contract as built: one file, scripts inline, its own colors. Test Copy on the first publish.
