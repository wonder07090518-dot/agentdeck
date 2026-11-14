#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}, io::{BufRead, BufReader}};
use tauri::{Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
struct Daemon(Mutex<Option<Child>>);
// relay.json uses the same relayUrl field as daemon connection files.
fn configured_relay(app: &tauri::AppHandle, explicit: Option<String>) -> Result<String, String> {
    let nonempty = |value: String| {
        let value = value.trim().to_owned();
        if value.is_empty() { None } else { Some(value) }
    };
    if let Some(url) = explicit.and_then(nonempty) { return Ok(url); }
    if let Some(url) = std::env::var("AGENTDECK_RELAY").ok().and_then(nonempty) { return Ok(url); }
    let home = match std::env::var_os("AGENTDECK_HOME") {
        Some(home) => std::path::PathBuf::from(home),
        None => app.path().app_data_dir().map_err(|_| "Cannot locate app data; set AGENTDECK_RELAY or pass --relay to the CLI")?,
    };
    match std::fs::read_to_string(home.join("relay.json")) {
        Ok(contents) => {
            let config: serde_json::Value = serde_json::from_str(&contents)
                .map_err(|_| "Invalid relay.json; expected JSON with a relayUrl string")?;
            if let Some(url) = config.get("relayUrl").and_then(|v| v.as_str()).and_then(|v| nonempty(v.to_owned())) {
                return Ok(url);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        Err(_) => return Err("Cannot read relay.json; set AGENTDECK_RELAY or pass --relay to the CLI".into()),
    }
    Err("No relay configured. Set AGENTDECK_RELAY, supply the login relay argument, or pass --relay to the CLI".into())
}
#[tauri::command]
async fn login(app: tauri::AppHandle, email: String, password: String, relay: Option<String>) -> Result<(), String> {
    if app.state::<Daemon>().0.lock().unwrap().is_some() { return Err("already running".into()); }
    let relay = configured_relay(&app, relay)?;
    // Development sidecar: built Node CLI; credentials travel through environment, never argv.
    let cli = std::env::var("AGENTDECK_CLI").unwrap_or_else(|_| "../../../packages/daemon/dist/cli.js".into());
    let mut command = Command::new("node");
    command.args([&cli, "login", "--relay", &relay])
        .env("AGENTDECK_EMAIL", email).env("AGENTDECK_PASSWORD", password)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|_| "cannot start daemon")?;
    let stderr = child.stderr.take().ok_or("cannot read daemon")?;
    let (tx,rx)=std::sync::mpsc::channel();
    // Drain stderr without persisting secrets or pairing capabilities.
    std::thread::spawn(move || { for line in BufReader::new(stderr).lines().map_while(Result::ok) { if line == "已登录 正在连接" { let _=tx.send(()); } } });
    let deadline=Instant::now()+Duration::from_secs(20);
    loop {
        if rx.try_recv().is_ok() { break; }
        if child.try_wait().map_err(|_| "daemon failed")?.is_some() || Instant::now()>deadline { let _=child.kill();let _=child.wait();return Err("login failed".into()); }
        std::thread::sleep(Duration::from_millis(50));
    }
    *app.state::<Daemon>().0.lock().unwrap()=Some(child);
    if let Some(tray)=app.tray_by_id("agentdeck") { let _=tray.set_tooltip(Some("AgentDeck · 已登录")); }
    if let Some(window)=app.get_webview_window("main") { let _=window.hide(); }
    Ok(())
}
fn main() {
    tauri::Builder::default().manage(Daemon(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![login])
        .setup(|app| {
            let status=MenuItem::with_id(app,"status","状态 / 打开登录窗口",true,None::<&str>)?;
            let pair=MenuItem::with_id(app,"pair","打开配对页（开发占位）",false,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&status,&pair,&quit])?;
            let icon=tauri::image::Image::new_owned(vec![92,225,255,255].repeat(32*32),32,32);
            TrayIconBuilder::with_id("agentdeck").icon(icon).tooltip("AgentDeck").menu(&menu).on_menu_event(|app,event| {
                if event.id.as_ref()=="quit" { app.exit(0); }
                else if event.id.as_ref()=="status" { if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();} }
            }).build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!()).expect("cannot start AgentDeck")
        .run(|app,event| { if let tauri::RunEvent::Exit = event { if let Some(mut child)=app.state::<Daemon>().0.lock().unwrap().take(){let _=child.kill();let _=child.wait();} } });
}
