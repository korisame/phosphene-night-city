import AppKit
import AVFoundation
import CoreMedia
import Foundation
import Observation
import UniformTypeIdentifiers

// Platform services and private framework boundaries remain Swift. Native Rust
// owns the AppKit view tree and its allocations; no SwiftUI is linked in this host.
@MainActor private var hostManager: PhospheneManager?
@MainActor private var nativeDryRun = false

@_cdecl("phosphene_host_start")
public func phospheneHostStart(_ dryRun: Int32) {
    MainActor.assumeIsolated {
        nativeDryRun = dryRun != 0
        if !nativeDryRun {
            hostManager = PhospheneManager()
            Log.general.notice("Phosphene Native: Rust AppKit controller and Apple service bridge started")
        }
    }
}

@_cdecl("phosphene_host_snapshot")
public func phospheneHostSnapshot() -> UnsafeMutablePointer<CChar>? {
    let serialized: String? = MainActor.assumeIsolated {
        if nativeDryRun {
            if let path = ProcessInfo.processInfo.environment["PHOSPHENE_PREVIEW_FIXTURE"],
               let text = try? String(contentsOfFile: path, encoding: .utf8) { return text }
            return "{\"entries\":[],\"selections\":[],\"dryRun\":true,\"scope\":0,\"version\":\"1.9.0-rust\"}"
        }
        guard let manager = hostManager else { return nil }
        let prefs = manager.prefsService
        let entries = VideoDeploymentService.listEntries().map { entry -> [String: Any] in
            var item: [String: Any] = [
                "id": entry.id, "name": entry.name, "filename": entry.filename,
                "width": entry.resolution.width, "height": entry.resolution.height,
                "fps": entry.fps, "duration": entry.duration,
                "url": VideoDeploymentService.videoURL(for: entry).path,
                "bytes": VideoDeploymentService.fileSize(for: entry) ?? 0,
                "variants": (entry.variants ?? []).map { ["filename": $0.filename, "fps": $0.fps, "width": $0.resolution.width, "height": $0.resolution.height] as [String: Any] },
            ]
            item["thumbnail"] = VideoDeploymentService.thumbnailURL(for: entry.id)?.path
            return item
        }
        let selections = prefs.selections.map { selection -> [String: Any] in
            var item: [String: Any] = ["id": selection.id, "videoID": selection.videoID, "displayID": selection.displayID, "displayName": selection.displayName]
            item["spaceName"] = selection.spaceName
            item["videoName"] = selection.videoName
            item["thumbnail"] = VideoDeploymentService.thumbnailURL(for: selection.videoID)?.path
            item["userPaused"] = prefs.userPaused || prefs.pausedDisplays.contains(selection.displayID)
            item["hidden"] = prefs.fullscreenDisplays.contains(selection.displayID) || (prefs.pauseWhenOccluded && (prefs.desktopOccluded || prefs.occludedDisplays.contains(selection.displayID)))
            return item
        }
        let updates = SilentUpdates.shared
        updates.refresh()
        var state: [String: Any] = [
            "entries": entries, "selections": selections,
            "scope": prefs.userPaused ? 2 : prefs.alwaysPauseDesktop ? 1 : 0,
            "launchAtLogin": manager.launchAtLogin, "pauseWhenOccluded": prefs.pauseWhenOccluded,
            "autoUpdate": manager.autoUpdate, "optimizing": manager.isOptimizing,
            "progress": manager.optimizationProgress,
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.9.0",
        ]
        state["optimizingID"] = manager.optimizingEntryID
        state["codecID"] = selectedCodecID
        state["codec"] = selectedCodec
        if manager.showOptimizationAlert { state["optimizationError"] = manager.optimizationAlertMessage }
        state["updateAvailable"] = updates.availableVersion ?? updates.pendingVersion
        state["justUpdated"] = updates.justUpdatedVersion
        if case let .failed(message) = updates.manualPhase { state["updateFailure"] = message }
        state["updating"] = updates.manualPhase == .working
        guard let data = try? JSONSerialization.data(withJSONObject: state), let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }
    return serialized.flatMap { strdup($0) }
}

@_cdecl("phosphene_host_free")
public func phospheneHostFree(_ pointer: UnsafeMutablePointer<CChar>?) { free(pointer) }

@_cdecl("phosphene_host_action")
public func phospheneHostAction(_ action: Int32, _ payload: UnsafePointer<CChar>?) {
    let text = payload.map(String.init(cString:)) ?? ""
    MainActor.assumeIsolated {
        guard !nativeDryRun, let manager = hostManager else { return }
        let prefs = manager.prefsService
        switch action {
        case 0:
            prefs.userPaused = text == "2"
            prefs.alwaysPauseDesktop = text == "1"
        case 1: manager.launchAtLogin.toggle()
        case 2: prefs.pauseWhenOccluded.toggle()
        case 3: manager.autoUpdate.toggle()
        case 4: prefs.restartWallpaperAgent()

        case 6:
            let parts = text.components(separatedBy: "\n")
            if parts.count >= 2 { VideoDeploymentService.renameEntry(entryID: parts[0], to: parts.dropFirst().joined(separator: "\n")) }
        case 7: manager.removeVideo(entryID: text)
        case 8:
            let parts = text.components(separatedBy: "\n")
            if parts.count == 2 {
                let preset = OptimizationPreset.allCases.first { $0.rawValue == parts[1] } ?? .balanced
                manager.optimizeVideo(entryID: parts[0], preset: preset)
            }
        case 9: manager.cancelOptimization()
        case 10: manager.removeVariants(entryID: text)
        case 11:
            if prefs.userPaused { prefs.userPaused = false }
            else if let displayID = UInt32(text) { prefs.togglePause(displayID: displayID) }
            else { prefs.togglePause() }
        case 12: Task { await SilentUpdates.shared.updateNow() }
        case 13: SilentUpdates.shared.acknowledgeUpdate()
        case 14:
            Task { await manager.importVideo(URL(fileURLWithPath: text)) }
        case 15: loadSelectedCodec(text)
        case 16: manager.showOptimizationAlert = false
        case 17: SilentUpdates.shared.dismissFailure()
        default: break
        }
    }
}

/// Preserve the pasteboard's NSURL and its scoped grant across the Rust/Swift ABI.
/// Rebuilding a path-only URL could lose the sandbox extension attached to a drop.
@_cdecl("phosphene_host_import_url")
public func phospheneHostImportURL(_ pointer: UnsafeRawPointer?) {
    guard let pointer else { return }
    let url = Unmanaged<NSURL>.fromOpaque(pointer).takeUnretainedValue() as URL
    MainActor.assumeIsolated {
        guard !nativeDryRun, let manager = hostManager,
              let type = UTType(filenameExtension: url.pathExtension),
              type.conforms(to: .movie) || type.conforms(to: .video) else { return }
        Task { await manager.importVideo(url) }
    }
}

@MainActor private var selectedCodecID = ""
@MainActor private var selectedCodec = ""
@MainActor private var codecTask: Task<Void, Never>?

@MainActor private func loadSelectedCodec(_ id: String) {
    guard selectedCodecID != id else { return }
    selectedCodecID = id
    selectedCodec = ""
    codecTask?.cancel()
    guard let entry = VideoDeploymentService.listEntries().first(where: { $0.id == id }) else { return }
    let asset = AVURLAsset(url: VideoDeploymentService.videoURL(for: entry))
    codecTask = Task {
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let descriptions = try? await track.load(.formatDescriptions),
              let description = descriptions.first,
              !Task.isCancelled, selectedCodecID == id else { return }
        let code = CMFormatDescriptionGetMediaSubType(description)
        switch code {
        case kCMVideoCodecType_HEVC: selectedCodec = "HEVC"
        case kCMVideoCodecType_H264: selectedCodec = "H.264"
        case kCMVideoCodecType_VP9: selectedCodec = "VP9"
        case kCMVideoCodecType_AV1: selectedCodec = "AV1"
        default:
            selectedCodec = String(bytes: [UInt8((code >> 24) & 255), UInt8((code >> 16) & 255), UInt8((code >> 8) & 255), UInt8(code & 255)], encoding: .ascii) ?? "Unknown"
        }
    }
}
