import './helpers/isolate-home.js';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployBuiltinSkills } from '../builtin-skills.js';
import { hookDispatchCli } from '../hook-dispatch-cli.js';
import {
  cursorOrClaudeHookRunsInGrokCli,
  grokHookPayload,
  grokTeamaiHookFile,
} from '../grok-hook-io.js';
import { grokbotTeamaiSkillMarkdown } from '../grokbot-skill.js';
import { reconcileHooks } from '../hooks.js';
import { builtinHookDefs } from '../builtin-hooks.js';
import { isInstalled } from './helpers/install-gate.js';
import { channelsOf, isToolId, TOOLS } from '../tools.js';
import { TeamaiConfigSchema, type LocalConfig } from '../types.js';

const REAL_GROKBOT_SKILLS = '/home/box/agent-data/workflows';
const REAL_GROK_HOME = path.join(os.homedir(), '.grok');

function userConfig(): LocalConfig {
  return {
    repo: { localPath: path.join(process.env.HOME!, 'repo'), remote: 'https://example.com/t.git' },
    username: 'testuser',
    updatePolicy: 'auto',
    additionalRoles: [],
    scope: 'user',
  };
}

function teamConfig() {
  return TeamaiConfigSchema.parse({ team: 't', repo: 'https://example.com/t.git' });
}

describe('grokbot and grok tool descriptors', () => {
  it('registers both tools', () => {
    expect(isToolId('grokbot')).toBe(true);
    expect(isToolId('grok')).toBe(true);
    expect(TOOLS.grokbot.hooks.user).toBe('none');
    expect(TOOLS.grokbot.hooks.self).toBe('none');
    expect(channelsOf('grok').hooks.user).toMatchObject({ channel: 'settings', format: 'claude' });
  });
});

describe('Grok Bot skill adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes the instruction skill into a temp skills dir, not the real workflows folder', async () => {
    const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grokbot-skills-'));
    vi.stubEnv('HOME', fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grokbot-home-')));
    vi.stubEnv('USERPROFILE', process.env.HOME!);
    vi.stubEnv('TEAMAI_GROKBOT_SKILLS_DIR', skillsDir);
    fs.mkdirSync(skillsDir, { recursive: true });

    const realTeamaiBefore = fs.existsSync(path.join(REAL_GROKBOT_SKILLS, 'teamai', 'SKILL.md'));

    await deployBuiltinSkills(teamConfig(), userConfig());

    const written = path.join(skillsDir, 'teamai', 'SKILL.md');
    expect(fs.readFileSync(written, 'utf8')).toBe(grokbotTeamaiSkillMarkdown());
    expect(fs.readFileSync(written, 'utf8')).toContain('teamai recall "<query>"');
    expect(fs.readFileSync(written, 'utf8')).toContain('teamai recall feedback --positive');
    expect(fs.readFileSync(written, 'utf8')).toContain('teamai skill get share');
    expect(fs.existsSync(path.join(REAL_GROKBOT_SKILLS, 'teamai', 'SKILL.md'))).toBe(realTeamaiBefore);
    expect(fs.existsSync(path.join(process.env.HOME!, 'agent-data', 'workflows', 'teamai', 'SKILL.md'))).toBe(false);

    fs.rmSync(skillsDir, { recursive: true, force: true });
  });

  it('detects Grok Bot when $HOME/agent-data/workflows exists, and not otherwise', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grokbot-detect-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);

    expect(await isInstalled('grokbot', 'skills', userConfig())).toBe(false);
    fs.mkdirSync(path.join(home, 'agent-data', 'workflows'), { recursive: true });
    expect(await isInstalled('grokbot', 'skills', userConfig())).toBe(true);
  });

  it('hook-dispatch is a no-op for grokbot and does not wait for stdin', async () => {
    await expect(hookDispatchCli('session-start', 'grokbot', '*')).resolves.toBeUndefined();
  });
});

describe('Grok CLI hook adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('translates Grok CLI hook payloads into Claude-shaped fields', () => {
    const translated = grokHookPayload('post-tool-use', {
      hookEventName: 'PostToolUse',
      sessionId: 'sess-1',
      cwd: '/tmp/proj',
      workspaceRoot: '/tmp/ignored',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });

    expect(translated).toMatchObject({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-1',
      cwd: '/tmp/proj',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
  });

  it('falls back to Grok CLI environment variables and workspaceRoot', () => {
    const translated = grokHookPayload('session-start', {}, {
      GROK_HOOK_EVENT: 'SessionStart',
      GROK_SESSION_ID: 'sess-env',
      GROK_WORKSPACE_ROOT: '/tmp/ws',
    });

    expect(translated).toMatchObject({
      hook_event_name: 'SessionStart',
      session_id: 'sess-env',
      cwd: '/tmp/ws',
    });
  });

  it('skips Cursor and Claude hooks in a Grok CLI session only when the grok teamai hook file is installed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grok-skip-'));
    const env = { HOME: home, GROK_SESSION_ID: 'sess-1' };

    expect(cursorOrClaudeHookRunsInGrokCli('cursor', env)).toBe(false);
    expect(cursorOrClaudeHookRunsInGrokCli('claude', env)).toBe(false);

    const file = grokTeamaiHookFile(env)!;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"teamai hook-dispatch session-start --tool grok"}]}]}}\n');

    expect(cursorOrClaudeHookRunsInGrokCli('cursor', env)).toBe(true);
    expect(cursorOrClaudeHookRunsInGrokCli('claude', env)).toBe(true);
    expect(cursorOrClaudeHookRunsInGrokCli('grok', env)).toBe(false);
    expect(cursorOrClaudeHookRunsInGrokCli('cursor', { HOME: home })).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes a dedicated ~/.grok/hooks/teamai.json with --tool grok and timeouts, without touching the real ~/.grok', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grok-hooks-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    const realGrokBefore = fs.existsSync(REAL_GROK_HOME);

    fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
    const hookFile = path.join(home, '.grok', 'hooks', 'teamai.json');
    await reconcileHooks(hookFile, 'grok');

    const written = JSON.parse(fs.readFileSync(hookFile, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>> };
    const commands = Object.values(written.hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)));
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command.includes('--tool grok'))).toBe(true);
    expect(commands.some((command) => command.includes('session-start'))).toBe(true);
    expect(commands.some((command) => command.includes('post-tool-use'))).toBe(true);
    expect(commands.some((command) => command.includes('prompt-submit'))).toBe(true);
    expect(commands.some((command) => command.includes('stop'))).toBe(true);
    const timeouts = Object.values(written.hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.timeout)));
    expect(timeouts.every((timeout) => typeof timeout === 'number' && timeout >= 5)).toBe(true);
    expect(fs.existsSync(REAL_GROK_HOME)).toBe(realGrokBefore);
    expect(builtinHookDefs('grok').every((def) => def.timeout !== undefined && def.command.includes('--tool grok'))).toBe(true);
  });

  it('detects Grok CLI from ~/.grok or a grok binary on PATH, without creating the real ~/.grok', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-grok-detect-'));
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('PATH', `/nonexistent:${bin}`);

    expect(await isInstalled('grok', 'skills', userConfig())).toBe(false);

    fs.writeFileSync(path.join(bin, 'grok'), '#!/bin/sh\n');
    fs.chmodSync(path.join(bin, 'grok'), 0o755);
    expect(await isInstalled('grok', 'skills', userConfig())).toBe(true);

    fs.rmSync(path.join(bin, 'grok'));
    fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
    expect(await isInstalled('grok', 'skills', userConfig())).toBe(true);
    expect(fs.existsSync(REAL_GROK_HOME)).toBe(fs.existsSync(REAL_GROK_HOME));
  });
});
