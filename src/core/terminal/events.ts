/**
 * DispatchEvent — PTY 字节流扫描后的事件契约。
 *
 * 扫描在 Rust 端完成（src-tauri/src/terminal/scan.rs），前端只消费已分类事件。
 * 形状与 Rust `ScanEvent`（serde tag=kind, camelCase）一一对应。
 */

export type DispatchEvent =
  | { kind: 'data'; text: string }
  | { kind: 'osc'; code: string; payload: string; raw: string }
  | { kind: 'altEnter'; raw: string }
  | { kind: 'altExit'; raw: string };
