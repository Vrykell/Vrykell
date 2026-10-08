//! Exercise the production output window with real editor chunks in browser tests.
#[path = "../src-tauri/src/terminal/output_batch.rs"]
mod output_batch;

use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::time::Instant;

fn main() {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let mut window = output_batch::OutputBatchWindow::new(Instant::now());
    let mut input_pending = false;
    let mut pending = Vec::new();
    let mut bytes = 0;
    loop {
        let flush = match rx.recv_timeout(window.wait_timeout(Instant::now())) {
            Ok(line) if line == "input" => {
                input_pending = true;
                false
            }
            Ok(line) => {
                if input_pending {
                    window.input_response(Instant::now());
                    input_pending = false;
                }
                bytes += line.len() / 4 * 3
                    - line.bytes().rev().take_while(|byte| *byte == b'=').count();
                pending.push(format!("\"{line}\""));
                window.should_flush(bytes, Instant::now())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => !pending.is_empty(),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if flush {
            println!("[{}]", pending.join(","));
            io::stdout().flush().unwrap();
            pending.clear();
            bytes = 0;
            window.flushed(Instant::now());
        }
    }
}
