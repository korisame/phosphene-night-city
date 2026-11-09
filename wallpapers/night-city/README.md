# Night City · v7 · Blue district

Portable source for the current fixed-camera wallpaper. See the root
[build guide](../../BUILDING.md#rebuild-the-wallpaper),
[artwork provenance](../../ARTWORK.md) and [credits](../../CREDITS.md).

The renderer loads the included illustration layers and deterministic scene
configuration. It draws weather, natural window behavior, screen emission,
character/clothing details, small bridge traffic, lifts and rare city events.
`scene.json` retains internal draft revision22 for provenance; the published
wallpaper release is v7. No passing elevated train is drawn in this release.

Use `npm ci` then `mkdir -p qa`. `npm run verify:source` runs frame-motion checks;
`npm run draft` emits stills; `npm run render` produces the full4K clip through
external FFmpeg. Source layers are retained, encoded output and QA files are
ignored, and downloadable masters live under GitHub Releases.
