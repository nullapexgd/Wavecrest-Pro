# Product lines roadmap (idea record, not approved)

Status: direction only. Nothing here is designed, priced or scheduled. No billing change, no implementation. Current priority stays the AI-quality corrections and the Improve plan (`PLAN-improve-dashboard.md`).

## Offers under consideration
1. **Wavecrest** (standalone): creator intelligence, reports, analytics.
2. **Reelcut** (standalone, separate project): AI clip discovery, editing, captions, exports.
3. **Wavecrest + Reelcut bundle**: both products plus an integration between Reelcut and Wavecrest's Recent Reports and Improve dashboard.

## Principles
- Each standalone product keeps its full core functionality. The bundle adds integration value; it never removes or throttles a standalone feature to create a reason to buy.
- Integration value, not gating: evidence-backed recommendation (report claim or Improve idea) -> clip candidates in Reelcut -> edit/export -> a measurable experiment tracked back in Improve.
- Evidence honesty carries over: a recommendation links to the videos that support it; experiment results use only metrics the creator actually connects, never invented ones.
- Reelcut stays a separate service/codebase. Integration goes through an explicit, user-authorised link (scoped, revocable), not shared database access.

## Open questions (decide before any design)
- Account model: shared sign-in vs linked accounts; who owns clips and experiment data.
- What a "measurable experiment" can measure from public data vs connected analytics (see Improve plan §data limits).
- Rights and consent for source video (user's own channel only?) and Reelcut's processing/storage costs.
- Packaging and pricing: undecided. Needs owner approval and a billing design; Wavecrest is Free Beta with no payment provider today.

## Wavecrest Access
Discounted or sponsored plans (students, educators, veterans, seniors, qualifying nonprofits) are a separate evaluation track, already specified as non-approved in `PLAN-improve-dashboard.md` section 18 (verification options, minimal data, no final eligibility, prices or thresholds). If a bundle exists, whether Access applies to it is an open policy question, not assumed.

## Sequencing
1. Finish and release the AI-quality corrections.
2. Improve dashboard phases per its plan.
3. Only then scope Reelcut integration (needs Reelcut's API/export surface reviewed first).
4. Access policy design in parallel as a business decision, independent of engineering.
