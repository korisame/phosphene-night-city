#!/bin/zsh
# Builds and signs a separate candidate. Never installs, registers or starts it.
set -euo pipefail
cd "${0:A:h}/.."
export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p rust-release
xcodebuild -project Phosphene.xcodeproj -scheme Phosphene -configuration Release \
  -jobs "${PHOSPHENE_BUILD_JOBS:-1}" \
  -derivedDataPath rust-release/DerivedData -destination 'generic/platform=macOS' \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= build > rust-release/build-universal.log 2>&1
for architecture in arm64 x86_64; do
  if [[ "$architecture" == arm64 ]]; then rust_target=aarch64-apple-darwin; else rust_target=x86_64-apple-darwin; fi
  cargo build --locked --release --manifest-path native-rust/Cargo.toml --target "$rust_target" --bin phosphene-native
  PHOSPHENE_SWIFT_TARGET="$architecture-apple-macos26.0" \
    PHOSPHENE_HOST_OUTPUT="rust-release/libPhospheneNativeHost-$architecture.dylib" \
    native-rust/build-host.sh
 done
xcrun lipo -create native-rust/target/aarch64-apple-darwin/release/phosphene-native \
  native-rust/target/x86_64-apple-darwin/release/phosphene-native -output rust-release/PhospheneNative-universal
xcrun lipo -create rust-release/libPhospheneNativeHost-arm64.dylib \
  rust-release/libPhospheneNativeHost-x86_64.dylib -output rust-release/libPhospheneNativeHost-universal.dylib
stage=$(mktemp -d "$PWD/rust-release/phosphene-stage.XXXXXX")
app="$stage/Phosphene.app"
ditto rust-release/DerivedData/Build/Products/Release/Phosphene.app "$app"
cp rust-release/PhospheneNative-universal "$app/Contents/MacOS/Phosphene"
# Keep Finder, About and the Rust GUI on the same release identity.
app_version=$(cargo metadata --locked --no-deps --format-version 1 --manifest-path native-rust/Cargo.toml | /usr/bin/plutil -extract packages.0.version raw -o - -)
app_build=$(sed -n 's/^const APP_BUILD: &str = "\([^"]*\)";/\1/p' native-rust/src/main.rs)
[[ -n "$app_version" && -n "$app_build" ]]
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $app_version" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $app_build" "$app/Contents/Info.plist"
mkdir -p "$app/Contents/Frameworks"
cp rust-release/libPhospheneNativeHost-universal.dylib "$app/Contents/Frameworks/libPhospheneNativeHost.dylib"
# Activation is selected only by the deployment coordinator; it is sealed at signing.
if [[ "${PHOSPHENE_NATIVE_ACTIVATE:-0}" == 1 ]]; then
  touch "$app/Contents/Resources/NativeReleaseEnabled"
fi
identity="${PHOSPHENE_SIGNING_IDENTITY:--}"
signing_options=()
if [[ "$identity" != - ]]; then signing_options+=(--options runtime); fi
codesign --force --sign "$identity" "${signing_options[@]}" --identifier glass.kagerou.phosphene.native-host \
  "$app/Contents/Frameworks/libPhospheneNativeHost.dylib"
codesign --force --sign "$identity" "${signing_options[@]}" --identifier glass.kagerou.phosphene.extension \
  --entitlements native-rust/PhospheneExtension.entitlements "$app/Contents/Extensions/PhospheneExtension.appex"
codesign --force --sign "$identity" "${signing_options[@]}" --identifier glass.kagerou.phosphene \
  --entitlements Phosphene/Phosphene.entitlements "$app"
codesign --verify --deep --strict --verbose=2 "$app"
candidate="$PWD/rust-release/Phosphene-Rust-Candidate.app"
if [[ -e "$candidate" ]]; then mv "$candidate" "$candidate.previous.$(date +%Y%m%d-%H%M%S)"; fi
mv "$app" "$candidate"
rmdir "$stage"
print "$candidate"
