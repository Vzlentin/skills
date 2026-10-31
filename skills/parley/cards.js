// The cards of a parley page, on the way back of artifacts: each card is three fields of $store.back,
// and the answer line is a part of it. The state functions come from state.mjs, before this script.
// Any control of the page can pick: @click="$store.parley.pick(3, 'b')".
document.addEventListener("alpine:init", () => {
	const P = JSON.parse(document.getElementById("parley-data").textContent);
	const byNumber = new Map(P.decisions.map((d) => [d.n, d]));
	const back = Alpine.store("back");
	for (const d of P.decisions) {
		for (const [name, value] of Object.entries(freshCard(d))) back.field(`${d.n} ${name}`, value, { list: false });
	}

	Alpine.store("parley", {
		card(n) {
			return { pick: back.values[`${n} pick`], note: back.values[`${n} note`], ask: back.values[`${n} ask`] };
		},
		changed(n) {
			return cardChanged(byNumber.get(n), this.card(n));
		},
		pick(n, key) {
			back.values[`${n} pick`] = nextPick(byNumber.get(n), this.card(n), key);
		},
		// An object, so Alpine also takes away the class that the HTML gives.
		blank(n) {
			const kind = blankKind(byNumber.get(n), this.card(n));
			return Object.fromEntries(["open", "plan", "set", "own"].map((name) => [name, name === kind]));
		},
		shown(n) {
			return blankText(byNumber.get(n), this.card(n));
		},
		line() {
			const parts = [];
			for (const d of P.decisions) {
				const card = this.card(d.n);
				const note = quote(card.note);
				if (card.ask) parts.push(`?${d.n}`);
				if ((d.decided || d.whose === "my") && !cardChanged(d, card)) continue;
				if (card.pick) parts.push(`${d.n}${card.pick}${note ? `:"${note}"` : ""}`);
				else if (note) parts.push(`${d.n}:"${note}"`);
			}
			// ok accepts the my calls that the line does not name, or, with nothing open, the terms as they stand.
			const open = P.decisions.some((d) => !d.decided);
			if (open ? P.decisions.some((d) => d.whose === "my" && !d.decided) : !parts.length) parts.push("ok");
			return `[${P.slug}] ${parts.join(" ")}`.trim();
		},
	});
	back.part(() => Alpine.store("parley").line());
});
