//! Keeps the app window on the app. A link in a tutor reply, a lesson, Raise hand help, a resource or a
//! diagram is written by a model or a document's author; clicked, it would navigate the whole window to
//! that site. The window is frameless (`decorations: false`), so the React Titlebar holds the only
//! window controls, and it unloads with the app: the child would be left in an unfiltered browser with
//! no way back or out. The webview's click guard (`src/lib/link-guard.ts`) stops the click and shows the
//! address for a grown-up to copy; this is the backstop for anything that gets past it.
//!
//! Every top-level navigation of every webview passes `on_navigation`; anything not the app's own origin
//! is cancelled. One gap is upstream's: tauri-runtime-wry allows a navigation whose URL `Url::parse`
//! rejects without calling the handler (`unwrap_or(true)`), so the webview's guard is the only check there. The app's origin is the custom protocol (`tauri://localhost` on macOS and Linux,
//! `http(s)://tauri.localhost` on Windows) and, in a dev build only, the `devUrl` from tauri.conf.json.
//! New windows (target=_blank, a ctrl- or middle-click, `window.open`) need nothing here: no
//! `on_new_window` handler is set, and wry then marks WebView2's NewWindowRequested handled with no
//! window, so none opens.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nav-guard")
        .on_navigation(|webview, url| {
            let dev_url = if tauri::is_dev() { webview.config().build.dev_url.clone() } else { None };
            is_app_url(url, dev_url.as_ref())
        })
        .build()
}

/// True for a URL the app itself serves: the custom protocol, or the dev server's origin when one is given.
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        // A non-special scheme, so its Url::origin() is opaque: compare the host instead.
        "tauri" => url.host_str() == Some("localhost") && url.port().is_none(),
        "http" | "https" => {
            (url.host_str() == Some("tauri.localhost") && url.port().is_none())
                || dev_url.is_some_and(|dev| url.origin() == dev.origin())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_app_url;
    use tauri::Url;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_apps_own_pages_load() {
        for page in [
            "tauri://localhost",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/assets/x.js#part",
        ] {
            assert!(is_app_url(&u(page), None), "{page}");
        }
    }

    #[test]
    fn the_dev_server_loads_only_when_given() {
        let dev = u("http://localhost:1420");
        assert!(is_app_url(&u("http://localhost:1420/"), Some(&dev)));
        assert!(is_app_url(&u("http://localhost:1420/src/main.tsx?t=1"), Some(&dev)));
        assert!(!is_app_url(&u("http://localhost:1420/"), None));
        assert!(!is_app_url(&u("http://localhost:1421/"), Some(&dev)));
        assert!(!is_app_url(&u("https://localhost:1420/"), Some(&dev)));
        assert!(!is_app_url(&u("http://127.0.0.1:1420/"), Some(&dev)));
    }

    #[test]
    fn a_link_to_anywhere_else_is_cancelled() {
        let dev = u("http://localhost:1420");
        for link in [
            "https://www.khanacademy.org/",
            "http://example.com/tauri.localhost",
            "https://tauri.localhost.example.com/",
            "http://tauri.localhost:8080/",
            "tauri://example.com/",
            "http://localhost/",
            "file:///C:/Windows/",
            "data:text/html,<p>hi</p>",
            "javascript:alert(1)",
            "mailto:someone@example.com",
            "about:blank",
        ] {
            assert!(!is_app_url(&u(link), Some(&dev)), "{link}");
        }
    }
}
