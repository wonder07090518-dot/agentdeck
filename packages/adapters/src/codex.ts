import { detectBinary, type AgentAdapter } from './index.js';
import { execFileSync } from 'node:child_process';
import { redact } from './claude.js';

export const codex: AgentAdapter = {
  id: 'codex',
  detect: async () => {
    const info = await detectBinary('codex', process.env.AGENTDECK_CODEX_BIN || 'codex');
    if(info)try{const status=execFileSync(process.env.AGENTDECK_CODEX_BIN||'codex',['login','status'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','pipe']});info.authenticated=/Logged in/i.test(status);}catch{}
    return info ? {...info,supports:{jsonOut:true,resume:false,interactive:false,permissions:false}} : null;
  },
  buildDelegateRun(request) {
    if (request.sessionRef) throw Error('Codex 续跑暂未实现，请新建任务');
    return {
      cmd: process.env.AGENTDECK_CODEX_BIN || 'codex',
      args: ['exec', '--json', '--sandbox', 'workspace-write',
        ...(!request.workspace.gitRoot ? ['--skip-git-repo-check'] : []), request.prompt],
      cwd: request.workspace.path, env: process.env, stdin: 'closed', parseMode: 'jsonl',
    };
  },
  buildAttachRun() { throw Error('not_implemented'); },
  resumeArgs() { throw Error('Codex 续跑暂未实现'); },
  mapExit: (code, stderr) => ({ ok: code === 0, reason: code ? redact(stderr) || `exit ${code}` : undefined }),
  parse(line) {
    try {
      const value = JSON.parse(line);
      if (value.type === 'thread.started') return { events: [], sessionRef: value.thread_id };
      if (value.type === 'turn.completed') return { events: [{ type: 'cost.update', origin: 'runtime', payload: {
        inputTokens: value.usage?.input_tokens ?? 0, outputTokens: value.usage?.output_tokens ?? 0,
      } }], result: { ok: true } };
      if (value.type === 'turn.failed' || value.type === 'error') return { events: [], result: { ok: false, reason: redact(value.error?.message ?? value.message ?? 'Codex 执行失败') } };
      const item = value.item;
      if (value.type === 'item.completed' && item?.type === 'reasoning') return { events: [{type:'agent.reasoning',origin:'agent',payload:{summary:redact(item.text ?? '')}}] };
      if (value.type === 'item.started' && item?.type === 'command_execution') return { events: [{ type: 'tool.call', origin: 'agent', payload: { toolCallId: item.id, name: 'Bash', input: { command: item.command } } }] };
      if (value.type === 'item.completed' && item?.type === 'agent_message') return { events: [{ type: 'agent.message', origin: 'agent', payload: { text: redact(item.text), final: true } }] };
      if (value.type === 'item.completed' && item?.type === 'command_execution') return { events: [{ type: 'tool.result', origin: 'agent', payload: { toolCallId: item.id, ok: item.exit_code === 0, output: redact(item.aggregated_output ?? '') } }] };
      if (value.type === 'item.completed' && item?.type === 'file_change') return { events: (item.changes ?? []).map((change: {path:string;kind:string}) => ({ type: 'file.change' as const, origin: 'agent' as const, payload: { path: change.path, kind: change.kind === 'delete' ? 'delete' as const : change.kind === 'add' ? 'add' as const : 'modify' as const } })) };
    } catch { /* Preserve unrecognized output for inspection. */ }
    return { events: [{ type: 'output.chunk', origin: 'runtime', payload: { stream: 'stdout', data: Buffer.from(redact(line)).toString('base64') } }] };
  },
};
