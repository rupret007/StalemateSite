# Bounded production participation reads

October 26, 2026. This application correction keeps the existing admission,
record, transaction, rollback-checkpoint and transport limits. It does not
activate C3, install a policy, enroll anyone, qualify guardian decisions or
enable a provider. The ordinary beta's current age/media rules remain.

## The observed admission failure

A source-bound, one-worker regression drives actual `betaFetch`, issued guest
cookies, `HangoutLobby`, the session authority, partitioned C2/C3 adapters and
effect writer over disk SQLite. Only operator/guardian decisions, the transport
extension and unrelated binding transports are synthetic. Every guest uses a
different IP and issued SID, receives a synthetic current grant, and follows
the same upgrade/nickname flow. Healthy transport acknowledgements use real
sequence numbers and the unchanged pacing rules. The test stops at its first
refusal; it never retries an action or bypasses admission.

| Original source observation | Result |
| --- | --- |
| Fifty guests | Preparation used 1,806 physical calls; nickname commit used 1,921 |
| Fully admitted guests before first refusal | 110 |
| Next guest's nickname | Refused despite caller-only status still showing authorized revision 2 |
| That guest's preparation | Both upgrade/nickname preparations completed 4,002 calls with no writes |
| Failed nickname effect transaction | Reached the 4,096-call application guard after 64,043 written bytes; rolled back during final authorization |

This identifies an application call-budget conflict, not a Cloudflare or kernel
capacity measurement. The existing 32 MiB read and 16 MiB write guards were not
the observed failure. The whole-engine 50 ms checkpoint guard also remains.

## Preparation and commit dependencies

`readPartitionedParticipationPreparation` projects purpose eligibility and
retained withdrawal state from one validated current partition per distinct
principal. It still checks the policy, subject index and current global
guardian/consent/decision references. Duplicate principals share only this
read-only traversal; each connection's binding and expiry remain independent.
Verified retained withdrawals still narrow sharing when affirmative policy
eligibility expires. Corrupt or incomplete reads supply no such projection.
Adapters without the new preparation reader retain the previous fallback.

Each commit authorization reads the union of its actually recorded actors,
peers and withdrawal checks, preserving original slots and missing-peer
denial. Both sides of awaited effect writes independently resolve current
policy/grants and validate authoritative connections. Neither fence treats a
preparation result or previous read as current authority; no record cache is
reused between the fences or across a transaction boundary.
Provider guards retain their existing behavior and remain unqualified/off in
the production composition.

## Qualification and remaining limits

The corrected focused set passed 205 cases across ten files, including actual
SQLite failures after the final effect write for subject expiry, policy and
subject revision changes, SID replacement and existing session/role changes.
Peer dependency, null-slot, corrupt reference and retained-withdrawal cases
also remain covered.

One fresh sequential admission run passed the unchanged 150-guest target in
118.343 seconds, including the harness, synthetic clients and instrumented
SQLite work. This is admission acceptance with transport doubles, not 150 real
network sockets, a load/soak SLO or hosted throughput. Passed-test console
suppression omitted that run's final per-transaction measurements from its raw
output; those numbers are not claimed. The original failed run's complete
phase measurements remain retained. The required clean integrated unit run
must capture them with `--reporter=default --silent=false`.

The new long fixture and the existing thirty-room fixture run in the existing
serial capacity project after ordinary units, with one worker and unchanged
hook/test deadlines. Every recorded dependency must still fit the same atomic
transaction. A large simultaneous set of true withdrawals or peer-dependent
checks can remain expensive; no universal 150-person/all-actions or 200-person
capacity claim follows from this admission case.

A later combined-source full run at `5bb8b455f525` timed out in a setup hook
that grouped five admissions under the unchanged 10,000 ms hook deadline. The
reported fixture duration was 116.074 seconds and its final 150-guest assertion
was skipped; no specific guest refusal or final capacity metric payload was established.
That result remains a failed setup qualification, not a demonstrated product
refusal or a transferred pass from an earlier source revision.

Setup now gives each genuine admission its own existing hook deadline, retaining
all 150 guests in order, the same ACK flow, assertions, caps and real clocks.
This removes the arbitrary five-admission runner boundary without changing the
application's separate 50 ms rollback-checkpoint guard. A new clean combined
full run is required; no standalone unchanged retry qualifies this correction.

The earlier default-relay 50/150 measurements, current C3 admission proof,
physical slow-reader/reconnect behavior, native media and hosted staging are
separate qualifications. See [the scale plan](HANGOUT_SCALE_QUALIFICATION.md)
and [participation dependencies](HANGOUT_PARTICIPATION_READ_SCOPE.md). Hosted
monitoring, budgets, rollout and StoryPool operations remain with the receiving
owner. This correction introduces no purchases, deployment or policy changes.
