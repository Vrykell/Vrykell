use portable_pty::{Child, MasterPty};
use std::io::Write;
use std::sync::atomic::AtomicU16;
use std::sync::{Arc, Mutex};

use crate::core::models::SessionInfo;

/// Managed PTY session — metadata + shared child + stdin writer + master for resize
pub struct ManagedSession {
    pub info: SessionInfo,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    pub writer: Box<dyn Write + Send>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Current PTY dimensions, shared with the reader thread so every
    /// emitted output batch can be tagged with the dims it was generated at.
    pub cols: Arc<AtomicU16>,
    pub rows: Arc<AtomicU16>,
}
