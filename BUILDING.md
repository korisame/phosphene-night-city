# Build and use

## Fastest route: use the wallpaper

Download [Night City v7](https://github.com/korisame/phosphene-night-city/releases/tag/wallpaper-v7),
install the [original signed Phosphene](https://kagerou.glass/phosphene/), import
the MP4 with Add Video and select it from Phosphene's System Settings wallpaper
collection. This uses the upstream app; its GUI does not include this edition's
Rust-only changes.

## Rust community application

Requirements: macOS26+, Xcode with the matching Apple SDK/command-line tools,
stable Rust/Cargo and both supported targets. Build from the repository root:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cargo test --locked --manifest-path rust-core/Cargo.toml
cargo test --locked --manifest-path native-rust/Cargo.toml --bin phosphene-native
native-rust/package-release.sh
```

The Xcode build phase calls `build-rust-core.sh`; the packaging script builds
both architectures, the Apple service bridge and extension, then writes a
separate candidate into ignored `rust-release/`. It does not install or register
that candidate. Default signing is ad-hoc. A source-build success does not make
an app Developer-ID-signed or notarized, and an ad-hoc candidate may not load as
a system wallpaper extension.

For a coordinated local deployment, use an appropriate Apple signing identity:

```sh
PHOSPHENE_SIGNING_IDENTITY='YOUR APPLE SIGNING IDENTITY' \
PHOSPHENE_NATIVE_ACTIVATE=1 native-rust/package-release.sh
```

The signed marker enables the Rust controller. Preserve a current installation,
its extension container, videos and settings before changing deployment. Install
only one coordinated Phosphene bundle: the community and upstream apps retain
the same bundle identifiers so existing library and wallpaper mappings survive.
Do not run/register multiple candidates or reset TCC/the global wallpaper store
as an installation shortcut. Verify native provider registration and actual
playback on your own supported OS. This repository deliberately does not ship
certificates, provisioning profiles or a public app binary.

The public source does not contain a personal updater identity. The native
migration pin is unconfigured and fails closed; see [architecture](ARCHITECTURE.md).
Manual upstream updating replaces this Rust executable. It is not a mechanism
for distributing new community builds.

## Rebuild the wallpaper

The existing animation pipeline requires Node with npm, external FFmpeg and the
included artwork layers. This retains the established media stack.

```sh
cd wallpapers/night-city
npm ci
mkdir -p qa
npm run verify:source
npm run draft
# Full128-second4K encode: significantly more CPU time and output storage.
npm run render
```

`FFMPEG=/absolute/path/to/ffmpeg npm run render` overrides the encoder executable.
Generated frames, QA output, dependencies and encoded masters are ignored.
The canonical published v7 file remains the original master and is separately
checksummed in its GitHub release. A rebuild can differ with platform, canvas
or encoder versions; bit-identical encoding is not promised.

## Preview the website

Serve `docs/` with any local static HTTP server. There is no build step, account,
API key or analytics dependency. GitHub Pages publishes that same folder from
`main`. Video starts only after the visitor presses Play, including when reduced
motion is requested. Page source remains readable without JavaScript; the
archive selector requires it, with a GitHub Releases fallback.
