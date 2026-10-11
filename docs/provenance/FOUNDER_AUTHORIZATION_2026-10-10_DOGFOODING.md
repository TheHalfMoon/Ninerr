# Founder authorization for P08-G11 dogfooding: 2026-10-10

On 2026-10-10 (session message at 19:04:03 UTC), the founder set the P08-G11 dogfooding program and gave this authorization. The excerpt below is verbatim; the rest of the message sets the dogfooding protocol and is not quoted here:

```text
# 3. NEW FOUNDER AUTHORIZATION — PUBLIC OPEN-SOURCE PROJECTS

The founder has approved using **seven real public open-source projects** for P08-G11.

You are explicitly authorized to:

- Discover and select seven suitable public projects.
- Download or clone them locally.
- Inspect their source code and structures.
- Create temporary working copies.
- Import their supported components into Ninerr.
- Modify copied components and project content for testing.
- Rename copied projects or components where useful.
- Create derivative testing fixtures.
- Execute real dogfooding workflows.
- Publish the selected public project names and Ninerr testing results in Ninerr's public evidence.
- Open issues and implement fixes for defects uncovered by these tests.

The founder additionally states that they possess broad permission to copy, modify, combine, and rebrand the source material.

Treat that statement as permission to proceed with authorized engineering evaluation and reuse, not as evidence that every third-party rightsholder has waived all applicable obligations.

Before redistributing third-party code or removing attribution/license notices, verify the applicable license or explicit rightsholder authorization.

Do not remove legally required notices merely because a repository is public.

No additional approval is required for normal public-repository cloning and local testing.

Do not access private repositories or disclose private information for G11.

Do not ask me to nominate the seven projects.

**Select them yourself using the criteria below.**
```

## How Ninerr applies it
- The seven projects are public and MIT-licensed, each pinned to a commit in `scripts/dogfood/projects.json`. `scripts/dogfood/fetch.mjs` checks each license file for the MIT license text (two of its sentences).
- They are registered in `docs/provenance/LICENSE_REGISTER.json` as kind `dogfood-subject` (category B: their own license governs them) and listed in `THIRD_PARTY_NOTICES.md`.
- None of their files are committed to this repository or shipped in a release. The local working copies keep their license files.
- The founder's statement of broad permission is not relied on for any redistribution: nothing of the projects is redistributed.
- Their names and the testing results are published in `docs/evidence/P08_G11_DOGFOODING_2026-10-11.md`, which lands in the PR after the harness.
