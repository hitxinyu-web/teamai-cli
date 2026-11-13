/**
 * Grok CLI hook payload translation and Cursor/Claude double-fire guards.
 *
 * Official hook contract (https://docs.x.ai/build/features/hooks): event JSON
 * on stdin with hookEventName, sessionId, cwd, workspaceRoot, and for tool
 * events toolName and toolInput; hook processes also receive GROK_HOOK_EVENT,
 * GROK_HOOK_NAME, GROK_SESSION_ID and GROK_WORKSPACE_ROOT.
 *
 * Grok CLI also loads ~/.cursor/hooks.json and ~/.claude/settings.json. When
 * teamai has installed ~/.grok/hooks/teamai.json, hook-dispatch skips the
 * Cursor and Claude copies in a Grok CLI session so the same handlers do not
 * run twice.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { HookStdin } from './hook-dispatch.js';
import { JsonObjectSchema, type JsonObject } from './types.js';

/** Environment variables Grok CLI sets on every hook process. */
export const GROK_HOOK_EVENT_ENV = 'GROK_HOOK_EVENT';
export const GROK_SESSION_ID_ENV = 'GROK_SESSION_ID';
export const GROK_WORKSPACE_ROOT_ENV = 'GROK_WORKSPACE_ROOT';

const GrokFields = z.looseObject({
  hookEventName: z.string().optional().catch(undefined),
  sessionId: z.string().optional().catch(undefined),
  cwd: z.string().optional().catch(undefined),
  workspaceRoot: z.string().optional().catch(undefined),
  toolName: z.string().optional().catch(undefined),
  toolInput: z.union([JsonObjectSchema, z.string()]).optional(),
});

function parsedToolInput(value: z.infer<typeof GrokFields>['toolInput']): JsonObject | undefined {
  const asObject = JsonObjectSchema.safeParse(value);

  if (asObject.success) return asObject.data;
  const asString = z.string().safeParse(value);

  if (!asString.success || !asString.data.trim()) return undefined;

  try {
    const parsed = JsonObjectSchema.safeParse(JSON.parse(asString.data));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Translate a Grok CLI hook payload into the Claude-shaped fields teamai's
 * handlers already read. Unknown or extra fields are kept.
 */
export function grokHookPayload(event: string, payload: HookStdin, env: NodeJS.ProcessEnv = process.env): HookStdin {
  const grok = GrokFields.parse(payload);
  const claude: HookStdin = { ...payload };
  const hookEvent = grok.hookEventName ?? env[GROK_HOOK_EVENT_ENV];
  const existingEvent = z.string().safeParse(claude.hook_event_name);

  if (hookEvent) claude.hook_event_name = hookEvent;
  else if (!existingEvent.success) claude.hook_event_name = event;

  if (grok.sessionId) claude.session_id = grok.sessionId;
  else if (env[GROK_SESSION_ID_ENV] && claude.session_id === undefined && claude.sessionId === undefined) {
    claude.session_id = env[GROK_SESSION_ID_ENV];
  }

  const cwd = grok.cwd?.trim() || grok.workspaceRoot?.trim() || env[GROK_WORKSPACE_ROOT_ENV]?.trim();

  if (cwd) claude.cwd = cwd;

  if (grok.toolName) claude.tool_name = grok.toolName;
  const input = parsedToolInput(grok.toolInput);

  if (input !== undefined) claude.tool_input = input;

  return claude;
}

/** `$HOME/.grok/hooks/teamai.json`. */
export function grokTeamaiHookFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();

  if (!home) return null;

  return path.join(home, '.grok', 'hooks', 'teamai.json');
}

/** Whether teamai has installed Grok CLI's dedicated hook file. */
export function grokTeamaiHooksInstalled(env: NodeJS.ProcessEnv = process.env): boolean {
  const file = grokTeamaiHookFile(env);

  if (file === null) return false;

  try {
    const content = fs.readFileSync(file, 'utf8');

    return content.includes('hook-dispatch') && content.includes('--tool grok');
  } catch {
    return false;
  }
}

/**
 * Whether a Cursor or Claude hook is running inside Grok CLI and should be
 * skipped because the dedicated `--tool grok` hooks will handle the event.
 */
export function cursorOrClaudeHookRunsInGrokCli(tool: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const name = tool.toLowerCase();

  if (name !== 'cursor' && name !== 'claude') return false;

  if (!env[GROK_HOOK_EVENT_ENV] && !env[GROK_SESSION_ID_ENV]) return false;

  return grokTeamaiHooksInstalled(env);
}
