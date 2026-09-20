# shichengrao.com

Personal website of Shicheng Rao, built with [Hugo](https://gohugo.io/) and the
[Ananke](https://github.com/theNewDynamic/gohugo-theme-ananke) theme (vendored as a
git submodule), deployed on Netlify.

## Local development

```sh
git clone --recurse-submodules git@github.com:ShichengRao/personal-website.git
cd personal-website
hugo server
```

If you cloned without submodules, run `git submodule update --init` first.
`hugo server` serves the site at http://localhost:1313 with live reload. No npm
install is needed to build or serve the site.

## Repo layout

| Path | Purpose |
| --- | --- |
| `content/` | Page content and front matter (homepage project cards live in `content/_index.md`) |
| `layouts/` | Custom templates: homepage projects grid, the self-contained Hangul practice app, the Blunder Drill page, the Long Game hub and game pages, favicon partial |
| `static/` | Files copied verbatim into the site: resume PDF, favicons, the Blunder Drill data, the Long Game scripts (`static/games/`) |
| `config.toml` | Site config, nav menu, SEO settings |
| `netlify.toml` | Build command, pinned Hugo version, redirects, security headers |
| `themes/ananke/` | Theme submodule — don't edit; override in `layouts/` instead |
| `plans/` | Product notes for side projects |
| `tests/` | Node tests (`npm test`): repo smoke check, game scripts parse, Crux level is well-formed. New test files must be added to the `test` script in `package.json` |

`public/` and `resources/` are Hugo build output and are not tracked.

## The Long Game

`/long-game/` hosts three small canvas games (Bulwark, Slipstream, Crux) built as
plain scripts with no build step. Each page is a `content/long-game/<game>.md` whose
`layout` front matter picks `layouts/long-game/<game>.html`; the shared chrome lives
in `layouts/partials/long-game/style.html` and `static/games/common.js`. Every game
exposes a `window.__lg.<game>` handle (state, `update(dt)`, `reset(seed)`) so it can
be stepped headlessly from the console for tuning; the Crux wall in
`static/games/crux.js` is generated from block definitions and should be edited as
blocks rather than by hand.

## CI and deployment

- Every push to `main` deploys via Netlify: it runs `hugo` and publishes `public/`.
- GitHub Actions (`.github/workflows/ci.yml`) builds the site on PRs and pushes to
  `main`, using the same Hugo version Netlify pins.
- The Hugo version is pinned in two places — `netlify.toml` and `ci.yml` — keep them
  in sync when upgrading.
- Old URLs (`/church/`, `/vine/`, `/deskbooks/`, `/livestream/`, the dated resume
  filename) are 301-redirected in `netlify.toml`; add a redirect there before
  removing or renaming any public path.
