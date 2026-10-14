use std::time::{Duration, Instant};

/// Time span one summary line covers. A full-screen program emits a chunk per frame, so one line
/// per chunk buries the log; the window keeps the same counters at one line per span.
pub const IO_WINDOW: Duration = Duration::from_millis(1000);
/// Silence below this is ordinary thinking time for the foreground program.
const IDLE_MIN: Duration = Duration::from_millis(1000);

/// What one flushed output batch contributes to the window.
#[derive(Default)]
pub struct OutputStats {
    pub events: usize,
    pub data_bytes: usize,
    pub osc: usize,
    pub alt: usize,
}

/// Per-span counters of the reader loop: reads, flushed batches, and the holds that keep an input
/// repaint together. The open window is written once it is over; a silence that keeps growing is
/// recorded as it doubles, so a session that stopped producing output leaves a trail.
pub struct ReaderWindow {
    start: Instant,
    reads: usize,
    read_bytes: usize,
    chars: usize,
    max_read_bytes: usize,
    outputs: usize,
    events: usize,
    data_bytes: usize,
    osc: usize,
    alt: usize,
    held: usize,
    max_gap: Duration,
    last_read: Instant,
    next_idle: Duration,
}

impl ReaderWindow {
    pub fn new(now: Instant) -> Self {
        Self {
            start: now,
            reads: 0,
            read_bytes: 0,
            chars: 0,
            max_read_bytes: 0,
            outputs: 0,
            events: 0,
            data_bytes: 0,
            osc: 0,
            alt: 0,
            held: 0,
            max_gap: Duration::ZERO,
            last_read: now,
            next_idle: IDLE_MIN,
        }
    }

    /// One read from the PTY; `chars` is the text the decoder produced from it.
    pub fn read(&mut self, now: Instant, bytes: usize, chars: usize) {
        self.max_gap = self.max_gap.max(now.saturating_duration_since(self.last_read));
        self.last_read = now;
        self.next_idle = IDLE_MIN;
        self.reads += 1;
        self.read_bytes += bytes;
        self.chars += chars;
        self.max_read_bytes = self.max_read_bytes.max(bytes);
    }

    /// One flushed output batch and what it carried.
    pub fn output(&mut self, stats: OutputStats) {
        self.outputs += 1;
        self.events += stats.events;
        self.data_bytes += stats.data_bytes;
        self.osc += stats.osc;
        self.alt += stats.alt;
    }

    /// A batch held for the short input-response window.
    pub fn held(&mut self) {
        self.held += 1;
    }

    /// The window line once [`IO_WINDOW`] has passed; `None` while the window is still open.
    pub fn take(&mut self, now: Instant, id: &str) -> Option<String> {
        let span = now.saturating_duration_since(self.start);
        if span < IO_WINDOW {
            return None;
        }
        self.start = now;
        self.drain(span, id)
    }

    /// The window line for a session that is ending: a partial window still carries the last reads
    /// that arrived before the process went away.
    pub fn finish(&mut self, now: Instant, id: &str) -> Option<String> {
        let span = now.saturating_duration_since(self.start);
        self.start = now;
        self.drain(span, id)
    }

    fn drain(&mut self, span: Duration, id: &str) -> Option<String> {
        let line = (self.reads > 0 || self.outputs > 0).then(|| {
            format!(
                "id={} ms={} reads={} read_bytes={} chars={} max_read={} outputs={} events={} data_bytes={} osc={} alt={} held={} max_gap_ms={}",
                id,
                span.as_millis(),
                self.reads,
                self.read_bytes,
                self.chars,
                self.max_read_bytes,
                self.outputs,
                self.events,
                self.data_bytes,
                self.osc,
                self.alt,
                self.held,
                self.max_gap.as_millis(),
            )
        });
        self.reads = 0;
        self.read_bytes = 0;
        self.chars = 0;
        self.max_read_bytes = 0;
        self.outputs = 0;
        self.events = 0;
        self.data_bytes = 0;
        self.osc = 0;
        self.alt = 0;
        self.held = 0;
        self.max_gap = Duration::ZERO;
        line
    }

    /// A silence line once the gap since the last read has doubled past [`IDLE_MIN`].
    pub fn idle(&mut self, now: Instant, id: &str) -> Option<String> {
        let idle = now.saturating_duration_since(self.last_read);
        if idle < self.next_idle {
            return None;
        }
        self.next_idle = idle.saturating_mul(2);
        Some(format!("id={} idle_ms={}", id, idle.as_millis()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_window_aggregates_reads_batches_and_holds() {
        let start = Instant::now();
        let mut window = ReaderWindow::new(start);
        window.read(start + Duration::from_millis(10), 1024, 1000);
        window.read(start + Duration::from_millis(200), 4096, 4000);
        window.output(OutputStats {
            events: 2,
            data_bytes: 4096,
            osc: 1,
            alt: 0,
        });
        window.held();
        window.output(OutputStats {
            events: 3,
            data_bytes: 1024,
            osc: 0,
            alt: 1,
        });
        assert_eq!(window.take(start + Duration::from_millis(999), "pty-a"), None);
        let line = window.take(start + Duration::from_millis(1000), "pty-a").unwrap();
        assert!(line.contains("reads=2"), "{line}");
        assert!(line.contains("read_bytes=5120"), "{line}");
        assert!(line.contains("chars=5000"), "{line}");
        assert!(line.contains("max_read=4096"), "{line}");
        assert!(line.contains("outputs=2"), "{line}");
        assert!(line.contains("events=5"), "{line}");
        assert!(line.contains("data_bytes=5120"), "{line}");
        assert!(line.contains("osc=1"), "{line}");
        assert!(line.contains("alt=1"), "{line}");
        assert!(line.contains("held=1"), "{line}");
        assert!(line.contains("max_gap_ms=190"), "{line}");
        // The next window starts empty.
        assert_eq!(window.take(start + Duration::from_millis(2000), "pty-a"), None);
    }

    #[test]
    fn an_idle_window_writes_nothing() {
        let start = Instant::now();
        let mut window = ReaderWindow::new(start);
        assert_eq!(window.take(start + IO_WINDOW, "pty-a"), None);
        assert_eq!(window.take(start + IO_WINDOW * 2, "pty-a"), None);
        assert_eq!(window.finish(start + IO_WINDOW * 3, "pty-a"), None);
    }

    #[test]
    fn a_session_that_ends_mid_window_keeps_its_last_reads() {
        let start = Instant::now();
        let mut window = ReaderWindow::new(start);
        window.read(start + Duration::from_millis(800), 4096, 4000);
        assert_eq!(window.take(start + Duration::from_millis(900), "pty-a"), None);
        let line = window.finish(start + Duration::from_millis(950), "pty-a").unwrap();
        assert!(line.contains("ms=950"), "{line}");
        assert!(line.contains("reads=1"), "{line}");
        assert!(line.contains("read_bytes=4096"), "{line}");
        // The counters are spent; a second finish has nothing left to report.
        assert_eq!(window.finish(start + Duration::from_millis(1000), "pty-a"), None);
    }

    #[test]
    fn growing_silence_is_recorded_as_it_doubles() {
        let start = Instant::now();
        let mut window = ReaderWindow::new(start);
        window.read(start, 64, 64);
        assert_eq!(window.idle(start + Duration::from_millis(900), "pty-a"), None);
        assert!(window.idle(start + Duration::from_millis(1000), "pty-a")
            .unwrap()
            .contains("idle_ms=1000"));
        assert_eq!(window.idle(start + Duration::from_millis(1500), "pty-a"), None);
        assert!(window.idle(start + Duration::from_millis(2000), "pty-a")
            .unwrap()
            .contains("idle_ms=2000"));
        assert_eq!(window.idle(start + Duration::from_millis(3000), "pty-a"), None);
        assert!(window.idle(start + Duration::from_millis(4000), "pty-a")
            .unwrap()
            .contains("idle_ms=4000"));
        // A read resets the trail, so a later silence is reported from one second again.
        window.read(start + Duration::from_millis(4100), 8, 8);
        assert_eq!(window.idle(start + Duration::from_millis(5000), "pty-a"), None);
        assert!(window.idle(start + Duration::from_millis(5100), "pty-a")
            .unwrap()
            .contains("idle_ms=1000"));
    }
}
