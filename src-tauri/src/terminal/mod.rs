//! terminal — 终端后端：PTY、输出扫描、shell 集成、shell 列表。
pub mod pty;
mod output_batch;
pub mod scan;
pub mod shell_integration;
pub mod shells;
pub mod debug;
pub mod ssh_command;
