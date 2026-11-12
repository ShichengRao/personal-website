# Notes for coding agents

## Pull requests

Each merge to main is a production deploy, and the site's Netlify plan caps those each month. So keep one open PR at a time.

- Before opening a PR, look for one that's already open (`gh pr list --state open`). If there is one, put your change on its branch, even when the two changes are unrelated, and add a section about yours to its description.
- Open a new PR only when none is open.
- Before every push, check that the PR is still open. If it has been merged, start a new branch from main.
