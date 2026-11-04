# Private browser ownership integration — November 4

This candidate follows documentation199 and qualified website198. It imports
exact browser runtime bytes from reviewed native source
`01ffdc8b1162dc5ee511de567a86705f305559b6` ([PR423](https://github.com/rupret007/webjam/pull/423)).
That PR merged as`d814a47894dcdb5f954ca557496611a28c107d95`; reviewed, actual CI
checkout17698bd and merge share tree`d1f1fe6559d9931d57a460dfc913de753122c1ca`.

Upstream qualification is now complete: all six protected checks passed;
all559 tracked Python modules ran once in order,12,887 passed/60 existing
skipped. Separate Web Join CI passed25 Node units,74 Worker units and34 Linux
browser cases. The original native bootstrap failure and the earlier failing
ownership regressions remain recorded; none is relabeled as a pass.

All13 runtime/license files match their upstream and shipped SHA256 values in
[join provenance](../join/PROVENANCE.json). The rebuilt private beta package
contains exactly those13 files plus the matching provenance manifest. CSP,
exact relay origin, policy, license and public navigation are unchanged.
No development dependencies or tests are copied into the join package.

The imported runtime keeps status, error, latency and audio-resume completions
with their originating Join attempt. A retired enrollment cannot clear a newer
error or enable Join while its replacement is pending. Late capture releases
its own stream; stats returned after close cannot tune the retired receiver.
Competing microphone checks remain disabled during joining. Permission copy
now explains that Check microphone or Join requests microphone access.

Eight website ownership regressions failed with the older176103a assets before
this import. After import the complete focused website Web Join file passed22
Chromium/WebKit cases without retries, including mic denial/no device,
375/390 wrapping, explicit Retry and capture cleanup. All2,057 units in137
files passed locally, including finite asset graph, hidden-navigation and
public packaging guards. These checks use synthetic capture and mocked
provider/session failures. They do not establish real enrollment or music.

[Sanitized receipt and four reviewed phone captures](../pr-assets/beta-collaboration/20261104/browser-ownership-import/receipt.json).
The captures are scrolled viewport views after explicit Retry, with the Retry
control visible; they are not full-page accessibility or physical iPhone proof.
The earlier failed screenshots/video and all guarded test logs remain private.

This new website tree still needs its own CI; predecessor198's green results
are not its CI. Native424's combined lifecycle changes also remain pending
current-head CI after incorporating merged423 under normal strict protection.
No website main merge, provider activation, build, deployment or public launch
was performed. The infrastructure owner received a read-only readiness request;
delivery of that message does not establish owner execution.

Continue from [the private demo checklist](HANGOUT_PRIVATE_DEMO_PROGRESS_20261104.md).
All62 requirements and public/provider/release holds remain intact. Actual
ARM/Intel/Windows reciprocal music, separate-network use, Linux scope and the
original audit's human/accessibility/capacity/legal gaps remain unqualified.
