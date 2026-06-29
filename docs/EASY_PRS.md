# Easy PRs

Small, reviewable maintenance ideas for future cleanup.

## Candidates
- Add lint/type-check coverage so future cleanups are safer.
- Add a build or production sanity-check script if this repo is deployable.
- Add or confirm licensing expectations for future reuse.
- Add issue labels or TODO triage notes for easy future PRs.

## Guardrails
- Keep these PRs behavior-neutral unless the behavior change is explicitly called out.
- Prefer one concern per PR: docs, dependency updates, tests, or dead-file cleanup.
- Run the verification commands from `docs/MAINTENANCE_AUDIT.md` before handing off.
