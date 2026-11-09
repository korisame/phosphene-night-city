#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
export PATH="$HOME/.cargo/bin:$PATH"
architectures="${ARCHS:-arm64 x86_64}"
archives=()
for architecture in ${=architectures}; do
  case "$architecture" in
    arm64) rust_target=aarch64-apple-darwin ;;
    x86_64) rust_target=x86_64-apple-darwin ;;
    *) print -u2 "Unsupported Rust architecture: $architecture"; exit 2 ;;
  esac
  cargo build --locked --lib --release --manifest-path rust-core/Cargo.toml --target "$rust_target"
  archives+=("$PWD/rust-core/target/$rust_target/release/libphosphene_core.a")
done
mkdir -p rust-core/target/universal/release
if (( ${#archives} == 1 )); then
  cp "${archives[1]}" rust-core/target/universal/release/libphosphene_core.a
else
  xcrun lipo -create "${archives[@]}" -output rust-core/target/universal/release/libphosphene_core.a
fi
