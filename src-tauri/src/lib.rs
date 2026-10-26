//! AnyAmp-Kern: verwaltet das versteckte YouTube-Music-Fenster (`ytm`) und
//! vermittelt zwischen ihm und der AnyAmp-Oberfläche (`main`).

mod spectrum;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const MAIN: &str = "main";
const YTM: &str = "ytm";
const YTM_URL: &str = "https://music.youtube.com/";
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
// YT Music und Google-Login erwarten einen regulären Browser.
const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

fn ytm(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(YTM).ok_or_else(|| "YT-Music-Fenster fehlt".into())
}

fn require(webview: &Webview, label: &str) -> Result<(), String> {
    (webview.label() == label).then_some(()).ok_or_else(|| "nicht erlaubt".into())
}

/// Bridge (in `ytm`) → Oberfläche.
#[tauri::command]
fn ytm_event(webview: Webview, app: AppHandle, event: Value) -> Result<(), String> {
    require(&webview, YTM)?;
    if !matches!(event["type"].as_str(), Some("state" | "vis")) {
        eprintln!("[ytm] {event}");
    }
    app.emit_to(MAIN, "ytm", event).map_err(|e| e.to_string())
}

/// Oberfläche → Bridge. Antwort kommt asynchron als `ytm`-Event vom Typ `result`.
#[tauri::command]
fn ytm_call(webview: Webview, app: AppHandle, request: Value) -> Result<(), String> {
    require(&webview, MAIN)?;
    ytm(&app)?
        .eval(format!("window.__anyamp && window.__anyamp.dispatch({request})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn ytm_login(webview: Webview, app: AppHandle) -> Result<(), String> {
    require(&webview, MAIN)?;
    let w = ytm(&app)?;
    w.navigate(LOGIN_URL.parse().unwrap()).map_err(|e| e.to_string())?;
    w.show().and_then(|_| w.set_focus()).map_err(|e| e.to_string())
}

#[tauri::command]
fn ytm_set_visible(webview: Webview, app: AppHandle, visible: bool) -> Result<(), String> {
    require(&webview, MAIN)?;
    let w = ytm(&app)?;
    if visible { w.show() } else { w.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn ytm_reload(webview: Webview, app: AppHandle) -> Result<(), String> {
    require(&webview, MAIN)?;
    ytm(&app)?.navigate(YTM_URL.parse().unwrap()).map_err(|e| e.to_string())
}

/// Visualizer: Bildrate (60 / 30 / 0 = aus) und Lage im Fenster (Punkte, Punkte je Skin-Pixel).
#[tauri::command]
fn vis_config(webview: Webview, fps: u32, mode: String, x: f64, y: f64, px: f64, volume: u32) -> Result<(), String> {
    require(&webview, MAIN)?;
    spectrum::set_volume(volume);
    spectrum::configure(fps, mode == "scope", x, y, px);
    Ok(())
}

/// Visualizer-Farben aus dem Skin (VISCOLOR.TXT); leere Liste = Standard.
#[tauri::command]
fn vis_colors(webview: Webview, colors: Vec<u32>) -> Result<(), String> {
    require(&webview, MAIN)?;
    spectrum::set_colors(&colors);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Auto-Update über GitHub-Releases (signiert), danach Neustart
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .setup(|app| {
            spectrum::start();
            let window = WebviewWindowBuilder::new(app, YTM, WebviewUrl::External(YTM_URL.parse().unwrap()))
                .title("YouTube Music – Anmeldung")
                .inner_size(1000.0, 760.0)
                .visible(false)
                .user_agent(SAFARI_UA)
                .initialization_script(include_str!("bridge.js"))
                .on_page_load(|webview, payload| {
                    eprintln!("[ytm] {:?} {}", payload.event(), payload.url());
                    // Zustimmung (consent.youtube.com) oder Google-Login braucht den Nutzer:
                    // Fenster zeigen. Zurück auf YTM blendet die Oberfläche es nach dem Login aus.
                    if payload.url().host_str() != Some("music.youtube.com") {
                        let _ = webview.show();
                        let _ = webview.set_focus();
                    }
                })
                .build()?;
            // Entwicklung: ANYAMP_PROBE=<datei.js> wertet ein Skript in der YTM-Sitzung aus
            // (Ergebnisse erscheinen im Log). Nur im Debug-Build.
            #[cfg(debug_assertions)]
            if let Ok(path) = std::env::var("ANYAMP_PROBE") {
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(12));
                    if let Ok(js) = std::fs::read_to_string(path) {
                        let _ = w.eval(js);
                    }
                });
            }
            // AnyAmp-Fenster schließen beendet die App (das YTM-Fenster ist nur versteckt).
            if let Some(main) = app.get_webview_window(MAIN) {
                spectrum::attach(&main);
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        handle.exit(0);
                    }
                });
            }
            // Schließen versteckt nur – das Fenster ist der Player.
            let w = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ytm_event, ytm_call, ytm_login, ytm_set_visible, ytm_reload, vis_config, vis_colors])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
