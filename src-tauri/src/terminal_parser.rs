use serde::Serialize;

/// Structured terminal event — the frontend receives these instead of raw escape sequences.
/// Each variant maps 1:1 to a method on the TypeScript `TerminalBuffer`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "p")]
pub enum TerminalEvent {
    /// Printable text run (one or more characters).
    #[serde(rename = "txt")]
    Text(String),

    /// CSI Cursor Up `A` — move up N rows.
    #[serde(rename = "A")]
    Cuu(u16),

    /// CSI Cursor Down `B` — move down N rows.
    #[serde(rename = "B")]
    Cud(u16),

    /// CSI Cursor Forward `C` — move right N cols.
    #[serde(rename = "C")]
    Cuf(u16),

    /// CSI Cursor Back `D` — move left N cols.
    #[serde(rename = "D")]
    Cub(u16),

    /// CSI Cursor Position `H` — move to (row, col).
    #[serde(rename = "H")]
    Cup(u16, u16),

    /// CSI Cursor Horizontal Absolute `G` — move to column.
    #[serde(rename = "G")]
    Cha(u16),

    /// CSI Vertical Position Absolute `d` — move to row.
    #[serde(rename = "d")]
    Vpa(u16),

    /// CSI Save Cursor `s`.
    #[serde(rename = "s")]
    SaveCursor,

    /// CSI Restore Cursor `u`.
    #[serde(rename = "u")]
    RestoreCursor,

    /// CSI Erase in Display `J`.
    #[serde(rename = "J")]
    EraseDisplay(u8),

    /// CSI Erase in Line `K`.
    #[serde(rename = "K")]
    EraseLine(u8),

    /// CSI SGR `m` — raw params, frontend resolves colors.
    #[serde(rename = "m")]
    Sgr(Vec<u16>),

    /// DEC private mode set/reset (CSI ? ... h/l).
    #[serde(rename = "dec")]
    DecPrivateMode(u16, bool),

    /// Carriage return `\r`.
    #[serde(rename = "cr")]
    Cr,

    /// Line feed `\n`.
    #[serde(rename = "lf")]
    Lf,

    /// Backspace `\x08`.
    #[serde(rename = "bs")]
    Bs,

    /// Horizontal tab `\t`.
    #[serde(rename = "tab")]
    Tab,

    /// OSC title change (0 or 2).
    #[serde(rename = "osc")]
    OscTitle(String),
}

/// Streaming ANSI / CSI / OSC parser.  Feed bytes via `push()` and drain
/// completed events with `take_events()`.
pub struct TerminalParser {
    events: Vec<TerminalEvent>,
    pending: Vec<u8>,  // partial escape sequence split across PTY chunks
}

impl TerminalParser {
    pub fn new() -> Self {
        Self { events: Vec::with_capacity(64), pending: Vec::new() }
    }

    /// Feed a PTY output chunk.  Parsed events are accumulated internally.
    pub fn push(&mut self, data: &[u8]) {
        // Copy into a local buffer so we never borrow self.pending across
        // a mutable self call (parse_csi / emit_osc_title).
        let buf: Vec<u8> = if self.pending.is_empty() {
            data.to_vec()
        } else {
            let mut v = std::mem::take(&mut self.pending);
            v.extend_from_slice(data);
            v
        };

        let len = buf.len();
        let mut text_start: usize = 0;
        let mut pos = 0;

        while pos < len {
            let b = buf[pos];
            if b >= 0x20 && b != 0x1b { pos += 1; continue; }

            // Flush text before this control char.
            if pos > text_start {
                let text = String::from_utf8_lossy(&buf[text_start..pos]).into_owned();
                if !text.is_empty() { self.events.push(TerminalEvent::Text(text)); }
            }

            match b {
                0x0d => { self.events.push(TerminalEvent::Cr); }
                0x0a => { self.events.push(TerminalEvent::Lf); }
                0x08 => { self.events.push(TerminalEvent::Bs); }
                0x09 => { self.events.push(TerminalEvent::Tab); }

                0x1b if pos + 1 < len => {
                    let after = &buf[pos + 1..];
                    match after[0] {
                        b'[' => {
                            if let Some(end) = after[1..].iter().position(|b| (0x40..=0x7e).contains(b)) {
                                let fb = after[1 + end];
                                let params = &after[1..1 + end];
                                self.parse_csi(fb, params);
                                pos += 2 + end;
                            } else {
                                self.pending = buf[pos..].to_vec();
                                return;
                            }
                        }
                        b']' => {
                            let osc_body = &after[1..];
                            if let Some(end) = osc_body.iter().position(|&b| b == 0x07) {
                                self.emit_osc_title(&osc_body[..end]);
                                pos += 2 + end;
                            } else if let Some(end) = osc_body.windows(2).position(|w| w == b"\x1b\\") {
                                self.emit_osc_title(&osc_body[..end]);
                                pos += 2 + end + 1;
                            } else {
                                self.pending = buf[pos..].to_vec();
                                return;
                            }
                        }
                        b'P' | b'X' | b'^' | b'_' => {
                            if let Some(end) = after[1..].windows(2).position(|w| w == b"\x1b\\") {
                                pos += 2 + end + 1;
                            } else {
                                self.pending = buf[pos..].to_vec();
                                return;
                            }
                        }
                        // DECSC / DECRC (ESC 7 / ESC 8) — same semantics as CSI s/u.
                        b'7' => { self.events.push(TerminalEvent::SaveCursor); pos += 1; }
                        b'8' => { self.events.push(TerminalEvent::RestoreCursor); pos += 1; }
                        // Charset designation (ESC ( B, ESC ( 0, …) and DEC
                        // special sequences (ESC # 8) take a FINAL byte after
                        // the designator.  Skip BOTH bytes — previously only
                        // the designator was skipped and the final byte (e.g.
                        // 'B') leaked into the text stream as garbage.
                        b'(' | b')' | b'*' | b'+' | b'#' => {
                            if pos + 2 < len {
                                pos += 2;
                            } else {
                                self.pending = buf[pos..].to_vec();
                                return;
                            }
                        }
                        _ => { pos += 1; } // simple ESC
                    }
                }
                0x1b => {
                    self.pending = buf[pos..].to_vec();
                    return;
                }
                _ => {} // other control char — skip
            }
            pos += 1;
            text_start = pos;
        }

        // Flush remaining text.
        if text_start < pos {
            let text_bytes = &buf[text_start..];
            match std::str::from_utf8(text_bytes) {
                Ok(s) => {
                    if !s.is_empty() { self.events.push(TerminalEvent::Text(s.to_owned())); }
                }
                Err(e) => {
                    // Incomplete UTF-8 sequence at the end of the PTY chunk.
                    // Emit only the valid prefix and keep the trailing bytes
                    // in pending so they are completed by the next chunk.
                    // Without this, a multi-byte character split across read()
                    // boundaries becomes '�' and shifts every subsequent cell.
                    let valid = e.valid_up_to();
                    if valid > 0 {
                        let text = String::from_utf8_lossy(&text_bytes[..valid]).into_owned();
                        if !text.is_empty() { self.events.push(TerminalEvent::Text(text)); }
                    }
                    self.pending = text_bytes[valid..].to_vec();
                }
            }
        }
    }

    /// Take all accumulated events, leaving the parser empty.
    pub fn take_events(&mut self) -> Vec<TerminalEvent> {
        let mut out = Vec::with_capacity(64);
        std::mem::swap(&mut out, &mut self.events);
        out
    }

    /// Extract title from OSC 0;title or OSC 2;title sequences.
    fn emit_osc_title(&mut self, osc: &[u8]) {
        // OSC format: <number>;<title>
        let body = if osc.starts_with(b"0;") || osc.starts_with(b"2;") {
            &osc[2..]
        } else {
            return;
        };
        let title = String::from_utf8_lossy(body).into_owned();
        if !title.is_empty() {
            self.events.push(TerminalEvent::OscTitle(title));
        }
    }

    // ── CSI sub-parser ──────────────────────────────────────────────────────

    fn parse_csi(&mut self, final_byte: u8, params: &[u8]) {
        let is_private = params.first() == Some(&b'?');
        let param_slice = if is_private { &params[1..] } else { params };

        // xterm private sequences use `>`, `<`, `=` as the first param byte:
        //   CSI > ... m   modifyOtherKeys
        //   CSI < u       kitty keyboard protocol pop
        //   CSI > u       kitty keyboard protocol push
        //   CSI = ...     other private protocols
        // They are NOT the standard sequence with the same final byte —
        // previously CSI > 4 m was misread as SGR(4) (underline everything)
        // and CSI < u as RestoreCursor (cursor teleported mid-frame, which
        // is what scattered TUI frames and spawned phantom cursors).
        let first = params.first().copied().unwrap_or(0);
        if first == b'>' || first == b'<' || first == b'=' {
            return;
        }

        // Parse semicolon-separated integers.  Colons (ITU-style sub-params,
        // e.g. SGR 38:5:220) are treated like semicolons — for color
        // sequences this yields exactly the params the semicolon form would.
        let mut p: Vec<u16> = Vec::with_capacity(4);
        let mut n: u16 = 0;
        let mut has_digit = false;
        for &b in param_slice {
            if b.is_ascii_digit() {
                n = n.saturating_mul(10).saturating_add((b - b'0') as u16);
                has_digit = true;
            } else if b == b';' || b == b':' {
                p.push(n);
                n = 0;
                has_digit = false;
            }
        }
        p.push(if has_digit { n } else { 0 });

        if is_private {
            let set = final_byte == b'h';
            let unset = final_byte == b'l';
            if !set && !unset { return; }
            for &code in &p {
                self.events.push(TerminalEvent::DecPrivateMode(code, set));
            }
            return;
        }

        // Per ECMA-48, a missing or 0 parameter for cursor movement commands
        // defaults to 1.  parse_csi pushes 0 for empty params (§3.1 of this file),
        // so we must translate 0→1 here.  (SGR m, EraseDisplay J, EraseLine K
        // treat 0 as a meaningful value and keep it as-is.)
        let default1 = |n: u16| if n == 0 { 1 } else { n };

        match final_byte {
            b'm' => self.events.push(TerminalEvent::Sgr(p)),
            b'A' => self.events.push(TerminalEvent::Cuu(default1(p.first().copied().unwrap_or(1)))),
            b'B' => self.events.push(TerminalEvent::Cud(default1(p.first().copied().unwrap_or(1)))),
            b'C' => self.events.push(TerminalEvent::Cuf(default1(p.first().copied().unwrap_or(1)))),
            b'D' => self.events.push(TerminalEvent::Cub(default1(p.first().copied().unwrap_or(1)))),
            b'H' => self.events.push(TerminalEvent::Cup(
                default1(p.first().copied().unwrap_or(1)),
                default1(p.get(1).copied().unwrap_or(1)),
            )),
            b'G' => self.events.push(TerminalEvent::Cha(default1(p.first().copied().unwrap_or(1)))),
            b'd' => self.events.push(TerminalEvent::Vpa(default1(p.first().copied().unwrap_or(1)))),
            b's' => self.events.push(TerminalEvent::SaveCursor),
            b'u' => self.events.push(TerminalEvent::RestoreCursor),
            b'J' => self.events.push(TerminalEvent::EraseDisplay(p.first().copied().unwrap_or(0) as u8)),
            b'K' => self.events.push(TerminalEvent::EraseLine(p.first().copied().unwrap_or(0) as u8)),
            _ => {} // unsupported CSI — ignore gracefully
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(data: &[u8]) -> Vec<TerminalEvent> {
        let mut p = TerminalParser::new();
        p.push(data);
        p.take_events()
    }

    #[test]
    fn plain_text() {
        let e = events(b"hello");
        assert!(matches!(&e[0], TerminalEvent::Text(t) if t == "hello"));
    }

    #[test]
    fn control_chars() {
        let e = events(b"a\r\nb\x08c\t");
        assert!(matches!(&e[0], TerminalEvent::Text(t) if t == "a"));
        assert!(matches!(&e[1], TerminalEvent::Cr));
        assert!(matches!(&e[2], TerminalEvent::Lf));
        assert!(matches!(&e[3], TerminalEvent::Text(t) if t == "b"));
        assert!(matches!(&e[4], TerminalEvent::Bs));
        assert!(matches!(&e[5], TerminalEvent::Text(t) if t == "c"));
        assert!(matches!(&e[6], TerminalEvent::Tab));
    }

    #[test]
    fn csi_cursor() {
        let e = events(b"\x1b[10;20H");
        assert!(matches!(&e[0], TerminalEvent::Cup(10, 20)));
    }

    /// Bare CSI sequences (no params) must default to 1, not 0.
    #[test]
    fn bare_csi_defaults() {
        // \x1b[H → cursor home: row 1, col 1
        let e = events(b"\x1b[H");
        assert!(matches!(&e[0], TerminalEvent::Cup(1, 1)),
                "bare CUP should default to (1,1), got {:?}", &e[0]);

        // \x1b[G → CHA to column 1
        let e = events(b"\x1b[G");
        assert!(matches!(&e[0], TerminalEvent::Cha(1)),
                "bare CHA should default to 1, got {:?}", &e[0]);

        // \x1b[A → Cuu 1
        let e = events(b"\x1b[A");
        assert!(matches!(&e[0], TerminalEvent::Cuu(1)),
                "bare CUU should default to 1, got {:?}", &e[0]);

        // \x1b[B → Cud 1
        let e = events(b"\x1b[B");
        assert!(matches!(&e[0], TerminalEvent::Cud(1)));

        // \x1b[C → Cuf 1
        let e = events(b"\x1b[C");
        assert!(matches!(&e[0], TerminalEvent::Cuf(1)));

        // \x1b[D → Cub 1
        let e = events(b"\x1b[D");
        assert!(matches!(&e[0], TerminalEvent::Cub(1)));

        // \x1b[d → Vpa 1
        let e = events(b"\x1b[d");
        assert!(matches!(&e[0], TerminalEvent::Vpa(1)),
                "bare VPA should default to 1, got {:?}", &e[0]);
    }

    #[test]
    fn csi_sgr() {
        let e = events(b"\x1b[31;1m");
        assert!(matches!(&e[0], TerminalEvent::Sgr(p) if p == &[31, 1]));
    }

    #[test]
    fn dec_private_mode() {
        let e = events(b"\x1b[?25h\x1b[?7l");
        assert!(matches!(&e[0], TerminalEvent::DecPrivateMode(25, true)));
        assert!(matches!(&e[1], TerminalEvent::DecPrivateMode(7, false)));
    }

    #[test]
    fn split_csi_across_chunks() {
        let mut p = TerminalParser::new();
        p.push(b"\x1b[38;5;");
        assert!(p.take_events().is_empty()); // incomplete
        p.push(b"220mX");
        let e = p.take_events();
        assert!(matches!(&e[0], TerminalEvent::Sgr(p) if p == &[38, 5, 220]));
        assert!(matches!(&e[1], TerminalEvent::Text(t) if t == "X"));
    }

    #[test]
    fn osc_title() {
        let e = events(b"\x1b]0;hello\x07");
        assert!(matches!(&e[0], TerminalEvent::OscTitle(t) if t == "hello"));
    }

    /// Claude TUI-like output: long text line with box-drawing + SGR + CUP.
    /// Must NOT produce scattered single-character lines.
    #[test]
    fn long_text_with_escape_sequences() {
        // Simulate: Claude outputs a long safety-check message with SGR codes.
        let input = b"\x1b[38;5;220m\x1b[1mAccessing\x1b[12Gworkspace:\x1b[22m\x1b[39m\r\n\r\n\x1b[2G\x1b[1m/Users/wuzhe\x1b[22m\r\n\r\n\x1b[2GQuick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[30Ga\x1b[32Gproject\x1b[40Gyou\x1b[44Gcreated\x1b[52Gor\x1b[55Gone\x1b[59Gyou\x1b[63Gtrust?\x1b[70G(Like\x1b[76Gyour\x1b[81Gown\x1b[85Gcode,\x1b[91Ga\r\n";
        let e = events(input);

        // All Text events should contain their characters without extra newlines
        for ev in &e {
            if let TerminalEvent::Text(ref t) = ev {
                assert!(!t.contains('\n'), "Text event contains newline: {:?}", t);
                assert!(!t.contains('\r'), "Text event contains CR: {:?}", t);
                // No single-char Text events that would cause vertical scatter
                if t.len() == 1 && t.chars().next().unwrap().is_alphabetic() {
                    // Single alpha chars are suspicious — print for debugging
                    eprintln!("Single-char Text event: {:?}", t);
                }
            }
        }

        // Should have Text, Sgr, Cr, Lf, CUP events — not just garbage
        let text_count = e.iter().filter(|ev| matches!(ev, TerminalEvent::Text(_))).count();
        assert!(text_count > 3, "Expected multiple Text events, got {}", text_count);
    }

    /// Newlines inside text must be split into Text + Lf events.
    #[test]
    fn embedded_newline_in_text() {
        let input = b"hello\nworld\n";
        let e = events(input);
        // Should be: Text("hello"), Lf, Text("world"), Lf
        assert!(matches!(&e[0], TerminalEvent::Text(t) if t == "hello"));
        assert!(matches!(&e[1], TerminalEvent::Lf));
        assert!(matches!(&e[2], TerminalEvent::Text(t) if t == "world"));
        assert!(matches!(&e[3], TerminalEvent::Lf));
    }

    /// CSI CUP positions beyond current width — should still be emitted correctly.
    #[test]
    fn cup_beyond_width() {
        let e = events(b"\x1b[10;200H");
        assert!(matches!(&e[0], TerminalEvent::Cup(10, 200)));
    }

    /// ESC ( B (charset designation) must skip BOTH bytes — the final 'B'
    /// must not leak into the text stream.
    #[test]
    fn charset_designation_does_not_leak_final_byte() {
        let e = events(b"\x1b(Bhello\x1b(0world");
        let text: String = e.iter().filter_map(|ev| match ev {
            TerminalEvent::Text(t) => Some(t.as_str()),
            _ => None,
        }).collect();
        assert_eq!(text, "helloworld", "charset final byte leaked as text: {:?}", text);
    }

    /// xterm private CSI (`>`, `<`, `=` prefix) must be ignored, NOT
    /// reinterpreted as the standard sequence with the same final byte.
    #[test]
    fn xterm_private_csi_is_ignored() {
        // CSI > 4 m (modifyOtherKeys) must NOT become SGR(4)
        let e = events(b"\x1b[>4mX");
        assert!(e.iter().all(|ev| !matches!(ev, TerminalEvent::Sgr(_))),
                "modifyOtherKeys leaked as SGR: {:?}", e);

        // CSI < u (kitty keyboard pop) must NOT become RestoreCursor
        let e = events(b"\x1b[<uX");
        assert!(e.iter().all(|ev| !matches!(ev, TerminalEvent::RestoreCursor)),
                "kitty keyboard pop leaked as RestoreCursor: {:?}", e);

        // CSI > u (kitty keyboard push) must NOT become RestoreCursor either
        let e = events(b"\x1b[>uX");
        assert!(e.iter().all(|ev| !matches!(ev, TerminalEvent::RestoreCursor)),
                "kitty keyboard push leaked as RestoreCursor: {:?}", e);
    }

    /// ESC 7 / ESC 8 are DECSC / DECRC — same as CSI s / CSI u.
    #[test]
    fn esc7_esc8_are_decsc_decrc() {
        let e = events(b"\x1b7\x1b[r\x1b8");
        assert!(matches!(&e[0], TerminalEvent::SaveCursor));
        assert!(matches!(&e[1], TerminalEvent::RestoreCursor));
    }

    /// Multi-byte UTF-8 characters split across PTY read boundaries must not
    /// become replacement characters ('�') — that shifts column accounting.
    #[test]
    fn utf8_split_across_chunks() {
        let mut p = TerminalParser::new();
        // ─ (U+2500) is encoded as E2 94 80
        p.push(b"\xE2\x94");
        assert!(p.take_events().is_empty()); // incomplete sequence stays pending
        p.push(b"\x80");
        let e = p.take_events();
        assert_eq!(e.len(), 1);
        assert!(matches!(&e[0], TerminalEvent::Text(t) if t == "\u{2500}"));
    }

    /// A long box-drawing border must survive arbitrary chunk boundaries.
    #[test]
    fn utf8_box_drawing_across_many_chunks() {
        let mut p = TerminalParser::new();
        let border = "\u{2500}".repeat(100); // 100 box-drawing chars
        let bytes = border.as_bytes();
        for chunk in bytes.chunks(7) { // 7 bytes crosses many UTF-8 boundaries
            p.push(chunk);
        }
        let e = p.take_events();
        let text: String = e.iter().filter_map(|ev| match ev {
            TerminalEvent::Text(t) => Some(t.as_str()),
            _ => None,
        }).collect();
        assert_eq!(text, border, "UTF-8 border corrupted across chunk boundaries");
    }

    /// ITU-style colon sub-params are treated like semicolons so that
    /// SGR 38:5:220 resolves identically to 38;5;220.
    #[test]
    fn colon_sgr_params() {
        let e = events(b"\x1b[38:5:220m");
        assert!(matches!(&e[0], TerminalEvent::Sgr(p) if p == &[38, 5, 220]),
                "colon SGR misparsed: {:?}", &e[0]);
    }
}
