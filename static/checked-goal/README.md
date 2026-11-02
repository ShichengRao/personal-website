# Checked /goal for Mirror

A prototype `/goal` for Reflection's [Mirror](https://github.com/reflection-oss/mirror). Before a "complete" stands, fresh Beam calls check the work:
- a verifier tests a sandboxed copy against the written requirements;
- a reviewer sends concrete problems back;
- a progress check reads the record as the agent works;
- a guard reads risky commands before they run.

**Status:** a prototype. It has been reviewed only by AI agents, with no human review, and this build hasn't yet been run live in Mirror.

## Install

Clone it into a folder named `goal`, the extension's ID. Mirror loads an extension only from a folder named after its ID, so it takes the plain `/goal`'s place:

```bash
git clone --branch said-and-done-2026-11-02 https://github.com/ShichengRao/mirror-goal-extension ~/.mirror/extensions/goal
```

(or `.mirror/extensions/goal` inside a project). The tag is the build behind the benchmark's numbers.
- On Linux, install bubblewrap (`bwrap`) for the verifier's sandbox. macOS uses `sandbox-exec`, which it already has.
- Start Mirror and enable the extension when asked.
- Run `/goal <what you want done>`. Also `/goal stop`, `/goal resume`, and `/goal clear`.

It uses your Reflection API key: `REFLECTION_API_KEY`, or the key Mirror saved. The checks call Reflection's API with the extension's own model setting, whatever model Mirror itself is using.

## Settings

Set them in `~/.mirror/config.json`, for example `{"extensions": {"goal": {"config": {"max_reviews": 3}}}}`.

| Setting | Default | What it does |
|---|---|---|
| `max_turns` | 25 | Turns a goal may take before it stops |
| `progress_every` | 5 | Turns between progress checks (0 turns this off) |
| `progress_calls` | 20, 40, 50 | Tool calls after which a progress check also runs; at the last, it asks whether to stop and report (`[]` turns this off) |
| `max_reviews` | 2 | Reviews before the next "complete" stands |
| `verify` | true | Run the verifier |
| `verify_unconfined` | false | Run the verifier even when no sandbox is available |
| `guard` | true | Run the guard |
| `guard_tools` | bash, write, edit | Tool calls the guard reads |
| `guard_on_error` | ask | What happens if the guard's call fails: ask, or allow |
| `model` | Beam-1.0-501B-A23B | The model the checks use |
| `reasoning_effort` | max | Their reasoning effort |

## Limits

- Interactive Mirror only: its headless modes don't load extensions.
- The guard needs manual approval mode, and it sees only bash, write, and edit calls ([Mirror issue #10](https://github.com/reflection-oss/mirror/issues/10)).
- Without a sandbox, the verifier doesn't run.
- The checks fail open:
  - if the API fails, "complete" is accepted and marked unchecked;
  - after two reviews, the next "complete" stands;
  - a "blocked" report gets only a light check.

## Evidence

These numbers come from the same checks run in the Said & Done benchmark's harness, not in Mirror:
- **The 28 tasks they were tuned on:** Beam's Said & Done score rose from 39% to 77%.
- **20 new tasks written without seeing them:** it rose from 52% to 73% (+22 points, 95% interval +3 to +42). The gain was on the tasks that can't be done honestly as asked.

Details: [huggingface.co/spaces/ShichengRao/said-and-done](https://huggingface.co/spaces/ShichengRao/said-and-done).

## License

Apache-2.0, the same as Mirror. Copyright 2026 Shicheng Rao.
