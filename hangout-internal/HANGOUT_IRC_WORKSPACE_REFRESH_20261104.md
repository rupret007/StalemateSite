# IRC workspace refresh

Jeff requested a cleaner desktop IRC workspace, mIRC familiarity, a visible
browser-guest invitation button, and Halloy as an open-source reference.
Preserve the one shared browser community, join-time scrollback, creative rooms,
WebJam music, all62 outcomes and mobile input containment.

## Research and implementation choice

[Halloy](https://halloy.chat/) is a native Rust/Iced IRC client for Mac, Windows
and Linux. Its [single-pane guide](https://halloy.chat/guides/single-pane)
describes switching a channel into the existing pane; its
[sidebar documentation](https://halloy.chat/configuration/sidebar) describes
channel navigation, bounded width and unread indicators. Its
[source license](https://github.com/squidowl/halloy/blob/main/LICENSE) is GPL-3.0.
The site's current home labels2026.10 while some linked guides label2026.9;
these are the pages observed November4, not a qualified Halloy build here.

Use Halloy's interaction model as the primary reference: persistent channel
navigation, one focused transcript, a separate people list, readable monospace
messages, restrained chrome and a bottom composer. This patch implements those
layout choices in the existing browser code. No Halloy code/assets are copied,
no application license is changed, and no new client framework is introduced.
Any later source reuse needs its own pinned source/license/attribution record.

Halloy speaks IRC/IRCv3; this community currently uses its own authenticated
JSON WebSocket protocol and room lifecycle. Direct Halloy connectivity would
require a protocol adapter and its own permission/privacy acceptance. It is
outside this desktop layout correction. Halloy's optional chathistory capability
does not change our connected-session-only transcript requirement.

Also reviewed [The Lounge](https://thelounge.chat/) (MIT) and
[KiwiIRC](https://github.com/kiwiirc/kiwiirc) as browser IRC references.
Their additional services/history settings are not added to this community.

## Current correction

The existing IRC already spans its browser viewport; our physical trial windows
were deliberately1180×850 on the MacBook and1024×850 on the Mini. Window size and
application layout are separate. Add an explicit user-operated Full screen
button where the browser permits it, with an accurate denial fallback and state
reset when fullscreen ends. It never enters fullscreen automatically.

Above900px, reduce fixed sidebar/chrome space, use a compact vertical room-action
list and enlarge transcript text. Keep the active channel tab/focus behavior and
anchor the composer. The existing phone/short-window rules remain in control at
375/390px, with16px inputs. Actual rendered screenshots, keyboard behavior and
full CI are required before private delivery; source edits are not that proof.

The native WebJam follow-up is on codex/web-join-host-readiness-20261104: a
visible browser-guest button and persistent status use the existing permission
owner; required packaged custom Opus closes the missing-codec blocker found on
the physical Intel MacBook. A source/codec smoke still does not prove actual
reciprocal music. Public navigation, media/AI holds and namespaces stay intact.

## Validation and remaining delivery

The updated source passes23 local browser cases:9 existing Chromium discovery
journeys plus7 workspace cases each in Chromium and WebKit. Discovery's18 unit
cases also pass. Five viewport checks per engine cover1024×768,1440×900,
1920×1080,375×812 and390×844; composer containment and16px phone inputs are
asserted. Browser-supported fullscreen entry/exit and explicit denial recovery
preserve the draft. Unsupported fullscreen only qualifies the hidden control.

[Local screenshots and hashes](../pr-assets/beta-collaboration/20261104/irc-workspace/screenshots.json)
retain desktop and375/390 views in both engines. Desktop1440 Chromium/1920
WebKit and375 WebKit were inspected after the final copy change; the earlier
375 Chromium/390 WebKit phone captures were also inspected. These are browser
viewport checks, not physical-iPhone evidence. Empty gathering/creation wording
now describes the room plainly rather than exposing evidence requirements;
missing-event authority, no fabricated time, no attendance claim and no auto-send
prompt tests remain in place.

The first14-case run failed the two denial fixtures because the init script
accessed documentElement before it existed. The corrected fixture overrides
Element.prototype; the real API test had already passed. Both original contexts
are retained locally; no product failure is relabeled.

This branch stacks on Paint Along203/cb81e11. It does not merge to public main,
deploy the beta, enable media/AI, or change the62 acceptance requirements.
Its own normal GitHub CI and private delivery remain pending.
