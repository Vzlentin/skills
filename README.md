# skills

Agent skills for Pi and other coding agents.

- `parley`: decide with the user, round by round, until a written contract.
- `show-me`: explain with the smallest view that works, and draw Mermaid diagrams to SVG.
- `artifacts`: make HTML pages, share copies and PDFs.
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
