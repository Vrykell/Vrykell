/**
 * Fresh-store defaults: the store must not hydrate from another suite's localStorage, so this
 * file only asserts the shipped level table.
 */
import { expect, it } from 'vitest';
import { usePermissions } from '@features/agent/stores/permissions';

it('ships safe defaults for durable writes and third-party capabilities', () => {
  const levels = usePermissions.getState().levels;
  // Executing things asks by default.
  expect(levels.run_command).toBe('ask');
  expect(levels.write_file).toBe('ask');
  expect(levels.edit_file).toBe('ask');
  expect(levels.terminal_keys).toBe('ask');
  // Installing a skill writes instructions that are trusted afterwards; MCP tools are
  // arbitrary third-party capabilities.
  expect(levels.install_skill).toBe('ask');
  expect(levels.mcp).toBe('ask');
  // Reads stay frictionless; memory writes are gated per action instead.
  expect(levels.read_file).toBe('allow');
  expect(levels.list_dir).toBe('allow');
  expect(levels.read_terminal).toBe('allow');
  expect(levels.memory).toBe('allow');
  expect(levels.web_fetch).toBe('allow');
});
