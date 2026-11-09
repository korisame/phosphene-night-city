import CoreGraphics
import Foundation

/// The pure geometry of occlusion detection — separated from `OcclusionMonitor`'s
/// window-list plumbing so the thresholds and coverage math can be tested. All
/// rects are CG coordinates (top-left origin); callers pre-filter the window list
/// (regular applications only, layers below the chrome floor).
enum OcclusionMath {
    struct Window: Equatable {
        let rect: CGRect
        let layer: Int

        init(rect: CGRect, layer: Int) {
            self.rect = rect
            self.layer = layer
        }
    }

    /// Grid cell size in points. 8pt gives good precision without excessive memory.
    static let cellSize: CGFloat = 8

    /// A single window owning (nearly) the whole display marks it as running a
    /// fullscreen app:
    ///
    /// - At layer 0 covering ≥99% of the FULL frame, menu bar region included —
    ///   a native fullscreen Space, or a borderless window sized to the display.
    /// - At an elevated layer covering ≥95% of the visible frame — borderless
    ///   fullscreen games: Wine parks them just above the menu bar (Genshin: 26),
    ///   and ordinary app windows never sit at elevated layers, so a maximized
    ///   browser can't trip this.
    static func hasFullscreenApp(full: CGRect, visible: CGRect, windows: [Window]) -> Bool {
        RustOcclusion.result(full: full, visible: visible, windows: windows) & 2 != 0
    }

    /// Rasterize the screen area into a coarse grid and mark cells covered by
    /// windows — the union, so overlapping windows aren't double-counted.
    /// Returns true if ≥95% of cells are covered.
    static func isOccluded(_ screenRect: CGRect, by windows: [Window]) -> Bool {
        RustOcclusion.result(full: screenRect, visible: screenRect, windows: windows) & 1 != 0
    }
}
