//! 平台层：与宿主平台 / 目标平台强相关的规则收口在这里，业务模块不自行判断。
//!
//! - `path`：远端（POSIX）路径语义——Windows 宿主上必须用它，不能用 `std::path`。
//! - `clipboard_files`：系统文件剪贴板——把真实文件路径按平台写入系统剪贴板。

pub mod clipboard_files;
pub mod path;
pub mod context_menu;
pub mod window_chrome;
