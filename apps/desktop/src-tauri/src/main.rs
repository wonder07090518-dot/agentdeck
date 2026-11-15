#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}, io::{BufRead, BufReader}};
use tauri::{Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
struct Daemon(Mutex<Option<Child>>);
#[tauri::command]
async fn login(app: tauri::AppHandle, email: String, password: String, relay: Option<String>) -> Result<(), String> {
    if app.state::<Daemon>().0.lock().unwrap().is_some() { return Err("already running".into()); }
    // Installed resources only: neither Node on PATH nor a repository is required.
    let resources = app.path().resource_dir().map_err(|_| "cannot locate resources")?.join("runtime");
    let home = app.path().app_data_dir().map_err(|_| "cannot locate app data")?;
    std::fs::create_dir_all(&home).map_err(|_| "cannot create app data")?;
    let saved_relay = std::fs::read(home.join("relay.json")).ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("relayUrl").and_then(|url| url.as_str()).map(str::to_owned));
    let relay = relay.filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("AGENTDECK_RELAY").ok().filter(|s| !s.trim().is_empty()))
        .or(saved_relay).unwrap_or_else(|| "wss://relay.agentdeckapp.com".into());
    let node_bin = if cfg!(windows) { resources.join("node.exe") } else { resources.join("node") };
    let mut command = Command::new(node_bin);
    command.arg(resources.join("packages/daemon/dist/cli.js"))
        .args(["login", "--relay", &relay])
        .current_dir(&home).env("AGENTDECK_HOME", &home)
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
