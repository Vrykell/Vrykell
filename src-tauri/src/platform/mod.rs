//! Platform layer: rules tied to the host or target platform are consolidated here; business modules do not decide them on their own.
//!
//! - `path`: remote (POSIX) path semantics — required on a Windows host; do not use `std::path`.
//! - `clipboard_files`: system file clipboard — writes real file paths to the system clipboard per platform.

pub mod clipboard_files;
pub mod path;
pub mod context_menu;
pub mod window_chrome;
