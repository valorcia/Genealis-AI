//! Coque desktop GENEALIS AI : lance le moteur Python local (sidecar) puis affiche l'interface.
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct Backend(Mutex<Option<CommandChild>>);

fn free_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(preferred)
}

fn wait_ready(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    let url = format!("http://127.0.0.1:{port}/api/health");
    while start.elapsed() < timeout {
        if let Ok(resp) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
            .and_then(|c| c.get(&url).send())
        {
            if resp.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

#[tauri::command]
fn backend_port(state: tauri::State<'_, u16>) -> u16 {
    *state.inner()
}

pub fn run() {
    let port = free_port(8765);
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(port)
        .manage(Backend(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![backend_port])
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let already_running = wait_ready(port, Duration::from_millis(500));
            if !already_running {
                let sidecar = app
                    .shell()
                    .sidecar("genealis-backend")
                    .expect("sidecar genealis-backend introuvable")
                    .args(["--port", &port.to_string()])
                    .env("GENEALIS_DATA_DIR", &data_dir)
                    .env("GENEALIS_PORT", port.to_string());
                let (_rx, child) = sidecar.spawn().expect("impossible de lancer le moteur GENEALIS");
                app.state::<Backend>().0.lock().unwrap().replace(child);
            }
            let ready = wait_ready(port, Duration::from_secs(60));
            let window = app.get_webview_window("main").expect("fenêtre principale");
            if ready {
                let url = format!("http://127.0.0.1:{port}/");
                let _ = window.navigate(url.parse().expect("url"));
            } else {
                let _ = window.eval(
                    "document.body.innerHTML='<div style=\"font-family:sans-serif;padding:40px;color:#0f1e3a\"><h1>GENEALIS AI</h1><p>Le moteur local n\\'a pas démarré dans le délai imparti. Consultez le journal technique dans le dossier de données.</p></div>'",
                );
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de GENEALIS AI")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Backend>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
