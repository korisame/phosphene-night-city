//! Read-only UI fixture from the existing library; never writes the library.
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(std::env::var_os("HOME").unwrap())
        .join("Library/Containers/glass.kagerou.phosphene.extension/Data/Documents");
    let mut entries = vec![];
    for dir in fs::read_dir(root.join("videos")).unwrap().flatten() {
        let path = dir.path();
        let Ok(bytes) = fs::read(path.join("metadata.json")) else {
            continue;
        };
        let Ok(m) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let filename = m["filename"].as_str().unwrap_or("");
        let variants=m["variants"].as_array().map(|vs|vs.iter().map(|v|json!({"filename":v["filename"],"fps":v["fps"],"width":v["resolution"][0],"height":v["resolution"][1]})).collect::<Vec<_>>()).unwrap_or_default();
        entries.push(json!({"id":m["id"],"name":m["name"],"filename":filename,"width":m["resolution"][0],"height":m["resolution"][1],"fps":m["fps"],"duration":m["duration"],"url":path.join(filename),"thumbnail":path.join("thumbnail.jpg"),"dateAdded":m["dateAdded"],"bytes":fs::metadata(path.join(filename)).map(|m|m.len()).unwrap_or(0),"variants":variants}));
    }
    entries.sort_by(|a, b| {
        a["dateAdded"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&b["dateAdded"].as_f64().unwrap_or(0.0))
    });
    let state: Value =
        serde_json::from_slice(&fs::read(root.join("phosphene-state.json")).unwrap()).unwrap();
    let selections=state["contexts"].as_array().map(|ss|ss.iter().map(|s|json!({"id":s["displayID"].to_string(),"videoID":s["videoID"],"videoName":s["videoName"],"displayID":s["displayID"],"displayName":"Current display","thumbnail":root.join("videos").join(s["videoID"].as_str().unwrap_or("")).join("thumbnail.jpg"),"hidden":false,"userPaused":false})).collect::<Vec<_>>()).unwrap_or_default();
    println!(
        "{}",
        json!({"dryRun":true,"entries":entries,"selections":selections,"scope":0,"version":"1.9.0 Rust preview","launchAtLogin":false,"pauseWhenOccluded":true,"autoUpdate":false,"optimizing":false})
    );
}
