//! Presentation only. The existing host owns persistence and playback policy.
use super::*;

fn rounded(view: &NSView, radius: f64, color: Option<&NSColor>, border: Option<&NSColor>) {
    view.setWantsLayer(true);
    // SAFETY: AppKit owns the layer on the main thread. CALayer retains its
    // CGColor values; no borrowed Objective-C pointer escapes this call.
    unsafe {
        let layer: Retained<AnyObject> = msg_send![view, layer];
        let _: () = msg_send![&*layer, setCornerRadius:radius];
        let _: () = msg_send![&*layer, setMasksToBounds:true];
        if let Some(color) = color {
            let cg: *const c_void = msg_send![color, CGColor];
            let _: () = msg_send![&*layer, setBackgroundColor:cg];
        }
        if let Some(color) = border {
            let cg: *const c_void = msg_send![color, CGColor];
            let _: () = msg_send![&*layer, setBorderColor:cg];
            let _: () = msg_send![&*layer, setBorderWidth:2.0f64];
        }
    }
}

fn symbol(name: &str) -> Option<Retained<NSImage>> {
    NSImage::imageWithSystemSymbolName_accessibilityDescription(&s(name), None)
}

impl Delegate {
    fn panel(&self, parent: &NSView, frame: NSRect, radius: f64) -> Retained<NSView> {
        let view = NSView::initWithFrame(NSView::alloc(self.mtm()), frame);
        rounded(
            &view,
            radius,
            Some(&NSColor::quaternaryLabelColor().colorWithAlphaComponent(0.07)),
            None,
        );
        parent.addSubview(&view);
        view
    }
    fn title(
        &self,
        parent: &NSView,
        title: &str,
        frame: NSRect,
        size: f64,
    ) -> Retained<NSTextField> {
        let label = self.label(parent, title, frame, size);
        label.setFont(Some(&NSFont::systemFontOfSize_weight(size, unsafe {
            NSFontWeightSemibold
        })));
        label
    }
    fn secondary(
        &self,
        parent: &NSView,
        title: &str,
        frame: NSRect,
        size: f64,
    ) -> Retained<NSTextField> {
        let label = self.label(parent, title, frame, size);
        label.setTextColor(Some(&NSColor::secondaryLabelColor()));
        label
    }
    fn icon_button(
        &self,
        parent: &NSView,
        title: &str,
        icon: &str,
        frame: NSRect,
        code: i32,
        payload: &str,
    ) -> Retained<NSButton> {
        let b = self.button(parent, title, frame, code, payload);
        if let Some(image) = symbol(icon) {
            b.setImage(Some(&image));
            b.setImagePosition(NSCellImagePosition::ImageLeading);
        }
        if title.is_empty() {
            b.setAccessibilityLabel(Some(&s(match icon {
                "info.circle" => "About Phosphene",
                "pencil" => "Rename Video",
                "chevron.right" => "Next Display",
                "play.fill" => "Resume this display",
                "pause.fill" => "Pause this display",
                _ => icon,
            })));
        }
        b
    }
    fn primary(&self, b: &NSButton) {
        b.setBezelColor(Some(&NSColor::controlAccentColor()));
        b.setContentTintColor(Some(&NSColor::whiteColor()));
        b.setFont(Some(&NSFont::systemFontOfSize_weight(12.0, unsafe {
            NSFontWeightSemibold
        })));
    }
    fn thumbnail(
        &self,
        parent: &NSView,
        path: &str,
        frame: NSRect,
        radius: f64,
    ) -> Retained<NSImageView> {
        let view = NSImageView::initWithFrame(NSImageView::alloc(self.mtm()), frame);
        view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
        if let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &s(path)) {
            view.setImage(Some(&image));
        }
        rounded(
            &view,
            radius,
            Some(&NSColor::blackColor().colorWithAlphaComponent(0.12)),
            None,
        );
        parent.addSubview(&view);
        view
    }
    pub(super) fn layout_library(&self) {
        let Some(window) = self.ivars().library.borrow().clone() else {
            return;
        };
        let Some(content) = window.contentView() else {
            return;
        };
        let size = content.bounds().size;
        let grid_top_gap = self
            .ivars()
            .scroll
            .borrow()
            .as_ref()
            .map(|scroll| {
                let b = scroll.contentView().bounds();
                scroll
                    .documentView()
                    .map(|d| (d.bounds().size.height - b.origin.y - b.size.height).max(0.0))
                    .unwrap_or(0.0)
            })
            .unwrap_or(0.0);
        let sidebar = if self.ivars().inspector_hidden.get() {
            0.0
        } else {
            340.0
        };
        if let Some(toolbar) = self.ivars().toolbar.borrow().as_ref() {
            toolbar.setFrame(rect(0.0, size.height - 68.0, size.width, 68.0));
            for view in toolbar.subviews() {
                if view
                    .identifier()
                    .is_some_and(|id| id.to_string() == "inspector-toggle")
                {
                    view.setFrame(rect(size.width - 170.0, 18.0, 146.0, 32.0));
                } else if view
                    .identifier()
                    .is_some_and(|id| id.to_string() == "version-history")
                {
                    view.setFrame(rect(size.width - 320.0, 18.0, 134.0, 32.0));
                }
            }
        }
        if let Some(scroll) = self.ivars().scroll.borrow().as_ref() {
            scroll.setFrame(rect(0.0, 30.0, size.width - sidebar, size.height - 98.0));
        }
        if let Some(scroll) = self.ivars().inspector_scroll.borrow().as_ref() {
            let old = scroll.contentView().bounds();
            let old_height = scroll
                .documentView()
                .map(|v| v.bounds().size.height)
                .unwrap_or(668.0);
            let gap = (old_height - old.origin.y - old.size.height).max(0.0);
            scroll.setFrame(rect(size.width - 340.0, 30.0, 340.0, size.height - 98.0));
            if let Some(doc) = scroll.documentView() {
                let height = 668.0f64.max(scroll.contentView().bounds().size.height);
                doc.setFrameSize(NSSize::new(332.0, height));
                if let Some(body) = self.ivars().inspector.borrow().as_ref() {
                    body.setFrameOrigin(NSPoint::new(0.0, height - 668.0));
                }
            }
            scroll.contentView().scrollToPoint(NSPoint::new(
                0.0,
                (scroll
                    .documentView()
                    .map(|v| v.bounds().size.height)
                    .unwrap_or(668.0)
                    - scroll.contentView().bounds().size.height
                    - gap)
                    .max(0.0),
            ));
        }
        if let Some(footer) = self.ivars().footer.borrow().as_ref() {
            footer.setFrame(rect(20.0, 7.0, size.width - 40.0, 17.0));
        }
        self.rebuild_grid();
        if let Some(scroll) = self.ivars().scroll.borrow().as_ref()
            && let Some(doc) = scroll.documentView()
        {
            scroll.contentView().scrollToPoint(NSPoint::new(
                0.0,
                (doc.bounds().size.height
                    - scroll.contentView().bounds().size.height
                    - grid_top_gap)
                    .max(0.0),
            ));
        }
    }
    pub(super) fn toggle_inspector(&self) {
        let hidden = !self.ivars().inspector_hidden.get();
        self.ivars().inspector_hidden.set(hidden);
        if hidden {
            self.stop_player();
            if let Some(scroll) = self.ivars().inspector_scroll.borrow_mut().take() {
                scroll.removeFromSuperview();
            }
            self.ivars().inspector.borrow_mut().take();
        } else if let Some(window) = self.ivars().library.borrow().as_ref()
            && let Some(content) = window.contentView()
        {
            self.create_inspector(&content);
        }
        self.layout_library();
        self.rebuild_inspector();
    }
    fn create_inspector(&self, content: &NSView) {
        let scroll = NSScrollView::initWithFrame(
            NSScrollView::alloc(self.mtm()),
            rect(760.0, 30.0, 340.0, 650.0),
        );
        scroll.setHasVerticalScroller(true);
        scroll.setAutohidesScrollers(true);
        let doc = NSView::initWithFrame(NSView::alloc(self.mtm()), rect(0.0, 0.0, 332.0, 668.0));
        rounded(&doc, 0.0, Some(&NSColor::controlBackgroundColor()), None);
        let body = NSView::initWithFrame(NSView::alloc(self.mtm()), rect(0.0, 0.0, 332.0, 668.0));
        doc.addSubview(&body);
        scroll.setDocumentView(Some(&doc));
        content.addSubview(&scroll);
        *self.ivars().inspector.borrow_mut() = Some(body);
        *self.ivars().inspector_scroll.borrow_mut() = Some(scroll);
    }
    pub(super) fn show_library(&self) {
        if let Some(popover) = self.ivars().popover.borrow().as_ref() {
            unsafe {
                popover.performClose(None);
            }
        }
        if let Some(window) = self.ivars().library.borrow().as_ref() {
            let app = NSApplication::sharedApplication(self.mtm());
            app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
            window.makeKeyAndOrderFront(None);
            app.activate();
            return;
        }
        self.ivars().inspector_hidden.set(false);
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(self.mtm()),
                rect(0.0, 0.0, 1100.0, 760.0),
                NSWindowStyleMask::Titled
                    | NSWindowStyleMask::Closable
                    | NSWindowStyleMask::Miniaturizable
                    | NSWindowStyleMask::Resizable,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe {
            window.setReleasedWhenClosed(false);
            window.setContentMinSize(NSSize::new(900.0, 640.0));
        }
        if self.ivars().host.dry
            && let Some((w, h)) = std::env::args().find_map(|arg| {
                arg.strip_prefix("--preview-size=")
                    .and_then(|v| v.split_once('x'))
                    .and_then(|(w, h)| Some((w.parse::<f64>().ok()?, h.parse::<f64>().ok()?)))
            })
        {
            window.setContentSize(NSSize::new(w.clamp(900.0, 2000.0), h.clamp(640.0, 1400.0)));
        }
        window.setTitle(&s(&format!("Phosphene {}", env!("CARGO_PKG_VERSION"))));
        window.setDelegate(Some(ProtocolObject::from_ref(self)));
        window.center();
        let content = DropView::new(self, rect(0.0, 0.0, 1100.0, 760.0));
        window.setContentView(Some(&content));
        let toolbar = NSVisualEffectView::initWithFrame(
            NSVisualEffectView::alloc(self.mtm()),
            rect(0.0, 692.0, 1100.0, 68.0),
        );
        toolbar.setMaterial(NSVisualEffectMaterial::HeaderView);
        toolbar.setBlendingMode(NSVisualEffectBlendingMode::WithinWindow);
        content.addSubview(&toolbar);
        self.title(&toolbar, "Library", rect(20.0, 22.0, 104.0, 26.0), 20.0);
        let add = self.icon_button(
            &toolbar,
            "Add Video…",
            "plus",
            rect(132.0, 18.0, 134.0, 32.0),
            5,
            "",
        );
        self.primary(&add);
        self.icon_button(
            &toolbar,
            "System Settings…",
            "gearshape",
            rect(278.0, 18.0, 186.0, 32.0),
            101,
            "",
        );
        let history = self.icon_button(
            &toolbar,
            "History",
            "clock.arrow.circlepath",
            rect(780.0, 18.0, 134.0, 32.0),
            116,
            "",
        );
        history.setIdentifier(Some(&s("version-history")));
        let toggle = self.icon_button(
            &toolbar,
            "Inspector",
            "sidebar.right",
            rect(930.0, 18.0, 146.0, 32.0),
            111,
            "",
        );
        // The layout marker must not replace the action registry tag.
        unsafe {
            let _: () = msg_send![&*toggle,setIdentifier:&*s("inspector-toggle")];
        }
        toggle.setTag(self.register(111, ""));
        *self.ivars().toolbar.borrow_mut() = Some(toolbar.into_super());
        let scroll = NSScrollView::initWithFrame(
            NSScrollView::alloc(self.mtm()),
            rect(0.0, 30.0, 760.0, 662.0),
        );
        scroll.setHasVerticalScroller(true);
        scroll.setAutohidesScrollers(true);
        scroll.setDrawsBackground(false);
        content.addSubview(&scroll);
        *self.ivars().scroll.borrow_mut() = Some(scroll);
        self.create_inspector(&content);
        let footer = self.secondary(&content, "", rect(20.0, 7.0, 1060.0, 17.0), 11.0);
        *self.ivars().footer.borrow_mut() = Some(footer);
        *self.ivars().library.borrow_mut() = Some(window.clone());
        self.refresh_library();
        self.layout_library();
        if let Some(scroll) = self.ivars().inspector_scroll.borrow().as_ref() {
            scroll.contentView().scrollToPoint(NSPoint::new(
                0.0,
                (668.0 - scroll.contentView().bounds().size.height).max(0.0),
            ));
        }
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
        let app = NSApplication::sharedApplication(self.mtm());
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        window.makeKeyAndOrderFront(None);
        app.activate();
    }
    pub(super) fn rebuild_grid(&self) {
        let state = self.ivars().state.borrow();
        let total = state["entries"].as_array().map_or(0, Vec::len);
        let archived = state["entries"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|e| e["archived"].as_bool().unwrap_or(false))
            .count();
        let entries = versions::visible(&state, self.ivars().show_history.get());
        if let Some(toolbar) = self.ivars().toolbar.borrow().as_ref() {
            for v in toolbar.subviews() {
                if v.identifier()
                    .is_some_and(|id| id.to_string() == "version-history")
                    && let Some(b) = v.downcast_ref::<NSButton>()
                {
                    b.setTitle(&s(&format!(
                        "{} ({archived})",
                        if self.ivars().show_history.get() {
                            "Hide History"
                        } else {
                            "History"
                        }
                    )));
                }
            }
        }

        let Some(scroll) = self.ivars().scroll.borrow().clone() else {
            return;
        };
        let viewport = scroll.contentView().bounds().size;
        let columns = ((viewport.width - 24.0) / 236.0).floor().max(1.0) as usize;
        let width =
            ((viewport.width - 40.0 - (columns - 1) as f64 * 16.0) / columns as f64).min(300.0);
        let image_h = width * 9.0 / 16.0;
        let card_h = image_h + 54.0;
        let row_h = card_h + 20.0;
        let height =
            (entries.len().div_ceil(columns).max(1) as f64 * row_h + 20.0).max(viewport.height);
        let document = NSView::initWithFrame(
            NSView::alloc(self.mtm()),
            rect(0.0, 0.0, viewport.width, height),
        );
        if let Some(footer) = self.ivars().footer.borrow().as_ref() {
            footer.setStringValue(&s(&format!("{} of {total} releases · {archived} previous versions in History · Phosphene {} (build {APP_BUILD})",entries.len(),env!("CARGO_PKG_VERSION"))));
            if let Some(error) = state["versioningError"].as_str() {
                footer.setStringValue(&s(error));
            }
        }
        let selected = self.ivars().selected.borrow().clone();
        if entries.iter().all(|e| text(e, "id") != selected) {
            *self.ivars().selected.borrow_mut() = state["selections"]
                .as_array()
                .and_then(|v| v.first())
                .map(|v| text(v, "videoID"))
                .or_else(|| entries.first().map(|v| text(v, "id")))
                .unwrap_or_default();
        }
        if entries.is_empty() {
            self.title(
                &document,
                "No Videos",
                rect(24.0, height - 110.0, 400.0, 30.0),
                22.0,
            );
            self.secondary(
                &document,
                "Add a video to use as your wallpaper.",
                rect(24.0, height - 145.0, 430.0, 30.0),
                13.0,
            );
            let b = self.icon_button(
                &document,
                "Add Video…",
                "plus",
                rect(24.0, height - 190.0, 150.0, 32.0),
                5,
                "",
            );
            self.primary(&b);
        }
        for (i, e) in entries.iter().enumerate() {
            let id = text(e, "id");
            let selected = id == *self.ivars().selected.borrow();
            let used = state["selections"]
                .as_array()
                .is_some_and(|v| v.iter().any(|v| text(v, "videoID") == id));
            let x = 20.0 + (i % columns) as f64 * (width + 16.0);
            let y = height - 20.0 - card_h - (i / columns) as f64 * row_h;
            let card = self.panel(&document, rect(x, y, width, card_h), 12.0);
            if selected {
                rounded(
                    &card,
                    12.0,
                    Some(&NSColor::controlAccentColor().colorWithAlphaComponent(0.12)),
                    Some(&NSColor::controlAccentColor()),
                );
            }
            self.thumbnail(
                &card,
                &text(e, "thumbnail"),
                rect(5.0, 49.0, width - 10.0, image_h - 5.0),
                8.0,
            );
            let name = self.title(
                &card,
                &text(e, "name"),
                rect(10.0, 9.0, width - 20.0, 34.0),
                12.0,
            );
            name.setMaximumNumberOfLines(2);
            if used {
                let badge = self.panel(&card, rect(width - 34.0, 57.0, 24.0, 24.0), 12.0);
                rounded(&badge, 12.0, Some(&NSColor::controlAccentColor()), None);
                let icon = NSImageView::initWithFrame(
                    NSImageView::alloc(self.mtm()),
                    rect(5.0, 5.0, 14.0, 14.0),
                );
                icon.setImage(symbol("checkmark").as_deref());
                icon.setContentTintColor(Some(&NSColor::whiteColor()));
                badge.addSubview(&icon);
            }
            let click = self.button(
                &card,
                &text(e, "name"),
                rect(0.0, 0.0, width, card_h),
                104,
                &id,
            );
            click.setTransparent(true);
            click.setBordered(false);
            click.setToolTip(Some(&s(&format!(
                "{}{}",
                text(e, "name"),
                if used { " · In use as wallpaper" } else { "" }
            ))));
            click.setState(if selected { 1 } else { 0 });
        }
        let old = scroll.contentView().bounds().origin;
        let first = scroll.documentView().is_none();
        scroll.setDocumentView(Some(&document));
        scroll.contentView().scrollToPoint(if first {
            NSPoint::new(0.0, (height - viewport.height).max(0.0))
        } else {
            NSPoint::new(old.x, old.y.min((height - viewport.height).max(0.0)))
        });
        scroll.reflectScrolledClipView(&scroll.contentView());
    }
    pub(super) fn rebuild_inspector(&self) {
        let Some(view) = self.ivars().inspector.borrow().clone() else {
            return;
        };
        let state = self.ivars().state.borrow().clone();
        let id = self.ivars().selected.borrow().clone();
        if *self.ivars().player_id.borrow() != id {
            self.stop_player();
        }
        for child in view.subviews() {
            child.removeFromSuperview();
        }
        self.ivars().host.act(15, &id);
        let Some(e) = state["entries"]
            .as_array()
            .and_then(|es| es.iter().find(|e| text(e, "id") == id))
        else {
            self.secondary(
                &view,
                "Select a video to view its details.",
                rect(20.0, 580.0, 290.0, 50.0),
                14.0,
            );
            return;
        };
        self.thumbnail(
            &view,
            &text(e, "thumbnail"),
            rect(16.0, 482.0, 300.0, 168.75),
            10.0,
        );
        if let Some(player) = self.ivars().player_view.borrow().as_ref() {
            rounded(player, 10.0, None, None);
            view.addSubview(player);
        }
        let overlay = self.panel(&view, rect(144.0, 544.0, 44.0, 44.0), 22.0);
        rounded(
            &overlay,
            22.0,
            Some(&NSColor::blackColor().colorWithAlphaComponent(0.60)),
            None,
        );
        let play = self.icon_button(
            &overlay,
            "",
            if self.ivars().playing.get() {
                "pause.fill"
            } else {
                "play.fill"
            },
            rect(0.0, 0.0, 44.0, 44.0),
            107,
            "",
        );
        play.setBordered(false);
        play.setContentTintColor(Some(&NSColor::whiteColor()));
        play.setImagePosition(NSCellImagePosition::ImageOnly);
        play.setAccessibilityLabel(Some(&s(if self.ivars().playing.get() {
            "Pause Preview"
        } else {
            "Play Preview"
        })));
        if let Some(image) = play.image() {
            image.setSize(NSSize::new(18.0, 18.0));
        }
        let name = self.title(
            &view,
            &text(e, "name"),
            rect(16.0, 430.0, 262.0, 42.0),
            14.0,
        );
        name.setMaximumNumberOfLines(2);
        let rename = self.icon_button(
            &view,
            "",
            "pencil",
            rect(284.0, 438.0, 32.0, 28.0),
            106,
            &id,
        );
        rename.setToolTip(Some(&s("Rename Video")));
        let specs = [
            format!("{} × {}", e["width"], e["height"]),
            format!("{} fps", e["fps"]),
            format!("{:.1}s", e["duration"].as_f64().unwrap_or(0.0)),
            format!(
                "{:.1} MB {}",
                e["bytes"].as_f64().unwrap_or(0.0) / 1_000_000.0,
                if text(&state, "codecID") == id {
                    text(&state, "codec")
                } else {
                    String::new()
                }
            ),
        ];
        for (i, value) in specs.iter().enumerate() {
            let chip = self.panel(
                &view,
                rect(
                    16.0 + (i % 2) as f64 * 154.0,
                    394.0 - (i / 2) as f64 * 29.0,
                    146.0,
                    24.0,
                ),
                6.0,
            );
            self.secondary(&chip, value, rect(8.0, 4.0, 130.0, 16.0), 11.0);
        }
        let usage = state["selections"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter(|v| text(v, "videoID") == id)
                    .map(|v| text(v, "displayName"))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        if !usage.is_empty() {
            let card = self.panel(&view, rect(16.0, 300.0, 300.0, 54.0), 9.0);
            self.title(
                &card,
                "In use as wallpaper",
                rect(12.0, 29.0, 278.0, 18.0),
                11.0,
            );
            self.secondary(&card, &usage, rect(12.0, 8.0, 278.0, 18.0), 11.0);
        }
        let opt = self.panel(&view, rect(16.0, 128.0, 300.0, 160.0), 10.0);
        self.title(&opt, "Optimization", rect(12.0, 129.0, 276.0, 20.0), 13.0);
        let optimizing =
            state["optimizing"].as_bool().unwrap_or(false) && text(&state, "optimizingID") == id;
        if optimizing {
            self.secondary(
                &opt,
                &format!(
                    "Optimizing… {:.0}%",
                    state["progress"].as_f64().unwrap_or(0.0) * 100.0
                ),
                rect(12.0, 95.0, 270.0, 20.0),
                12.0,
            );
            let progress = NSProgressIndicator::initWithFrame(
                NSProgressIndicator::alloc(self.mtm()),
                rect(12.0, 78.0, 276.0, 8.0),
            );
            progress.setIndeterminate(false);
            progress.setDoubleValue(state["progress"].as_f64().unwrap_or(0.0) * 100.0);
            opt.addSubview(&progress);
            self.button(&opt, "Cancel", rect(12.0, 20.0, 276.0, 30.0), 9, "");
        } else if let Some(variants) = e["variants"].as_array().filter(|v| !v.is_empty()) {
            let lines = variants
                .iter()
                .map(|v| format!("{} fps · {} × {}", v["fps"], v["width"], v["height"]))
                .collect::<Vec<_>>()
                .join("\n");
            self.secondary(&opt, &lines, rect(12.0, 65.0, 276.0, 52.0), 12.0);
            self.icon_button(
                &opt,
                "Remove Variants…",
                "minus.circle",
                rect(12.0, 15.0, 276.0, 30.0),
                109,
                &id,
            );
        } else {
            for (i, preset) in ["Battery Saver", "Balanced", "Quality"].iter().enumerate() {
                self.button(
                    &opt,
                    preset,
                    rect(10.0 + i as f64 * 94.0, 87.0, 92.0, 28.0),
                    8,
                    &format!("{id}\n{preset}"),
                );
            }
            self.secondary(
                &opt,
                "Create efficient FPS variants. Balanced and Quality preserve source resolution.",
                rect(12.0, 19.0, 276.0, 54.0),
                11.0,
            );
        }
        let apply = self.icon_button(
            &view,
            "Apply Wallpaper",
            "desktopcomputer",
            rect(16.0, 79.0, 300.0, 34.0),
            115,
            &id,
        );
        self.primary(&apply);
        self.icon_button(
            &view,
            "Show in Finder",
            "folder",
            rect(16.0, 33.0, 146.0, 30.0),
            108,
            &text(e, "url"),
        );
        let delete = self.icon_button(
            &view,
            "Delete…",
            "trash",
            rect(170.0, 33.0, 146.0, 30.0),
            105,
            &id,
        );
        delete.setContentTintColor(Some(&NSColor::systemRedColor()));
    }
    pub(super) fn toggle_popover(&self) {
        if let Some(p) = self.ivars().popover.borrow().as_ref()
            && p.isShown()
        {
            unsafe {
                p.performClose(None);
            }
            return;
        }
        if self.ivars().popover.borrow().is_none() {
            let p = NSPopover::new(self.mtm());
            p.setBehavior(NSPopoverBehavior::Transient);
            p.setDelegate(Some(ProtocolObject::from_ref(self)));
            *self.ivars().popover.borrow_mut() = Some(p);
        }
        self.rebuild_popover();
        NSApplication::sharedApplication(self.mtm()).activate();
        if let (Some(p), Some(status)) = (
            self.ivars().popover.borrow().as_ref(),
            self.ivars().status.borrow().as_ref(),
        ) && let Some(button) = status.button(self.mtm())
        {
            p.showRelativeToRect_ofView_preferredEdge(
                button.bounds(),
                &button,
                objc2_foundation::NSRectEdge::MinY,
            );
        }
    }
    pub(super) fn refresh_visible_popover(&self) {
        if self
            .ivars()
            .popover
            .borrow()
            .as_ref()
            .is_some_and(|p| p.isShown())
        {
            self.rebuild_popover();
        }
    }
    pub(super) fn rebuild_popover(&self) {
        let state = self.ivars().host.read();
        let fingerprint = json!([state, self.ivars().popover_page.get()]).to_string();
        if *self.ivars().popover_fingerprint.borrow() == fingerprint {
            return;
        }
        *self.ivars().popover_fingerprint.borrow_mut() = fingerprint;
        let root = NSView::initWithFrame(NSView::alloc(self.mtm()), rect(0.0, 0.0, 356.0, 560.0));
        self.title(&root, "Phosphene", rect(20.0, 518.0, 236.0, 27.0), 20.0);
        let about = self.icon_button(
            &root,
            "",
            "info.circle",
            rect(298.0, 518.0, 36.0, 28.0),
            103,
            "",
        );
        about.setToolTip(Some(&s("About Phosphene")));
        let mut selections = state["selections"].as_array().cloned().unwrap_or_default();
        if selections.is_empty()
            && let Some(e) = state["entries"].as_array().and_then(|es| es.first())
        {
            selections.push(json!({"videoID":e["id"],"videoName":e["name"],"thumbnail":e["thumbnail"],"displayName":"Desktop","unapplied":true}));
        }
        if let Some(current) =
            selections.get(self.ivars().popover_page.get() % selections.len().max(1))
        {
            let hero = self.panel(&root, rect(16.0, 314.0, 324.0, 182.25), 12.0);
            self.thumbnail(
                &hero,
                &text(current, "thumbnail"),
                rect(0.0, 0.0, 324.0, 182.25),
                12.0,
            );
            let overlay = self.panel(&hero, rect(0.0, 0.0, 324.0, 55.0), 0.0);
            rounded(
                &overlay,
                0.0,
                Some(&NSColor::blackColor().colorWithAlphaComponent(0.72)),
                None,
            );
            let label = self.title(
                &overlay,
                &text(current, "videoName"),
                rect(10.0, 29.0, 302.0, 18.0),
                12.0,
            );
            label.setTextColor(Some(&NSColor::whiteColor()));
            label.setMaximumNumberOfLines(1);
            let scope = state["scope"].as_i64().unwrap_or(0);
            let status = if current["unapplied"].as_bool().unwrap_or(false) {
                "Not applied"
            } else if scope == 1 {
                "Playing on Lock Screen"
            } else if current["hidden"].as_bool().unwrap_or(false) {
                "Paused · Display Covered"
            } else if scope == 2 || current["userPaused"].as_bool().unwrap_or(false) {
                "Paused"
            } else {
                "Playing"
            };
            let subtitle = self.label(
                &overlay,
                &format!("{} · {status}", text(current, "displayName")),
                rect(10.0, 8.0, 302.0, 17.0),
                10.5,
            );
            subtitle.setTextColor(Some(&NSColor::whiteColor().colorWithAlphaComponent(0.84)));
            let paused = scope == 2 || current["userPaused"].as_bool().unwrap_or(false);
            let pause = self.icon_button(
                &root,
                "",
                if paused { "play.fill" } else { "pause.fill" },
                rect(300.0, 458.0, 28.0, 28.0),
                11,
                &current["displayID"].to_string(),
            );
            pause.setToolTip(Some(&s(if paused {
                "Resume this display"
            } else {
                "Pause this display"
            })));
            pause.setEnabled(
                !current["unapplied"].as_bool().unwrap_or(false)
                    && scope != 1
                    && !current["hidden"].as_bool().unwrap_or(false),
            );
            if selections.len() > 1 {
                let next = self.icon_button(
                    &root,
                    "",
                    "chevron.right",
                    rect(264.0, 458.0, 28.0, 28.0),
                    113,
                    "",
                );
                next.setToolTip(Some(&s("Next Display")));
            }
        } else {
            self.secondary(
                &root,
                "Add a video to use as your wallpaper.",
                rect(20.0, 354.0, 316.0, 80.0),
                14.0,
            );
        }
        let scope = state["scope"].as_i64().unwrap_or(0);
        let scope_control = NSSegmentedControl::initWithFrame(
            NSSegmentedControl::alloc(self.mtm()),
            rect(16.0, 268.0, 324.0, 30.0),
        );
        scope_control.setSegmentCount(3);
        for (i, label) in ["Everywhere", "Lock Screen", "Paused"].iter().enumerate() {
            scope_control.setLabel_forSegment(&s(label), i as isize);
            scope_control.setWidth_forSegment(108.0, i as isize);
        }
        scope_control.setSelectedSegment(scope as isize);
        // SAFETY: the delegate outlives this control; the action reads only its selected segment.
        unsafe {
            scope_control.setTarget(Some(self));
            scope_control.setAction(Some(sel!(action:)));
        }
        scope_control.setTag(self.register(114, ""));
        root.addSubview(&scope_control);
        for (i, (label, key, code)) in [
            ("Launch at Login", "launchAtLogin", 1),
            ("Pause When Hidden", "pauseWhenOccluded", 2),
            ("Automatic Official Updates", "autoUpdate", 3),
        ]
        .iter()
        .enumerate()
        {
            let b = self.button(
                &root,
                label,
                rect(20.0, 220.0 - i as f64 * 35.0, 316.0, 27.0),
                *code,
                "",
            );
            b.setButtonType(NSButtonType::Switch);
            b.setState(if state[*key].as_bool().unwrap_or(false) {
                1
            } else {
                0
            });
            b.setFont(Some(&NSFont::systemFontOfSize(12.0)));
        }
        let library = self.icon_button(
            &root,
            "Library…",
            "square.grid.2x2",
            rect(16.0, 92.0, 156.0, 32.0),
            100,
            "",
        );
        self.primary(&library);
        self.icon_button(
            &root,
            "Add Video…",
            "plus",
            rect(184.0, 92.0, 156.0, 32.0),
            5,
            "",
        );
        let settings = self.icon_button(
            &root,
            "Apply Wallpaper",
            "desktopcomputer",
            rect(16.0, 48.0, 204.0, 30.0),
            115,
            &selections
                .first()
                .map(|s| text(s, "videoID"))
                .unwrap_or_default(),
        );
        settings.setToolTip(Some(&s(
            "Apply this video using the native Phosphene provider",
        )));
        let restart = self.icon_button(
            &root,
            "Restart",
            "arrow.clockwise",
            rect(232.0, 48.0, 108.0, 30.0),
            4,
            "",
        );
        restart.setToolTip(Some(&s("Restart Wallpaper Agent")));
        self.icon_button(
            &root,
            "Quit",
            "power",
            rect(274.0, 9.0, 66.0, 24.0),
            102,
            "",
        );
        self.secondary(
            &root,
            &format!("v{}", text(&state, "version")),
            rect(20.0, 14.0, 130.0, 18.0),
            10.5,
        );
        self.button(&root, "Updates…", rect(154.0, 9.0, 110.0, 24.0), 110, "");
        if let Some(p) = self.ivars().popover.borrow().as_ref() {
            if let Some(controller) = p.contentViewController() {
                controller.setView(&root);
            } else {
                let controller = NSViewController::new(self.mtm());
                controller.setView(&root);
                p.setContentViewController(Some(&controller));
            }
            p.setContentSize(NSSize::new(356.0, 560.0));
        }
    }
}
