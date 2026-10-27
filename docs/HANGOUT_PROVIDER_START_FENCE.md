# Inactive moderation start boundary

This application capability orders a possible future public-text moderation
request against the community's current session and participation state. It
does not enable AI, install consent, qualify a provider or add a public route.
Production still refuses authority-mode provider admission through
`providerQualified: false`, `session-start-fence-not-qualified` and the existing
authority-mode moderator/callback guards. Quota persistence, result application,
provider and child-data readiness remain separate activation requirements.

## Private capability and original owner

The participation adapter supplies an internal `{actorId, validate, start}`
request. The actor is the prepared connection ID, not a browser-supplied
identity, nickname or staff claim.
The bridge accepts only `aiPublicReview` with strict public-text/provider intent;
an ordinary chat purpose cannot be substituted to skip provider qualification.
The selected request is an immutable snapshot of primitive fields across awaits.
The dispatcher closes over an owner minted
while that engine is composed. The owner pins that engine, authority and opaque
storage-failure token; a delayed old request cannot adopt a replacement engine.
Every restart invalidates the old owner before restoration begins.

`dispatchParticipationStart(request, owner)` consumes the request object's
identity before waiting. A failed validation, storage error or thrown start
does not make that same capability reusable. This is in-memory request identity,
not a durable idempotency key or exactly-once external service guarantee.

The dispatcher checks the original owner and the actor's actual tagged socket,
attachment and live binding. It refuses a closing/closed socket even if its
durable retirement is still queued. It also refuses degraded evidence storage,
an unavailable authority, incompatible modes or a changed failure token. These
checks run before entering the owner gate and immediately before start.

## Validation, invocation and response

Inside the owning `blockConcurrencyWhile` callback, the authority's existing
initialized/configured transaction invokes `validate` with only bounded codec
`get` and `list` operations. Exact boolean `true` is required. The entire native
transaction must finish successfully, including codec poison/finalization,
before start is considered. A swallowed physical read failure cannot become a
successful validation merely because a validator returned `false`.

After transaction completion, the dispatcher repeats the live-owner checks and
invokes the one-use synchronous `start` callback without an intervening await.
The callback must initiate its operation synchronously. It may return a pending
response; it must not defer the actual start until later promise assimilation.
The gate returns a frozen, null-prototype, nonthenable box containing that
response. The response is awaited after the gate completes, so remote latency
does not hold the permission boundary against Stop, logout or ordinary chat.

Ordinary participation denial remains a refusal. A real codec/native transaction
failure retains the application's degraded-storage behavior. All errors are
contained inside the gate callback and reported after it returns; an ordinary
denial must not escape the callback and reset the object.

Cloudflare documents transaction commit-or-abort behavior. It does not make
external calls part of that transaction. The implementation therefore keeps
start outside the storage callback, including under defensive callback-replay
fault injection. Current documentation does not establish an automatic retry
count or an exactly-once callback promise. [SQLite storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)

Cloudflare's event barrier has exceptions for operations initiated by its
callback, a timeout and reset behavior. A FIFO test double alone cannot prove
that production exclusion. Writer coverage and immediate lifecycle/failure
fences need source review and actual Worker runtime tests; callback errors and
remote response waiting must stay out of the gate's failure path.
[Durable Object event barrier](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)

## Qualification and limits

The relevant assertions are actual SQLite commit-before-start ordering, prior
Stop/revocation/expiry denial, refusal of an old owner or closing socket,
unconfirmed/corrupt storage refusal, single capability consumption and progress
while a response is held. Production composition must separately keep provider
calls at zero. A qualified isolated test callback is not production readiness.

The new native fixture mode must retain the real production authority identity
and invoke the real dispatcher, without an extra fixture gate masking its
behavior. It supplements the existing native modes; none of their assertions,
limits, source checks or deadlines may be removed to manufacture a pass.

The linearization point is the application's synchronous start invocation.
Output gating may delay an outbound request, and a crash may occur after a
remote service accepts work. This capability does not prove network delivery
time, cancellation/recall, crash-level exactly-once dispatch, hosted scheduling,
provider policy, legal readiness or public launch.

This slice adds no durable schema or public protocol field. Its inherited
selected-person, lobby-instance and historical-label records still require the
matched readers/writers, socket drain and compatible-state rollback described
in `HANGOUT_PERSON_ACTIONS.md`. No deployment or rollback is qualified here.
