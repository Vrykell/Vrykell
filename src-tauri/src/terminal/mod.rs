//! terminal — terminal backend: PTY, output scanning, shell integration, shell list.
pub mod pty;
pub mod completion;
mod output_batch;
mod io_window;
pub mod scan;
pub mod shell_integration;
pub mod shells;
pub mod debug;
pub mod ssh_command;
