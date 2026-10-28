//! StreamScanner: synchronous PTY byte-stream scanner (moved down from streamDispatcher.ts).
//!
//! One pass, events in byte order:
//!   - OSC (\x1b]...\x07 or \x1b]...\x1b\\) becomes an Osc event and is removed from data.
//!   - Alternate-screen CSI (\x1b[?1049/1047/47 h|l) becomes AltEnter/AltExit and is removed from data.
//!   - Remaining bytes, including SGR and ordinary CSI, flow into Data events unchanged.
//!
//! An incomplete ESC sequence at a chunk boundary is kept in pending for the next push.
//!
//! Input is UTF-8 from StreamDecoder; scanning only targets ASCII single bytes and
//! control characters, so byte indexing is safe and every split point is a character boundary.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScanEvent {
    Data { text: String },
    Osc { code: String, payload: String, raw: String },
    AltEnter { raw: String },
    AltExit { raw: String },
}

pub struct StreamScanner {
    pending: String,
}

impl StreamScanner {
    pub fn new() -> Self {
        Self { pending: String::new() }
    }

    pub fn push(&mut self, chunk: &str) -> Vec<ScanEvent> {
        let mut s = std::mem::take(&mut self.pending);
        s.push_str(chunk);

        let bytes = s.as_bytes();
        let len = bytes.len();
        let mut events: Vec<ScanEvent> = Vec::new();
        let mut text_start = 0usize;
        let mut i = 0usize;

        // Flush [text_start, end) as one Data event; end must be a character boundary.
        macro_rules! flush_data {
            ($end:expr) => {
                if $end > text_start {
                    events.push(ScanEvent::Data { text: s[text_start..$end].to_string() });
                }
            };
        }

        while i < len {
            if bytes[i] != 0x1b {
                i += 1;
                continue;
            }
            if i + 1 >= len {
                break; // A lone ESC stays pending.
            }
            match bytes[i + 1] {
                b']' => {
                    // OSC: find BEL or ESC\.
                    let bel = s[i + 2..].find('\x07');
                    let st = s[i + 2..].find("\x1b\\");
                    let (end, term_len) = match (bel, st) {
                        (Some(b), Some(t)) if b < t => (i + 2 + b, 1),
                        (_, Some(t)) => (i + 2 + t, 2),
                        (Some(b), _) => (i + 2 + b, 1),
                        _ => break, // Incomplete OSC stays pending.
                    };
                    let raw = s[i..end + term_len].to_string();
                    let (code, payload) = parse_osc(&s[i + 2..end]);
                    flush_data!(i);
                    events.push(ScanEvent::Osc { code, payload, raw });
                    i = end + term_len;
                    text_start = i;
                }
                b'[' => {
                    // CSI: parameter bytes [0-9;?]* followed by a final byte.
                    let mut j = i + 2;
                    while j < len && matches!(bytes[j], b'0'..=b'9' | b';' | b'?') {
                        j += 1;
                    }
                    if j >= len {
                        break; // Incomplete CSI stays pending.
                    }
                    // Invalid sequences remain data for the terminal parser. In particular,
                    // a non-ASCII character must never become a one-byte string slice.
                    if !(0x40..=0x7e).contains(&bytes[j]) {
                        i = j;
                        continue;
                    }
                    let seq = &s[i..j + 1];
                    if let Some(enter) = alt_dir(seq) {
                        flush_data!(i);
                        events.push(if enter {
                            ScanEvent::AltEnter { raw: seq.to_string() }
                        } else {
                            ScanEvent::AltExit { raw: seq.to_string() }
                        });
                        text_start = j + 1;
                    }
                    // Non-alt CSI stays in data unchanged.
                    i = j + 1;
                }
                // Other ESC sequences such as ESC ( 0 stay in data.
                _ => i += 1,
            }
        }

        // A break on an incomplete sequence settles scanned text and keeps the tail in pending.
        if i < len {
            flush_data!(i);
            self.pending = s[i..].to_string();
        } else {
            flush_data!(len);
        }
        events
    }
}

/// Parse an OSC body into code and payload. The 133 family keeps two segments ('133;A'/'133;D'); others use the first segment.
fn parse_osc(body: &str) -> (String, String) {
    match body.find(';') {
        None => (body.to_string(), String::new()),
        Some(semi) => {
            let num = &body[..semi];
            let rest = &body[semi + 1..];
            if num == "133" {
                match rest.find(';') {
                    None => (format!("133;{rest}"), String::new()),
                    Some(semi2) => (
                        format!("133;{}", &rest[..semi2]),
                        rest[semi2 + 1..].to_string(),
                    ),
                }
            } else {
                (num.to_string(), rest.to_string())
            }
        }
    }
}

/// Alt-screen CSI direction: Some(true) = enter (h), Some(false) = exit (l).
///
/// The DEC private mode may share one CSI with other modes (for example
/// `\x1b[?1049;2004h`), so every parameter is inspected instead of matching the
/// whole sequence. Without this an alt screen leaks into the block terminal and its
/// final frame is captured as a snapshot.
fn alt_dir(seq: &str) -> Option<bool> {
    let body = seq.strip_prefix("\x1b[?")?;
    let (params, final_byte) = body.split_at(body.len().checked_sub(1)?);
    let enter = match final_byte {
        "h" => true,
        "l" => false,
        _ => return None,
    };
    params
        .split(';')
        .any(|param| matches!(param, "1049" | "1047" | "47"))
        .then_some(enter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_csi_preserves_unicode_and_recovers_at_the_next_marker() {
        for sequence in ["\x1b[中", "\x1b[123😀", "\x1b[?1049界"] {
            let mut scanner = StreamScanner::new();
            assert!(scanner.push("\x1b[").is_empty());
            let input = format!("{}\x1b]133;A\x07", &sequence[2..]);
            let events = scanner.push(&input);
            assert!(matches!(&events[0], ScanEvent::Data { text } if text == sequence));
            assert!(matches!(&events[1], ScanEvent::Osc { code, .. } if code == "133;A"));
        }
    }

    const A: &str = "\x1b]133;A\x07";
    const C: &str = "\x1b]133;C\x07";
    const D0: &str = "\x1b]133;D;0\x07";

    fn kinds(events: &[ScanEvent]) -> Vec<&'static str> {
        events
            .iter()
            .map(|e| match e {
                ScanEvent::Data { .. } => "data",
                ScanEvent::Osc { .. } => "osc",
                ScanEvent::AltEnter { .. } => "altEnter",
                ScanEvent::AltExit { .. } => "altExit",
            })
            .collect()
    }

    #[test]
    fn plain_text_passes_through() {
        let mut d = StreamScanner::new();
        assert!(matches!(
            &d.push("hello\r\n")[..],
            [ScanEvent::Data { text }] if text == "hello\r\n"
        ));
    }

    #[test]
    fn osc_133_stripped_and_ordered() {
        let mut d = StreamScanner::new();
        let b64 = base64("ls");
        let ev = d.push(&format!("{A}prompt$ \x1b]133;E;{b64}\x07{C}out\r\n{D0}{A}"));
        assert_eq!(kinds(&ev), ["osc", "data", "osc", "osc", "data", "osc", "osc"]);
        assert!(matches!(&ev[0], ScanEvent::Osc { code, payload, .. } if code == "133;A" && payload.is_empty()));
        assert!(matches!(&ev[1], ScanEvent::Data { text } if text == "prompt$ "));
        assert!(matches!(&ev[2], ScanEvent::Osc { code, payload, .. } if code == "133;E" && payload == &b64));
        assert!(matches!(&ev[3], ScanEvent::Osc { code, .. } if code == "133;C"));
        assert!(matches!(&ev[4], ScanEvent::Data { text } if text == "out\r\n"));
        assert!(matches!(&ev[5], ScanEvent::Osc { code, payload, .. } if code == "133;D" && payload == "0"));
        assert!(matches!(&ev[6], ScanEvent::Osc { code, .. } if code == "133;A"));
    }

    #[test]
    fn osc_supports_st_terminator() {
        let mut d = StreamScanner::new();
        let ev = d.push("\x1b]133;A\x1b\\x");
        assert!(matches!(&ev[0], ScanEvent::Osc { code, .. } if code == "133;A"));
        assert!(matches!(&ev[1], ScanEvent::Data { text } if text == "x"));
    }

    #[test]
    fn osc_joins_across_chunks() {
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push("ab\x1b]13")[..], [ScanEvent::Data { text }] if text == "ab"));
        let ev = d.push("3;A\x07cd");
        assert!(matches!(&ev[0], ScanEvent::Osc { code, .. } if code == "133;A"));
        assert!(matches!(&ev[1], ScanEvent::Data { text } if text == "cd"));
    }

    #[test]
    fn csi_incomplete_joins_across_chunks() {
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push("x\x1b[?10")[..], [ScanEvent::Data { text }] if text == "x"));
        let ev = d.push("49hy");
        assert!(matches!(&ev[0], ScanEvent::AltEnter { .. }));
        assert!(matches!(&ev[1], ScanEvent::Data { text } if text == "y"));
    }

    #[test]
    fn alt_sequences_stripped_from_data() {
        let mut d = StreamScanner::new();
        let ev = d.push("before\x1b[?1049hafter\x1b[?1049lend");
        assert_eq!(kinds(&ev), ["data", "altEnter", "data", "altExit", "data"]);
        assert!(matches!(&ev[0], ScanEvent::Data { text } if text == "before"));
        assert!(matches!(&ev[2], ScanEvent::Data { text } if text == "after"));
        assert!(matches!(&ev[4], ScanEvent::Data { text } if text == "end"));
    }

    #[test]
    fn alt_47_1047_variants_recognized() {
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push("\x1b[?47h")[0], ScanEvent::AltEnter { .. }));
        assert!(matches!(&d.push("\x1b[?1047l")[0], ScanEvent::AltExit { .. }));
    }

    #[test]
    fn alt_combined_with_other_modes_recognized() {
        let mut d = StreamScanner::new();
        let ev = d.push("a\x1b[?1049;2004hb\x1b[?1049;2004lc");
        assert_eq!(kinds(&ev), ["data", "altEnter", "data", "altExit", "data"]);
        assert!(matches!(&ev[1], ScanEvent::AltEnter { raw } if raw == "\x1b[?1049;2004h"));
        assert!(matches!(&ev[3], ScanEvent::AltExit { raw } if raw == "\x1b[?1049;2004l"));
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push("\x1b[?47;25h")[0], ScanEvent::AltEnter { .. }));
    }

    #[test]
    fn other_private_modes_not_stripped() {
        let mut d = StreamScanner::new();
        assert!(matches!(
            &d.push("\x1b[?2004h\x1b[?25l")[..],
            [ScanEvent::Data { text }] if text == "\x1b[?2004h\x1b[?25l"
        ));
    }

    #[test]
    fn sgr_not_stripped() {
        let mut d = StreamScanner::new();
        assert!(matches!(
            &d.push("\x1b[31mred\x1b[0m")[..],
            [ScanEvent::Data { text }] if text == "\x1b[31mred\x1b[0m"
        ));
    }

    #[test]
    fn osc_7_and_0_stripped() {
        let mut d = StreamScanner::new();
        let ev = d.push("\x1b]7;file://h/Users/w\x07\x1b]0;title\x07");
        assert!(matches!(&ev[0], ScanEvent::Osc { code, payload, .. } if code == "7" && payload == "file://h/Users/w"));
        assert!(matches!(&ev[1], ScanEvent::Osc { code, payload, .. } if code == "0" && payload == "title"));
    }

    #[test]
    fn osc_8_hyperlink_keeps_raw() {
        let mut d = StreamScanner::new();
        let raw = "\x1b]8;;https://a.com\x07";
        let ev = d.push(&format!("{raw}link\x1b]8;;\x07"));
        assert!(matches!(&ev[0], ScanEvent::Osc { code, raw: r, .. } if code == "8" && r == raw));
        assert!(matches!(&ev[1], ScanEvent::Data { text } if text == "link"));
    }

    #[test]
    fn raw_field_contains_full_sequence() {
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push(A)[0], ScanEvent::Osc { raw, .. } if raw == A));
    }

    #[test]
    fn trailing_isolated_esc_stays_pending() {
        let mut d = StreamScanner::new();
        assert!(matches!(&d.push("abc\x1b")[..], [ScanEvent::Data { text }] if text == "abc"));
        assert!(matches!(&d.push("[0m")[..], [ScanEvent::Data { text }] if text == "\x1b[0m"));
    }

    /// Test-only base64 (std has no public base64; the 133;E payload only needs to round-trip).
    fn base64(s: &str) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes = s.as_bytes();
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        out
    }
}
