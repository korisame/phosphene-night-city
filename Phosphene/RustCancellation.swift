import Foundation

@_silgen_name("phosphene_cancel_new")
nonisolated private func rustCancelNew() -> UnsafeMutableRawPointer
@_silgen_name("phosphene_cancel_set")
nonisolated private func rustCancelSet(_ token: UnsafeMutableRawPointer)
@_silgen_name("phosphene_cancel_get")
nonisolated private func rustCancelGet(_ token: UnsafeMutableRawPointer) -> UInt32
@_silgen_name("phosphene_cancel_free")
nonisolated private func rustCancelFree(_ token: UnsafeMutableRawPointer)

/// The Task and AVFoundation dispatch worker share one Rust atomic cancellation bit.
@safe nonisolated final class RustCancellation: @unchecked Sendable {
    private let token = unsafe rustCancelNew()
    func cancel() { unsafe rustCancelSet(token) }
    var isCancelled: Bool { unsafe rustCancelGet(token) != 0 }
    deinit { unsafe rustCancelFree(token) }
}
