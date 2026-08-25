//! schedules — 定时任务：`~/.vrykell/schedules.json`。
//! 存储「每隔 N 分钟运行一次提示词」；前端定时器触发 agent 执行。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub prompt: String,
    /// 执行间隔（分钟）
    pub interval_minutes: u64,
    pub enabled: bool,
    /// 上次执行时间戳（毫秒）
    pub last_run_at: u64,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            prompt: String::new(),
            interval_minutes: 60,
            enabled: false,
            last_run_at: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct ScheduleList {
    schedules: Vec<Schedule>,
}

fn path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("schedules.json")
}

fn load() -> Vec<Schedule> {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str::<ScheduleList>(&s).ok())
        .map(|l| l.schedules)
        .unwrap_or_default()
}

fn save(list: &[Schedule]) -> Result<(), String> {
    let p = path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let json = serde_json::to_string_pretty(&ScheduleList { schedules: list.to_vec() })
        .map_err(|e| format!("序列化失败：{e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("写入失败：{e}"))
}

#[tauri::command]
pub fn list_schedules() -> Result<Vec<Schedule>, String> {
    Ok(load())
}

#[tauri::command]
pub fn save_schedule(schedule: Schedule) -> Result<(), String> {
    if schedule.name.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    if schedule.interval_minutes == 0 {
        return Err("间隔不能为 0".to_string());
    }
    let mut list = load();
    let id = if schedule.id.trim().is_empty() {
        format!("s{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
    } else {
        schedule.id.clone()
    };
    let mut def = schedule;
    def.id = id.clone();
    if let Some(i) = list.iter().position(|s| s.id == id) {
        list[i] = def;
    } else {
        list.push(def);
    }
    save(&list)
}

#[tauri::command]
pub fn remove_schedule(id: String) -> Result<(), String> {
    let list = load();
    let next: Vec<Schedule> = list.into_iter().filter(|s| s.id != id).collect();
    save(&next)
}

/// 标记某任务已运行（更新 last_run_at）。
#[tauri::command]
pub fn mark_schedule_run(id: String, at: u64) -> Result<(), String> {
    let mut list = load();
    if let Some(s) = list.iter_mut().find(|s| s.id == id) {
        s.last_run_at = at;
    }
    save(&list)
}
