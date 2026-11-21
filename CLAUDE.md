# Claude Code Repository Guidance

Read `AGENTS.md` first; its instructions are authoritative for this repo.
When taking over from Codex, verify Codex is stopped, inspect the checkpoint commit and task status, and continue in the **same task worktree**. Never write to `main` or `develop`; open a draft PR targeting `develop` and leave it for human verification.
