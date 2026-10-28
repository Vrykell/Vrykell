import { describe, it, expect, vi, beforeEach } from 'vitest';

const ptyWriteMock = vi.hoisted(() => vi.fn());

vi.mock('@platform/pty', () => ({ ptyWrite: ptyWriteMock }));

import {
  TERMINAL_INPUT_CHUNK_UNITS,
  cancelTerminalInput,
  writeTerminalInput,
  writeTerminalPaste,
} from '@features/terminal/services/terminalWriteQueue';

interface PendingWrite {
  data: string;
  settle: () => void;
  fail: (error: unknown) => void;
}

/** Hand each write back to the test so it can watch the queue while a write is in flight. */
function deferredWrites(): PendingWrite[] {
  const pending: PendingWrite[] = [];
  ptyWriteMock.mockImplementation((_id: string, data: string) => new Promise<void>((resolve, reject) => {
    pending.push({ data, settle: resolve, fail: reject });
  }));
  return pending;
}

const callData = () => ptyWriteMock.mock.calls.map((call) => call[1] as string);

describe('terminalWriteQueue', () => {
  beforeEach(() => {
    ptyWriteMock.mockReset();
  });

  it('writes a short payload in one call', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    await writeTerminalInput('short', 'ls\r');
    expect(ptyWriteMock).toHaveBeenCalledExactlyOnceWith('short', 'ls\r');
  });

  it('ignores an empty payload', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    await writeTerminalInput('empty', '');
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('splits a long payload into ordered chunks that reassemble to the payload', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    const payload = 'x'.repeat(TERMINAL_INPUT_CHUNK_UNITS * 2 + 7);
    await writeTerminalInput('long', payload);
    const chunks = callData();
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.length))
      .toEqual([TERMINAL_INPUT_CHUNK_UNITS, TERMINAL_INPUT_CHUNK_UNITS, 7]);
    expect(chunks.join('')).toBe(payload);
  });

  it('never splits a surrogate pair across two writes', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    const payload = `${'a'.repeat(TERMINAL_INPUT_CHUNK_UNITS - 1)}😀tail`;
    await writeTerminalInput('astral', payload);
    const chunks = callData();
    // The pair that straddles the boundary travels whole: the chunk grows by one code unit.
    expect(chunks[0]).toHaveLength(TERMINAL_INPUT_CHUNK_UNITS + 1);
    expect(chunks.join('')).toBe(payload);
    const strays = chunks.filter((chunk) => {
      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      return (first >= 0xdc00 && first <= 0xdfff) || (last >= 0xd800 && last <= 0xdbff);
    });
    expect(strays).toEqual([]);
  });

  it('keeps the order of writes that arrive while one is in flight', async () => {
    const pending = deferredWrites();
    const first = writeTerminalInput('order', 'a');
    const second = writeTerminalInput('order', 'b');
    expect(pending.map((write) => write.data)).toEqual(['a']);

    pending[0]!.settle();
    await vi.waitFor(() => expect(pending.map((write) => write.data)).toEqual(['a', 'b']));
    pending[1]!.settle();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('sends the next chunk only after the previous write resolved', async () => {
    const pending = deferredWrites();
    const payload = 'y'.repeat(TERMINAL_INPUT_CHUNK_UNITS + 5);
    const done = writeTerminalInput('serial', payload);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]!.data).toHaveLength(TERMINAL_INPUT_CHUNK_UNITS);

    pending[0]!.settle();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.data).toHaveLength(5);
    pending[1]!.settle();
    await done;
    expect(callData().join('')).toBe(payload);
  });

  it('drops the rest of a paste when an interrupt arrives', async () => {
    const pending = deferredWrites();
    const paste = writeTerminalInput('interrupt', 'z'.repeat(TERMINAL_INPUT_CHUNK_UNITS * 4));
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    const firstChunk = pending[0]!.data;
    const interrupt = writeTerminalInput('interrupt', '\x03');
    pending[0]!.settle();
    // The interrupt leads the queue: the chunks the paste still had never go out.
    await vi.waitFor(() => expect(pending.map((write) => write.data)).toEqual([firstChunk, '\x03']));
    pending[1]!.settle();
    await expect(Promise.all([paste, interrupt])).resolves.toEqual([undefined, undefined]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(2);
  });

  it('stops the queue and rejects the caller when a write fails', async () => {
    const pending = deferredWrites();
    const payload = 'q'.repeat(TERMINAL_INPUT_CHUNK_UNITS + 3);
    const rejected = expect(writeTerminalInput('broken', payload)).rejects.toThrow('session not found');
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    pending[0]!.fail(new Error('session not found'));
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(1);
  });

  it('cancel drops the writes a leaving session had queued', async () => {
    const pending = deferredWrites();
    const write = writeTerminalInput('closing', 'w'.repeat(TERMINAL_INPUT_CHUNK_UNITS * 3));
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    cancelTerminalInput('closing');
    pending[0]!.settle();
    await expect(write).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(1);
  });

  it('never starts a paste whose foreground owner is already stale', async () => {
    const paste = writeTerminalPaste('stale', { epoch: 7, isCurrent: () => false }, () => {
      void writeTerminalInput('stale', 'unintended command\r');
    });
    await expect(paste).rejects.toThrow('terminal input target changed');
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('drops a paste tail when its owner exits while the first chunk is in flight', async () => {
    const pending = deferredWrites(); let current = true;
    const paste = writeTerminalPaste('owner', { epoch: 3, isCurrent: () => current }, () => {
      void writeTerminalInput('owner', `${'x'.repeat(4096)}\runintended command\r`);
    });
    const stopped = expect(paste).rejects.toThrow('terminal input target changed');
    expect(pending[0]!.data).toHaveLength(1024);
    expect(ptyWriteMock).toHaveBeenCalledExactlyOnceWith('owner', pending[0]!.data, 3);
    current = false; pending[0]!.settle(); await stopped;
    expect(pending).toHaveLength(1);
    const keyboard = writeTerminalInput('owner', 'intentional input');
    await vi.waitFor(() => expect(pending).toHaveLength(2)); pending[1]!.settle(); await keyboard;
    expect(pending[1]!.data).toBe('intentional input');
  });
});
