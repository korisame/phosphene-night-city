# Wallpaper releases

App: **Phosphene 1.9.1**, build **20261109.1**.
Current wallpaper: **Night City · v7 · Blue district**, 3840 × 2160, 30 fps, 128 seconds.

The app version identifies the player. The wallpaper revision identifies the
artwork. Library normally shows the newest available release of each series and
any older release still in use. **History** reveals all previous releases;
**Apply Wallpaper** loads the selected video through the native wallpaper
provider.

| Release | Title | Duration | Status |
| --- | --- | --- | --- |
| v7 | Blue district | 128 s | Current; no passing train |
| v6 | Living metropolis | 128 s | History; includes the old train effect |
| v5 | Evolving weather | 128 s | History |
| v4 | OLED detail | 128 s | History |
| v3 | After-hours cinema | 128 s | History |
| v2 | OLED midnight | 16 s | History |
| v1 | Fixed camera | 16 s | History |

These are the seven retained, installed releases, numbered by their original
deployment dates. Older development folder numbers, such as `v22`, identify
working drafts and are not installed release numbers. The artwork has not been
rerendered or duplicated for this change.

Revision numbers are persisted by media ID in `wallpaper-versions.json` beside
the existing extension library. Renaming a title does not change its number;
new imports receive the next number in their series. History preserves the
original media and optimization variants.

The desktop-loading repair corrects macOS profiles that mistakenly assigned an
MP4 to the still-image provider. The new Apply action validates the video,
updates native profiles atomically, preserves independent third-party
screensavers and keeps one rollback snapshot. Its scope is all existing
desktop profiles, matching the Everywhere control.
