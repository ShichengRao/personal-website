# Architecture

This document captures the maintainer-facing structure of the repository. It is intentionally descriptive; it does not change product behavior.

## Top-Level Map
- `.claude/` - project file or directory
- `.gitignore` - ignored local/generated files
- `.gitmodules` - project file or directory
- `.hugo_build.lock` - project file or directory
- `.idea/` - JetBrains IDE metadata
- `archetypes/` - project file or directory
- `assets/` - static assets
- `config.toml` - project file or directory
- `content/` - project file or directory
- `data/` - fixtures, sample data, or local runtime data
- `docs/` - project documentation
- `i18n/` - project file or directory
- `layouts/` - project file or directory
- `netlify.toml` - project file or directory
- `node_modules/` - project file or directory
- `package-lock.json` - project file or directory
- `package.json` - Node package metadata and scripts
- `plans/` - project file or directory
- `public/` - static assets
- `resources/` - project file or directory
- `scripts/` - project file or directory
- `static/` - static assets
- `themes/` - project file or directory

## Runtime Shape
- Node/package roots: `.`, `themes/ananke`.

## Maintenance Notes
- Keep generated output, editor metadata, virtual environments, local credentials, and machine-specific assistant settings out of Git.
- Prefer adding focused tests around stable entry points before changing application behavior.
- Update this document when directories gain or lose maintainer-facing responsibility.
