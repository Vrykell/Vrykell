import '@xterm/xterm/css/xterm.css';
import { useXterm } from './useXterm';

export default function TerminalPanel({ onReady }: { onReady: (sessionId: string) => void }) {
  const ref = useXterm(onReady);
  return <div ref={ref} style={{ width: '100%', height: '100%', padding: 4, background: '#0e0f11' }} />;
}
