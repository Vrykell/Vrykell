#!/usr/bin/env node
/**
 * fake-acp-agent.mjs — a scripted ACP agent, for trying the harness session without installing one.
 *
 * Usage: add a harness in the app that runs `node` with this file as its only argument, then press
 * "test connection" and "connect". It answers the handshake, creates a session, streams a short
 * turn (two message chunks, a thought and a tool call), asks for permission once and finishes with
 * `end_turn`; `session/cancel` ends the turn early. Nothing here is a real agent: it prints what it
 * receives so the protocol traffic can be watched in a terminal.
 */
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const note = (text) => process.stderr.write(`[fake-acp] ${text}\n`);

const rl = createInterface({ input: process.stdin });
let cancelled = false;

rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    note(`unparsable line: ${line.slice(0, 80)}`);
    return;
  }
  const { id, method, params } = message;

  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: 'fake-acp', title: 'Fake ACP agent', version: '0.1.0' },
        authMethods: [],
      },
    });
  }

  if (method === 'session/new') {
    note(`session in ${params?.cwd}`);
    return send({ jsonrpc: '2.0', id, result: { sessionId: 'sess_fake' } });
  }

  if (method === 'session/cancel') {
    cancelled = true;
    note('cancel requested');
    return;
  }

  if (method === 'session/prompt') {
    cancelled = false;
    const text = (params?.prompt ?? []).map((block) => block?.text ?? '').join(' ');
    const sessionId = params?.sessionId ?? 'sess_fake';
    const update = (update) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });

    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `thinking about "${text}"` } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Got it. ' } });
    update({
      sessionUpdate: 'tool_call', toolCallId: 'call_fake', title: 'Read the project file', kind: 'read', status: 'pending',
    });

    // Ask for permission the way a real agent would; a client that is not wired to an approval card
    // refuses, and the turn still has to end cleanly.
    send({
      jsonrpc: '2.0', id: 4242, method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'call_fake', title: 'Read the project file' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    update({
      sessionUpdate: 'tool_call_update', toolCallId: 'call_fake', status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'read 12 lines' } }],
    });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `You said: ${text}` } });

    const finish = () => send({ jsonrpc: '2.0', id, result: { stopReason: cancelled ? 'cancelled' : 'end_turn' } });
    // A beat between the chunks, so a stop request can land in the middle of a turn.
    setTimeout(finish, 600);
    return;
  }

  // Anything else: answer as an error rather than staying silent.
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `fake agent does not implement ${method}` } });
  }
});

rl.on('close', () => process.exit(0));
