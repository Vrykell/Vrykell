//! agents — 子代理（subagent）定义：`~/.vrykell/agents.json`。
//! 主 agent 用 spawn_agent 工具按名委派任务给子代理（独立系统提示词）。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 系统提示词（子代理的行为准则）
    pub prompt: String,
}

impl Default for AgentDef {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            prompt: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct AgentList {
    agents: Vec<AgentDef>,
}

fn agents_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".vrykell")
        .join("agents.json")
}

fn load() -> Vec<AgentDef> {
    std::fs::read_to_string(agents_path())
        .ok()
        .and_then(|s| serde_json::from_str::<AgentList>(&s).ok())
        .map(|l| l.agents)
        .unwrap_or_default()
}

fn save(agents: &[AgentDef]) -> Result<(), String> {
    let p = agents_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let json = serde_json::to_string_pretty(&AgentList { agents: agents.to_vec() })
        .map_err(|e| format!("序列化失败：{e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("写入失败：{e}"))
}

#[tauri::command]
pub fn list_agents() -> Result<Vec<AgentDef>, String> {
    Ok(load())
}

#[tauri::command]
pub fn save_agent(agent: AgentDef) -> Result<(), String> {
    if agent.name.trim().is_empty() {
        return Err("名称不能为空".to_string());
    }
    let mut list = load();
    let id = if agent.id.trim().is_empty() {
        format!("a{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
    } else {
        agent.id.clone()
    };
    let mut def = agent;
    def.id = id.clone();
    if let Some(i) = list.iter().position(|a| a.id == id) {
        list[i] = def;
    } else {
        list.push(def);
    }
    save(&list)
}

#[tauri::command]
pub fn remove_agent(id: String) -> Result<(), String> {
    let list = load();
    let next: Vec<AgentDef> = list.into_iter().filter(|a| a.id != id).collect();
    save(&next)
}

/// 按名或 id 取子代理定义（spawn_agent 用）。
#[tauri::command]
pub fn get_agent(name_or_id: String) -> Result<AgentDef, String> {
    let q = name_or_id.trim().to_lowercase();
    load()
        .into_iter()
        .find(|a| a.name.trim().to_lowercase() == q || a.id == name_or_id.trim())
        .ok_or_else(|| format!("未找到子代理「{name_or_id}」"))
}
