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
| `layouts/` | Custom templates: homepage projects grid, the self-contained Hangul practice app, favicon partial |
| `static/` | Files copied verbatim into the site: resume PDF, favicons |
| `config.toml` | Site config, nav menu, SEO settings |
| `netlify.toml` | Build command, pinned Hugo version, redirects, security headers |
| `themes/ananke/` | Theme submodule — don't edit; override in `layouts/` instead |
| `plans/` | Product notes for side projects |
| `tests/` | Node smoke test (`npm test`) |

`public/` and `resources/` are Hugo build output and are not tracked.

## CI and deployment

- Every push to `main` deploys via Netlify: it runs `hugo` and publishes `public/`.
- GitHub Actions (`.github/workflows/ci.yml`) builds the site on PRs and pushes to
  `main`, using the same Hugo version Netlify pins.
- The Hugo version is pinned in two places — `netlify.toml` and `ci.yml` — keep them
  in sync when upgrading.
- Old URLs (`/church/`, `/vine/`, `/deskbooks/`, `/livestream/`, the dated resume
  filename) are 301-redirected in `netlify.toml`; add a redirect there before
  removing or renaming any public path.
