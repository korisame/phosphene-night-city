//! Stable library release numbers, independent of application build numbers.
use crate::wallpaper;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs};

fn parts(name: &str) -> (String, String, Option<u64>) {
    let p: Vec<_> = name
        .split('·')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect();
    let series = p.first().copied().unwrap_or("Wallpaper").to_string();
    let revision = p
        .iter()
        .find_map(|p| p.strip_prefix('v').and_then(|v| v.parse().ok()));
    let title = p
        .iter()
        .skip(1)
        .filter(|p| {
            **p != "David"
                && **p != "4K"
                && !p
                    .strip_prefix('v')
                    .is_some_and(|v| v.parse::<u64>().is_ok())
        })
        .copied()
        .collect::<Vec<_>>()
        .join(" · ");
    (
        series.clone(),
        if title.is_empty() {
            series.clone()
        } else {
            title
        },
        revision,
    )
}
fn decorate_catalog(state: &mut Value, catalog: &mut Value) -> bool {
    let Some(entries) = state["entries"].as_array_mut() else {
        return false;
    };
    let mut changed = false;
    let mut maximum: BTreeMap<String, u64> = BTreeMap::new();
    if let Some(records) = catalog["releases"].as_object() {
        for r in records.values() {
            if let (Some(series), Some(n)) = (r["series"].as_str(), r["revision"].as_u64()) {
                let m = maximum.entry(series.into()).or_default();
                *m = (*m).max(n);
            }
        }
    }
    // The Apple service supplies entries in deployment-date order. Existing IDs
    // retain their assigned number when reordered, renamed, removed or imported.
    for e in entries.iter() {
        let Some(id) = e["id"].as_str() else {
            continue;
        };
        if catalog["releases"][id].is_object() {
            continue;
        }
        let (series, _, parsed) = parts(e["name"].as_str().unwrap_or("Wallpaper"));
        let next = maximum.entry(series.clone()).or_default();
        let revision = parsed.unwrap_or(*next + 1);
        *next = (*next).max(revision);
        catalog["releases"][id] = json!({"series":series,"revision":revision});
        changed = true;
    }
    // Derive latest from available media, not from a deleted release's counter.
    let mut available: BTreeMap<String, u64> = BTreeMap::new();
    for e in entries.iter() {
        if let Some(id) = e["id"].as_str() {
            let r = &catalog["releases"][id];
            if let (Some(series), Some(n)) = (r["series"].as_str(), r["revision"].as_u64()) {
                let a = available.entry(series.into()).or_default();
                *a = (*a).max(n);
            }
        }
    }
    for e in entries.iter_mut() {
        let Some(id) = e["id"].as_str() else {
            continue;
        };
        let r = &catalog["releases"][id];
        let (Some(series), Some(n)) = (r["series"].as_str(), r["revision"].as_u64()) else {
            continue;
        };
        let original = e["name"].as_str().unwrap_or("Wallpaper").to_string();
        let (_, title, _) = parts(&original);
        e["originalName"] = json!(original);
        e["releaseTitle"] = json!(title);
        e["series"] = json!(series);
        e["revision"] = json!(n);
        e["archived"] = json!(available.get(series).is_some_and(|max| n < *max));
        e["name"] = json!(if series == title {
            format!("{series} · v{n}")
        } else {
            format!("{series} · v{n} · {title}")
        });
    }
    entries.sort_by(|a, b| {
        a["series"]
            .as_str()
            .cmp(&b["series"].as_str())
            .then_with(|| b["revision"].as_u64().cmp(&a["revision"].as_u64()))
    });
    let labels: BTreeMap<_, _> = entries
        .iter()
        .filter_map(|e| Some((e["id"].as_str()?.to_owned(), e["name"].clone())))
        .collect();
    if let Some(selections) = state["selections"].as_array_mut() {
        for s in selections {
            if let Some(name) = s["videoID"].as_str().and_then(|id| labels.get(id)) {
                s["videoName"] = name.clone();
            }
        }
    }
    changed
}
pub fn decorate(mut state: Value, dry: bool) -> Value {
    let path = wallpaper::documents().join("wallpaper-versions.json");
    let mut catalog = match fs::read(&path) {
        Ok(data) => match serde_json::from_slice::<Value>(&data) {
            Ok(v) if v["schemaVersion"] == 1 && v["releases"].is_object() => v,
            _ => {
                state["versioningError"] =
                    json!("Version catalog is invalid; original file preserved");
                return state;
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({"schemaVersion":1,"releases":{}})
        }
        Err(e) => {
            state["versioningError"] = json!(e.to_string());
            return state;
        }
    };
    let changed = decorate_catalog(&mut state, &mut catalog);
    if changed && !dry {
        let result = serde_json::to_vec_pretty(&catalog)
            .map_err(|e| e.to_string())
            .and_then(|bytes| wallpaper::atomic_write(&path, &bytes));
        if let Err(error) = result {
            state["versioningError"] = json!(error);
        }
    }
    state
}
pub fn visible(state: &Value, history: bool) -> Vec<Value> {
    let active: Vec<_> = state["selections"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["videoID"].as_str())
        .collect();
    state["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|e| {
            history
                || !e["archived"].as_bool().unwrap_or(false)
                || e["id"].as_str().is_some_and(|id| active.contains(&id))
        })
        .cloned()
        .collect()
}
pub fn renamed(entry: &Value, title: &str) -> String {
    match (entry["series"].as_str(), entry["revision"].as_u64()) {
        (Some(s), Some(n)) => format!("{s} · v{n} · {}", title.trim()),
        _ => title.trim().into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_releases_and_latest_only() {
        let mut state = json!({"entries":[{"id":"first","name":"City · Fixed camera"},{"id":"second","name":"City · Rain"}],"selections":[]});
        let mut catalog = json!({"schemaVersion":1,"releases":{}});
        assert!(decorate_catalog(&mut state, &mut catalog));
        assert_eq!(visible(&state, false).len(), 1);
        assert_eq!(visible(&state, true).len(), 2);
        assert_eq!(state["entries"][0]["revision"], 2);
        state["entries"].as_array_mut().unwrap().reverse();
        assert!(!decorate_catalog(&mut state, &mut catalog));
        assert_eq!(catalog["releases"]["first"]["revision"], 1);
        state["entries"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"third","name":"City · Blue district"}));
        assert!(decorate_catalog(&mut state, &mut catalog));
        assert_eq!(catalog["releases"]["third"]["revision"], 3);
    }
    #[test]
    fn active_older_release_remains_visible() {
        let mut s = json!({"entries":[{"id":"old","name":"City · Old"},{"id":"new","name":"City · New"}],"selections":[{"videoID":"old"}]});
        let mut c = json!({"releases":{}});
        decorate_catalog(&mut s, &mut c);
        assert_eq!(visible(&s, false).len(), 2);
        assert_eq!(s["selections"][0]["videoName"], "City · v1 · Old");
    }
    #[test]
    fn editing_title_preserves_release_number() {
        assert_eq!(
            renamed(&json!({"series":"City","revision":7}), "New title"),
            "City · v7 · New title"
        );
    }
}
