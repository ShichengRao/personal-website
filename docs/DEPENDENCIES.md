# Dependencies

Use this as the maintainer checklist for dependency updates and reproducible setup.

## Inventory
- `.` Node package: 0 runtime deps, 0 dev deps, lockfile `package-lock.json`.
- `themes/ananke` Node package: 4 runtime deps, 5 dev deps, lockfile `themes/ananke/package-lock.json`.

## Update Guidance
- Prefer lockfile-preserving installs when a lockfile exists.
- Run the verification commands in `docs/MAINTENANCE_AUDIT.md` after dependency updates.
- Keep dependency updates separate from product behavior changes so regressions are easier to review.
- If a broad version range is intentional, document why before widening it further.
