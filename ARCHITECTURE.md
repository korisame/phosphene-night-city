# Architecture

The native Rust controller constructs the menu-bar popover, Library, inspector,
file import/rename/delete prompts and AVKit preview through AppKit bindings.
`native-rust/bridge/NativeHost.swift` exposes a small C ABI to the existing
AVFoundation, preference, deployment, login and updater services. It is not an
all-Rust rewrite of Apple's private framework integration.

The extension keeps its Swift ExtensionFoundation entry point and private
WallpaperExtensionKit/XPC boundary. Independent computation moves through the
Rust core: playback policy, occlusion coverage, tier selection, ramps,
cancellation and streaming BMP generation. There is no additional resident
UI webview or renderer server.

## Release identities

The application has a semantic version and a build number. The packaging script
derives those values from the Rust controller's sources. Wallpaper releases
have stable revisions keyed by their existing media IDs, recorded in a compatible
`wallpaper-versions.json` sidecar. Latest and currently active releases appear in
the normal Library; History reveals previous entries without deleting media.

The native Apply Wallpaper operation validates the selected media, uses Apple's
Foundation property-list serializer and writes the existing macOS wallpaper
profiles atomically. It assigns the video to the native Phosphene provider,
preserves independently selected third-party screensavers, detects concurrent
store changes and retains one transaction rollback. Its current scope is all
existing desktop profiles, matching Everywhere playback.

## Public build trust boundary

No personal signing identity or provisioning material is included. The public
source's fixed native updater Team pin is the deliberately unconfigured
`LOCALTEAM0`; native-to-official migration therefore fails closed until a
builder deliberately configures a trusted identity in source. It is never taken
from preferences, downloaded metadata or an environment variable. Official
candidate checks remain pinned to the upstream vendor. Automatic official
updates replace the community executable; use deliberate manual deployment when
maintaining this edition. The local installed build is unchanged by publication.

## Wallpaper pipeline

The existing Node/Canvas renderer is retained at its established media boundary;
Rust does not require a rewrite of the illustration/animation pipeline. It loads
registered artwork layers, draws deterministic motion and invokes external
FFmpeg for the final4K H.264 clip. The portable copy uses a pinned npm dependency
and FFmpeg on PATH, with `FFMPEG` as an optional explicit executable override.
No internal home-directory path is required.
