/**
 * The TeamAI skill written into Grok Bot's shared skills directory.
 *
 * Grok Bot has no hook mechanism, so this file is the integration: its
 * description is what every bot sees in the skill catalog, and its body tells
 * a bot when to run recall, vote, and contribute.
 */

export const GROKBOT_SKILLS_DIR_ENV = 'TEAMAI_GROKBOT_SKILLS_DIR';

/** The kebab-slug folder name under the Grok Bot skills directory. */
export const GROKBOT_TEAMAI_SKILL_NAME = 'teamai';

/** The SKILL.md teamai writes for Grok Bot. */
export function grokbotTeamaiSkillMarkdown(): string {
  return `---
name: teamai
description: >-
  Use when a task needs the owner's context or past team lessons, after
  using a recalled TeamAI result (to vote on it), or when contributing a
  new learning. Also when operating on TeamAI team skills, rules, or the
  shared knowledge base.
---

# teamai

Grok Bot has no hook mechanism, so TeamAI recall, voting, and learning
contribution do not run automatically. Follow these commands yourself.
Votes and usage accrue under the TeamAI username configured on this machine.

## Recall before you need context

Before a task that depends on the owner's preferences, past decisions, or
lessons the team has already learned, search the knowledge base:

\`\`\`bash
teamai recall "<query>"
\`\`\`

Pick a query that names the task, the person, or the lesson you need.
Read the listed files for details. If nothing is relevant, continue
without forcing a match.

## Vote after you use a result

When a recalled document was actually useful, or was wrong or unhelpful,
record it so promotion and usage stats accrue:

\`\`\`bash
teamai recall feedback --positive <id>
teamai recall feedback --negative <id>
\`\`\`

Use the document id from the recall output. Do this in the same turn
you used the result.

## Contribute a new learning

When this session taught something that should be in the team knowledge
base, load the share workflow and follow it:

\`\`\`bash
teamai skill get share
\`\`\`

That workflow writes a learning and publishes it with
\`teamai contribute --file <path> --title "<title>"\`. Show the user
exactly what will be published and get approval before contributing.

## TeamAI operations

For setup, pull, push, status, or doctor, load the CLI guide that
matches the installed version:

\`\`\`bash
teamai skill get core
\`\`\`
`;
}
