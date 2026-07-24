use crate::core::models::SessionInfo;

/// Payload emitted from Rust to frontend for PTY output.
/// Events are pre-parsed escape sequences — the frontend no longer parses raw bytes.
///
/// `cols`/`rows` tag the batch with the PTY dimensions in effect when the
/// bytes were read.  The frontend resizes its buffer to these values BEFORE
/// applying the events, so output generated at the old width during a window
/// drag is never interpreted at the new width (which caused wrapped-line
/// divergence and stale residual characters at the bottom of TUI frames).
#[derive(Clone, serde::Serialize)]
pub struct PtyOutputPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub events: Vec<crate::pty::parser::TerminalEvent>,
    pub cols: u16,
    pub rows: u16,
}

/// Payload for PTY exit event
#[derive(Clone, serde::Serialize)]
pub struct PtyExitPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

/// Payload for session created event
#[derive(Clone, serde::Serialize)]
pub struct SessionCreatedPayload {
    pub session: SessionInfo,
}

/// Payload for session closed event
#[derive(Clone, serde::Serialize)]
pub struct SessionClosedPayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

/// Payload for title change event
#[derive(Clone, serde::Serialize)]
pub struct TitleChangePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub title: String,
}
