// <w-parley></w-parley> shows the asks of a parley as cards: the open asks with their choices, the settled asks with their decision.
// Live, in a host that has readAsks and sendAnswers, it reads the asks and sends the answers in one Send.
// Static, it reads the { parley, asks } of its <script type="application/json"> child, and Copy gives the answer line.
// A module script: render.mjs adds it to a page that has the tag.
const { css, html, nothing } = Lit;
const { Widget } = kit;

// The problem of a label as the host checks it, or "" when the label is good.
const labelProblem = (text) => (!/\S/.test(text) ? "is blank" : /`|\*\*/.test(text) ? "has a backtick or **" : "");

const isReadBack = (ask) => ask.parley !== undefined && ask.options === undefined;

const sorted = ({ parley, asks }) => ({ parley, asks: [...asks].sort((a, b) => a.parley.n - b.parley.n) });

const decision = (ask) => {
	if (ask.answer === "own") return `own: ${ask.label}`;
	if (ask.answer === "ok") return "ok";
	const option = ask.options?.find((found) => found.key === ask.answer);
	return option ? `${ask.answer}. ${option.label}` : ask.answer;
};

const quoted = (text) => `"${text.replaceAll('"', "'")}"`;

class Parley extends Widget {
	static properties = { ...Widget.properties, data: { state: true }, status: { state: true }, error: { state: true } };

	static styles = css`
		.head { justify-content: space-between; }
		.tag, .badge {
			font: 600 11px var(--mono);
			padding: 1px 7px;
			border-radius: 6px;
			border: 1px solid var(--line);
			color: var(--muted);
			white-space: nowrap;
		}
		.badge { border-color: var(--accent); color: var(--accent); }
		.ask { padding: 12px 0; border-top: 1px dotted var(--line); }
		.ask:first-of-type { border-top: 0; padding-top: 0; }
		.title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; color: var(--fg); }
		.tension, .words { margin: 6px 0; color: var(--muted); }
		.decided { margin: 6px 0; font-weight: 700; color: var(--accent); }
		.dropped { opacity: .5; }
		.opt {
			display: block;
			width: 100%;
			margin: 6px 0;
			padding: 8px 10px;
			border: 1px solid var(--line);
			border-radius: 8px;
			background: var(--card);
			color: var(--text);
			font: inherit;
			text-align: left;
		}
		button.opt { cursor: pointer; }
		button.opt:disabled { cursor: default; }
		.opt.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
		.key { font: 600 13px var(--mono); color: var(--fg); }
		.gc { display: block; margin-left: 1.2em; font-size: .92em; color: var(--muted); }
		.plus { color: var(--series-1); }
		.minus { color: var(--series-3); }
		summary { cursor: pointer; color: var(--muted); font-size: 13.5px; }
		pre { white-space: pre-wrap; font: 13px/1.5 var(--mono); margin: 6px 0; }
		input[type="text"], textarea {
			display: block;
			width: 100%;
			margin: 6px 0;
			padding: 6px 8px;
			border: 1px solid var(--line);
			border-radius: 8px;
			background: var(--sunk);
			color: var(--text);
			font: inherit;
		}
		textarea { resize: vertical; }
		.line { flex: 1; min-width: 140px; font: 13px var(--mono); overflow-wrap: anywhere; color: var(--fg); }
		.error { color: var(--series-3); }
	`;

	// The draft of each open ask, keyed by its number: { pick, label, words }.
	drafts = {};

	connectedCallback() {
		super.connectedCallback();
		this.load();
	}

	inline() {
		const block = this.querySelector('script[type="application/json"]');
		return block ? sorted(JSON.parse(block.textContent)) : undefined;
	}

	async load() {
		this.live = typeof window.readAsks === "function";
		try {
			this.show(this.live ? sorted(await window.readAsks()) : this.inline());
		} catch (error) {
			this.live = false;
			this.error = `The asks are not read: ${error.message}`;
			try {
				this.show(this.inline());
			} catch (inlineError) {
				this.error += `. The inline block is not read: ${inlineError.message}`;
			}
		}
	}

	// Draws the asks, with the plan chosen on each open ask that has one.
	show(data) {
		if (!data) {
			this.error ??= "The page has no asks: no readAsks and no inline block.";
			return;
		}
		this.drafts = {};
		for (const ask of data.asks) if (ask.state === "open" && ask.plan) this.drafts[ask.parley.n] = { pick: ask.plan };
		this.data = data;
	}

	get open() {
		return this.data?.parley.status === "open";
	}

	get openAsks() {
		return this.open ? this.data.asks.filter((ask) => ask.state === "open") : [];
	}

	draft(n) {
		return this.drafts[n] ?? {};
	}

	edit(n, field, value) {
		this.drafts[n] = { ...this.draft(n), [field]: value };
		this.requestUpdate();
	}

	// The answers of the open asks that have a choice, and the problems that stop Send and Copy.
	answers() {
		const answers = [];
		const problems = [];
		for (const ask of this.openAsks) {
			const n = ask.parley.n;
			const { pick, label, words: text } = this.draft(n);
			if (!pick) continue;
			const answer = { n, answer: pick };
			if (pick === "own") {
				answer.label = (label ?? "").trim();
				const problem = labelProblem(answer.label);
				if (problem) problems.push(`ask ${n}: the label ${problem}`);
			}
			const words = (text ?? "").trim();
			if (words) answer.words = [words];
			answers.push(answer);
		}
		return { answers, problems };
	}

	line(answers) {
		const parts = answers.map(({ n, answer, label, words }) => {
			if (answer === "ok") return "ok";
			if (answer === "own") return `${n}:${quoted(words ? `${label}: ${words[0]}` : label)}`;
			return `${n}${answer}${words ? `:${quoted(words[0])}` : ""}`;
		});
		return [`[${this.data.parley.slug}]`, ...parts].join(" ");
	}

	// Sends answers that answers() found without problems.
	async send(answers) {
		if (!answers.length) {
			this.status = "nothing to send: choose an answer first";
			return;
		}
		let reply;
		try {
			reply = await window.sendAnswers(answers);
		} catch (error) {
			this.status = `not sent: ${error.message}`;
			return;
		}
		if (reply === undefined) {
			const line = document.querySelector(".harness-send")?.textContent;
			this.status = line ? `not sent (${line})` : "not sent";
			return;
		}
		const mine = reply.parleys?.find((found) => found.parley.slug === this.data.parley.slug);
		if (mine) this.show(sorted(mine));
		this.status = `sent ${answers.length} answer${answers.length === 1 ? "" : "s"}`;
	}

	async copy(line) {
		try {
			await navigator.clipboard.writeText(line);
			this.status = "copied";
		} catch {
			this.status = "not copied: select the line and copy it";
		}
	}

	// The body of an option: its key, its label, the plan badge, its gains and its costs.
	option(ask, option) {
		return html`<span class="key">${option.key}.</span> ${option.label}
			${option.key === ask.plan ? html`<span class="badge">plan</span>` : nothing}
			${(option.gains ?? []).map((gain) => html`<span class="gc"><span class="plus">+</span> ${gain}</span>`)}
			${(option.costs ?? []).map((cost) => html`<span class="gc"><span class="minus">−</span> ${cost}</span>`)}`;
	}

	// A button that picks key for the open ask.
	choice(ask, key, body) {
		const n = ask.parley.n;
		const on = this.draft(n).pick === key;
		return html`<button type="button" class=${on ? "opt on" : "opt"} aria-pressed=${on} @click=${() => this.edit(n, "pick", key)}>${body}</button>`;
	}

	choices(ask) {
		const n = ask.parley.n;
		const draft = this.draft(n);
		const words = html`<textarea rows="2" placeholder="Your words (optional)" .value=${draft.words ?? ""} @input=${(event) => this.edit(n, "words", event.target.value)}></textarea>`;
		if (isReadBack(ask))
			return html`${this.choice(ask, "ok", html`<span class="key">ok</span> these are the terms`)} ${this.live ? words : nothing}`;
		return html`${ask.options.map((option) => this.choice(ask, option.key, this.option(ask, option)))}
			${this.choice(ask, "own", html`<span class="key">own</span> your own answer`)}
			${draft.pick === "own"
				? html`<input type="text" placeholder="A short label" .value=${draft.label ?? ""} @input=${(event) => this.edit(n, "label", event.target.value)} />`
				: nothing}
			${words}`;
	}

	ask(ask) {
		const head = html`<div class="title">
			<b>${ask.parley.n}. ${ask.title}</b>
			${ask.kind ? html`<span class="tag">${ask.kind}</span>` : nothing}
			<span class="tag">${ask.state}</span>
		</div>`;
		const view = ask.view ? html`<details><summary>The view of this ask</summary><pre>${ask.view}</pre></details>` : nothing;
		if (ask.state === "dropped") return html`<section class="ask dropped">${head}</section>`;
		if (ask.state === "answered")
			return html`<section class="ask settled">
				${head}
				<p class="decided">✓ ${decision(ask)}</p>
				${ask.words?.length ? html`<p class="words">“${ask.words.join(" ")}”</p>` : nothing}
				${ask.options
					? html`<details><summary>The options</summary>${ask.options.map((option) => html`<div class=${option.key === ask.answer ? "opt on" : "opt"}>${this.option(ask, option)}</div>`)}</details>`
					: nothing}
				${view}
			</section>`;
		return html`<section class="ask">
			${head} ${ask.tension ? html`<p class="tension">${ask.tension}</p>` : nothing}
			${this.open ? this.choices(ask) : (ask.options ?? []).map((option) => html`<div class="opt">${this.option(ask, option)}</div>`)} ${view}
		</section>`;
	}

	foot() {
		if (!this.openAsks.length) return this.status ? html`<div class="foot"><span class="count">${this.status}</span></div>` : nothing;
		const { answers, problems } = this.answers();
		const blocked = problems.length > 0;
		const line = blocked ? "" : this.line(answers);
		const action = this.live
			? html`<button class="btn" ?disabled=${blocked} @click=${() => this.send(answers)}>Send</button>`
			: html`${blocked ? nothing : html`<code class="line">${line}</code>`}<button class="btn ghost" ?disabled=${blocked} @click=${() => this.copy(line)}>Copy</button>`;
		const status = blocked ? `not ready: ${problems.join("; ")}` : (this.status ?? "");
		return html`<div class="foot">${action}<span class=${blocked ? "count status error" : "count status"}>${status}</span></div>`;
	}

	render() {
		const error = this.error ? html`<p class="error">${this.error}</p>` : nothing;
		if (!this.data) return html`<div class="card"><div class="body">${error || html`<p class="note">Reading the asks…</p>`}</div></div>`;
		const { parley, asks } = this.data;
		return html`<div class="card">
			<div class="head">
				<span>${parley.title ?? parley.slug}</span>
				<span><span class="tag">${parley.slug}</span> ${this.open ? nothing : html`<span class="tag">${parley.status}</span>`}</span>
			</div>
			<div class="body">${error}${asks.map((ask) => this.ask(ask))}</div>
			${this.foot()}
		</div>`;
	}
}

customElements.define("w-parley", Parley);
