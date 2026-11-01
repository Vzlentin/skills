// The widget kit: the base of a widget, a card, a slider, buttons and a player.
// A plain script after vendor/lit.min.js. It reads the global Lit and sets the global kit:
//   const { css, html, svg } = Lit;
//   const { Widget, Player, slider, icon, iconButton, base } = kit;
// A widget is a custom element whose tag starts with w-. It extends kit.Widget, so Alpine binds it with
// x-model: Alpine sets its value property, and the widget sends an input event with the new value.
// The colors are the page theme variables, and --series-1 to --series-4 for the series of a chart.
//
// The shapes come from Sam Rose's visualisations, https://github.com/samwho/visualisations:
// a card with a header, a body and a footer of controls.
//
// MIT License
//
// Copyright (c) 2026 Sam Rose
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Arrow functions, not function declarations: a function declared in a block of a plain script
// also becomes a global, and a page script that declares the same name then stops.
{
	const { css, html, LitElement } = Lit;

	const base = css`
		:host {
			display: block;
			margin: 22px 0 26px;
			font: 15px/1.5 var(--sans);
			color: var(--text);
		}
		* { box-sizing: border-box; }
		.card {
			border: 1px solid var(--line);
			border-radius: 14px;
			overflow: clip;
			background: var(--card);
		}
		.head {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 10px;
			flex-wrap: wrap;
			padding: 8px 14px;
			border-bottom: 1px dotted var(--line);
			font: 600 13px/1.5 var(--mono);
			font-variant-numeric: tabular-nums;
			color: var(--fg);
			min-height: 40px;
		}
		.body { padding: 16px 14px; background: var(--bg); }
		.foot {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 8px 10px;
			border-top: 1px dotted var(--line);
			flex-wrap: wrap;
		}
		.foot .grow { flex: 1; min-width: 140px; }
		.count {
			font: 12px var(--mono);
			color: var(--muted);
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}
		.btn {
			display: inline-grid;
			place-items: center;
			min-width: 36px;
			height: 32px;
			padding: 0 10px;
			border: 0;
			border-radius: 8px;
			background: var(--fg);
			color: var(--bg);
			font: 600 13px var(--sans);
			cursor: pointer;
		}
		.btn:disabled { opacity: .35; cursor: default; }
		.btn.ghost { background: var(--sunk); color: var(--fg); border: 1px solid var(--line); }
		.btn.on { background: var(--accent); color: var(--bg); }
		.btn svg { width: 16px; height: 16px; fill: currentColor; }
		.seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
		.seg button { border: 0; background: var(--sunk); color: var(--muted); font: 600 12.5px var(--sans); padding: 6px 11px; cursor: pointer; }
		.seg button.on { background: var(--fg); color: var(--bg); }
		input[type="range"] {
			-webkit-appearance: none;
			appearance: none;
			width: 100%;
			height: 28px;
			background: transparent;
			margin: 0;
			cursor: pointer;
			--fill: 0%;
		}
		input[type="range"]::-webkit-slider-runnable-track {
			height: 4px;
			border-radius: 2px;
			background: linear-gradient(to right, var(--accent) var(--fill), var(--line) var(--fill));
		}
		input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--line); }
		input[type="range"]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--accent); }
		input[type="range"]::-webkit-slider-thumb {
			-webkit-appearance: none;
			width: 20px;
			height: 20px;
			margin-top: -8px;
			border-radius: 50%;
			background: var(--accent);
			border: 0;
			box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
		}
		input[type="range"]::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: var(--accent); border: 0; }
		input[type="range"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
		.note { font-size: 13.5px; color: var(--muted); min-height: 3em; }
		.s1 { --c: var(--series-1); } .s2 { --c: var(--series-2); } .s3 { --c: var(--series-3); } .s4 { --c: var(--series-4); }
		.mono { font-family: var(--mono); }
		@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
	`;

	const icons = {
		play: html`<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>`,
		pause: html`<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>`,
		back: html`<svg viewBox="0 0 16 16"><path d="M10.5 2.5 4.5 8l6 5.5z"/></svg>`,
		next: html`<svg viewBox="0 0 16 16"><path d="M5.5 2.5 11.5 8l-6 5.5z"/></svg>`,
		replay: html`<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>`,
	};

	const icon = (name) => icons[name];

	// A button with an icon: play, pause, back, next or replay.
	const iconButton = (name, { label = name, disabled = false, ghost = true, onClick }) =>
		html`<button class=${ghost ? "btn ghost" : "btn"} aria-label=${label} ?disabled=${disabled} @click=${onClick}>${icon(name)}</button>`;

	const slider = ({ min, max, step = 1, value, label, onInput }) => {
		const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
		return html`<input
			class="grow"
			type="range"
			min=${min}
			max=${max}
			step=${step}
			.value=${String(value)}
			aria-label=${label}
			style=${`--fill:${fill}%`}
			@input=${(event) => onInput(Number(event.target.value))}
		/>`;
	};

	const announce = (host, value) => host.dispatchEvent(new CustomEvent("input", { detail: value, bubbles: true }));

	// An attribute as JSON when it parses, so value="3" is the number 3. Else the plain string.
	const json = {
		fromAttribute(text) {
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		},
	};

	// The base of a widget: the kit styles before its own, and one value that Alpine binds with x-model.
	// emit(value) sets the value and tells the page.
	class Widget extends LitElement {
		static properties = { value: { converter: json } };

		static finalizeStyles(styles) {
			return [base, ...super.finalizeStyles(styles)];
		}

		createRenderRoot() {
			const root = super.createRenderRoot();
			// The input event of a control inside the widget crosses the shadow root. Only emit() speaks for the widget.
			root.addEventListener("input", (event) => {
				if (!(event instanceof CustomEvent)) event.stopPropagation();
			});
			return root;
		}

		emit(value) {
			this.value = value;
			announce(this, value);
		}
	}

	// The players of the page, for check.mjs.
	const players = new Set();

	// A player moves a value from min to max over time. It stops at max, it pauses
	// when the widget leaves the screen, and it does not start by itself when the
	// reader asks for reduced motion.
	// bind: the player moves the value of its widget, and the page gets each whole unit.
	class Player {
		constructor(host, { min = 0, max = 1, value = min, speed = 1, autoplay = false, bind = false } = {}) {
			this.host = host;
			this.min = min;
			this.max = max;
			this.bind = bind;
			this.own = value;
			this.speed = speed;
			this.playing = false;
			this.autoplay = autoplay && !matchMedia("(prefers-reduced-motion: reduce)").matches;
			this.visible = false;
			this.last = 0;
			this.frame = 0;
			host.addController(this);
		}

		get value() {
			const value = this.bind ? Number(this.host.value ?? this.min) : this.own;
			return Number.isFinite(value) ? value : this.min;
		}

		hostConnected() {
			players.add(this);
			this.observer = new IntersectionObserver(([entry]) => {
				this.visible = entry.isIntersecting;
				if (this.visible && this.autoplay) {
					this.autoplay = false;
					this.play();
				}
				if (this.visible && this.playing) this.loop();
			});
			this.observer.observe(this.host);
		}

		hostDisconnected() {
			players.delete(this);
			this.observer?.disconnect();
			cancelAnimationFrame(this.frame);
		}

		play() {
			if (this.value >= this.max) this.set(this.min);
			this.playing = true;
			this.loop();
			this.host.requestUpdate();
		}

		pause() {
			this.playing = false;
			cancelAnimationFrame(this.frame);
			this.host.requestUpdate();
		}

		toggle() {
			this.playing ? this.pause() : this.play();
		}

		set(value) {
			const next = Math.min(this.max, Math.max(this.min, value));
			const before = Math.floor(this.value);
			if (!this.bind) this.own = next;
			else {
				this.host.value = next;
				if (Math.floor(next) !== before) announce(this.host, Math.floor(next));
			}
			this.host.requestUpdate();
		}

		loop() {
			cancelAnimationFrame(this.frame);
			this.last = performance.now();
			const tick = (now) => {
				if (!this.playing || !this.visible) return;
				const dt = Math.min(0.1, (now - this.last) / 1000);
				this.last = now;
				this.set(this.value + dt * this.speed);
				if (this.value >= this.max) {
					this.playing = false;
					this.host.requestUpdate();
					return;
				}
				this.frame = requestAnimationFrame(tick);
			};
			this.frame = requestAnimationFrame(tick);
		}

		// Move by whole units: pause, then go to the unit before or after.
		step(by) {
			this.pause();
			this.set(Math.floor(this.value) + by);
		}

		button() {
			const name = this.playing ? "pause" : this.value >= this.max ? "replay" : "play";
			return iconButton(name, { ghost: false, onClick: () => this.toggle() });
		}

		backButton() {
			return iconButton("back", { disabled: Math.floor(this.value) <= this.min, onClick: () => this.step(-1) });
		}

		nextButton() {
			return iconButton("next", { disabled: Math.floor(this.value) >= this.max, onClick: () => this.step(1) });
		}
	}

	window.kit = { base, icon, iconButton, slider, Widget, Player, players };
}
