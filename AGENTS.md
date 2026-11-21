# Repository Instructions for Codex, Claude Code, and other coding agents

**Current status: architecture planning only.** Proposed design documents under `docs/` are **not yet approved**. Do not generate or alter product code without a clearly assigned and approved GitHub issue.

## Hard rules
1. Never commit or push to `main` or `develop`, and never merge any pull request. Agent work belongs on one isolated task branch (`agent/TASK-###-description`) and a draft PR targeting `develop`.
2. Every concurrently active agent must work in a separate Git worktree. Do not share a working directory.
3. Before edits, read `docs/ARCHITECTURE_V1_DRAFT.md`, `docs/TEAM_WORKFLOW_V1_DRAFT.md`, `docs/CONTRACTS_V1_DRAFT.md`, and the assigned task issue. If rules are not yet approved, surface conflicts to the human operator.
4. Only change explicitly permitted paths. No unauthorised shared-contract, dependency, environment, database, CI, or cross-lane edits.
5. Do not independently choose an architecture or duplicate a module another task already owns.
6. Don't run destructive operations, handle secrets in code/logs, deploy, or incur spending without explicit human consent.
7. Report actual tests and results, changed files, commit SHA, limitations, and manual verification steps. No invented claims of passing checks or availability.
8. Human review is required before merge to `develop`. Another AI's review does not count. `main` is reserved for separately reviewed substantial milestones.
9. Default agent: Codex CLI. If switching to Claude Code, **stop the prior agent** and checkpoint before reopening the same task worktree with the new agent.
10. Design for verified real Boston places and genuine transit, not fictitious API responses. Test fixtures/mocks must remain visibly identified.

## Deliverable template
TASK ID / owner / agent / branch / commit / files changed / contract changes / tests + actual output / limitations / reproducible demo steps / requested human reviewer.

This file records operating policy for agents working on this planning branch. Its presence in `develop` depends on team approval of the draft PR.
