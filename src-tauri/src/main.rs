// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(status) = vrykell_lib::run_app_mcp_helper() { std::process::exit(status); }
    if let Some(status) = vrykell_lib::run_ssh_proxy_helper() { std::process::exit(status); }
    vrykell_lib::run()
}
