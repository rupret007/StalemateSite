# Paint Together: starter flow and afro mark

The community's chosen first lesson is **The Grandeur of Summer**. Four editorial
starter picks cover that one-hour special, A Walk in the Woods, Northern Lights
and Grey Winter, with the existing custom YouTube-link route retained. The larger
browser catalogue is preserved separately; the lobby shows the small starter set.
The special is labelled as a special, without invented season/episode numbers.
Existing rooms keep their selected lesson; opening reference information does
not start media or a microphone.

Getting started is optional and collapsible. It links to the official
[Master Paint Set/materials list](https://www.bobross.com/bob-ross-master-paint-set/)
and [painting supplies](https://www.bobross.com/painting-supplies/), checked
November4. The kit is optional. Prices and shopping flows are not embedded.
The official kit page describes Mountain Summit instructions; Grandeur-first is
the community's starter choice, not a quotation claiming otherwise. The user's
book photo is reference context; the scan is not copied into the application.

Official YouTube metadata identified the official Bob Ross channel for all four
IDs. Separate local-app observations used two real provider players for each,
with advancing, unmuted timelines and zero capture requests. This establishes
browser-provider scope only; headless playback does not prove physical lesson
hearing or native WebJam playback. Native references retain the existing mute
and explicit sound-handoff controls. Physical music remains a separate gate.

## Generated artwork

Built-in image_gen created an original transparent mark from the prompt below.
The prior squirrel illustration is preserved in Git history; this replacement
follows the later request for a Bob Ross-style afro. WebJam's main trefoil is
unchanged. The desktop activity mark keeps its established72×48 allocation and
neutral rendering in every native icon state. The browser version is a lossless
WebP encoding; decoded RGBA pixels were compared exactly with the source PNG.

- Native PNG: `webjam_qt/theme/assets/paint_along_mark.png`
- Browser WebP: `paint-together-afro.webp` in the private room runtime directory.
- PNG SHA256: `2b22a624c31ff2ea200f70380cdd6d4455e19b23448a90d138889d02b700e7cf`
- WebP SHA256: `304cfcfe00d136cc577d7824e32fd0e8945f598e9680b043ee08c5ad4d12ed8d`
- 1261×1247 pixels with alpha; PNG1,435,466 bytes / WebP852,272 bytes.

Final generation prompt (built-in mode, transparent_background=true):

```text
Use case: logo-brand. Create one finished transparent PNG activity logo for Paint Together / Paint Along, a friendly shared Bob Ross painting-lesson experience. The mark should look immediately like Bob Ross's iconic very large rounded curly afro: a front-facing, friendly painter's head with the afro dominating the silhouette and a small calm smiling face and short beard below it. Simple bold illustrative logo shapes, clean outlined edges, strong readable silhouette at 32–48 pixels, generous clear padding. Warm brown curls and a light cream face, with a thin light cream outside contour so it remains legible on a near-black UI. No lettering, no words, no watermark, no badge, no solid background, no scene, no forest, no tools. Genuine transparent background. One centered standalone mark only, not a mockup or a sheet of variants.
```

Application source and local renders are distinct from CI, delivered assets and
physical music. Preserve all62 requirements, current session/namespace authority,
AI/media holds and the private-launch boundary. No StoryPool/Karen dispatch.

## Browser validation

Five catalogue/starter unit cases and all four existing open-room browser cases
pass. Four additional375/390 cases pass in Chromium and WebKit, checking the
loaded icon, four picks, focusable optional links, page containment, visible Send
and16px input. These use the offline YouTube fixture; the separate real-provider
observations retain their own scope. Local screenshots of the375px Chromium entry
and390px WebKit expanded guide were inspected: links remain readable and the
composer is retained while the activity pane scrolls. This branch stacks on
IRC workspace204 and needs its own full CI and private delivery.

The first full PR CI at1903b5d failed ten unit cases in job126926697884:
nine playback/media cases still supplied an old partial BobRoss test double,
and the privacy check rejected a private route in this artwork note. The nine
fixture failures reproduced locally before correction. Those fixtures now load
the actual catalogue module rather than duplicating its growing interface.
The note uses only the asset filename; the privacy rule remains unchanged.
All98 cases in the affected watch-controls, media-client, hidden-room and
catalogue modules pass locally. No playback, host-permission, moderation or
privacy assertion was relaxed. The original CI log is retained locally with
SHA256 b35b994b04bf2be3bcc24465452cc01f9887ccdb8960a9e89114331bc31042d5.
