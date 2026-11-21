import { agentDrivers } from './agentDrivers';
import { useAiWorkspace } from '../stores/aiWorkspace';

export function closeAiWorkspaceSession(id = useAiWorkspace.getState().selected, force = false) {
  const driver = Object.values(agentDrivers).find((candidate) => id.startsWith(candidate.prefix));
  driver?.close(id.slice(driver.prefix.length), force);
}
