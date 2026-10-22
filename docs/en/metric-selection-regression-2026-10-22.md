# Resource selection contract, 2026-10-22

The existing resource command now accepts an optional typed selection for status, CPU, memory, disk, network, load and uptime. Disabled sections are absent from the fixed remote script; disabling status also omits the metadata and latency probe. Disabling everything returns before creating a remote connection. Callers that omit the selection retain complete collection.

The frontend API forwards explicit selections while preserving legacy arguments. This is the collection contract for the upcoming dashboard controls; it does not introduce background dashboard polling by itself. Existing saved-profile identity, host trust, authentication, timeouts and output bounds remain in place.

Typechecking and architecture checks passed with the existing two-command advisory. Full frontend unit tests passed 2068 with one skipped. Full backend tests passed 267 with three ignored integration cases. All nine existing status browser scenarios passed. Evidence is in [the collection-contract folder](../audit-evidence/2026-10-22/metric-selection/).
