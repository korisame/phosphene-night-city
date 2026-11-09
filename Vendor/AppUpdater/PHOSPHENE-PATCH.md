# Phosphene official update transition

Upstream AppUpdater 4.2.1, commit a2b89896ebc6c5194b67d38a0481b13b3a311901.
Original Unlicense and upstream source/tests/resources are retained.

Only Phosphene's established bundle/signing identifier is special-cased. Official
candidates must retain the verified vendor Developer ID Application chain and Team
52K336H235. An installed Rust build must carry the sealed NativeReleaseEnabled
marker and an Apple-anchored signature under the fixed local Team LOCALTEAM0 (unconfigured placeholder; deliberately fails closed).
Pins cannot come from preferences, release metadata, environment or a download.

The prepared transaction separately retains the installed native identity and
official candidate identity. Before replacement both are revalidated; after
replacement the official identity is required. Existing rollback, archive/path
limits, all-architecture/nested signature checks and relaunch checks are retained.
Other applications use the upstream same-developer behavior.

The app's manual update prompt explains that an official update replaces the Rust
build. Automatic updates remain at the user's existing off setting; enabling them
requires the same explicit decision in the native menu. Tests validate the archived
official app and local native app without installing either.
