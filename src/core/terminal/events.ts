/**
 * DispatchEvent — the event contract produced by scanning the PTY byte stream.
 *
 * Scanning happens in Rust (src-tauri/src/terminal/scan.rs); the front end only consumes
 * already-classified events. The shape maps one-to-one onto the Rust `ScanEvent`
 * (serde tag=kind, camelCase).
 */

export type DispatchEvent =
  | { kind: 'data'; text: string }
  | { kind: 'osc'; code: string; payload: string; raw: string }
  | { kind: 'altEnter'; raw: string }
  | { kind: 'altExit'; raw: string };
