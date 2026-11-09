//! Native wallpaper selection. An MP4 must never be sent to the image provider.
use super::{AnyObject, Retained, s};
use objc2_foundation::{
    NSArray, NSData, NSMutableDictionary, NSPropertyListFormat, NSPropertyListMutabilityOptions,
    NSPropertyListSerialization, NSString, NSURL,
};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

type Dict = NSMutableDictionary;
trait StringFields {
    fn put(&self, key: &NSString, value: &AnyObject);
}
impl StringFields for Dict {
    fn put(&self, key: &NSString, value: &AnyObject) {
        // SAFETY: NSString implements NSCopying; erased dictionary types accept
        // every Objective-C object. Foundation copies keys and retains values.
        unsafe {
            self.setObject_forKey(value, objc2::runtime::ProtocolObject::from_ref(key));
        }
    }
}
const PROVIDER: &str = "glass.kagerou.phosphene.extension";

pub fn documents() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("user home"))
        .join("Library/Containers/glass.kagerou.phosphene.extension/Data/Documents")
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let temp = path.with_extension(format!("phosphene-{}-tmp", std::process::id()));
    let mode = fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o777)
        .unwrap_or(0o600);
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn parse(bytes: &[u8]) -> Result<Retained<AnyObject>, String> {
    // SAFETY: Foundation owns the decoded containers; the optional format pointer is null.
    unsafe {
        NSPropertyListSerialization::propertyListWithData_options_format_error(
            &NSData::with_bytes(bytes),
            NSPropertyListMutabilityOptions::MutableContainers,
            std::ptr::null_mut(),
        )
    }
    .map_err(|e| e.to_string())
}
fn encode(root: &AnyObject) -> Result<Vec<u8>, String> {
    // SAFETY: root and inserted values are valid Foundation property-list types.
    unsafe {
        NSPropertyListSerialization::dataWithPropertyList_format_options_error(
            root,
            NSPropertyListFormat::BinaryFormat_v1_0,
            0,
        )
    }
    .map(|d| d.to_vec())
    .map_err(|e| e.to_string())
}
fn child(dict: &Dict, key: &str) -> Option<Retained<Dict>> {
    dict.objectForKey(&s(key))?.downcast().ok()
}
fn ours(component: &Dict) -> bool {
    let Some(content) = child(component, "Content") else {
        return false;
    };
    let Some(choices) = content.objectForKey(&s("Choices")) else {
        return false;
    };
    let Some(array) = choices.downcast_ref::<NSArray<AnyObject>>() else {
        return false;
    };
    array.iter().any(|c| {
        c.downcast_ref::<Dict>()
            .and_then(|c| c.objectForKey(&s("Provider")))
            .and_then(|v| v.downcast::<NSString>().ok())
            .is_some_and(|v| v.to_string() == PROVIDER)
    })
}
fn component(template: Option<Retained<Dict>>, choice: &Dict) -> Retained<Dict> {
    let c = template.unwrap_or_default();
    let content = child(&c, "Content").unwrap_or_default();
    let choices = NSArray::from_slice(&[choice]);
    content.put(&s("Choices"), &choices);
    c.put(&s("Content"), &content);
    c
}
fn replace_profiles(node: &AnyObject, choice: &Dict) -> usize {
    if let Some(d) = node.downcast_ref::<Dict>() {
        let profile = d
            .objectForKey(&s("Type"))
            .and_then(|v| v.downcast::<NSString>().ok())
            .is_some_and(|v| matches!(v.to_string().as_str(), "linked" | "individual"));
        if profile
            && (child(d, "Desktop").is_some()
                || child(d, "Idle").is_some()
                || child(d, "Linked").is_some())
        {
            let idle = child(d, "Idle");
            // Preserve an independently chosen third-party screensaver.
            if idle.as_ref().is_some_and(|v| !ours(v)) {
                let desktop = component(child(d, "Desktop"), choice);
                d.put(&s("Desktop"), &desktop);
                d.put(&s("Type"), &s("individual"));
            } else {
                let linked = component(
                    child(d, "Linked").or(idle).or_else(|| child(d, "Desktop")),
                    choice,
                );
                d.put(&s("Linked"), &linked);
                d.put(&s("Type"), &s("linked"));
                d.removeObjectForKey(&s("Desktop"));
                d.removeObjectForKey(&s("Idle"));
            }
            return 1;
        }
        let mut count = 0;
        for key in d.allKeys() {
            if let Some(v) = d.objectForKey(&key) {
                count += replace_profiles(&v, choice);
            }
        }
        count
    } else if let Some(array) = node.downcast_ref::<NSArray<AnyObject>>() {
        array.iter().map(|v| replace_profiles(&v, choice)).sum()
    } else {
        0
    }
}
pub fn prepared_store(bytes: &[u8], id: &str, video: &Path) -> Result<(Vec<u8>, usize), String> {
    let root = parse(bytes)?;
    let file = Dict::new();
    let url = NSURL::fileURLWithPath(&s(&video.to_string_lossy()));
    file.put(
        &s("relative"),
        &*url.absoluteString().ok_or("Invalid video URL")?,
    );
    let files = NSArray::from_slice(&[&*file]);
    let choice = Dict::new();
    choice.put(&s("Provider"), &s(PROVIDER));
    choice.put(&s("Configuration"), &NSData::with_bytes(id.as_bytes()));
    choice.put(&s("Files"), &files);
    let count = replace_profiles(&root, &choice);
    if count == 0 {
        return Err("No supported wallpaper profiles found; original settings preserved".into());
    }
    let encoded = encode(&root)?;
    parse(&encoded)?;
    Ok((encoded, count))
}
pub fn apply(id: &str) -> Result<usize, String> {
    if id.len() != 36
        || !id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err("Invalid wallpaper identifier".into());
    }
    let dir = documents().join("videos").join(id);
    let meta: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.join("metadata.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let filename = meta["filename"].as_str().ok_or("Video filename missing")?;
    if filename.contains(['/', '\\']) || matches!(filename, "." | "..") {
        return Err("Unsafe video filename".into());
    }
    let video = dir.join(filename);
    if !video.is_file() {
        return Err("Wallpaper video is missing; original settings preserved".into());
    }
    let store = PathBuf::from(std::env::var_os("HOME").ok_or("No home")?)
        .join("Library/Application Support/com.apple.wallpaper/Store/Index.plist");
    let original = fs::read(&store).map_err(|e| e.to_string())?;
    let (updated, count) = prepared_store(&original, id, &video)?;
    // One bounded rollback for this transaction, rather than a new export/version.
    atomic_write(
        &documents().join("wallpaper-store-before-apply.plist"),
        &original,
    )?;
    if fs::read(&store).map_err(|e| e.to_string())? != original {
        return Err("Wallpaper settings changed concurrently; try applying again".into());
    }
    atomic_write(&store, &updated)?;
    let status = Command::new("/usr/bin/killall")
        .args([
            "-u",
            &std::env::var("USER").unwrap_or_default(),
            "WallpaperAgent",
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        atomic_write(&store, &original)?;
        return Err("WallpaperAgent could not reload; original settings restored".into());
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_failure_keeps_original_and_unowned_temporary() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("phosphene-atomic-{unique}"));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("catalog.json");
        fs::write(&path, b"original").unwrap();
        let temp = path.with_extension(format!("phosphene-{}-tmp", std::process::id()));
        fs::write(&temp, b"other writer").unwrap();
        assert!(atomic_write(&path, b"new").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read(&temp).unwrap(), b"other writer");
        fs::remove_file(temp).unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"new");
        fs::remove_dir_all(dir).unwrap();
    }
    fn xml(body: &str) -> Vec<u8> {
        format!("<?xml version=\"1.0\"?><plist version=\"1.0\"><dict>{body}</dict></plist>")
            .into_bytes()
    }
    #[test]
    fn repairs_video_misclassified_as_image_and_links_native_idle() {
        let data = xml(
            "<key>SystemDefault</key><dict><key>Type</key><string>individual</string><key>Desktop</key><dict><key>Content</key><dict><key>Choices</key><array><dict><key>Provider</key><string>com.apple.wallpaper.choice.image</string></dict></array></dict></dict><key>Idle</key><dict><key>Content</key><dict><key>Choices</key><array><dict><key>Provider</key><string>glass.kagerou.phosphene.extension</string></dict></array></dict></dict></dict><key>Unrelated</key><string>keep</string>",
        );
        let (bytes, n) = prepared_store(&data, "release-id", Path::new("/tmp/movie.mp4")).unwrap();
        assert_eq!(n, 1);
        let root = parse(&bytes).unwrap();
        let d = root.downcast_ref::<Dict>().unwrap();
        let p = child(d, "SystemDefault").unwrap();
        assert!(ours(&child(&p, "Linked").unwrap()));
        assert!(p.objectForKey(&s("Desktop")).is_none());
        assert_eq!(
            d.objectForKey(&s("Unrelated"))
                .unwrap()
                .downcast::<NSString>()
                .unwrap()
                .to_string(),
            "keep"
        );
        let (_, n) = prepared_store(&bytes, "release-id", Path::new("/tmp/movie.mp4")).unwrap();
        assert_eq!(n, 1);
    }
    #[test]
    fn keeps_separate_third_party_screensaver() {
        let data = xml(
            "<key>SystemDefault</key><dict><key>Type</key><string>individual</string><key>Desktop</key><dict/><key>Idle</key><dict><key>Content</key><dict><key>Choices</key><array><dict><key>Provider</key><string>com.example.saver</string></dict></array></dict></dict></dict>",
        );
        let (bytes, _) = prepared_store(&data, "release-id", Path::new("/tmp/movie.mp4")).unwrap();
        let r = parse(&bytes).unwrap();
        let p = child(r.downcast_ref::<Dict>().unwrap(), "SystemDefault").unwrap();
        assert!(ours(&child(&p, "Desktop").unwrap()));
        assert!(!ours(&child(&p, "Idle").unwrap()));
    }
    #[test]
    fn rejects_unrecognized_settings() {
        assert!(
            prepared_store(
                &xml("<key>Other</key><dict/>"),
                "id",
                Path::new("/tmp/movie.mp4")
            )
            .is_err()
        );
    }
}
