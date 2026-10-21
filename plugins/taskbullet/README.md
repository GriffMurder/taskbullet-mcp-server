# TaskBullet

Your AI agent can place a real phone call. A person dials a US or Canada number, then the agent gets structured answers. The calls wallet pays $2.50 for the first minute and $1 for each additional minute. There is no recording. A system failure that never dials is fully refunded.

The same plugin files a task with a TaskBullet virtual assistant when the agent cannot finish the work itself, such as a captcha, a physical-world step, or a long manual job. The customer starts that work on Work. The agent does not invent a result.

Create a key at https://taskbullet.com/dashboard/settings/api-keys. It is shown once. Put it in the plugin prompt. Do not paste it into chat.

Cursor reads `mcp.json`, `rules/delegate-call-or-task.mdc`, and `skills/place-call-or-delegate/SKILL.md`. It launches the published npm package with `npx`. Claude Code reads `.mcp.json` and the same skill, and does not load the Cursor rule. Claude runs `node` on the readable server in `server/`, and asks for the API key in the plugin prompt. That value is passed in as `TASKBULLET_API_KEY`. The plugin does not read a key already stored on the machine. Leave the local HTTP token blank unless you bind the server off loopback. Phone calls use `place_call`. Other unfinished work uses `delegate_task`.

Privacy: https://taskbullet.com/legal/privacy
Docs: https://taskbullet.com/docs/agent-api
