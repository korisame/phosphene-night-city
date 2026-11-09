import Foundation

// The extension retains Apple's ExtensionFoundation/Swift ABI and AVFoundation
// objects. Pure decisions and image-buffer processing execute in the Rust archive.
@_silgen_name("phosphene_policy")
nonisolated func rustPlaybackPolicy(_ mode: UInt32, _ flags: UInt32, _ thermal: UInt32, _ battery: Int32, _ brightness: Float) -> UInt32

@_silgen_name("phosphene_ramp_ease")
nonisolated func rustRampEase(_ t: Double) -> Double

@_silgen_name("phosphene_ramp_rate")
nonisolated func rustRampRate(_ start: Double, _ target: Double, _ progress: Double) -> Double

@_silgen_name("phosphene_variant")
nonisolated func rustVariant(_ policy: UInt32, _ source: Int64, _ fps: UnsafePointer<Int64>?, _ count: Int) -> Int64

@_silgen_name("phosphene_write_bmp")
nonisolated func rustWriteBMP(_ path: UnsafePointer<CChar>, _ bgra: UnsafeRawPointer, _ count: Int, _ width: Int, _ height: Int, _ stride: Int) -> Int32

@_silgen_name("phosphene_surface_reclaim")
nonisolated func rustSurfaceReclaim(_ display: UInt32, _ preview: UInt32, _ online: UInt32, _ offlineMS: UInt64) -> UInt32
