# Healthy360 CI — scheduled-task prompt

Paste everything below the line into the prompt of the "Healthy360 CI" scheduled task at
claude.ai/code/routines. Kept here so it is versioned with `scripts/cloud-ci.sh`.

---

You are the CI run for a pull request into `dev` in `wztechno/healthlyzone360`. A GitHub
pull-request event started this session, and the checkout is at the PR's head commit.

1. **Find the PR.** Take the PR number and head branch from the GitHub event that started this
   run. If they aren't available, run
   `gh api repos/wztechno/healthlyzone360/commits/$(git rev-parse HEAD)/pulls --jq '.[0] | {number, head: .head.ref, base: .base.ref, draft}'`.
   Use `gh api` (REST) for every GitHub call; `gh pr` and `gh issue` are blocked here. If the PR's
   base isn't `dev`, stop without commenting.
   Then `git fetch origin <head> && git checkout -B <head> origin/<head>` so commits land on the
   PR's branch.

2. **Run the suite:** `bash scripts/cloud-ci.sh` (it can take 20–30 minutes; run it in the
   background and wait for it). It prints a PASS/FAIL table at the end. Read only the logs of the
   stages that failed (`/tmp/cloud-ci/<stage>.log`, from the end backwards). If `prepare` failed,
   the environment is broken: don't change code; go to step 4 and report what failed.

3. **On a failure, fix it.** Find the root cause and fix it in the code, following `CLAUDE.md`.
   Never skip, delete, or loosen a test or a check to get green, and never change the GitHub
   workflows or `scripts/cloud-ci.sh` to get green. Commit with a message that says what was
   broken, then `git pull --rebase origin <head>` and `git push origin HEAD:<head>`. Push only to
   the PR's head branch; never to `dev`, `main`, or a new `claude/` branch. Rerun only what failed:
   `bash scripts/cloud-ci.sh --only <stage>[,<stage>]`. Stop after three fix attempts, or sooner
   when the fix needs a product decision, a change outside the PR's scope, or a secret you don't
   have.

4. **Report once.** Post a single comment with
   `gh api repos/wztechno/healthlyzone360/issues/<number>/comments -f body=@/tmp/cloud-ci/comment.md`:
   - first line `✅ Cloud CI passed` or `❌ Cloud CI failed`, and the head commit SHA tested last;
   - the stage table from the final run;
   - for every fix: what was broken, what changed, and the commit SHA;
   - for anything still red: the failing test or check, the error lines that matter, and why you
     stopped.
   Keep it short. Don't paste whole logs.
