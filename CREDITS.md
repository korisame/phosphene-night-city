# Credits

## Original software

[Phosphene](https://github.com/kageroumado/phosphene) by **kageroumado** provides
the original application, product icon, Apple wallpaper extension, native service
integration and original UI/source. This community edition is derived from
upstream commit `db03edf` (1.9.0, build22). Original copyright and MIT license
notices remain in [LICENSE](LICENSE); upstream history is retained.

## Community edition

**[korisame](https://github.com/korisame)** — direction, review and curation of the
Night City edition, wallpaper iterations and Rust adaptation.

**OpenAI Codex** — assisted software implementation, procedural animation,
verification and web presentation. Illustration layers were created with AI
assistance for this project, then layered and animated with code. No claim is
made that those illustrations were drawn by the original Phosphene author or
by the official anime artists.

## Creative inspiration

[Cyberpunk: Edgerunners](https://www.cyberpunk.net/en/edgerunners) was created in
collaboration between **CD PROJEKT RED and Studio TRIGGER** and released as a
Netflix anime. This artwork depicts a fan interpretation inspired by that world
and David Martinez. Cyberpunk2077, Night City, characters, trademarks and related
intellectual property remain with their respective owners. This community
project is not affiliated with or endorsed by those companies.

## Type and dependencies

| Component | Authors / upstream | License / notice |
| --- | --- | --- |
| Barlow Condensed | [Barlow Project Authors](https://github.com/jpt/barlow) | [SIL OFL1.1](docs/assets/fonts/OFL.txt), self-hosted unmodified font |
| objc2 and framework bindings | [madsmtm/objc2](https://github.com/madsmtm/objc2) | MIT, dependency manifests/lockfiles |
| Rust, serde_json and libc | Their respective project contributors | Respective upstream notices; dependency lockfiles retained |
| AppUpdater4.2.1 | [mxcl/AppUpdater](https://github.com/mxcl/AppUpdater) | [Unlicense](Vendor/AppUpdater/LICENSE.md); [patch notes](Vendor/AppUpdater/PHOSPHENE-PATCH.md) |
| Tiptoe1.1.0 | [mxcl/Tiptoe](https://github.com/mxcl/Tiptoe) | [Unlicense](Vendor/Tiptoe/LICENSE) |
| Version | [mxcl/Version](https://github.com/mxcl/Version) | Upstream package license; pinned resolution retained |
| Propofol | [kageroumado/propofol](https://github.com/kageroumado/propofol) | Upstream package notice; original app dependency |
| @napi-rs/canvas | [Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas) contributors | MIT; pinned renderer dependency |
| FFmpeg | [FFmpeg contributors](https://ffmpeg.org/) | External build tool, not bundled here; its build configuration governs its license |
| Swift, AppKit, AVFoundation and other Apple frameworks | Apple and Swift contributors | Platform tooling; not redistributed in this source repository |

All credited names identify their actual contribution; none implies endorsement
of this adaptation. Software licensing and the fan-art rights position are
separate: see [ARTWORK.md](ARTWORK.md).
