# skills

Agent skills for Pi and other coding agents.

- `parley`: decide with the user, round by round, until a written contract.
- `show-me`: explain with the smallest view that works, and draw Mermaid diagrams to SVG.
- `artifacts`: make HTML pages, share copies and PDFs.
- `writing-pr`: write short pull request titles and bodies.

## Install

```sh
npx skills add Vzlentin/skills -g -a pi -s '*' -y
npx skills update -g
```

Install all of them: `parley` uses `artifacts` and `show-me`. The skills CLI needs Node.js 22.20 or later.
`show-me` needs [Pele](https://www.npmjs.com/package/pele): `npm install -g pele`. `artifacts` uses the `marked` of Pi's install; without Pi, `npm install -g marked`.
