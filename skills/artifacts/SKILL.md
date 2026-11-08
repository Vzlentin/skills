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
- Building blocks: compose the page from the blocks of the kit (`split`, `card`, `grid`, `diagram`, `stepper`, `timeline`). Write a widget only for a model that no block can draw.
- The terminal theme: Pi's colors from Ghostty, when Ghostty is there. If not, the saved colors. The page keeps these colors in each light or dark setting of the viewer. Only the share copy is light. Use no other colors.

## Build

```sh
node {baseDir}/render.mjs /tmp/pages/<slug>/page.html [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/render.mjs --share /tmp/pages/<slug>/page.html      # share.html: a light copy for other people, and for a PDF
node {baseDir}/render.mjs --theme                                  # the theme as CSS variables, for a page by hand
```

- The source: HTML in `/tmp/pages/<slug>/page.html`, the content of `<main>`, with no frontmatter. The slug is the name of its folder. The title is the text of the first `<h1>`: a source with no `<h1>` stops the build.
- The build converts no Markdown: write HTML. The HTML goes into the page as it is, except `<diagram>`. `<style>` and `<script>` blocks go in as they are.
- The built page is a disposable output: to change it, change `page.html` and build again.
- The base shell gives the theme as CSS variables (`--accent`, `--text`, `--muted`, `--card`, `--line`, ...), the type, the spacing, the code style and the layout. Do not write layout CSS of your own (widths, margins, columns, media queries): use the parts of the shell.
- The layout: the page takes the width of the screen, up to 1760 px, with one left edge for every part. It has two tracks: the main track holds text at a readable measure (`--measure`, 70 ch), and the side track takes the rest of the width. Under 1080 px, it has one track.
  - Text goes in the main track by itself.
  - `.split` puts its first child in the main track and its second child in the side track, side by side. On a phone, the second child comes under the first. It is the part to use most: the text of a section on the left, and its view, example, code, table or card on the right.
  - Tables, figures, code, `.grid` and `.card` outside a `.split` take the full width.

  ```html
  <div class="split">
  <div>
  <h2>Why the test passed</h2>
  <p>The text of the section.</p>
  </div>
  <div>
  <diagram src="flow.svg" alt="The request goes through the cache"></diagram>
  </div>
  </div>
  ```

- The other blocks of the kit:
  - `.card`: a box for one thing. `<div class="card"><h3>Release plan</h3><p>…</p></div>`
  - `.grid`: columns that wrap on a phone. `<div class="grid"><div class="card">…</div><div class="card">…</div></div>`
  - `<diagram>`: an image from a file, with `src` relative to the folder of `page.html`. Draw a diagram with `show-me` (`mermaid.mjs --large`) as an SVG in that folder. The SVG goes into the page as it is, so it takes the page colors. A `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` file becomes an image with a data URL. A missing file or an unknown type stops the build. `<diagram src="flow.svg" alt="what it shows"></diagram>`
  - `ol.stepper`: ordered steps, all in view. Mark the steps that are done with `li.done`, and the step that runs now with `li.now`. `<ol class="stepper"><li class="done">Plan</li><li class="now">Build</li><li>Check</li></ol>`
  - `ol.timeline`: events in time order. Each `<li>` starts with a `<time>`. `<ol class="timeline"><li><time>10-27</time>The first page.</li><li><time>11-08</time>The retro.</li></ol>`
- Other parts: `.kicker` (a small label above a heading), `.lead` (the answer under it), `.pill` with `.good`, `.warn` or `.bad`, `.term` with `.s1` to `.s4` (a word in the color of a series), `.muted`, `.no-share`.
- A code sample is `<pre class="code"><code>`, with `&lt;`, `&gt;` and `&amp;` in the text. The build does not color code. A diff is `<pre class="code diff"><code>`, with each line in `<span class="add">`, `<span class="del">` or `<span class="ctx">`.
- A wide table goes in `<div class="tw">`: it scrolls sideways in its own box.
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

It takes screenshots at 390, 1280 and 1728 px, and prints their paths on one line:

```
screenshots: /tmp/pages/<slug>/check/390.png /tmp/pages/<slug>/check/1280.png /tmp/pages/<slug>/check/1728.png
```

It lists the errors of the scripts, the `<w-…>` tags that did not start, and the players that do not move. It checks the layout: one left edge, the shell's `--page` and `--measure` with two tracks at 1728 px, no text alone for more than 700 px with the side track empty at 1728 px, no sideways scroll at 390 px, and the same colors in a light and a dark setting. Its exit code is 1 when it finds a problem. It needs Chrome, Chromium or Edge: set `CHROME=<path>` when it does not find one.

- Take screenshots only with `check.mjs`, and read only the paths on its `screenshots:` line. Never run headless Chrome with `--screenshot`, and never guess a file name. When the line is missing, fix the error and run the check again.
- Look at each screenshot on that line. Ask: what covers the screen on the phone? Is the laptop screen full, with each view next to its text?
- Open the page and use each control once.
- One error in a script stops all the widgets of that script.
- A script contains no `</script`: it would end the script.

## Hosts

When the user is at this machine, the local file works. When he is not (on his phone, in a remote session), the host must give him a link: Radius when its tools (`artifacts_create`, ...) are there, else the Claude Code Artifact.

### Radius

- `mcp__radius__artifacts_create({ title, content, content_type: "text/html", visibility: "private", note })` creates the artifact once. It returns `structuredContent.artifact`. Its `id` is the `slug` of each later call, and it is not the `<slug>` of `/tmp/pages/<slug>/`. Its `canonical_url` is the link to give the user.
- `mcp__radius__artifacts_versions_publish({ slug, content, content_type: "text/html", note })` adds a version. The note says what changed. It returns the same `artifact` object.
- `mcp__radius__artifacts_files_download({ slug, version: "latest", path: "index.html" })` returns `structuredContent.url`, a presigned URL that expires in 10 minutes. The URL is a credential: do not print or log it.
- The title cannot change after the create. Name the topic, not the state.
- Never publish while an edit runs.
- Radius keeps an artifact 90 days after its last publish.
- If the Radius tools fail, or the user cannot open the link (a client VPN can block it), use another host.

Publish each version with this `codemode` script. A page with Alpine or widgets is larger than one tool output (50 KB), so the script reads it in parts. Then it reads the page back from Radius and compares it with the local file. It returns the artifact id, the link to give the user, and `same` or `DIFFERENT`. When the download fails, the script stops with the `curl` error.

```js
const dir = "/tmp/pages/<slug>", file = `${dir}/index.html`;
const run = async (command) => {
	const { exitCode, output } = await tools.bash({ command, timeout: 60 });
	if (exitCode !== 0) throw new Error(output);
	return output.trim();
};
const size = Number(await run(`wc -c < ${file}`));
// 30000 bytes give 40 KB of base64, and a multiple of 3 lets the parts join.
let b64 = "";
for (let at = 0; at < size; at += 30000) {
	b64 += await run(`node -e 'const [, file, at] = process.argv; process.stdout.write(require("fs").readFileSync(file).subarray(+at, +at + 30000).toString("base64"))' ${file} ${at}`);
}
const content = decodeURIComponent(escape(atob(b64)));
const { artifact } = (await tools.mcp__radius__artifacts_versions_publish({ slug: "<artifact id>", content, content_type: "text/html", note: "<what changed>" })).structuredContent;
const slug = artifact.id;
const { url } = (await tools.mcp__radius__artifacts_files_download({ slug, version: "latest", path: "index.html" })).structuredContent;
const check = await run(`curl -fsSL '${url}' -o ${dir}/remote.html && { cmp -s ${file} ${dir}/remote.html && echo same || echo DIFFERENT; }`);
return { slug, link: artifact.canonical_url, check };
```

- For the first version, replace the publish call with `tools.mcp__radius__artifacts_create({ title: "<topic>", content, content_type: "text/html", visibility: "private", note: "<note>" })`.
- The `codemode` sandbox has no `TextEncoder`, `TextDecoder` or `URL`. File work stays in bash or node, and `codemode` makes only the Radius calls.

### Local file

Open `/tmp/pages/<slug>/index.html`. On macOS: `open <file>`. On Linux: `xdg-open <file>`. On WSL: `wslview <file>`, or `explorer.exe "$(wslpath -w <file>)"`.

### Claude Code

Publish the page as an Artifact. If the `artifact-capabilities` skill exists, load it first. If the account has them, keep the answers in the page database (`ArtifactData`) and use comment threads (`ArtifactComments`). Copy stays as the fallback. In an inline widget, the page shows Send (`sendPrompt`). The page meets the Artifact contract as built: one file, scripts inline, its own colors. Test Copy on the first publish.
