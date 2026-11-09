//! Allocation-sensitive Phosphene core. The C ABI borrows caller-owned buffers.
use std::ffi::{CStr, c_char};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Preview surfaces and surfaces on online displays survive Space/connection changes.
#[unsafe(no_mangle)]
pub extern "C" fn phosphene_surface_reclaim(
    display: u32,
    preview: u32,
    online: u32,
    offline_ms: u64,
) -> u32 {
    u32::from(display != 0 && preview == 0 && online == 0 && offline_ms >= 15_000)
}

#[unsafe(no_mangle)]
pub extern "C" fn phosphene_cancel_new() -> *mut AtomicBool {
    Box::into_raw(Box::new(AtomicBool::new(false)))
}
/// # Safety
/// `token` must be live, returned by `phosphene_cancel_new`, and freed only after all users finish.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_cancel_set(token: *const AtomicBool) {
    if let Some(token) = unsafe { token.as_ref() } {
        token.store(true, Ordering::Release);
    }
}
/// # Safety
/// `token` must be live and returned by `phosphene_cancel_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_cancel_get(token: *const AtomicBool) -> u32 {
    u32::from(unsafe { token.as_ref() }.is_some_and(|t| t.load(Ordering::Acquire)))
}
/// # Safety
/// `token` must be returned by `phosphene_cancel_new`, with all concurrent users finished, and freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_cancel_free(token: *mut AtomicBool) {
    if !token.is_null() {
        drop(unsafe { Box::from_raw(token) });
    }
}

/// Paused=3, minimal=2, reduced=1, full=0. Flags are an explicitly versioned C ABI.
#[unsafe(no_mangle)]
pub extern "C" fn phosphene_policy(
    mode: u32,
    flags: u32,
    thermal: u32,
    battery: i32,
    brightness: f32,
) -> u32 {
    let full_screen = mode == 1 || (mode == 2 && flags & 128 != 0);
    if flags & (1 | 2 | 4) != 0
        || thermal == 3
        || battery < 10
        || brightness < 0.05
        || (mode == 2 && flags & 128 == 0)
        || (!full_screen && (flags & 8 != 0 || flags & 16 != 0 || flags & 32 != 0))
    {
        return 3;
    }
    if thermal == 2 || (flags & 64 != 0 && battery < 20) {
        return 2;
    }
    if thermal == 1 || flags & 64 != 0 {
        return 1;
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn phosphene_ramp_ease(t: f64) -> f64 {
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn phosphene_ramp_rate(start: f64, target: f64, progress: f64) -> f64 {
    start + (target - start) * phosphene_ramp_ease(progress.clamp(0.0, 1.0))
}

/// Return an index into the original array. O(n), stable ties, no sorting/allocation.
/// # Safety
/// `fps` must reference `count` readable i64 elements, or count must be zero.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_variant(
    policy: u32,
    source: i64,
    fps: *const i64,
    count: usize,
) -> i64 {
    if count == 0 || fps.is_null() || policy == 3 {
        return -1;
    }
    let rates = unsafe { slice::from_raw_parts(fps, count) };
    let mut highest = 0;
    let mut lowest = 0;
    let mut below: Option<usize> = None;
    for (i, &rate) in rates.iter().enumerate() {
        if rate > rates[highest] {
            highest = i;
        }
        // Swift's stable descending sort chooses the LAST equal minimum.
        if rate <= rates[lowest] {
            lowest = i;
        }
        if rate < source && below.is_none_or(|j| rate > rates[j]) {
            below = Some(i);
        }
    }
    match policy {
        0 if rates[highest] >= source => highest as i64,
        1 => below.unwrap_or(lowest) as i64,
        2 => lowest as i64,
        _ => -1,
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
impl Rect {
    fn valid(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.w.is_finite()
            && self.h.is_finite()
            && self.w > 0.0
            && self.h > 0.0
    }
    fn clip(self, to: Self) -> Option<Self> {
        let x = self.x.max(to.x);
        let y = self.y.max(to.y);
        let w = (self.x + self.w).min(to.x + to.w) - x;
        let h = (self.y + self.h).min(to.y + to.h) - y;
        if w <= 0.0 || h <= 0.0 {
            None
        } else {
            Some(Self { x, y, w, h })
        }
    }
    fn area(self) -> f64 {
        self.w * self.h
    }
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub rect: Rect,
    pub layer: i64,
}

pub fn occluded(screen: Rect, windows: &[Window]) -> bool {
    if !screen.valid() {
        return false;
    }
    let cols = (screen.w / 8.0).ceil() as usize;
    let rows = (screen.h / 8.0).ceil() as usize;
    let Some(cells) = cols.checked_mul(rows).filter(|&v| v <= 64_000_000) else {
        return false;
    };
    // A u64 bitset replaces Swift's one-byte Bool per grid cell.
    let mut grid = vec![0u64; cells.div_ceil(64)];
    let mut covered = 0usize;
    for window in windows {
        let Some(r) = window.rect.clip(screen) else {
            continue;
        };
        let min_col = (((r.x - screen.x) / 8.0).floor() as isize).max(0) as usize;
        let max_col =
            (((r.x + r.w - screen.x - 0.01) / 8.0).floor() as isize).min(cols as isize - 1);
        let min_row = (((r.y - screen.y) / 8.0).floor() as isize).max(0) as usize;
        let max_row =
            (((r.y + r.h - screen.y - 0.01) / 8.0).floor() as isize).min(rows as isize - 1);
        if max_col < 0 || max_row < 0 {
            continue;
        }
        let max_col = max_col as usize;
        let max_row = max_row as usize;
        if min_col > max_col || min_row > max_row || min_col >= cols || min_row >= rows {
            continue;
        }
        for row in min_row..=max_row {
            for col in min_col..=max_col {
                let bit = row * cols + col;
                let mask = 1u64 << (bit % 64);
                let word = &mut grid[bit / 64];
                if *word & mask == 0 {
                    *word |= mask;
                    covered += 1;
                }
            }
        }
        if covered == cells {
            return true;
        }
    }
    covered as f64 / cells as f64 >= 0.95
}

/// # Safety
/// `windows` must reference `count` initialized Window values; screen/full reference 4 doubles.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_occlusion(
    screen: *const Rect,
    full: *const Rect,
    windows: *const Window,
    count: usize,
) -> u32 {
    if screen.is_null() || full.is_null() || (count != 0 && windows.is_null()) {
        return 0;
    }
    let visible = unsafe { *screen };
    let full = unsafe { *full };
    let windows = if count == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(windows, count) }
    };
    let fullscreen = windows.iter().any(|w| {
        let (reference, fraction) = if w.layer == 0 {
            (full, 0.99)
        } else {
            (visible, 0.95)
        };
        reference.valid()
            && w.rect
                .clip(reference)
                .is_some_and(|r| r.area() >= reference.area() * fraction)
    });
    u32::from(occluded(visible, windows)) | (u32::from(fullscreen) << 1)
}

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// Atomic top-down BGR24 BMP, borrowing BGRA. Additional image memory is one row.
pub fn write_bmp(
    path: &Path,
    bgra: &[u8],
    width: usize,
    height: usize,
    stride: usize,
) -> io::Result<()> {
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid BMP geometry or source buffer",
        )
    };
    if width == 0 || height == 0 || width > i32::MAX as usize || height > i32::MAX as usize {
        return Err(invalid());
    }
    let source_row = width.checked_mul(4).ok_or_else(invalid)?;
    let source_len = stride
        .checked_mul(height - 1)
        .and_then(|v| v.checked_add(source_row))
        .ok_or_else(invalid)?;
    if stride < source_row || bgra.len() < source_len {
        return Err(invalid());
    }
    let row_bytes = width
        .checked_mul(3)
        .and_then(|v| v.checked_add(3))
        .map(|v| v & !3)
        .ok_or_else(invalid)?;
    let pixels = row_bytes.checked_mul(height).ok_or_else(invalid)?;
    let size = pixels
        .checked_add(54)
        .filter(|&v| v <= u32::MAX as usize)
        .ok_or_else(invalid)?;
    let mut header = [0u8; 54];
    header[0..2].copy_from_slice(b"BM");
    header[2..6].copy_from_slice(&(size as u32).to_le_bytes());
    header[10..14].copy_from_slice(&54u32.to_le_bytes());
    header[14..18].copy_from_slice(&40u32.to_le_bytes());
    header[18..22].copy_from_slice(&(width as i32).to_le_bytes());
    header[22..26].copy_from_slice(&(-(height as i32)).to_le_bytes());
    header[26..28].copy_from_slice(&1u16.to_le_bytes());
    header[28..30].copy_from_slice(&24u16.to_le_bytes());
    header[34..38].copy_from_slice(&(pixels as u32).to_le_bytes());
    let parent = path.parent().ok_or_else(invalid)?;
    let temp = parent.join(format!(
        ".phosphene-bmp-{}-{}",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);
        writer.write_all(&header)?;
        let mut row = vec![0u8; row_bytes];
        for y in 0..height {
            let src = &bgra[y * stride..y * stride + source_row];
            for (pixel, output) in src
                .as_chunks::<4>()
                .0
                .iter()
                .zip(row.as_chunks_mut::<3>().0.iter_mut())
            {
                output.copy_from_slice(&pixel[..3]);
            }
            writer.write_all(&row)?;
        }
        writer.flush()?;
        writer.get_ref().sync_all()?;
        fs::rename(&temp, path)?;
        // Sync directory metadata when supported; the image is already atomically published.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

/// # Safety
/// `path` must be NUL-terminated UTF-8 and `bgra` readable for len bytes for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn phosphene_write_bmp(
    path: *const c_char,
    bgra: *const u8,
    len: usize,
    width: usize,
    height: usize,
    stride: usize,
) -> i32 {
    if path.is_null() || bgra.is_null() {
        return 22;
    }
    let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
        return 22;
    };
    let bytes = unsafe { slice::from_raw_parts(bgra, len) };
    match write_bmp(Path::new(path), bytes, width, height, stride) {
        Ok(()) => 0,
        Err(e) => e.raw_os_error().unwrap_or(22),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_surface_grace_preserves_previews_and_online_spaces() {
        for preview in 0..=1 {
            for online in 0..=1 {
                for display in [0, 1, 5, 6] {
                    for elapsed in [0, 14_999, 15_000, 60_000] {
                        let expected =
                            display != 0 && preview == 0 && online == 0 && elapsed >= 15_000;
                        assert_eq!(
                            phosphene_surface_reclaim(display, preview, online, elapsed),
                            u32::from(expected)
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn cancellation_crosses_dispatch_thread_without_task_context() {
        let token = phosphene_cancel_new();
        let address = token as usize;
        assert_eq!(unsafe { phosphene_cancel_get(token) }, 0);
        std::thread::spawn(move || unsafe { phosphene_cancel_set(address as *const AtomicBool) })
            .join()
            .unwrap();
        assert_eq!(unsafe { phosphene_cancel_get(token) }, 1);
        unsafe { phosphene_cancel_free(token) };
    }
    #[test]
    fn lock_and_idle_override_desktop_coverage_but_not_user_pause() {
        for flags in [8, 16, 32, 8 | 16 | 32] {
            assert_eq!(phosphene_policy(0, flags, 0, 100, 1.0), 3);
            assert_eq!(phosphene_policy(1, flags, 0, 100, 1.0), 0);
            assert_eq!(phosphene_policy(2, flags | 128, 0, 100, 1.0), 0);
            assert_eq!(phosphene_policy(2, flags, 0, 100, 1.0), 3);
        }
        assert_eq!(phosphene_policy(1, 1, 0, 100, 1.0), 3);
        assert_eq!(phosphene_policy(1, 0, 3, 100, 1.0), 3);
        assert_eq!(phosphene_policy(1, 0, 0, 9, 1.0), 3);
        assert_eq!(phosphene_policy(0, 64, 0, 19, 1.0), 2);
        assert_eq!(phosphene_policy(0, 64, 0, 20, 1.0), 1);
        assert_eq!(phosphene_policy(0, 0, 0, 100, 0.05), 0);
    }
    #[test]
    fn exhaustive_policy_matches_original_severity_reducer() {
        for mode in 0..4 {
            for flags in 0..256 {
                for thermal in 0..4 {
                    for battery in [0, 9, 10, 19, 20, 100] {
                        for brightness in [0.0, 0.049, 0.05, 1.0] {
                            let full_screen = mode == 1 || (mode == 2 && flags & 128 != 0);
                            let mut expected = 0;
                            if thermal == 1 || flags & 64 != 0 {
                                expected = 1;
                            }
                            if thermal == 2 || (flags & 64 != 0 && battery < 20) {
                                expected = 2;
                            }
                            if flags & 1 != 0
                                || flags & 2 != 0
                                || flags & 4 != 0
                                || thermal == 3
                                || battery < 10
                                || brightness < 0.05
                                || (mode == 2 && flags & 128 == 0)
                                || (!full_screen
                                    && (flags & 8 != 0 || flags & 16 != 0 || flags & 32 != 0))
                            {
                                expected = 3;
                            }
                            assert_eq!(
                                phosphene_policy(mode, flags, thermal, battery, brightness),
                                expected
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn sub_cell_edge_window_preserves_original_grid_epsilon() {
        let screen = Rect {
            x: 0.0,
            y: 0.0,
            w: 8.0,
            h: 8.0,
        };
        let tiny = Window {
            rect: Rect { w: 0.001, ..screen },
            layer: 0,
        };
        assert!(!occluded(screen, &[tiny]));
    }
    #[test]
    fn ramp_endpoints_and_reversal() {
        assert_eq!(phosphene_ramp_rate(0.37, 1.0, -1.0), 0.37);
        assert_eq!(phosphene_ramp_rate(0.37, 1.0, 2.0), 1.0);
        assert!((phosphene_ramp_rate(1.0, 0.0, 0.5) - 0.5).abs() < 1e-12);
    }
    #[test]
    fn unordered_variant_and_ties_match_stable_sort() {
        let rates = [15, 30, 60, 15];
        unsafe {
            assert_eq!(phosphene_variant(0, 60, rates.as_ptr(), rates.len()), 2);
            assert_eq!(phosphene_variant(1, 60, rates.as_ptr(), rates.len()), 1);
            assert_eq!(phosphene_variant(2, 60, rates.as_ptr(), rates.len()), 3);
            assert_eq!(phosphene_variant(3, 60, rates.as_ptr(), rates.len()), -1);
            assert_eq!(phosphene_variant(0, 120, rates.as_ptr(), rates.len()), -1);
        }
    }
    #[test]
    fn union_grid_does_not_double_count_overlap() {
        let screen = Rect {
            x: 0.0,
            y: 24.0,
            w: 2560.0,
            h: 1416.0,
        };
        let half = Window {
            rect: Rect {
                w: 1280.0,
                ..screen
            },
            layer: 0,
        };
        assert!(!occluded(screen, &[half, half, half]));
        let right = Window {
            rect: Rect {
                x: 1280.0,
                ..half.rect
            },
            layer: 0,
        };
        assert!(occluded(screen, &[half, right]));
    }
    #[test]
    fn bmp_padded_rows_channels_orientation_and_atomic_failure() {
        let dir = std::env::temp_dir().join(format!("phosphene-core-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.bmp");
        let source = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
        write_bmp(&path, &source, 2, 2, 8).unwrap();
        let bmp = fs::read(&path).unwrap();
        assert_eq!(bmp.len(), 70);
        assert_eq!(&bmp[22..26], &(-2i32).to_le_bytes());
        assert_eq!(
            &bmp[54..],
            &[1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0]
        );
        assert!(write_bmp(&path, &source[..7], 2, 2, 8).is_err());
        assert_eq!(fs::read(&path).unwrap(), bmp);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
