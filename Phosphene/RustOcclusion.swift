import CoreGraphics
import Foundation

@_silgen_name("phosphene_occlusion")
nonisolated private func rustOcclusion(_ visible: UnsafeRawPointer, _ full: UnsafeRawPointer, _ windows: UnsafeRawPointer?, _ count: Int) -> UInt32

nonisolated enum RustOcclusion {
    // Four doubles plus one signed 64-bit layer match repr(C) Rust Window.
    struct Window {
        var x: Double, y: Double, width: Double, height: Double
        var layer: Int64
    }
    static func result(full: CGRect, visible: CGRect, windows: [OcclusionMath.Window]) -> UInt32 {
        var fullValues = [Double(full.minX), Double(full.minY), Double(full.width), Double(full.height)]
        var visibleValues = [Double(visible.minX), Double(visible.minY), Double(visible.width), Double(visible.height)]
        let input = windows.map { Window(x: Double($0.rect.minX), y: Double($0.rect.minY), width: Double($0.rect.width), height: Double($0.rect.height), layer: Int64($0.layer)) }
        return fullValues.withUnsafeMutableBytes { fullBuffer in
            visibleValues.withUnsafeMutableBytes { visibleBuffer in
                input.withUnsafeBytes { windowBuffer in
                    unsafe rustOcclusion(visibleBuffer.baseAddress!, fullBuffer.baseAddress!, windowBuffer.baseAddress, input.count)
                }
            }
        }
    }
}
