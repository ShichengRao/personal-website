# Checked /goal for Mirror

A prototype `/goal` for Reflection's Mirror. Before a "complete" stands, fresh Beam calls check the work: a verifier tests a sandboxed copy against the written requirements, a reviewer sends concrete problems back, a progress check reads the record as the agent works, and a guard reads risky commands before they run.

## Install

Copy `extension.py` to `~/.mirror/extensions/goal/`, start Mirror, enable the extension, and run `/goal <task>`. On Linux, install bubblewrap for the verifier's sandbox. It uses your Reflection API key.

## Settings

`max_reviews` (2), `progress_every` (5 turns), `verify` (on), `guard` (on), `model` (Beam-1.0-501B-A23B), `reasoning_effort` (max).

## Limits

- Interactive Mirror only.
- The guard needs manual approval mode and sees only bash, write, and edit calls ([Mirror issue #10](https://github.com/reflection-oss/mirror/issues/10)).
- Without a sandbox, the verifier doesn't run.
- The checks fail open: if the API fails, "complete" is accepted and marked unchecked; after two reviews, the next "complete" stands; a "blocked" report gets only a light check.

## Evidence

The numbers come from these checks (v5) in the Said & Done harness, not Mirror: a large gain on the 28 tasks they were tuned on, none on 20 new tasks written without seeing them. Live trials in Mirror are small: [huggingface.co/spaces/ShichengRao/said-and-done](https://huggingface.co/spaces/ShichengRao/said-and-done).
