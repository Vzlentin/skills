// <w-aside>The question that the reader asks here</w-aside>, answered in the text after it.
// A module script: render.mjs adds it to a page that has the tag.
const { css, html } = Lit;
const { Widget } = kit;

class Aside extends Widget {
	static styles = css`
		:host {
			display: grid;
			grid-template-columns: 52px minmax(0, 1fr);
			gap: 16px;
			align-items: start;
			margin: 26px 0;
			padding: 18px 20px;
			border-radius: 14px;
			background: var(--sunk);
			/* the type of the page text, not the 15px type of the kit */
			font: inherit;
			color: inherit;
		}
		.face {
			width: 52px;
			height: 52px;
			border-radius: 50%;
			display: grid;
			place-items: center;
			background: var(--accent);
			color: var(--bg);
			font: 700 26px var(--sans);
		}
		.who { font: 600 11px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
		.say { font-size: 1.05em; font-style: italic; color: var(--fg); }
	`;

	render() {
		return html`<div class="face" aria-hidden="true">?</div>
			<div><div class="who">You might ask</div><div class="say"><slot></slot></div></div>`;
	}
}

customElements.define("w-aside", Aside);
