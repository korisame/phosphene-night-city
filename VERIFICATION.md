# Verification

Public-source validation on9November2026, Apple Silicon:

- Rust core tests pass; native controller's7 regression tests pass. They cover
  stable release IDs, active older media, rename preservation, malformed wallpaper
  profiles, atomic file failure/recovery and third-party screensaver preservation.
- AppUpdater suite:88 tests executed,2 signed-app-fixture tests skipped,0 failures.
  Public source intentionally excludes personal signed bundles and credentials.
- The existing installed1.9.1 controller was signature-verified and visually
  checked separately. The v7 master loaded natively on two displays; actual city
  pixels changed in both desktop captures. Startup re-entry left one controller.
  Host, extension and approved product icon were unchanged by that controller repair.
- App-window screenshots and artwork-only images were visually reviewed before
  publication. No private desktop icons, filenames, account UI, notifications,
  provisioning data or full-desktop capture are part of the public assets.

The public source removes the local personal signing pin in favour of a fixed,
unconfigured placeholder. Its tests pass, but the private installed app is not
represented as a public signed/notarized build of this checkout. Intel runtime,
fresh public-source installation, reboot and a new lock/unlock cycle have not
been tested as part of publication. Existing private framework integration is
not a guarantee of future macOS compatibility.

Website checks cover desktop and mobile layouts, overflow, image loading,
user-started video play/pause, History expansion and version-specific download
selection. The public4K master is identified by its SHA-256, with lower-frame-rate
variants and earlier revisions separately named. GitHub Actions reruns source
formatting, Rust tests/lints and web/renderer syntax on changes; passing CI is
not itself desktop playback evidence.

Private machine logs, signing details, system preference dumps and acceptance
captures stay local. They are not included in repository history or release assets.
