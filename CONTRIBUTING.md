# Contributing

This is an independent community adaptation. Report problems in this repository;
do not attribute local Rust/UI changes to the upstream Phosphene author.

Keep patches focused and include OS/tool versions, reproduction steps and the
smallest relevant validation. Preserve existing media formats, stable release
IDs and native lifecycle behavior. Never attach private desktop captures,
wallpaper-store dumps, account details, credentials or signing material.

Before a code contribution:

```sh
cargo fmt --check --manifest-path rust-core/Cargo.toml
cargo fmt --check --manifest-path native-rust/Cargo.toml
cargo test --locked --manifest-path rust-core/Cargo.toml
cargo test --locked --manifest-path native-rust/Cargo.toml --bin phosphene-native
```

Keep upstream/dependency license notices. A code change is not authority to
redistribute third-party artwork. See ARTWORK.md and CREDITS.md before changing
assets. Public screenshots should be app-window-only captures or artwork-only
frames, with metadata removed and a real visual privacy check.
