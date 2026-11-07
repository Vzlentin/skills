// The way back: what the user changes on a page comes back to the agent as one block of text.
// A field: x-init="$store.back.field('reply 1', $el.value)" x-model="$store.back.values['reply 1']".
// A field with { list: false } is not in the block: a part of the page reports it.
// A part: Alpine.store("back").part(() => "a line"), for a page that builds its own lines.
// $store.back.text is the block. $store.back.copy() copies it. The bar shows both once the page has a field or a part.
// Clear asks "Clear? Yes / No" in the page: askClear(), then clear(). The question goes away after 5 s.
// The browser keeps only the edits, so a new build of the page shows its new defaults.
document.addEventListener("alpine:init", () => {
	const { page, key } = document.body.dataset;
	const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
	let clearTimer;
	Alpine.store("back", {
		edits: Alpine.$persist({}).as(`${key}:back`),
		values: {},
		defaults: {},
		listed: {},
		parts: [],
		// The text of the toast that Copy shows.
		toast: "",
		clearing: false,
		field(name, value, { list = true } = {}) {
			this.defaults[name] = value;
			this.listed[name] = list;
			this.values[name] = name in this.edits ? this.edits[name] : value;
			Alpine.effect(() => {
				const current = this.values[name];
				if (same(current, this.defaults[name])) delete this.edits[name];
				else this.edits[name] = current;
			});
		},
		changed(name) {
			return name in this.edits;
		},
		// A field of this build differs from its default. An edit of a field that a new build renamed does not count.
		get edited() {
			return Object.keys(this.defaults).some((name) => this.changed(name));
		},
		undo(name) {
			this.values[name] = this.defaults[name];
		},
		part(build) {
			this.parts.push(build);
		},
		// The page uses the way back: the bar shows.
		get used() {
			return Object.keys(this.defaults).length > 0 || this.parts.length > 0;
		},
		get text() {
			const lines = this.parts.map((build) => build()).filter(Boolean);
			const fields = Object.keys(this.defaults)
				.filter((name) => this.listed[name] && this.changed(name))
				.map((name) => `${name}:\n${String(this.values[name]).trim()}`);
			return [...(lines.length ? lines : [`[${page}]`]), ...fields].join("\n\n");
		},
		async copy() {
			const text = this.text;
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				const area = document.createElement("textarea");
				area.value = text;
				document.body.append(area);
				area.select();
				document.execCommand("copy");
				area.remove();
			}
			this.toast = "Copied: paste it in the terminal";
			setTimeout(() => (this.toast = ""), 1500);
		},
		askClear() {
			this.clearing = true;
			clearTimeout(clearTimer);
			clearTimer = setTimeout(() => (this.clearing = false), 5000);
		},
		clear() {
			this.clearing = false;
			for (const name of Object.keys(this.defaults)) this.values[name] = this.defaults[name];
		},
	});
});
