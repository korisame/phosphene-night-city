//! Native AppKit UI. It does not construct a SwiftUI scene or keep an offscreen UI.
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::*;
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize,
    NSString, NSTimer, NSURL,
};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::ffi::{CStr, CString, c_char, c_void};
use std::path::PathBuf;
mod ui;
mod versions;
mod wallpaper;
const APP_BUILD: &str = "20261109.1";

type Start = unsafe extern "C" fn(i32);
type Snapshot = unsafe extern "C" fn() -> *mut c_char;
type Free = unsafe extern "C" fn(*mut c_char);
type Action = unsafe extern "C" fn(i32, *const c_char);
type ImportURL = unsafe extern "C" fn(*const c_void);
struct Host {
    _handle: *mut c_void,
    snapshot: Snapshot,
    free: Free,
    action: Action,
    import_url: ImportURL,
    dry: bool,
}
impl Host {
    fn load(dry: bool) -> Self {
        let exe = std::env::current_exe().unwrap();
        let path = std::env::var_os("PHOSPHENE_NATIVE_HOST")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                exe.parent()
                    .unwrap()
                    .join("../Frameworks/libPhospheneNativeHost.dylib")
            });
        let name = CString::new(path.to_string_lossy().as_bytes()).unwrap();
        unsafe {
            let handle = libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if handle.is_null() {
                panic!(
                    "Cannot load host: {}",
                    CStr::from_ptr(libc::dlerror()).to_string_lossy()
                );
            }
            let symbol = |name: &CStr| {
                let pointer = libc::dlsym(handle, name.as_ptr());
                assert!(
                    !pointer.is_null(),
                    "Missing host export {}",
                    name.to_string_lossy()
                );
                pointer
            };
            let start = std::mem::transmute::<*mut c_void, Start>(symbol(c"phosphene_host_start"));
            let snapshot =
                std::mem::transmute::<*mut c_void, Snapshot>(symbol(c"phosphene_host_snapshot"));
            let free = std::mem::transmute::<*mut c_void, Free>(symbol(c"phosphene_host_free"));
            let action =
                std::mem::transmute::<*mut c_void, Action>(symbol(c"phosphene_host_action"));
            let import_url =
                std::mem::transmute::<*mut c_void, ImportURL>(symbol(c"phosphene_host_import_url"));
            start(i32::from(dry));
            Self {
                _handle: handle,
                snapshot,
                free,
                action,
                import_url,
                dry,
            }
        }
    }
    fn read(&self) -> Value {
        unsafe {
            let p = (self.snapshot)();
            if p.is_null() {
                return json!({});
            }
            let value = serde_json::from_slice(CStr::from_ptr(p).to_bytes()).unwrap_or(json!({}));
            (self.free)(p);
            let mut value = versions::decorate(value, self.dry);
            value["version"] = json!(env!("CARGO_PKG_VERSION"));
            value["build"] = json!(APP_BUILD);
            if !self.dry {
                if let Some(entries) = value["entries"].as_array() {
                    for e in entries {
                        if e["name"] != e["originalName"] && e["originalName"].is_string() {
                            self.act(6, &format!("{}\n{}", text(e, "id"), text(e, "name")));
                        }
                    }
                }
                value["wallpaperActive"] = json!(
                    std::fs::read(wallpaper::documents().join("phosphene-state.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                        .and_then(|v| v["isActive"].as_bool())
                        .unwrap_or(false)
                );
            }
            value
        }
    }
    fn act(&self, action: i32, payload: &str) {
        if let Ok(payload) = CString::new(payload) {
            unsafe { (self.action)(action, payload.as_ptr()) }
        }
    }
}
fn s(v: &str) -> Retained<NSString> {
    NSString::from_str(v)
}
fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_owned()
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}

struct Ivars {
    host: Host,
    status: RefCell<Option<Retained<NSStatusItem>>>,
    menu: RefCell<Option<Retained<NSMenu>>>,
    library: RefCell<Option<Retained<NSWindow>>>,
    scroll: RefCell<Option<Retained<NSScrollView>>>,
    inspector: RefCell<Option<Retained<NSView>>>,
    selected: RefCell<String>,
    state: RefCell<Value>,
    action_payloads: RefCell<Vec<(i32, String)>>,
    player: RefCell<Option<Retained<AnyObject>>>,
    looper: RefCell<Option<Retained<AnyObject>>>,
    playing: Cell<bool>,
    player_id: RefCell<String>,
    player_view: RefCell<Option<Retained<NSView>>>,
    last_library: RefCell<String>,
    grid_fingerprint: RefCell<String>,
    inspector_hidden: Cell<bool>,
    footer: RefCell<Option<Retained<NSTextField>>>,
    timer_count: Cell<u32>,
    library_timer: RefCell<Option<Retained<NSTimer>>>,
    toolbar: RefCell<Option<Retained<NSView>>>,
    inspector_scroll: RefCell<Option<Retained<NSScrollView>>>,
    popover: RefCell<Option<Retained<NSPopover>>>,
    popover_page: Cell<usize>,
    popover_timer: RefCell<Option<Retained<NSTimer>>>,
    popover_fingerprint: RefCell<String>,
    show_history: Cell<bool>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Ivars]
    struct Delegate;
    unsafe impl NSObjectProtocol for Delegate {}
    unsafe impl NSApplicationDelegate for Delegate {
        #[unsafe(method(applicationDidFinishLaunching:))]
        fn launched(&self, _note: &NSNotification) { self.install(); }
        #[unsafe(method(application:openURLs:))]
        fn open_urls(&self, _app: &NSApplication, urls: &objc2_foundation::NSArray<NSURL>) {
            for url in urls {
                let absolute = url.absoluteString().map(|s| s.to_string()).unwrap_or_default();
                if absolute.starts_with("phosphene://add-video") { self.open_chooser(); }
                else if absolute.starts_with("phosphene://") { self.show_library(); }
                else if url.path().is_some() { unsafe { (self.ivars().host.import_url)(Retained::as_ptr(&url).cast()); } self.show_library(); }
            }
        }
    }
    unsafe impl NSMenuDelegate for Delegate {
        #[unsafe(method(menuNeedsUpdate:))]
        fn menu_update(&self, menu: &NSMenu) { self.rebuild_menu(menu); }
        #[unsafe(method(menuDidClose:))]
        fn menu_close(&self, menu: &NSMenu) { menu.removeAllItems(); self.item(menu,"Phosphene",103,"",false); }
    }
    unsafe impl NSWindowDelegate for Delegate {
        #[unsafe(method(windowDidResize:))]
        fn window_resize(&self, _note: &NSNotification) { self.layout_library(); }
        #[unsafe(method(windowWillClose:))]
        fn window_close(&self, _note: &NSNotification) {
            self.stop_player();
            // Release the complete library view tree on the following runloop tick.
            // The next tick sees isVisible=false and drops all strong references.
            NSApplication::sharedApplication(self.mtm()).setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        }
    }
    unsafe impl NSPopoverDelegate for Delegate {
        #[unsafe(method(popoverWillShow:))]
        fn popover_will_show(&self, _note: &NSNotification) {
            let timer=unsafe {NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(1.0,self,sel!(popoverTick:),None,true)};
            *self.ivars().popover_timer.borrow_mut()=Some(timer);
        }
        #[unsafe(method(popoverDidClose:))]
        fn popover_closed(&self, _note: &NSNotification) {
            if let Some(timer)=self.ivars().popover_timer.borrow_mut().take(){timer.invalidate();}
            self.ivars().popover_fingerprint.borrow_mut().clear();
            if let Some(popover) = self.ivars().popover.borrow().as_ref() {
                popover.setContentViewController(None);
            }
        }
    }
    impl Delegate {
        #[unsafe(method(previewPopover:))]
        fn preview_popover(&self, _timer: &NSTimer) {self.toggle_popover();}
        #[unsafe(method(popoverTick:))]
        fn popover_tick(&self, _timer: &NSTimer) {self.refresh_visible_popover();}
        #[unsafe(method(action:))]
        fn action(&self, sender: &AnyObject) {
            let tag: isize = unsafe { msg_send![sender, tag] };
            let payload = self.ivars().action_payloads.borrow().get(tag as usize).cloned();
            let Some((code, payload)) = payload else { return; };
            match code {
                5 => self.open_chooser(),
                100 => self.show_library(),
                101 => self.open_url("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension"),
                102 => NSApplication::sharedApplication(self.mtm()).terminate(None),
                103 => self.show_about(),
                104 => { *self.ivars().selected.borrow_mut() = payload; self.rebuild_grid(); self.rebuild_inspector(); }
                105 => { if self.confirm("Delete Video", "Remove the selected video from your library?", "Delete") { self.ivars().host.act(7, &payload); } }
                106 => self.rename(&payload),
                107 => { self.toggle_player(); self.rebuild_inspector(); },
                108 => self.show_file(&payload),
                109 => { if self.confirm("Remove Variants", "Delete optimized variants and keep the original video?", "Remove") { self.ivars().host.act(10, &payload); } }
                110 => self.show_updates(),
                111 => self.toggle_inspector(),
                112 => { self.toggle_popover(); return; }
                113 => { self.ivars().popover_page.set(self.ivars().popover_page.get()+1); self.rebuild_popover(); return; }
                114 => {
                    // SAFETY: this action is registered only on our live NSSegmentedControl.
                    let selected: isize = unsafe { msg_send![sender, selectedSegment] };
                    self.ivars().host.act(0, &selected.to_string());
                }
                115 => {self.apply_wallpaper(&payload);}
                116 => {self.ivars().show_history.set(!self.ivars().show_history.get());self.rebuild_grid();self.rebuild_inspector();}
                3 => {
                    let enabled = self.ivars().host.read()["autoUpdate"].as_bool().unwrap_or(false);
                    if enabled || self.confirm("Automatic Official Updates", "Official updates are signed by the original developer and replace this Rust build with the official app. Enable automatic installation?", "Enable") {
                        self.ivars().host.act(3, "");
                    }
                }
                _ => self.ivars().host.act(code, &payload),
            }
            self.refresh_library();
            self.refresh_visible_popover();
        }
        #[unsafe(method(shutdown:))]
        fn shutdown(&self, _timer: &NSTimer) { NSApplication::sharedApplication(self.mtm()).terminate(None); }
        #[unsafe(method(badgeTick:))]
        fn badge_tick(&self, _timer: &NSTimer) { self.refresh_badge(); }
        #[unsafe(method(tick:))]
        fn tick(&self, _timer: &NSTimer) {
            let count = self.ivars().timer_count.get() + 1;
            self.ivars().timer_count.set(count);
            if std::env::args().any(|a|a=="--smoke-popover") {
                if count==1 || count==3 {
                    assert!(self.ivars().popover.borrow().as_ref().is_some_and(|p|p.isShown()));
                    self.toggle_popover();
                }
                if count==2 || count==4 {
                    assert!(self.ivars().popover_timer.borrow().is_none());
                    assert!(self.ivars().popover.borrow().as_ref().is_some_and(|p|p.contentViewController().is_none()));
                    if count==2 {self.toggle_popover();} else {
                        println!("{}",json!({"popoverLifecycle":"pass","cycles":2,"contentAndTimerReleased":true}));NSApplication::sharedApplication(self.mtm()).terminate(None);
                    }
                }
            }
            let visible = self.ivars().library.borrow().as_ref().is_some_and(|w| w.isVisible());
            if visible { self.refresh_library(); }
            else if self.ivars().library.borrow().is_some() {
                if let Some(timer) = self.ivars().library_timer.borrow_mut().take() { timer.invalidate(); }
                self.ivars().inspector.borrow_mut().take();
                self.ivars().scroll.borrow_mut().take();
                self.ivars().footer.borrow_mut().take();
                self.ivars().toolbar.borrow_mut().take();
                self.ivars().inspector_scroll.borrow_mut().take();
                self.ivars().library.borrow_mut().take();
                self.ivars().last_library.borrow_mut().clear();
                self.ivars().grid_fingerprint.borrow_mut().clear();
            }
            if std::env::args().any(|a|a=="--smoke-lifecycle") {
                println!("lifecycle_tick={count} visible={visible}");
                if count==1 {
                    self.toggle_inspector();assert!(self.ivars().inspector.borrow().is_none());
                    self.toggle_inspector();assert!(self.ivars().inspector.borrow().is_some());
                }
                if count==2 || count==4 {
                    let window=self.ivars().library.borrow().clone().unwrap();window.close();
                }
                if count==3 || count==5 {
                    assert!(self.ivars().library.borrow().is_none());assert!(self.ivars().inspector.borrow().is_none());
                    assert!(self.ivars().player.borrow().is_none());assert!(self.ivars().scroll.borrow().is_none());assert!(self.ivars().library_timer.borrow().is_none());
                    assert!(self.ivars().toolbar.borrow().is_none());assert!(self.ivars().inspector_scroll.borrow().is_none());
                    if count==3 {self.show_library();} else {
                        println!("{}",json!({"uiLifecycle":"pass","cycles":2,"uiReferencesReleased":true}));NSApplication::sharedApplication(self.mtm()).terminate(None);
                    }
                }
            }
            if count == 1 && std::env::args().any(|a|a=="--smoke-player") { self.toggle_player(); }
            if count == 2 && std::env::args().any(|a| a == "--smoke-ui") {
                if std::env::args().any(|a|a=="--smoke-player") {
                    let status:i64=self.ivars().player.borrow().as_ref().map(|p|unsafe{msg_send![&**p,timeControlStatus]}).unwrap_or(-1);
                    println!("{}",json!({"previewPlayerStatus":status,"playing":self.ivars().playing.get()}));
                    assert_eq!(status,2,"AVPlayer must actually reach playing");
                }
                self.capture_preview();
                let state = self.ivars().state.borrow();
                println!("{}", json!({"uiSmoke":"pass", "entries":state["entries"].as_array().map_or(0,Vec::len), "window":visible,"dryRun":self.ivars().host.dry}));
                NSApplication::sharedApplication(self.mtm()).terminate(None);
            }
            if count.is_multiple_of(60) { self.refresh_badge(); }
        }
    }
);
struct DropIvars {
    delegate: Weak<Delegate>,
}
define_class!(
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[ivars = DropIvars]
    struct DropView;
    unsafe impl NSObjectProtocol for DropView {}
    unsafe impl NSDraggingDestination for DropView {
        #[unsafe(method(draggingEntered:))]
        fn dragging_entered(
            &self,
            _sender: &ProtocolObject<dyn NSDraggingInfo>,
        ) -> NSDragOperation {
            NSDragOperation::Copy
        }
        #[unsafe(method(performDragOperation:))]
        fn perform_drag(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
            let Some(delegate) = self.ivars().delegate.load() else {
                return false.into();
            };
            let Some(items) = sender.draggingPasteboard().pasteboardItems() else {
                return false.into();
            };
            let mut accepted = false;
            for item in items {
                if let Some(value) = item.stringForType(&s("public.file-url"))
                    && let Some(url) = NSURL::URLWithString(&value)
                {
                    unsafe {
                        (delegate.ivars().host.import_url)(Retained::as_ptr(&url).cast());
                    }
                    accepted = true;
                }
            }
            accepted
        }
    }
);
impl DropView {
    fn new(delegate: &Delegate, frame: NSRect) -> Retained<Self> {
        let this = Self::alloc(delegate.mtm()).set_ivars(DropIvars {
            delegate: Weak::new(delegate),
        });
        let this: Retained<Self> = unsafe { msg_send![super(this),initWithFrame:frame] };
        this.registerForDraggedTypes(&objc2_foundation::NSArray::from_retained_slice(&[s(
            "public.file-url",
        )]));
        this
    }
}
impl Delegate {
    fn new(mtm: MainThreadMarker, dry: bool) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars {
            host: Host::load(dry),
            status: RefCell::new(None),
            menu: RefCell::new(None),
            library: RefCell::new(None),
            scroll: RefCell::new(None),
            inspector: RefCell::new(None),
            selected: RefCell::new(String::new()),
            state: RefCell::new(json!({})),
            action_payloads: RefCell::new(vec![]),
            player: RefCell::new(None),
            looper: RefCell::new(None),
            playing: Cell::new(false),
            player_id: RefCell::new(String::new()),
            player_view: RefCell::new(None),
            last_library: RefCell::new(String::new()),
            grid_fingerprint: RefCell::new(String::new()),
            inspector_hidden: Cell::new(false),
            footer: RefCell::new(None),
            timer_count: Cell::new(0),
            library_timer: RefCell::new(None),
            toolbar: RefCell::new(None),
            inspector_scroll: RefCell::new(None),
            popover: RefCell::new(None),
            popover_page: Cell::new(0),
            popover_timer: RefCell::new(None),
            popover_fingerprint: RefCell::new(String::new()),
            show_history: Cell::new(false),
        });
        unsafe { msg_send![super(this), init] }
    }
    fn install(&self) {
        let mtm = self.mtm();
        let status =
            NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
        if let Some(button) = status.button(mtm) {
            button.setImage(Some(&self.menu_icon(false)));
            button.setToolTip(Some(&s(if self.ivars().host.dry {
                "Phosphene Rust preview — no changes"
            } else {
                "Phosphene"
            })));
        }
        let menu = NSMenu::new(mtm);
        menu.setAutoenablesItems(false);
        menu.setDelegate(Some(ProtocolObject::from_ref(self)));
        self.install_main_menu();
        self.item(&menu, "Phosphene", 103, "", false);
        if let Some(button) = status.button(mtm) {
            unsafe {
                button.setTarget(Some(self));
                button.setAction(Some(sel!(action:)));
            }
            button.setTag(self.register(112, ""));
        }
        *self.ivars().status.borrow_mut() = Some(status);
        *self.ivars().menu.borrow_mut() = Some(menu);
        unsafe {
            NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(
                60.0,
                self,
                sel!(badgeTick:),
                None,
                true,
            );
        }
        if let Some(seconds) = std::env::args().find_map(|a| {
            a.strip_prefix("--quit-after=")
                .and_then(|v| v.parse::<f64>().ok())
        }) {
            unsafe {
                NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(
                    seconds,
                    self,
                    sel!(shutdown:),
                    None,
                    false,
                );
            }
        }
        if std::env::args().any(|a| a == "--library") {
            self.show_library();
        }
        if std::env::args().any(|a| a == "--popover") {
            unsafe {
                NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(
                    0.5,
                    self,
                    sel!(previewPopover:),
                    None,
                    false,
                );
            }
        }
        if self.ivars().host.dry && std::env::args().any(|a| a == "--smoke-popover") {
            let timer = unsafe {
                NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(
                    1.0,
                    self,
                    sel!(tick:),
                    None,
                    true,
                )
            };
            *self.ivars().library_timer.borrow_mut() = Some(timer);
        }
        if self.ivars().host.dry && std::env::args().any(|a| a == "--smoke-update-prompt") {
            self.show_updates();
        }
    }
    fn register(&self, code: i32, payload: &str) -> isize {
        let mut actions = self.ivars().action_payloads.borrow_mut();
        if let Some(i) = actions.iter().position(|(c, p)| *c == code && p == payload) {
            return i as isize;
        }
        actions.push((code, payload.to_owned()));
        (actions.len() - 1) as isize
    }
    fn item(&self, menu: &NSMenu, title: &str, code: i32, payload: &str, checked: bool) {
        let action = if code < 0 { None } else { Some(sel!(action:)) };
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(self.mtm()),
                &s(title),
                action,
                &s(""),
            )
        };
        if code >= 0 {
            unsafe {
                item.setTarget(Some(self));
            }
            item.setTag(self.register(code, payload));
        } else {
            item.setEnabled(false);
        }
        if checked {
            item.setState(1);
        }
        menu.addItem(&item);
    }
    fn rebuild_menu(&self, menu: &NSMenu) {
        let state = self.ivars().host.read();
        *self.ivars().state.borrow_mut() = state.clone();
        menu.removeAllItems();
        self.item(menu, "Phosphene", 103, "", false);
        let scope = state["scope"].as_i64().unwrap_or(0);
        if let Some(selections) = state["selections"].as_array() {
            for selection in selections {
                let title = format!(
                    "{} · {}{}",
                    text(selection, "videoName"),
                    text(selection, "displayName"),
                    selection["spaceName"]
                        .as_str()
                        .map(|n| format!(" · {n}"))
                        .unwrap_or_default()
                );
                self.item(menu, &title, -1, "", false);
                if let Some(path) = selection["thumbnail"].as_str()
                    && let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &s(path))
                {
                    image.setSize(NSSize::new(280.0, 157.5));
                    let view = NSImageView::initWithFrame(
                        NSImageView::alloc(self.mtm()),
                        rect(0.0, 0.0, 300.0, 166.0),
                    );
                    view.setImage(Some(&image));
                    let item = NSMenuItem::new(self.mtm());
                    item.setView(Some(&view));
                    menu.addItem(&item);
                }
                let hidden = selection["hidden"].as_bool().unwrap_or(false);
                let paused = selection["userPaused"].as_bool().unwrap_or(false);
                let status = if scope == 1 {
                    "Playing on Lock Screen"
                } else if hidden {
                    "Paused — Display Covered"
                } else if paused {
                    "Resume this display"
                } else {
                    "Pause this display"
                };
                self.item(
                    menu,
                    status,
                    if scope == 1 || hidden { -1 } else { 11 },
                    &selection["displayID"].to_string(),
                    false,
                );
            }
        }
        menu.addItem(&NSMenuItem::separatorItem(self.mtm()));
        for (i, title) in ["Everywhere", "Lock Screen", "Paused"]
            .into_iter()
            .enumerate()
        {
            self.item(menu, title, 0, &i.to_string(), scope == i as i64);
        }
        menu.addItem(&NSMenuItem::separatorItem(self.mtm()));
        self.item(
            menu,
            "Launch at Login",
            1,
            "",
            state["launchAtLogin"].as_bool().unwrap_or(false),
        );
        self.item(
            menu,
            "Pause When Hidden",
            2,
            "",
            state["pauseWhenOccluded"].as_bool().unwrap_or(false),
        );
        self.item(
            menu,
            "Automatic Official Updates",
            3,
            "",
            state["autoUpdate"].as_bool().unwrap_or(false),
        );
        let update = text(&state, "updateAvailable");
        let updated = text(&state, "justUpdated");
        if state["updating"].as_bool().unwrap_or(false) {
            self.item(menu, "Updating…", -1, "", false);
        } else if let Some(message) = state["updateFailure"].as_str() {
            self.item(menu, &format!("Update failed: {message}"), 110, "", false);
        } else if !update.is_empty() || !updated.is_empty() {
            self.item(
                menu,
                &format!(
                    "What's New — {}",
                    if updated.is_empty() {
                        &update
                    } else {
                        &updated
                    }
                ),
                110,
                "",
                false,
            );
        }
        self.item(menu, "Library…", 100, "", false);
        self.item(menu, "Add Video…", 5, "", false);
        self.item(menu, "Choose Wallpaper…", 101, "", false);
        self.item(menu, "Restart Wallpaper Agent", 4, "", false);
        self.item(
            menu,
            &format!("Quit Phosphene {}", text(&state, "version")),
            102,
            "",
            false,
        );
    }
    #[allow(deprecated)]
    fn menu_icon(&self, badge: bool) -> Retained<NSImage> {
        let image = NSImage::initWithSize(NSImage::alloc(), NSSize::new(18.0, 18.0));
        image.lockFocus();
        NSColor::blackColor().setFill();
        NSColor::blackColor().setStroke();
        NSBezierPath::bezierPathWithOvalInRect(rect(7.0, 7.0, 4.0, 4.0)).fill();
        for (radius, arcs) in [
            (4.5, [(20.0, 150.0), (200.0, 330.0)]),
            (7.25, [(80.0, 190.0), (260.0, 10.0)]),
        ] {
            for (start, end) in arcs {
                let path = NSBezierPath::bezierPath();
                path.setLineWidth(1.5);
                path.setLineCapStyle(NSLineCapStyle::Round);
                path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle(
                    NSPoint::new(9.0, 9.0),
                    radius,
                    start,
                    end,
                );
                path.stroke();
            }
        }
        if badge {
            let offset = 7.25 * std::f64::consts::FRAC_1_SQRT_2;
            NSBezierPath::bezierPathWithOvalInRect(rect(
                9.0 + offset - 2.3,
                9.0 + offset - 2.3,
                4.6,
                4.6,
            ))
            .fill();
        }
        image.unlockFocus();
        image.setTemplate(true);
        image
    }
    fn install_main_menu(&self) {
        let main = NSMenu::new(self.mtm());
        let root = NSMenuItem::new(self.mtm());
        let app_menu = NSMenu::new(self.mtm());
        self.item(&app_menu, "About Phosphene", 103, "", false);
        self.item(&app_menu, "Library…", 100, "", false);
        let quit = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(self.mtm()),
                &s("Quit Phosphene"),
                Some(sel!(action:)),
                &s("q"),
            )
        };
        unsafe {
            quit.setTarget(Some(self));
        }
        quit.setTag(self.register(102, ""));
        app_menu.addItem(&quit);
        root.setSubmenu(Some(&app_menu));
        main.addItem(&root);
        let view_root = NSMenuItem::new(self.mtm());
        view_root.setTitle(&s("View"));
        let view_menu = NSMenu::new(self.mtm());
        let toggle = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(self.mtm()),
                &s("Toggle Inspector"),
                Some(sel!(action:)),
                &s("i"),
            )
        };
        toggle.setKeyEquivalentModifierMask(
            NSEventModifierFlags::Command | NSEventModifierFlags::Option,
        );
        unsafe {
            toggle.setTarget(Some(self));
        }
        toggle.setTag(self.register(111, ""));
        view_menu.addItem(&toggle);
        view_root.setSubmenu(Some(&view_menu));
        main.addItem(&view_root);
        NSApplication::sharedApplication(self.mtm()).setMainMenu(Some(&main));
    }
    fn refresh_badge(&self) {
        let state = self.ivars().host.read();
        let badge = state["updateAvailable"].is_string() || state["justUpdated"].is_string();
        if let Some(status) = self.ivars().status.borrow().as_ref()
            && let Some(button) = status.button(self.mtm())
        {
            button.setTitle(&s(if badge { "•" } else { "" }));
        }
    }
    fn label(
        &self,
        parent: &NSView,
        title: &str,
        frame: NSRect,
        size: f64,
    ) -> Retained<NSTextField> {
        let label = NSTextField::labelWithString(&s(title), self.mtm());
        label.setFrame(frame);
        label.setFont(Some(&NSFont::systemFontOfSize(size)));
        label.setMaximumNumberOfLines(0);
        if let Some(cell) = label.cell() {
            cell.setUsesSingleLineMode(false);
            cell.setWraps(true);
            cell.setLineBreakMode(NSLineBreakMode::ByWordWrapping);
            cell.setTruncatesLastVisibleLine(true);
        }
        parent.addSubview(&label);
        label
    }
    fn button(
        &self,
        parent: &NSView,
        title: &str,
        frame: NSRect,
        code: i32,
        payload: &str,
    ) -> Retained<NSButton> {
        let button = unsafe {
            NSButton::buttonWithTitle_target_action(
                &s(title),
                Some(self),
                Some(sel!(action:)),
                self.mtm(),
            )
        };
        button.setBordered(true);
        button.setBezelStyle(NSBezelStyle::Push);
        button.setFont(Some(&NSFont::systemFontOfSize(12.0)));
        button.setFrame(frame);
        button.setTag(self.register(code, payload));
        parent.addSubview(&button);
        button
    }
    fn refresh_library(&self) {
        if self.ivars().library.borrow().is_none() {
            return;
        }
        let state = self.ivars().host.read();
        if let Some(message) = state["optimizationError"].as_str() {
            self.ivars().host.act(16, "");
            let alert = NSAlert::new(self.mtm());
            alert.setMessageText(&s("Optimization Failed"));
            alert.setInformativeText(&s(message));
            alert.runModal();
        }
        // Thumbnails/views are rebuilt only when their model changes.
        let fingerprint = json!([
            state["entries"],
            state["selections"],
            state["optimizing"],
            state["optimizingID"],
            state["progress"],
            state["codec"],
            state["codecID"]
        ])
        .to_string();
        *self.ivars().state.borrow_mut() = state;
        if *self.ivars().last_library.borrow() == fingerprint {
            return;
        }
        *self.ivars().last_library.borrow_mut() = fingerprint;
        let grid_key = json!([
            self.ivars().state.borrow()["entries"],
            self.ivars().state.borrow()["selections"]
        ])
        .to_string();
        if *self.ivars().grid_fingerprint.borrow() != grid_key {
            *self.ivars().grid_fingerprint.borrow_mut() = grid_key;
            self.rebuild_grid();
        }
        self.rebuild_inspector();
    }
    fn open_chooser(&self) {
        // Standard OS file picker, configured directly from Rust with movie/video
        // UTTypes. Transfer NSURL itself so the scoped grant is not lost.
        let panel = NSOpenPanel::openPanel(self.mtm());
        panel.setAllowsMultipleSelection(true);
        panel.setCanChooseDirectories(false);
        unsafe {
            let class = objc2::runtime::AnyClass::get(c"UTType")
                .expect("UniformTypeIdentifiers loaded by Apple host");
            let movie: Retained<AnyObject> =
                msg_send![class,typeWithIdentifier:&*s("public.movie")];
            let video: Retained<AnyObject> =
                msg_send![class,typeWithIdentifier:&*s("public.video")];
            let types = objc2_foundation::NSArray::from_retained_slice(&[movie, video]);
            let _: () = msg_send![&*panel,setAllowedContentTypes:&*types];
        }
        if panel.runModal() == 1 {
            for url in panel.URLs() {
                unsafe {
                    (self.ivars().host.import_url)(Retained::as_ptr(&url).cast());
                }
            }
        }
    }
    fn open_url(&self, url: &str) {
        if let Some(url) = NSURL::URLWithString(&s(url)) {
            NSWorkspace::sharedWorkspace().openURL(&url);
        }
    }
    fn show_file(&self, path: &str) {
        let url = NSURL::fileURLWithPath(&s(path));
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(
            &objc2_foundation::NSArray::from_retained_slice(&[url]),
        );
    }
    fn confirm(&self, title: &str, message: &str, action: &str) -> bool {
        let alert = NSAlert::new(self.mtm());
        alert.setMessageText(&s(title));
        alert.setInformativeText(&s(message));
        alert.addButtonWithTitle(&s(action));
        alert.addButtonWithTitle(&s("Cancel"));
        alert.runModal() == 1000
    }
    fn rename(&self, id: &str) {
        let state = self.ivars().state.borrow().clone();
        let name = state["entries"]
            .as_array()
            .and_then(|es| es.iter().find(|e| text(e, "id") == id))
            .map(|e| text(e, "releaseTitle"))
            .unwrap_or_default();
        let alert = NSAlert::new(self.mtm());
        alert.setMessageText(&s("Rename Video"));
        let field =
            NSTextField::initWithFrame(NSTextField::alloc(self.mtm()), rect(0.0, 0.0, 300.0, 26.0));
        field.setStringValue(&s(&name));
        alert.setAccessoryView(Some(&field));
        alert.addButtonWithTitle(&s("Save"));
        alert.addButtonWithTitle(&s("Cancel"));
        if alert.runModal() == 1000
            && let Some(entry) = state["entries"]
                .as_array()
                .and_then(|es| es.iter().find(|e| text(e, "id") == id))
        {
            let title = field.stringValue().to_string();
            if !title.trim().is_empty() {
                self.ivars()
                    .host
                    .act(6, &format!("{id}\n{}", versions::renamed(entry, &title)));
            }
        }
    }
    fn show_updates(&self) {
        let state = self.ivars().host.read();
        if state["updating"].as_bool().unwrap_or(false) {
            return;
        }
        if state["updateFailure"].is_string() {
            self.ivars().host.act(17, "");
            self.open_url("https://github.com/kageroumado/phosphene/releases/latest");
            return;
        }
        let version = text(&state, "updateAvailable");
        let updated = text(&state, "justUpdated");
        if !updated.is_empty() {
            self.ivars().host.act(13, "");
            self.open_url(&format!(
                "https://github.com/kageroumado/phosphene/releases/tag/v{updated}"
            ));
        } else if !version.is_empty() {
            let alert = NSAlert::new(self.mtm());
            alert.setMessageText(&s(&format!("Phosphene {version}")));
            alert.setInformativeText(&s(
                "This official release is signed by the original developer. Installing it replaces this Rust build with the official app and preserves your library and settings.",
            ));
            alert.addButtonWithTitle(&s("Release Notes"));
            alert.addButtonWithTitle(&s("Install Official Release"));
            alert.addButtonWithTitle(&s("Cancel"));
            match alert.runModal() {
                1000 => self.open_url(&format!(
                    "https://github.com/kageroumado/phosphene/releases/tag/v{version}"
                )),
                1001 => self.ivars().host.act(12, ""),
                _ => {}
            }
        } else {
            self.open_url("https://github.com/kageroumado/phosphene/releases/latest");
        }
    }
    fn capture_preview(&self) {
        let Ok(path) = std::env::var("PHOSPHENE_PREVIEW_PNG") else {
            return;
        };
        let Some(window) = self.ivars().library.borrow().clone() else {
            return;
        };
        let Some(view) = window.contentView() else {
            return;
        };
        let bounds = view.bounds();
        if let Some(rep) = view.bitmapImageRepForCachingDisplayInRect(bounds) {
            view.cacheDisplayInRect_toBitmapImageRep(bounds, &rep);
            let properties = objc2_foundation::NSDictionary::new();
            if let Some(data) = unsafe {
                rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
            } {
                let _ = std::fs::write(path, data.to_vec());
            }
        }
    }
    fn apply_wallpaper(&self, id: &str) {
        if self.ivars().host.dry {
            return;
        }
        match wallpaper::apply(id) {
            Ok(_) => {
                self.ivars().host.act(0, "0");
            }
            Err(error) => {
                let alert = NSAlert::new(self.mtm());
                alert.setMessageText(&s("Could Not Apply Wallpaper"));
                alert.setInformativeText(&s(&error));
                alert.runModal();
            }
        }
    }
    fn show_about(&self) {
        let alert = NSAlert::new(self.mtm());
        alert.setMessageText(&s("Phosphene"));
        alert.setInformativeText(&s(
            &format!("Phosphene {} (build {APP_BUILD})\nAny video as your real macOS wallpaper.\nkagerou.glass / @kageroumado.\nMIT License.",env!("CARGO_PKG_VERSION")),
        ));
        alert.runModal();
    }
    fn stop_player(&self) {
        if let Some(looper) = self.ivars().looper.borrow_mut().take() {
            unsafe {
                let _: () = msg_send![&*looper, disableLooping];
            }
        }
        if let Some(player) = self.ivars().player.borrow_mut().take() {
            unsafe {
                let _: () = msg_send![&*player, pause];
            }
        }
        if let Some(view) = self.ivars().player_view.borrow_mut().take() {
            unsafe {
                let _: () = msg_send![&*view,setPlayer:std::ptr::null::<AnyObject>()];
            }
            view.removeFromSuperview();
        }
        self.ivars().player_id.borrow_mut().clear();
        self.ivars().playing.set(false);
    }
    fn toggle_player(&self) {
        if self.ivars().playing.get() {
            if let Some(player) = self.ivars().player.borrow().as_ref() {
                unsafe {
                    let _: () = msg_send![&**player, pause];
                }
            }
            self.ivars().playing.set(false);
            return;
        }
        if self.ivars().player.borrow().is_none() {
            let state = self.ivars().state.borrow();
            let selected = self.ivars().selected.borrow();
            let Some(entry) = state["entries"]
                .as_array()
                .and_then(|es| es.iter().find(|e| text(e, "id") == *selected))
            else {
                return;
            };
            let url = NSURL::fileURLWithPath(&s(&text(entry, "url")));
            unsafe {
                let item_class = objc2::runtime::AnyClass::get(c"AVPlayerItem").unwrap();
                let queue_class = objc2::runtime::AnyClass::get(c"AVQueuePlayer").unwrap();
                let loop_class = objc2::runtime::AnyClass::get(c"AVPlayerLooper").unwrap();
                let _ = libc::dlopen(
                    c"/System/Library/Frameworks/AVKit.framework/AVKit".as_ptr(),
                    libc::RTLD_LAZY | libc::RTLD_LOCAL,
                );
                let view_class = objc2::runtime::AnyClass::get(c"AVPlayerView");
                let item: Retained<AnyObject> = msg_send![item_class,playerItemWithURL:&*url];
                let player: Retained<AnyObject> =
                    msg_send![queue_class,playerWithPlayerItem:&*item];
                let _: () = msg_send![&*player,setMuted:true];
                let looper: Retained<AnyObject> =
                    msg_send![loop_class,playerLooperWithPlayer:&*player,templateItem:&*item];
                if let (Some(view_class), Some(inspector)) =
                    (view_class, self.ivars().inspector.borrow().as_ref())
                {
                    let view: Retained<NSView> = msg_send![view_class, new];
                    view.setFrame(rect(16.0, 482.0, 300.0, 168.75));
                    let _: () = msg_send![&*view,setPlayer:&*player];
                    let _: () = msg_send![&*view,setControlsStyle:0isize];
                    inspector.addSubview(&view);
                    *self.ivars().player_view.borrow_mut() = Some(view);
                }
                *self.ivars().player_id.borrow_mut() = selected.clone();
                *self.ivars().player.borrow_mut() = Some(player);
                *self.ivars().looper.borrow_mut() = Some(looper);
            }
        }
        if let Some(player) = self.ivars().player.borrow().as_ref() {
            unsafe {
                let _: () = msg_send![&**player, play];
            }
        }
        self.ivars().playing.set(true);
    }
}
fn main() {
    let mtm = MainThreadMarker::new().expect("AppKit must run on main thread");
    if let Some(id) =
        std::env::args().find_map(|a| a.strip_prefix("--apply-wallpaper=").map(str::to_owned))
    {
        match wallpaper::apply(&id) {
            Ok(count) => println!("{}", json!({"applied":id,"profiles":count})),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }
    let dry = std::env::args().any(|a| a == "--preview-no-effects");
    let installed_gate = std::env::current_exe().ok().is_some_and(|p| {
        p.parent()
            .unwrap()
            .join("../Resources/NativeReleaseEnabled")
            .is_file()
    });
    if !dry && !installed_gate && std::env::var("PHOSPHENE_NATIVE_ENABLE").as_deref() != Ok("1") {
        eprintln!(
            "Candidate is staged. Set PHOSPHENE_NATIVE_ENABLE=1 only after signing/registration coordination; --preview-no-effects is isolated."
        );
        std::process::exit(78);
    }
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let delegate = Delegate::new(mtm, dry);
    app.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    app.run();
}
