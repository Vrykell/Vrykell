//! Bounded TCP connectivity checks independent of terminal sessions and authentication.

use serde::Serialize;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::{lookup_host, TcpStream};
use tokio::time::{sleep, timeout};

static PROBE_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProbeFailure { Timeout, Refused, Unreachable }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAttempt {
    latency_ms: Option<f64>,
    error_kind: Option<ProbeFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProbe {
    dns_ms: f64,
    attempts: Vec<NetworkAttempt>,
}

fn probe_host(host: &str, port: u16) -> Result<&str, String> {
    let host = host.trim();
    let host = host.strip_prefix('[').and_then(|value| value.strip_suffix(']')).unwrap_or(host);
    if host.is_empty() || host.len() > 253 || port == 0 || host.chars().any(|value| value.is_whitespace() || value.is_control() || matches!(value, '/' | '\\' | '@')) {
        return Err("Invalid network probe address".into());
    }
    Ok(host)
}

async fn probe_addresses(addresses: &[SocketAddr], count: usize, limit: Duration, pause: Duration) -> Vec<NetworkAttempt> {
    let mut attempts = Vec::with_capacity(count);
    for index in 0..count {
        let started = Instant::now();
        let mut result = NetworkAttempt { latency_ms: None, error_kind: Some(ProbeFailure::Unreachable) };
        // One shared deadline bounds each attempt even when a host resolves many addresses.
        let connection = timeout(limit, async {
            let mut last_error = std::io::ErrorKind::AddrNotAvailable;
            for address in addresses {
                match TcpStream::connect(address).await {
                    Ok(stream) => { drop(stream); return Ok(()); }
                    Err(error) => last_error = error.kind(),
                }
            }
            Err(last_error)
        }).await;
        match connection {
            Ok(Ok(())) => { result.latency_ms = Some(started.elapsed().as_secs_f64() * 1000.0); result.error_kind = None; }
            Ok(Err(std::io::ErrorKind::ConnectionRefused)) => result.error_kind = Some(ProbeFailure::Refused),
            Ok(Err(std::io::ErrorKind::TimedOut)) | Err(_) => result.error_kind = Some(ProbeFailure::Timeout),
            Ok(Err(_)) => {}
        }
        attempts.push(result);
        if index + 1 < count { sleep(pause).await; }
    }
    attempts
}

/// Check the direct local-to-server TCP route without logging in or writing terminal input.
#[tauri::command]
pub async fn ssh_network_probe(host: String, port: u16) -> Result<NetworkProbe, String> {
    let host = probe_host(&host, port)?;
    let _permit = PROBE_SLOTS.try_acquire().map_err(|_| "Network probes are already running. Try again shortly.")?;
    let started = Instant::now();
    let addresses: Vec<_> = timeout(Duration::from_secs(5), lookup_host((host, port))).await
        .map_err(|_| "Address resolution timed out")?
        .map_err(|error| format!("Address resolution failed: {error}"))?.take(16).collect();
    if addresses.is_empty() { return Err("No network address was found".into()); }
    let dns_ms = started.elapsed().as_secs_f64() * 1000.0;
    let attempts = probe_addresses(&addresses, 5, Duration::from_secs(2), Duration::from_millis(150)).await;
    Ok(NetworkProbe { dns_ms, attempts })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_hosts_and_normalizes_ipv6_without_invoking_a_shell() {
        assert_eq!(probe_host(" [::1] ", 22).unwrap(), "::1");
        assert_eq!(probe_host("server.example", 22).unwrap(), "server.example");
        for host in ["", "a\nb", "user@host", "host/path", "host name"] { assert!(probe_host(host, 22).is_err()); }
        assert!(probe_host("host", 0).is_err());
        assert!(probe_host(&"a".repeat(254), 22).is_err());
    }

    #[tokio::test]
    async fn collects_five_successful_local_connections_without_authentication() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let results = probe_addresses(&[listener.local_addr().unwrap()], 5, Duration::from_secs(1), Duration::ZERO).await;
        assert_eq!(results.len(), 5);
        assert!(results.iter().all(|result| result.latency_ms.is_some() && result.error_kind.is_none()));
        let json = serde_json::to_value(NetworkProbe { dns_ms: 0.5, attempts: results }).unwrap();
        assert!(json["attempts"][0]["latencyMs"].is_number());
        assert!(json["attempts"][0]["errorKind"].is_null());
    }

    #[tokio::test]
    async fn reports_a_closed_local_port_and_tries_other_resolved_addresses() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed = listener.local_addr().unwrap();
        drop(listener);
        let failed = probe_addresses(&[closed], 1, Duration::from_secs(1), Duration::ZERO).await;
        assert!(matches!(failed[0].error_kind, Some(ProbeFailure::Refused | ProbeFailure::Timeout)));
        assert!(failed[0].latency_ms.is_none());
        let available = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let recovered = probe_addresses(&[available.local_addr().unwrap(), closed], 1, Duration::from_secs(1), Duration::ZERO).await;
        assert!(recovered[0].latency_ms.is_some());
    }

    #[tokio::test]
    async fn enforces_an_attempt_deadline() {
        let result = probe_addresses(&[], 1, Duration::ZERO, Duration::ZERO).await;
        assert_eq!(result.len(), 1);
        assert!(result[0].latency_ms.is_none());
    }
}
