//! Isolated allocation benchmark: old three-buffer algorithm vs borrowed streaming.
use std::{fs, hint::black_box, path::Path};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("new");
    let width = args
        .get(2)
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(3840);
    let height = args
        .get(3)
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(2160);
    let output = args.get(4).expect("output path");
    let mut source = vec![0u8; width * height * 4];
    for (i, b) in source.iter_mut().enumerate() {
        *b = (i % 251) as u8;
    }
    if mode == "old" {
        let row = (width * 3 + 3) & !3;
        let mut pixels = vec![0u8; row * height];
        for y in 0..height {
            for x in 0..width {
                pixels[y * row + x * 3..y * row + x * 3 + 3]
                    .copy_from_slice(&source[y * width * 4 + x * 4..y * width * 4 + x * 4 + 3]);
            }
        }
        let mut bmp = vec![0u8; 54];
        bmp[..2].copy_from_slice(b"BM");
        bmp[2..6].copy_from_slice(&((54 + pixels.len()) as u32).to_le_bytes());
        bmp[10..14].copy_from_slice(&54u32.to_le_bytes());
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        bmp[18..22].copy_from_slice(&(width as i32).to_le_bytes());
        bmp[22..26].copy_from_slice(&(-(height as i32)).to_le_bytes());
        bmp[26..28].copy_from_slice(&1u16.to_le_bytes());
        bmp[28..30].copy_from_slice(&24u16.to_le_bytes());
        bmp[34..38].copy_from_slice(&(pixels.len() as u32).to_le_bytes());
        bmp.extend_from_slice(&pixels);
        fs::write(output, &bmp).unwrap();
        black_box((&source, &pixels, &bmp));
    } else {
        phosphene_core::write_bmp(Path::new(output), &source, width, height, width * 4).unwrap();
        black_box(&source);
    }
    println!(
        "mode={mode} width={width} height={height} source={} bytes={}",
        source.len(),
        fs::metadata(output).unwrap().len()
    );
}
