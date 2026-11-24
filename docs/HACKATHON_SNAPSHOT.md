# BostonHacks 2026 source snapshot

## Recorded baseline

| Field | Value |
| --- | --- |
| Repository | [`Dold18/vibewise_bostonhacks`](https://github.com/Dold18/vibewise_bostonhacks) |
| Event | BostonHacks 2026, November 21–22 |
| Source baseline | `5f9eca8ab2adfd2fc65d924d0c2518a163afbf9f` |
| Baseline commit | [View on GitHub](https://github.com/Dold18/vibewise_bostonhacks/commit/5f9eca8ab2adfd2fc65d924d0c2518a163afbf9f) |
| Snapshot branch | [`archive/bostonhacks-2026-final-20261122`](https://github.com/Dold18/vibewise_bostonhacks/tree/archive/bostonhacks-2026-final-20261122) |
| Latest major integration at this baseline | PR #69, VibeWise V3 “Layered Sheets” |

On November 24, 2026, before portfolio documentation was revised, the snapshot branch above was created **directly at the recorded post-hackathon `main` commit**. The original source state is therefore still inspectable even if team members continue to update `main`.

This identifies the **repository source snapshot**, not a cryptographic record of exactly what judges viewed, nor a copy of Vercel's runtime configuration, Supabase data, third-party services, or any local uncommitted files.

## What is preserved

The branch points to the complete Git tree at that commit: application, server, pipeline, migrations, scene assets, internal planning documents, and original historical README. GitHub commit and pull-request history remains available through the original repository.

A stable Git commit can be checked out using:

```bash
git clone https://github.com/Dold18/vibewise_bostonhacks.git
cd vibewise_bostonhacks
git checkout 5f9eca8ab2adfd2fc65d924d0c2518a163afbf9f
```

## Important backup distinction

An archive branch in the **same** repository protects against ordinary forward development on `main`, but it is **not an independent backup** against deletion of the original repository or its account. For fully independent preservation, the team should also keep a private Git mirror under a separate repository and verify that its archive branch resolves to the baseline SHA above. A mirror preserves contribution history; a one-file ZIP snapshot alone does not.

This documentation-only portfolio pass intentionally updates README/portfolio notes separately from the above baseline. It is not intended to modify the runtime implementation.
