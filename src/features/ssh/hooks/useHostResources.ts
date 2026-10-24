import { useEffect, useRef, useState } from 'react';
import { sshSystemStatus, type SshConnection, type SshSystemStatus } from '../services/api';

export const HOST_METRICS = ['status', 'cpu', 'memory', 'disk', 'network', 'load', 'uptime'] as const;
export type HostMetric = typeof HOST_METRICS[number];
export type HostMetricSelection = Record<HostMetric, boolean>;
export interface HostResourceState {
  data?: SshSystemStatus;
  error?: string;
  busy?: boolean;
  cpu?: number | null;
  download?: number | null;
  upload?: number | null;
  updatedAt?: number;
}

export const resourcePercent = (used?: number | null, total?: number | null) => used != null && total != null && total > 0 ? Math.round(used / total * 100) : null;
export const resourceRate = (value?: number | null) => value == null ? '—' : `${value < 1024 ? value.toFixed(0) : (value / 1024).toFixed(1)} ${value < 1024 ? 'B/s' : 'KB/s'}`;

export function useHostResources(connections: SshConnection[], metrics: HostMetricSelection, enabled: boolean) {
  const [samples, setSamples] = useState<Record<string, HostResourceState>>({});
  const samplesRef = useRef<Record<string, HostResourceState>>({});
  const [revision, setRevision] = useState(0);
  const selectedMetrics = HOST_METRICS.filter(id => metrics[id]).length;
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    if (!enabled || !selectedMetrics || !connections.length) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const collect = async () => {
      if (document.hidden) { timer = setTimeout(() => void collect(), 1000); return; }
      const next = { ...samplesRef.current };
      for (const connection of connections) next[connection.id] = { ...next[connection.id], busy: true };
      setSamples({ ...next });
      for (let index = 0; index < connections.length; index += 3) {
        await Promise.all(connections.slice(index, index + 3).map(async connection => {
          const previous = samplesRef.current[connection.id];
          try {
            const data = await sshSystemStatus(connection.id, connection.host, connection.port ?? 22, connection.user, metrics);
            const now = Date.now();
            const previousData = previous?.data;
            const cpu = previousData?.cpuTotal != null && previousData.cpuIdle != null && data.cpuTotal != null && data.cpuIdle != null
              ? (() => {
                const total = data.cpuTotal - previousData.cpuTotal!;
                const idle = data.cpuIdle - previousData.cpuIdle!;
                return total > 0 && idle >= 0 && idle <= total ? Math.round(100 * (total - idle) / total) : null;
              })() : null;
            const elapsed = previous?.updatedAt ? Math.max(.1, (now - previous.updatedAt) / 1000) : 1;
            const download = previousData?.networkReceived != null && data.networkReceived != null ? Math.max(0, (data.networkReceived - previousData.networkReceived) / elapsed) : null;
            const upload = previousData?.networkTransmitted != null && data.networkTransmitted != null ? Math.max(0, (data.networkTransmitted - previousData.networkTransmitted) / elapsed) : null;
            next[connection.id] = { data, cpu, download, upload, updatedAt: now, busy: false };
          } catch (error) { next[connection.id] = { ...previous, busy: false, error: String((error as Error)?.message ?? error) }; }
        }));
        if (disposed) return;
        samplesRef.current = { ...next }; setSamples({ ...next });
      }
      timer = setTimeout(() => void collect(), 10_000);
    };
    void collect();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [connections, enabled, metrics, revision, selectedMetrics]);
  return { samples, refresh };
}
