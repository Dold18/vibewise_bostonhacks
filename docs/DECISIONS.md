# Architecture Decision Register

Decisions listed as **Proposed** are not approved. After a team discussion, record accept/reject, rationale, date, owner, affected tasks, and a link to the approving PR/issue.

| ID | Proposal | Status | Rationale |
|---|---|---|---|
| ADR-001 | Single repository and modular backend rather than distributed microservices | Proposed | Avoid deployment and integration overhead during hackathon |
| ADR-002 | `main` release milestones; `develop` human-verified integration; task branches for agents | Proposed | Keep risky work away from stable release |
| ADR-003 | Central published contracts and designated owner | Proposed | Prevent agents from inventing incompatible schemas |
| ADR-004 | Codex first, Claude Code fallback via task checkpoints | Proposed | Provider-agnostic agent workflow |
| ADR-005 | Single-user journey first; group mode optional after real end-to-end flow | Proposed | Preserve demo reliability |
| ADR-006 | Team must sign off on stack, data providers, API architecture, and ownership before implementation | Proposed | Minimize rework |

## Decision template
- **Date / ID / Title:**
- **Owners and reviewers:**
- **Context / options considered:**
- **Decision:**
- **Why:**
- **Consequences and affected paths/contracts:**
- **Approving issue or PR:**
