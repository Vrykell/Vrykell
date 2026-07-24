use serde::{Deserialize, Serialize};

/// Session type discriminator — matches shared/types.ts SessionType
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SessionType {
    Local,
    Ssh,
}

/// Session metadata — mirrors shared/types.ts SessionInfo
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub session_type: SessionType,
    pub title: String,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    pub host: Option<String>,
    pub username: Option<String>,
}

/// Session creation options — mirrors shared/types.ts SessionOptions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOptions {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}
