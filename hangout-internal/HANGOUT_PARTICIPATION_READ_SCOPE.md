# Controlled participation read dependencies

October 25, 2026 application optimization on the partitioned C2/C3 model. This
does not connect an enrollment adapter or change the protected beta when
`createLobby({participation})` is absent. Production public all-ages, hosted cost
and provider readiness remain unqualified.

## Strict author-only public text

The actual engine now prepares only the authenticated author's participation
view for an ordinary `say` frame when all of these conditions hold:

- The raw string fits the existing regular frame byte limit before parsing.
- The frame contains string text that does not begin with `/`.
- Its channel is an existing public lobby/room, never a `pm:` context.
- The author already has a nickname and is a current room member.

This selects dependencies, not permissions. The actual handler still enforces
room/global/role/content/slow-mode and rate safeguards and records its author
purpose checks. Local ignore/block delivery rules remain. Receiving ordinary
public text does not establish a direct-contact or media grant. Pending private
requests, another author's held text, and existing watch/camera state are not
updated or authorized by this action.

Everything else prepares the full bounded connected roster. That includes
slash commands (including escaped slash text), private contexts, keyed/invite
rooms, joins, room artifacts, PM request/accept/delivery, camera and RTC/watch
actions, moderation approvals, AI results, refresh, disconnect and maintenance.
Malformed, oversized or ambiguous frames take the conservative path and retain
the existing refusal. Parsing adds bounded work before the existing parser;
incoming request/frame allowance is still charged first.

The enforcer does not infer missing peers or cache old eligibility. An accidental
peer-dependent check in a partial context fails closed because its peer subject
and binding are absent. A future change adding such a dependency to public text
must either expand the prepared set or remove that path from this classifier;
do not substitute a permissive missing-record default.

## Freshness and storage boundaries retained

No C2 record, policy or session cache is introduced. The author is freshly
resolved, then current policy/subject/grant rows are read during prepare. The
same atomic effect transaction validates the current authoritative session and
policy/subject revisions both before and after awaited writes. A withdrawal,
session authority change, root policy update or deadline crossed while writes
wait still prevents acknowledgement and public output. Required write failure
still rolls back unpublished semantics, retaining consumed abuse allowances.
The full existing bounded checkpoint/effect staging is unchanged.

AI review remains optional and deferred until the public effect commit. Its
fresh provider guard and non-retrying synchronous start fence retain the same
author context and current policy/session/subject checks. A changed or expired
binding cannot start a new provider request or let a late result restore a
grant. This optimization supplies no production provider, external cancellation
guarantee or trusted dispatch implementation.

For the synthetic partitioned adapter with one eligible author and no provider
invocation, the focused actual-engine regression observes 23 point reads:
7 during prepare and 16 across the effect transaction's two authorization
checks. This count includes its authoritative session reads. Additional provider
guards, other action types and adapter-specific work are separate. It is not a
hosted billing estimate.

## Evidence and limits

The focused regression uses the real partition ledger, C1 evaluator, enforcer
and engine with synthetic trusted serial storage. It checks the selected read
set and exact point-read count; intact PM/held/media state; both-peer checks for
private and RTC paths; queued author withdrawal/session change/storage failure;
expiry after awaited effect writes; retained-session denial after final subject
cleanup; and guarded provider starts with no external request. Existing full
participation tests remain in place.

The previous exact `081b41404cad` 96-person in-process workload observed 1,733
point reads for each public action while preparing the whole roster. A new
exact-source run is required to quantify this change; do not treat the focused
two-person test as a 96-person performance measurement.

Room/session snapshots, delivery to members, conservative checkpoints and the
synthetic store's transaction copies remain dependent on connected state.
Private/media and refresh operations still read the full roster. This is a
targeted read-amplification reduction, not unbounded scale, a production storage
adapter, a Cloudflare capacity claim, or permission to raise existing caps.
The old 150-socket default-beta measurement qualifies neither configured C3
transport nor its storage/transaction costs. StoryPool core, Karen, deployment
and shared operations remain owned by StoryPool 10-21-26.
