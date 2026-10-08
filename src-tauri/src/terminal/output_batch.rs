use std::time::{Duration, Instant};

pub const FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const INPUT_RESPONSE_WINDOW: Duration = Duration::from_millis(2);
const FLUSH_BYTES: usize = 32 * 1024;

/// Keep an input repaint and its immediate cleanup together without a full output-frame delay.
pub struct OutputBatchWindow {
    last_flush: Instant,
    response_until: Option<Instant>,
}

impl OutputBatchWindow {
    pub fn new(now: Instant) -> Self {
        Self {
            last_flush: now,
            response_until: None,
        }
    }

    pub fn input_response(&mut self, now: Instant) {
        self.response_until
            .get_or_insert(now + INPUT_RESPONSE_WINDOW);
    }

    pub fn wait_timeout(&self, now: Instant) -> Duration {
        self.response_until
            .map_or(FLUSH_INTERVAL, |until| until.saturating_duration_since(now))
    }

    pub fn should_flush(&self, bytes: usize, now: Instant) -> bool {
        bytes >= FLUSH_BYTES
            || self.response_until.map_or_else(
                || now.duration_since(self.last_flush) >= FLUSH_INTERVAL,
                |until| now >= until,
            )
    }

    pub fn flushed(&mut self, now: Instant) {
        self.last_flush = now;
        self.response_until = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_repaint_and_cleanup_share_a_bounded_window() {
        let now = Instant::now();
        let mut batch = OutputBatchWindow::new(now - FLUSH_INTERVAL);
        batch.input_response(now);
        assert!(!batch.should_flush(40, now));
        assert_eq!(batch.wait_timeout(now), Duration::from_millis(2));
        // A second chunk or key cannot extend the response past its original deadline.
        batch.input_response(now + Duration::from_millis(1));
        assert!(!batch.should_flush(80, now + Duration::from_millis(1)));
        assert!(batch.should_flush(80, now + Duration::from_millis(2)));
        batch.flushed(now + Duration::from_millis(2));
        assert_eq!(
            batch.wait_timeout(now + Duration::from_millis(2)),
            FLUSH_INTERVAL
        );
    }

    #[test]
    fn sustained_output_retains_frame_and_size_limits() {
        let now = Instant::now();
        let mut batch = OutputBatchWindow::new(now);
        assert!(!batch.should_flush(1, now));
        assert!(batch.should_flush(1, now + FLUSH_INTERVAL));
        batch.input_response(now);
        assert!(batch.should_flush(FLUSH_BYTES, now));
        assert_eq!(
            batch.wait_timeout(now + Duration::from_millis(4)),
            Duration::ZERO
        );
    }
}
