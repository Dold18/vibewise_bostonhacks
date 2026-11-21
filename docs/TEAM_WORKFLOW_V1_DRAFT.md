# VibePrint / Vibenta — Multi-Teammate Agent Workflow v1 (PROPOSAL)

**Status: Proposed, not approved.** Applies equally to Codex, Claude Code, and human-written contributions once approved.

## Operating model
**Humans own architecture, code review, integrations, and final decisions.** Agents execute bounded tasks. One authoritative GitHub issue per task; one branch and one local worktree per concurrently active coding agent.

## Suggested ownership lanes

| Lane | Human accountable owner (TBD) | Sole authority over | Integrates with |
|---|---|---|---|
| Experience | TBD | map UI, quiz UI, styling, transitions, cards | `DiscoveryState`, place IDs, transit overlay data |
| Intelligence | TBD | vibe interpretation, question selection, scoring algorithm | canonical `VibeProfile`, `Recommendation`, `QuizQuestion` |
| Data & routing | TBD | canonical places, MBTA adapter, venue data provenance, budget constraints | `Place`, `TransitPlan`, shared API |
| Integration & coordination | TBD | task triage, integration test fixtures, e2e tests, demo gate; optional group algorithm ownership | all lanes through explicit tickets |

Cross-lane shared files (contracts, API routes, package manager, common configuration, environment, DB schema, CI) have a designated **integration owner** and must not be changed unilaterally. If the team is smaller than four, combine accountabilities explicitly. One teammate can supervise multiple agents; agents are not additional human owners.

## Branch policy

```text
main                            <- stable milestones only, human approved
  ^                                 (no agent commits directly)
  |
develop                         <- reviewed end-to-end integration
  ^  ^  ^
  |  |  |
agent/TASK-101-map-pin          <- isolated task branch
agent/TASK-102-vibe-update      <- separate task branch
agent/TASK-103-place-fixture    <- separate task branch
planning/*                      <- design proposals and coordination
```

- Task branches start from the current `develop` baseline and submit **draft PRs targeting `develop`**.
- Only human-verified changes merge to `develop`.
- `main` updates only for meaningful, working milestones using a separately reviewed `develop -> main` PR.
- No agent directly commits, pushes, merges, force-pushes shared branches, or changes branch settings.
- Branch protection should be configured where plan permissions allow. Written policy is **not** technical enforcement.

## Task lifecycle
**Backlog -> Specified -> Claimed -> In progress -> Draft PR -> Tested -> Human verified -> Merged to develop -> Demo verified.**
Use one GitHub issue with a unique TASK number; claimant and reviewer must be visible. If a task is claimed, a second agent must not independently reimplement it.

Every task specification contains:
1. Owner, assigned agent, reviewer, timebox, and dependency IDs
2. A single observable objective and why it matters for the demo
3. **Allowed and forbidden files** and interface contracts it must honor
4. Inputs/outputs, concrete fixture, and error conditions
5. Acceptance checks, automated tests, and how to run the demo
6. What to do if a contract or dependency turns out to be missing

## Parallelism rules
- Parallelize tasks with separate file ownership and **pre-agreed APIs**.
- Never assign the same feature to multiple agents unless it is an explicitly isolated comparison/prototype.
- Begin with about two active agents per human, increasing only when review and integration keep up.
- Each active coding session gets its own worktree / checkout. No shared terminal folder or unstaged changes.
- Agents do not make speculative changes to another person's area to 'get it working'.
- Open draft PRs early to expose cross-lane integration risk, but never merge just to unblock another agent.
- Prefer small, independently testable vertical deliverables over enormous multi-day branches.

## Contract change protocol
Any required shared schema, dependency, API signature, or common configuration change is flagged **Blocked: contract change**. Owner proposes a contract diff and identifies all consumers. The integration owner and affected owners approve; only then is a dedicated contract PR merged to `develop`. Dependent agents sync the new baseline and continue. No simultaneous incompatible contract edits.

## Review gates (required)
1. Agent records final branch and commit SHA, what changed, actual commands and results, unverified behaviors, risks, and demonstration steps.
2. Automated checks (once configured) cover formatting, build/types, module tests, and contract fixtures; do not claim checks exist until actually implemented.
3. An independent agent may review as a second opinion, **but never substitutes for a human**.
4. Human owner reviews file diff, tests the accepted behavior, and approves the PR to `develop`.
5. Integration owner confirms no contract break; cross-lane changes require owners' sign-off.
6. Re-run end-to-end demo on `develop`; promote to `main` only on a milestone.

## Codex-first / Claude Code fallback
- Codex is the default coding agent. Claude Code is an interchangeable fallback when credits are exhausted.
- Both read `AGENTS.md`, the same issue, architecture, and contracts.
- To switch: stop Codex -> commit/checkpoint its task branch -> record task status, changed files, tests, and TODOs in the issue -> start Claude in **the same isolated task worktree** after Codex has stopped.
- No simultaneous Codex and Claude editing the same worktree. Preserve tests and task IDs during handoff.

## Coordination rhythm
- Short team planning checkpoint before work: select ready issues and dependencies.
- Asynchronously publish issue/PR updates; don't rely on oral status or isolated AI chat memory.
- Regular integration checkpoints (for example, every 2–3 hours during the event) review PRs and run the full journey.
- Reserve a dedicated integration owner and a no-new-features period before the final demo.
- Maintain `docs/DECISIONS.md` for accepted architecture changes.

## Escalation
- **Interface missing:** stop and request contract proposal, don't guess.
- **Files claimed by another task:** stop; ask owner to split or serialize.
- **Flaky external API:** disclose; keep a visible fallback and label mock data.
- **AI makes unrelated edits:** reject or split PR; don't silently accept.
- **Tests fail:** PR stays draft/blocked until failure is understood.
- **Agent budget exhausted:** checkpoint and transfer; no duplicated implementation.

## Team sign-off questions
How many teammates? Who enjoys frontend, backend/algorithms, data/MBTA, and integration? Who will be the final merge authority? When is the coding window and submission deadline?
