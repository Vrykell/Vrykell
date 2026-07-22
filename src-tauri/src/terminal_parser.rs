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
            let text = String::from_utf8_lossy(&buf[text_start..]).into_owned();
            if !text.is_empty() { self.events.push(TerminalEvent::Text(text)); }
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

        // Parse semicolon-separated integers.
        let mut p: Vec<u16> = Vec::with_capacity(4);
        let mut n: u16 = 0;
        let mut has_digit = false;
        for &b in param_slice {
            if b.is_ascii_digit() {
                n = n.saturating_mul(10).saturating_add((b - b'0') as u16);
                has_digit = true;
            } else if b == b';' {
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

        match final_byte {
            b'm' => self.events.push(TerminalEvent::Sgr(p)),
            b'A' => self.events.push(TerminalEvent::Cuu(p.first().copied().unwrap_or(1))),
            b'B' => self.events.push(TerminalEvent::Cud(p.first().copied().unwrap_or(1))),
            b'C' => self.events.push(TerminalEvent::Cuf(p.first().copied().unwrap_or(1))),
            b'D' => self.events.push(TerminalEvent::Cub(p.first().copied().unwrap_or(1))),
            b'H' => self.events.push(TerminalEvent::Cup(
                p.first().copied().unwrap_or(1),
                p.get(1).copied().unwrap_or(1),
            )),
            b'G' => self.events.push(TerminalEvent::Cha(p.first().copied().unwrap_or(1))),
            b'd' => self.events.push(TerminalEvent::Vpa(p.first().copied().unwrap_or(1))),
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
}
