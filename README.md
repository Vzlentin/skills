# skills

Agent skills for Pi and other coding agents.

- `parley`: decide with the user, round by round, until a written contract.
- `show-me`: explain with the smallest view that works, and draw Mermaid diagrams to SVG.
- `artifacts`: make HTML pages with widgets that the reader plays, share copies and PDFs.
- `writing-pr`: write short pull request titles and bodies.
- `dia`: read and drive your Dia browser on macOS, with your logged-in sessions.

## Install

```sh
npx skills add Vzlentin/skills -g -a pi -s '*' -y
npx skills update -g
```

Install all of them: `parley` uses `artifacts` and `show-me`. The skills CLI needs Node.js 22.20 or later.
`dia` works on macOS only. Its `read` and `eval` need Dia to start with `--enable-applescript-javascript`: `dia.mjs launcher` makes an app that opens Dia that way. While the flag is on, any program with the Automation permission for Dia can read and control all your tabs.

`show-me` needs [Pele](https://www.npmjs.com/package/pele): `npm install -g pele`. `artifacts` colors code with the `highlight.js` of Pi's install or of the global npm folder, when there is one.

## Licenses

The skills are MIT (`LICENSE`). The files in `skills/artifacts/vendor/` keep their own licenses: Alpine.js and marked are MIT, Lit is BSD-3-Clause (`skills/artifacts/vendor/lit.LICENSE`), and `entities.json` is the table of named character references from the [HTML Standard](https://html.spec.whatwg.org/multipage/named-characters.html) (WHATWG, CC BY 4.0). `skills/artifacts/kit.js` and `skills/artifacts/widgets/` take their shapes from [Sam Rose's visualisations](https://github.com/samwho/visualisations) (MIT), and the header of `kit.js` has his notice.
