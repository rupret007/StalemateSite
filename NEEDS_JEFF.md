# Needs Jeff: Windows native music readiness

Updated October 19, 2026. **Jeff confirmed there is no Windows signing certificate or service on record. Treat current Windows builds as unsigned. Do not purchase, sign up, submit identity/billing information, or start signing without a later explicit decision.** Mac, Windows and Linux remain required for the beta.

## Current blocker

The verified candidate is WebJam source `5effbc58db706254f8ca8b52de4a0520c482294a`, build [39197407138](https://github.com/rupret007/webjam/actions/runs/39197407138). Its unsigned Windows installer can pass installation/launch checks while native remote v3 Join still fails: the bundled `webjam-fabric.exe` must have an Authenticode status of **Valid** before WebJam starts it. That [runtime requirement](https://github.com/rupret007/webjam/blob/5effbc58db706254f8ca8b52de4a0520c482294a/services/transport_runtime.py#L693) stays intact. No v2 substitution or policy bypass.

See [installer evidence](docs/HANGOUT_WEBJAM_INSTALLERS.md) and the [physical acceptance sheet](docs/HANGOUT_BETA_FIRST_SESSION.md). Browser room participation remains separate from native music acceptance.

## Paid signing options — decision only

Prices are advertised US-dollar examples checked October 19, 2026, not quotes or authorization to spend. Taxes, storage, signing volume and term can change the total.

| Option | Cost and owner requirements | Fit and remaining work |
| --- | --- | --- |
| **Microsoft Artifact Signing, formerly Trusted Signing** | Basic **$9.99/month**, 5,000 signatures; $0.005 per additional signature. Public Trust individuals must be in US/Canada, with Azure/Entra, an Individual billing account and matching government-ID validation. | Most direct low-cost paid candidate if Jeff qualifies. Cloud signing needs a reviewed upstream GitHub/OIDC integration; no exportable new PFX assumption. [Price](https://azure.microsoft.com/en-us/products/artifact-signing), [identity requirements](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart). |
| **CA certificate: SSL.com, Sectigo or DigiCert** | SSL.com lists IV/OV **$129/year**, EV **$349/year**, plus storage/signing service (its page displays eSigner from $15/month). Sectigo advertises from **$536.25/year with a five-year term**; shorter terms/EV cost more. DigiCert offers annual certificate/token/KeyLocker combinations; obtain the exact selected total rather than assuming its displayed starting figure covers everything. | CA verifies individual/organization identity as applicable; EV is not required by WebJam's runtime. Hardware-token/HSM or cloud signing needs integration. A newly purchased certificate is not a drop-in exported PFX. [SSL.com](https://www.ssl.com/products/software-integrity/signing-service/), [Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing), [DigiCert](https://www.digicert.com/signing/code-signing-certificates). |

Either route must sign **both WebJam.exe and webjam-fabric.exe**, regenerate the fabric hash manifest, rebuild ZIP/Setup, sign the uninstaller, and retain publisher/trust/timestamp and final installed-artifact checks. Azure rotates short-lived certificates, so a reviewed profile/publisher identity check must replace permanent leaf-thumbprint assumptions without weakening runtime validation. Signing does not itself complete native Join/audio testing or guarantee absence of SmartScreen prompts. [Azure certificate lifecycle](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management).

## Cheapest paths without a certificate

These have **no certificate fee**, but differ in what they can establish. None is already accepted Windows native music support.

| Path | Useful next step | Limit |
| --- | --- | --- |
| **WSL2 + WSLg, Linux package** | Lowest-complexity no-certificate experiment: investigate the unchanged Ubuntu 22.04 x64 package on an attended Windows machine, with isolated settings. WSLg supports Linux GUI applications and audio/microphone integration. | This executes Linux binaries, not the Windows PE. Verify Qt UI, Jamulus/JACK and device routing, microphone/headphones, full v3 Join, cross-network audio, latency/recovery and cleanup. It cannot fill the native Windows acceptance row. [WSL GUI requirements](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps), [WSLg audio](https://github.com/microsoft/wslg). |
| **Podman on Windows** | Possible isolated Linux-container experiment after choosing a reproducible image and explicit GUI/audio/device/network mappings. | Podman uses a Linux VM on Windows. It adds integration work to WSL/virtualization; no working WebJam container or musical-audio result is established. It does not sign or repair the Windows executable. [Podman platform requirements](https://podman.io/docs/installation). |
| **WinGet / Scoop** | Could later automate obtaining a fixed, checksum-verified installer/portable ZIP. | Distribution convenience only: manifests/hashes do not add Authenticode to fabric. Native v3 stays blocked; no package submission or working WebJam package is claimed. [WinGet manifest](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest), [Scoop manifests](https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests). |
| **Documented SmartScreen “Run anyway”** | For an informed tester using the exact verified unsigned candidate: verify its SHA-256 against the installer receipt; if Windows presents that ordinary warning and policy permits, choose **More info → Run anyway** to test installation/launch. | This handles only that OS prompt; it neither signs fabric nor passes WebJam's native v3 guard. Do not disable global protections. Managed policy or Smart App Control may offer no exception. [Microsoft beta guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/publish-first-app), [Smart App Control limits](https://support.microsoft.com/en-gb/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions). |

## Decision to record

**Current decision: unsigned only; no purchase or signup.** If Jeff wants the next no-cost feasibility experiment, prefer WSLg before adding Podman. Record it separately as Linux-on-Windows and preserve the unmet native Windows requirement. WinGet/Scoop or Run Anyway can improve installation instructions, but cannot unblock native remote music.

A later paid decision can select Azure identity onboarding or a specific CA/provider budget. Until then, signing and native Windows v3 remain blocked. No signing workflow, credential configuration, installation experiment, publication or purchase is authorized by this document. Mac and Linux physical installation/Join/audio receipts also remain required.
