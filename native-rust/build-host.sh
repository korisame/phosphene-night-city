#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
products="$PWD/rust-release/DerivedData/Build/Products/Release"
profile_lib="$(xcrun clang --print-resource-dir)/lib/darwin/libclang_rt.profile_osx.a"
swiftc -O -whole-module-optimization -j 1 -num-threads 1 -target "${PHOSPHENE_SWIFT_TARGET:-arm64-apple-macos26.0}" -swift-version 6 -default-isolation MainActor \
  -enable-upcoming-feature NonisolatedNonsendingByDefault \
  -emit-library -module-name Phosphene -I "$products" \
  native-rust/bridge/NativeHost.swift \
  Phosphene/PhospheneManager.swift Phosphene/WallpaperPrefsService.swift \
  Phosphene/WallpaperStoreParser.swift Phosphene/OcclusionMonitor.swift \
  Phosphene/OcclusionMath.swift Phosphene/RustOcclusion.swift Phosphene/RustCancellation.swift \
  Phosphene/VideoDeploymentService.swift Phosphene/VideoOptimizationService.swift \
  Phosphene/VideoDisplayName.swift Phosphene/LaunchAtLoginService.swift \
  Phosphene/SilentUpdates.swift Phosphene/Log.swift Phosphene/PathSafety.swift \
  Phosphene/SetWallpaperIntent.swift Phosphene/PhospheneShortcuts.swift \
  Phosphene/WallpaperHistory.swift Phosphene/WallpaperHistoryItem.swift \
  Phosphene/HistoryStorageService.swift Phosphene/SecurityScopedResourceManager.swift \
  PhospheneExtension/RustCore.swift \
  "$products/TiptoeGitHub.o" "$products/Tiptoe.o" "$products/AppUpdater.o" "$products/Version.o" \
  rust-core/target/universal/release/libphosphene_core.a \
  "$profile_lib" \
  -Xlinker -install_name -Xlinker @rpath/libPhospheneNativeHost.dylib \
  -Xlinker -rpath -Xlinker /usr/lib/swift \
  -o "${PHOSPHENE_HOST_OUTPUT:-rust-release/libPhospheneNativeHost.dylib}"
