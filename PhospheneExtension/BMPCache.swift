import AVFoundation
import CryptoKit
import Foundation
import ImageIO

/// Load the most recent cached BMP from the Agent's cache directory as a CGImage.
/// Used to set rootLayer.contents as immediate visual content during transitions,
/// matching Apple's "Using existing snapshot as initial wallpaper contents" pattern.
///
/// - Parameter videoID: per-context choice identifier. Each display's acquire
///   passes its own choice so the right cached frame is shown during transitions.
///   Reading the process-wide "current" selection here would race across displays.
func loadCachedSnapshotImage(forChoice videoID: String?) -> CGImage? {
    guard let cacheDir = SurfaceRegistry.shared.cacheDirectoryURL else { return nil }

    let gained = cacheDir.startAccessingSecurityScopedResource()
    defer {
        if gained {
            cacheDir.stopAccessingSecurityScopedResource()
        }
    }

    guard let contents = try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil) else {
        return nil
    }

    let bmpFiles = contents.filter { $0.pathExtension == "bmp" }

    let bmpURL: URL?
    if let videoID {
        let hash = videoHash(for: videoID)
        bmpURL = bmpFiles.first { $0.lastPathComponent.hasPrefix(hash) } ?? bmpFiles.first
    } else {
        bmpURL = bmpFiles.first
    }

    guard let url = bmpURL else { return nil }

    guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
        traceLog("  [InitContent] Failed to decode cached BMP: \(url.lastPathComponent)")
        return nil
    }

    traceLog("  [InitContent] Loaded cached snapshot: \(url.lastPathComponent) (\(cgImage.width)x\(cgImage.height))")
    return cgImage
}

/// Write a BMP snapshot of the video's first frame to the Agent's cache directory.
/// Each video gets its own BMP file (keyed by video ID hash) so the Agent shows
/// the correct cached frame during transitions between videos.
private func performBMPSnapshot(videoURL: URL, videoID: String? = nil, displayPixelWidth: Int, displayPixelHeight: Int) async {
    guard let cacheDir = SurfaceRegistry.shared.cacheDirectoryURL else {
        traceLog("  [BMPCache] No cacheDirectoryURL, skipping")
        return
    }

    let gained = cacheDir.startAccessingSecurityScopedResource()
    defer {
        if gained {
            cacheDir.stopAccessingSecurityScopedResource()
        }
    }

    guard gained else {
        traceLog("  [BMPCache] Failed to acquire security-scoped access")
        return
    }

    let hashHex = videoHash(for: videoID ?? videoURL.lastPathComponent)

    guard displayPixelWidth > 0, displayPixelHeight > 0 else { return }
    let asset = AVURLAsset(url: videoURL)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // Bound extraction to the pixels needed by aspect-fill, retaining all source
    // pixels whenever the display can use them. This never changes video/profile.
    if let track = try? await asset.loadTracks(withMediaType: .video).first,
       let natural = try? await track.load(.naturalSize),
       let transform = try? await track.load(.preferredTransform) {
        let oriented = natural.applying(transform)
        let sourceW = abs(oriented.width), sourceH = abs(oriented.height)
        if sourceW > 0, sourceH > 0 {
            let scale = min(1, max(CGFloat(displayPixelWidth) / sourceW, CGFloat(displayPixelHeight) / sourceH))
            generator.maximumSize = CGSize(width: ceil(sourceW * scale), height: ceil(sourceH * scale))
        }
    }

    // Check if existing BMP for this video already matches requested dimensions
    if let existing = try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil) {
        for bmp in existing where bmp.pathExtension == "bmp" && bmp.lastPathComponent.hasPrefix(hashHex) {
            let components = bmp.deletingPathExtension().lastPathComponent.components(separatedBy: "-")
            // Filename format: <64-char-hash>-<width>-<height>-0-<timestamp>
            if components.count == 5,
               let existingW = Int(components[1]),
               let existingH = Int(components[2]),
               existingW == displayPixelWidth,
               existingH == displayPixelHeight,
               let imageSource = CGImageSourceCreateWithURL(bmp as CFURL, nil),
               let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
               let pixelW = properties[kCGImagePropertyPixelWidth] as? Int,
               let pixelH = properties[kCGImagePropertyPixelHeight] as? Int,
               pixelW <= Int(ceil(generator.maximumSize.width)),
               pixelH <= Int(ceil(generator.maximumSize.height)) {
                traceLog("  [BMPCache] Existing BMP matches \(displayPixelWidth)x\(displayPixelHeight) for \(videoID ?? "?"), skipping")
                return
            }
        }
    }

    let cgImage: CGImage
    do {
        cgImage = try await generator.image(at: .zero).image
    } catch {
        traceLog("  [BMPCache] Failed to get video frame: \(error)")
        return
    }

    let width = cgImage.width
    let height = cgImage.height
    let bytesPerPixel = 3 // 24bpp BGR
    let rawRowBytes = width * bytesPerPixel
    let paddedRowBytes = (rawRowBytes + 3) & ~3
    let pixelDataSize = paddedRowBytes * height

    traceLog("  [BMPCache] Rendering \(width)x\(height) BGR24 (\(pixelDataSize) bytes, row=\(paddedRowBytes))")

    let bgraRowBytes = width * 4
    var bgraData = Data(count: bgraRowBytes * height)
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    let rendered = bgraData.withUnsafeMutableBytes { rawBuf -> Bool in
        guard let ctx = CGContext(
            data: rawBuf.baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bgraRowBytes,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue,
        ) else { return false }
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }

    guard rendered else {
        traceLog("  [BMPCache] CGContext render failed")
        return
    }

    let timestamp = Date().timeIntervalSinceReferenceDate
    let timestampHex = String(format: "%016llx", timestamp.bitPattern)
    let filename = "\(hashHex)-\(displayPixelWidth)-\(displayPixelHeight)-0-\(timestampHex).bmp"
    let bmpURL = cacheDir.appendingPathComponent(filename)
    let result = bgraData.withUnsafeBytes { buffer -> Int32 in
        guard let address = buffer.baseAddress else { return 22 }
        return bmpURL.path.withCString {
            rustWriteBMP($0, address, buffer.count, width, height, bgraRowBytes)
        }
    }
    guard result == 0 else {
        extensionLog("  [BMPCache] Rust atomic streaming write failed: errno \(result)")
        return
    }
    // Only discard older snapshots AFTER the new complete file is visible. A disk
    // failure leaves the previous lock-screen fallback intact.
    if let contents = try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil) {
        for file in contents where file != bmpURL && file.pathExtension == "bmp" && file.lastPathComponent.hasPrefix(hashHex) {
            try? FileManager.default.removeItem(at: file)
        }
    }
    traceLog("  [BMPCache] Streamed \(54 + pixelDataSize) bytes → \(filename)")

    // Write cacheVersion.db
    let versionURL = cacheDir.appendingPathComponent("cacheVersion.db")
    do {
        try Data("{\"version\":2}".utf8).write(to: versionURL, options: .atomic)
    } catch {
        traceLog("  [BMPCache] cacheVersion.db failed: \(error)")
    }
}

/// Generate a consistent hash prefix for a video identifier.
private func videoHash(for identifier: String) -> String {
    let hash = SHA256.hash(data: Data(identifier.utf8))
    return hash.map { String(format: "%02x", $0) }.joined()
}

/// One extraction at a time: concurrent display acquires cannot multiply the full
/// decoded image + BGRA working set. Identical requests share the same Task.
private actor BMPSnapshotQueue {
    static let shared = BMPSnapshotQueue()
    private var tail: Task<Void, Never>?
    private var pending: [String: Task<Void, Never>] = [:]

    func write(videoURL: URL, videoID: String?, width: Int, height: Int) async {
        let key = "\(videoURL.path)|\(videoID ?? "")|\(width)x\(height)"
        if let task = pending[key] { await task.value; return }
        let previous = tail
        let task = Task {
            await previous?.value
            await performBMPSnapshot(videoURL: videoURL, videoID: videoID, displayPixelWidth: width, displayPixelHeight: height)
        }
        pending[key] = task
        tail = task
        await task.value
        pending[key] = nil
        if pending.isEmpty { tail = nil }
    }
}

func writeBMPSnapshot(videoURL: URL, videoID: String? = nil, displayPixelWidth: Int, displayPixelHeight: Int) async {
    await BMPSnapshotQueue.shared.write(videoURL: videoURL, videoID: videoID, width: displayPixelWidth, height: displayPixelHeight)
}
