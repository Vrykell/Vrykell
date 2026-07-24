/**
 * Mirrors the Rust `TerminalEvent` enum in src-tauri/src/terminal_parser.rs.
 * Serde serializes as `{ "t": "<tag>", "p": <payload> }`.
 */
export type TerminalEvent =
  | { t: 'txt'; p: string }
  | { t: 'A'; p: number }        // Cuu
  | { t: 'B'; p: number }        // Cud
  | { t: 'C'; p: number }        // Cuf
  | { t: 'D'; p: number }        // Cub
  | { t: 'H'; p: [number, number] } // Cup
  | { t: 'G'; p: number }        // Cha
  | { t: 'd'; p: number }        // Vpa
  | { t: 's' }                   // SaveCursor
  | { t: 'u' }                   // RestoreCursor
  | { t: 'J'; p: number }        // EraseDisplay
  | { t: 'K'; p: number }        // EraseLine
  | { t: 'm'; p: number[] }      // Sgr
  | { t: 'dec'; p: [number, boolean] } // DecPrivateMode
  | { t: 'cr' }                  // CarriageReturn
  | { t: 'lf' }                  // LineFeed
  | { t: 'bs' }                  // Backspace
  | { t: 'tab' }                 // HorizontalTab
  | { t: 'osc'; p: string };     // OscTitle
