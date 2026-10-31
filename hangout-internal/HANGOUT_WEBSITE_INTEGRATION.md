# Website integration: one shared Hang Out

Use this short guide to prepare the receiving owner's release. This application
session supplies source, tests and integration assets. Following Jeff's October30
clarification, application code, project CI and application PRs proceed here
independently of StoryPool/Karen. Shared StoryPool core, installed services and
operational files remain outside this task. Existing GitHub protections and
security/provider/release holds still apply. This document is not release
approval or evidence that a live website contains the candidate.

## Select one tested candidate

The current protected private website uses application source
`4ed1525c84f48173077f506261cb5acd19e3c1dc`, tree
`2144677d638fee4b078a18e75892db9d75c6acdc`, matched to Worker version
`a9724702-3ce5-418a-bbd4-950f2e169c9e`. Its current site CI, hosted mobile/short
layout, logout and read-only health evidence are in the
[dated application receipt](HANGOUT_PRIVATE_DEMO_PROGRESS_20261031.md).
Only chat CSS changed since the preceding source96/runtime629. That older
source retains the broader hosted chat/drawing proof and original failed
eight-hour observer, with its separate predicate diagnosis and ending identity.
The explicit eighth provider-start CI mode used inert callbacks; it does not
prove music or activate providers. Keep settings, keys, namespaces and release
holds intact. Documentation/toolkit-only merges do not change the live app.

Current native source is `bf24e7d4769aa8ef8ce1300ccacc7d1fe9b2fc35`. All four
matching private builds succeeded; actual ARM package identity, normal GUI and
idle transport checks are in the dated receipt above. Actual browser invitation,
installation and reciprocal ARM/Intel/Windows music remain required. Keep those
proof scopes distinct and use these identities before historical branches below.

The preceding `codex/webjam-native-ci-20261030`, based on PR169 head
`43457849374bfa00e68fcf3f224954e3f3832026`, added the separate eighth provider-start
mode to application CI.
The preceding `codex/jam-share-order-20261030` is based on
PR168 head `2c4a191915e02c73f95b1c0d2aca1082f6974649`. Its parent
`codex/jam-mobile-setup-20261030` contains the compact setup help and is based on
PR167 head `143b3905af12e029a645e96769cc1d04cec018a5`. The preceding
`codex/jam-confirmation-races-20261030` contains PR166 head
`1504f94837a68ce35844e0590cde469135c287b4`. The earlier parent
`codex/irc-webjam-polish-20261029` is based on the merged
`codex/che-demo-candidate` at `ec1eb14cfb2f7d068e5a01467193b70e21495dbc`; see the
[checkpoint](HANGOUT_DEMO_CHECKPOINT.md#previous-work-independent-application-ci)
for its exact inputs and unresolved gates. Obtain the actual reviewed current
commit, not just an input PR or branch name. This assembly includes both the
music-invitation fixes and the reconnect probe; older input results do not
qualify the merged tree.

Use the delivered source commit and its matching CI/review receipts. The entry
toolkit's `SOURCE-MANIFEST.json` names the commit used to build that archive; it
contains link tooling and documentation, not the whole application. Obtain the
application from the corresponding source branch or verified source patch.
Revalidate the exact current commit's application CI and review. Historical
dependency tables are an audit trail, not a list to cherry-pick blindly.

Retain newer Stalemate and Rad Dad pages, navigation, media consent and the
permanent Rad Dad `/tap/` to `/qr/` path. Do not replace either site with a stale
application checkout.

## Export a self-contained entry toolkit

From the committed application checkout, choose a new directory whose parent
already exists. For the currently approved private entry address:

```sh
node scripts/package-community-toolkit.mjs --community-address https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/ --out /path/to/new-entry-toolkit
```

The exporter reads a finite list of committed public files, not a repository
copy. Selected executable files must match that commit, allowing ordinary CRLF
checkout line endings while exporting exact Git bytes. It includes the link
builder and its two module dependencies, a disabled/unverified registration
example, a neutral link, concise instructions, license status and per-file
SHA256 hashes in `SOURCE-MANIFEST.json`. The manifest names the toolkit source;
it is not proof of a matching live application or a complete app distribution.
The extracted link builder needs Node.js, without this checkout or node_modules.

Existing output is refused. Published application asset directories are also
refused, so operator tooling is not accidentally placed in the visitor app.
No `.local`, `.env`, credentials, internal notes, third-party media or app/native
binary is included. Recognized repository-root license/notice files are
preserved when present; the export adds no licensing grant. Confirm appropriate
project permissions before public code redistribution. A plain entry link needs
no registry or toolkit execution.

This command does not verify domains, enable registrations, deploy either site,
change Worker origins or release a provider/public-launch hold. For approved
badge/return snippets, use the extracted builder as described below. Leave the
example disabled until the operator has reviewed the domain and scopes.

## Prepare entrance links

The release owner selects one approved canonical community address and one
authoritative backend/namespace. Both band sites and future links reach that
same service. Two independent Worker namespaces create two communities.

### A. Simple neutral Join link

Any website can add an ordinary link to that approved address without registering
its site, obtaining site credentials or running the package builder. Use top-level
navigation with no `via` value. For example, **replace this example.test address**
with the receiving owner's approved community entry URL:

```html
<a href="https://community.example.test/beta/" referrerpolicy="no-referrer">Hang Out</a>
```

This entrance is neutral: it attaches no site badge or registered return contract.
The community's existing invitation, sign-in and admission rules still apply;
linking grants no access or staff permissions. No band-site account, shared cookie
or cross-site SSO setup is required for the link itself. Adding a future basic
link does not create another community or require enabling a new integration.

### B. Optional reviewed badge and return navigation

Use the versioned integration contract when an entrance should offer a recognized
site badge and approved return link. This registration is optional for ordinary
linking. Badges remain visitor-controlled display context, never authentication.

1. Prepare a nonsecret registry using
   [`community-integration.example.json`](community-integration.example.json).
   Approve each registered site's domain control, exact origins, permitted return
   URL, display label and `link`, `badge`, `return` scopes. Domain verification is
   the operator's recorded assertion; the builder does not perform it. Example
   fixtures do not prove real domain control. Keep unapproved entries disabled;
   an integration receives no staff powers.
2. From the application repository root or extracted toolkit root, generate the
   snippets with an installed Node runtime. Choose a new output directory whose
   parent already exists; the builder refuses to replace an existing directory.

   ```sh
   node scripts/package-community-entry.mjs --config /path/to/approved-sites.json --out /path/to/generated-links
   ```

3. For additional badge sites, the release owner also sets the canonical
   Worker's public `HANGOUT_ENTRY_SITES` JSON array to the reviewed generated
   `manifest.json` → `entrySites` value. The built-in band entries stay built in.
   The Worker supplies the sanitized registry to both client and engine. A
   custom link without this matching configuration joins with a neutral badge;
   the link builder itself does not configure the Worker or verify domains.
4. Add each generated Hang Out link to the relevant site's existing navigation.
   Use the same community address with its registered entry identifier. Never
   put a private invitation, email code, cookie or credential in the link.

Disabling a registered site prevents new approved-link generation. A custom
source is neutral when it is absent from the runtime registry in use; existing
delivered labels stay with their messages. This does not invalidate copied
ordinary links, ban visitors or remove their accounts/rooms.

Both options share channels, room IDs, moderation and first-party community
sessions. The optional “via Stalemate” or “via Rad Dad” badge describes this
entrance only. Visitors can hide it. It grants no identity or permissions; direct
entry stays neutral. Do not copy cookies across band domains or assume an existing
site-account SSO service.

## Release the matching application and state

The release owner follows [session-authority migration and recovery](HANGOUT_SESSION_AUTHORITY.md)
and the [full handoff](HANGOUT_SHARED_COMMUNITY_HANDOFF.md). Preserve bindings,
IDs, account-key continuity, room ownership, bans and selected evidence.
Independently establish old-writer, socket and in-flight drain; a mode flag or
export is not drain proof. The opt-in Lobby authority mode is not activated by
the entry archive. A flag reversal is not sufficient rollback between different
authorities. Qualify recoverable state and matched assets/backend before use.

Before activation or rollback, check the actual saved fields and connected-client
versions against these compatibility contracts. Preserve compatible readers and
matched clients/backend; reversing a source patch or mode flag does not migrate
stored state or establish a verified drain.

| State or protocol | Contract | Receiving-owner compatibility condition |
| --- | --- | --- |
| `jamShareResults:1` / `jam-share-result` | [One pending Share](HANGOUT_JAM_SHARE_FEEDBACK.md#compatibility-and-qualification) | Deliver matching HTML/CSS/JS and engine. Older clients keep state-based behavior; a new client with an older engine does not establish the correlated rejection/single-pending guarantee. No stored schema is added, but existing drain and recovery contracts still apply. |
| Room `keepRef` | [Keep-room state and rollback](HANGOUT_KEEP_ROOM_SIGNIN.md#compatibility-and-rollback-boundary) | Preserve a reader that accepts the room-instance reference and preflight snapshot/indexed-record sizes within unchanged caps. Older indexed readers can refuse the field; qualify a compatible reader or the documented drained rollback conditions before use. |
| Restricted `safetyOnly` sessions and `sharing-stopped` | [Own-sharing integration](HANGOUT_OWN_SHARING_CONTROLS.md#integration-and-rollback-boundary) | Keep compatible stored-session readers and current clients. An older client can ignore media teardown; qualify current assets/cache delivery and drain older sockets. Do not remove the restriction to resume sharing. |
| Required C3 `participationMode` marker | [Required-mode and rollback rules](HANGOUT_OWN_SHARING_CONTROLS.md#integration-and-rollback-boundary) | Preserve the latch and matching reviewed configuration. Old unlatched domains need separately qualified drained mode admission; deleting policy/latch state or removing flags is not recovery. |
| `publicOrigin` receipts/reports and incident-source index | [Incident-source activation boundary](HANGOUT_INCIDENT_SOURCES.md#configuration-and-activation-boundary) | Preserve compatible stamp/index readers and generation under the required mode. An initialized source namespace has no supplied downgrade path; do not erase stamps/index or flip the flag to make an older reader load. |

These contracts supply no new migration API or live state-repair procedure.
Actual writer/socket drain, recoverable backup and matched rollback qualification
remain with the receiving deployment owner.

Publish only intended site/application assets. Local role selectors, incident
fixtures, synthetic bootstrap Workers, raw evidence and operational files are
not authentication services or website content. Keep existing holds and trust
checks. Configuration names are documented without supplying secret values.

## Verify the staged visitor journey

Use two separate browser contexts entering through the actual two site links:

1. Join as guests, exchange text in the same lobby and inspect both entry badges
   in messages and People. Hide one badge; try neutral direct entry separately.
2. Create and join a permitted room, draw together and exercise watch controls.
   Invite a guest to a Jam room and verify the full WebJam invitation handoff.
3. Confirm a fresh visitor receives no earlier chat. Test long text and controls
   at 375/390px, keyboard navigation, reconnect and expired-session recovery.
4. Report only a benign synthetic message. An authorized moderator reviews it;
   an ordinary visitor cannot access staff actions. Preserve unrelated reports.
   Check block/mute behavior and changed roles on existing connections.
5. Verify logout/revocation and private-room denial. If testing camera blocking,
   use updated clients and server: signaling denial alone cannot terminate an
   already established P2P connection between two outdated clients. Check that
   an unrelated participant continues and no new camera prompt is triggered.
6. From a third test site, follow its neutral link to the same canonical service
   and verify guest role isolation. Qualify an optional registered third-site
   badge/return entrance separately after actual domain review; a local fixture
   is not evidence of public-domain control or a configured live integration.

Record the actual deployed revision, environment, observed results and failures.
Local fixtures do not establish real Access sign-in, public all-ages readiness,
physical-device accessibility, hosted capacity or native audio. Keep current
safeguards until qualified guardian/legal/staffing paths are ready. AI and TURN
activation remain separate owner-qualified work; Windows remains unsigned.

Use [the Che demo guide](HANGOUT_DEMO_GUIDE.md) for the short walkthrough. A
cross-house native session additionally needs actual installation, trust,
join/leave and bidirectional audio evidence on the advertised platforms.
