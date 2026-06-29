# Data And Fixtures

This repository contains data-like directories. Treat private runtime data differently from committed fixtures.

## Detected Paths
- `data/` - review as sample content, fixtures, generated output, or local/private runtime data.
- `content/` - review as sample content, fixtures, generated output, or local/private runtime data.
- `public/` - review as sample content, fixtures, generated output, or local/private runtime data.

## Maintainer Rules
- Keep private, generated, or machine-local data ignored.
- Commit only small sample fixtures that are safe to share and useful for tests or demos.
- Add a short README near any data directory whose purpose is not obvious.
