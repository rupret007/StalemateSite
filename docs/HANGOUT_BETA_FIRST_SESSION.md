# First community beta session

Status: prepared, not scheduled or sent. This is a private acceptance session
on the way to an open community. The public website navigation is unchanged.
Use the [readiness assessment](HANGOUT_BETA_READINESS.md) to decide when to invite
people; working guest chat does not establish staffed moderation.

## People and coverage

Start with 8–10 invited people, including Jeff and a session helper. Include
Mac, Windows and Linux desktop users, at least one physical iPhone Safari user,
someone new to IRC, and two musicians on separate household networks. One
person can cover several roles. Browser participants do not need WebJam installed.
Website room hosts can use any supported browser. For native music, assign a
Mac host and include Windows and Linux joiners; native Music Host is currently
Mac-only. The Linux package baseline is Ubuntu 22.04 x64.

Before invitations, fill in the following. These are assignments to confirm,
not promises that coverage already exists.

| Assignment | Person / value | Verified |
| --- | --- | --- |
| Session host and release decision | Jeff | Sole initial owner confirmed; actual OTP owner callback verified |
| Report reviewer during the session | Jeff | Confirmed; separate actual staff callback and panel connection verified; human disposition pending |
| Session helper and incident handoff | Unassigned | Pending; no staff privilege implied |
| Monitored moderation contact | jeffstory007@gmail.com | Confirmed by Jeff; hosted mail link verified at 04:10 UTC in the [ops receipt](../pr-assets/beta-collaboration/hosted-ops.json) |
| Report review hours and expected response | Unagreed | Pending |
| Session date, time and time zone | Unscheduled | Pending |
| Follow-up check-in | Choose before invitations | Pending |

Jeff remains the sole initial owner/reviewer. Introduce the session helper,
who can help people join while Jeff handles reports. A helper or room host has
no community moderation privilege; additional staff require Jeff's explicit
appointment and separate Access/Worker allowlists. Agree an incident handoff
without assuming another reviewer exists. Do not advertise immediate or
round-the-clock report responses without people assigned to provide them.

## Before the session

- Owner/staff Access setup, real email delivery and both callbacks are verified.
  Complete denied-identity and physical-device checks. Both initial apps allow
  only Jeff; named future cohort owners belong
  only in the owner app. Confirm Jeff's review coverage and recheck the contact
  link after any deployment.
- Resolve the Windows native v3 signing blocker. All four candidate artifacts
  are verified in the [installer assessment](HANGOUT_WEBJAM_INSTALLERS.md); all three desktop
  platforms remain required. Test the actual candidate installer on Mac, Windows
  and Linux in a disposable OS profile. Record OS,
  architecture, artifact version/hash, microphone permission and complete
  invitation handling. A source build or successful download alone is not an
  installation pass.
- Verify the private entrance, report acknowledgement and real human review.
  Give the reviewers the [moderator guide](HANGOUT_MODERATOR_GUIDE.md).
- Review the latest runtime, rollback target and provider status. Leave AI and
  TURN disabled until their own acceptance checks pass. Do not turn cameras on
  as a workaround for missing TURN validation.
- Check the operator monitor and its last successful probe. Local Mac alerts
  require that Mac to be awake, online and logged in; they are not external
  uptime monitoring or provider billing alerts.
- Pick synthetic test content and one test room. Agree who removes it afterward.
  Reuse rooms where possible. A shared network has a three-new-rooms-per-hour
  allowance; coordinate hosts across households for the activity checks. Respect
  room/session limits instead of resetting counters to make tests pass.
- Prepare invitations privately. Do not paste their secret fragments into PRs,
  public issues, screenshots, analytics, or this document.

## Sixty-minute agenda

| Minutes | Activity | Observable result |
| --- | --- | --- |
| 0–10 | Join as guests, choose nicks, say hello in `#stalemate`; a late arrival joins. | No account needed for chat; late arrival sees no earlier transcript. Phone keyboard leaves Send usable. |
| 10–20 | A visitor starts a channel and invites someone. A verified owner keeps a test room and recovers it on a second device. | Guest hosting works; persistent ownership follows the verified account; unrelated guests cannot take it over. |
| 20–30 | Draw together, then try a watch room. | Both people see new strokes. Host play/pause/seek works with an actual provider; browser permission/autoplay prompts are understandable. |
| 30–45 | A Mac musician hosts native music; Mac/Windows/Linux musicians share complete invitations through the room and join from separate networks. | Actual packages handle invitations; selected cross-network pair hears each other. Record latency/dropouts and any fallback used. |
| 45–55 | Submit a clearly labelled synthetic report, review it with real staff, then reconnect one guest. | Reporter gets a durable acknowledgement; reviewer can act; reconnect starts fresh chat without old backlog. |
| 55–60 | Each person names one confusing step and one reason to return. Agree a follow-up activity. | Feedback has an owner; next visit has a purpose beyond testing. |

Run forced-relay camera, session expiry, rollback and incident drills with the
operators before this social session. Avoid making participants sit through
long operational tests or surprise media activation.

## Invitation draft

Replace the bracketed fields and send individually only after readiness gates
pass. No invitations have been sent by preparing this draft.

> Come help us try Stalemate Hang Out on [date, time, time zone]. It's an IRC-style
> place to meet people and make things together. Pick a nick, say hello, and
> start a room—guest chat needs no account. We'll try drawing, watch rooms and
> WebJam music. Desktop music participants: install the tested build for your
> Mac, Windows or Linux system using [private installer instructions].
>
> Your private entrance: [invitation link]. Keep it private. Chat starts when you
> join; earlier conversation isn't replayed. Use a message's report button for
> abuse. [Named reviewers] are covering this session; contact [confirmed inbox]
> if you cannot use the report button. This is a beta, so tell [host] where you
> get stuck. Cameras and microphones are always your choice.

## Acceptance record

Record pass/fail/not run, actual device/OS/browser or installer hash, operator,
time, and a sanitized evidence link. Leave unperformed rows pending. Never
include cookies, invitation fragments, email codes, or private abuse evidence
in public issue attachments.

| Check | Result | Evidence / follow-up owner |
| --- | --- | --- |
| Physical iPhone join, keyboard, background/resume | Pending | |
| Mac package install and actual invitation join | Pending | |
| Windows package install and actual invitation join | Pending | |
| Linux package install and actual invitation join | Pending | |
| Separate-household audio session | Pending | |
| Real owner login and second-device room recovery | Partial | Actual owner callback verified; second-device room recovery pending |
| Real restricted staff login, denied guest/owner, report review | Partial | Actual restricted panel and synthetic queue evidence verified; human disposition and denied-identity acceptance pending |
| Confirmed moderation contact displayed | Verified | [Hosted mail-link check](../pr-assets/beta-collaboration/hosted-ops.json); recheck after changes |
| Reviewer coverage and incident handoff | Pending | Jeff is the sole initial reviewer; agree hours and helper |
| Actual provider watch playback | Pending | |
| Forced-relay camera, consent, provider failure and usage visibility | Pending | |
| Registered-room compatible deployment/recovery | Pending | |
| Operator alert, recovery notification and documented coverage | Partial | Actual installed Mac probes and controlled local notification submissions verified; attended visibility and independent coverage pending |

Ask each participant: Where did you get stuck? What did you make or do with
someone else? What would bring you back? Collect ordinary feedback privately
through the host until a public feedback route is chosen. Abuse reports stay
in the moderation flow, not in a public GitHub issue.

Afterward, remove only synthetic test rooms/content, triage blockers, record
device outcomes and choose one concrete return activity. Invite the next small
cohort after the blocking failures are fixed and reviewed. This document does
not authorize a public launch or substitute for the required human PR review.
