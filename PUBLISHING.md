# Publish @taskbullet/mcp-server 0.2.1

Do not commit an npm token, a registry private key, or a `tb_live_` key. This file has commands only.

## Registry name

Preferred name: `com.taskbullet/mcp`.

That name is the reverse-DNS form of `taskbullet.com`. The registry grants it only after DNS or HTTP domain verification. Checked on 2026-10-21:

- `dig TXT taskbullet.com` has no `v=MCPv1` TXT record.
- `https://taskbullet.com/.well-known/mcp-registry-auth` returns 404.

`package.json` `mcpName` and `server.json` `name` therefore stay on the name GitHub auth already published:

`io.github.GriffMurder/taskbullet`

Checked on 2026-10-21, that listing's latest version is `0.2.0`. Publishing `0.2.1` updates it. It does not create `io.github.GriffMurder/taskbullet-mcp-server`. The GitHub Actions OIDC job can publish `io.github.GriffMurder/*` only. It cannot publish `com.taskbullet/mcp`. Switch `mcpName` to that name only after the DNS or HTTP proof below exists, in a later version.

### DNS TXT for `com.taskbullet/mcp`

Run this on a machine you control. Keep `key.pem` out of the repo.

```bash
MY_DOMAIN="taskbullet.com"
openssl genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record on the apex of `taskbullet.com` (host `@`). Do not put it on `_mcp-auth.taskbullet.com` or `_mcp-registry.taskbullet.com`. The registry reads the apex only. Leave existing SPF and site-verification TXT records in place. Remove a stale `v=MCPv1` record if you rotate the key.

After the record resolves:

```bash
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain taskbullet.com --private-key "${PRIVATE_KEY}"
```

HTTP alternative, same key. Host this single line at `https://taskbullet.com/.well-known/mcp-registry-auth`:

```text
v=MCPv1; k=ed25519; p=PUBLIC_KEY
```

Then:

```bash
mcp-publisher login http --domain taskbullet.com --private-key "${PRIVATE_KEY}"
```

Either login grants `com.taskbullet/*`. To use it, set both `package.json` `mcpName` and `server.json` `name` to `com.taskbullet/mcp`, bump the version, publish that version to npm, then `mcp-publisher publish`. Do not use `mcp-publisher login github` or the GitHub OIDC workflow for that name.

Docs: https://modelcontextprotocol.io/registry/quickstart and https://modelcontextprotocol.io/registry/authentication

## npm, then the MCP Registry

`0.2.1` is not published from this change. Publish it yourself.

```bash
npm install
npm run build
npm publish --access public
```

`prepublishOnly` runs `tsc`. Confirm https://www.npmjs.com/package/@taskbullet/mcp-server shows `0.2.1` and `mcpName` `io.github.GriffMurder/taskbullet` before the registry publish. The registry reads `mcpName` from the public npm tarball and rejects a mismatch.

Install the publisher:

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/
mcp-publisher --help
```

Authenticate and publish the GitHub-namespace server:

```bash
mcp-publisher login github
mcp-publisher validate server.json
mcp-publisher publish server.json
```

`mcp-publisher publish` with no file publishes `server.json` in the current directory. Search:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.GriffMurder/taskbullet"
```

The tag workflow `.github/workflows/publish-mcp.yml` runs `npm publish` and then `mcp-publisher login github-oidc` on `v*`. It publishes only when the repository secret `NPM_TOKEN` is set. This environment could not list Actions secrets. If the secret is absent, use the commands above. If it is present:

```bash
git tag v0.2.1
git push origin v0.2.1
```

The tag must match `package.json` and `server.json`. Do not tag until those versions are `0.2.1` on the commit you want to publish.

To list `server.json` after npm already has `0.2.1`, run the `Publish server.json to MCP Registry` workflow (`workflow_dispatch`). It does not run `npm publish`.

`server.site.json` (`io.github.GriffMurder/taskbullet-site`) is unchanged. The tag workflow publishes it and ignores a duplicate version.

## Directories

These submissions are manual. This change does not send them.

| Directory | URL | What is left |
| --- | --- | --- |
| Official MCP Registry | https://registry.modelcontextprotocol.io/ | `npm publish`, then `mcp-publisher login github` and `mcp-publisher publish`. DNS TXT above if you switch to `com.taskbullet/mcp`. |
| Anthropic connectors | https://claude.ai/directory/manage | Choose MCP connector. The portal requires a remote `https://` server. This package is stdio. The hosted URL `https://taskbullet.com/api/agent-mcp` is remote, and it authenticates with an `x-api-key` header, not OAuth. Directory auth for account tools is OAuth 2.0 (dynamic client registration or a client ID metadata document). A static header is beta and not the default path. This stdio server does not qualify as a connector. A connector listing needs an OAuth remote, or a review exception via mcp-review@anthropic.com. Docs: https://claude.com/docs/connectors/building/submission and https://claude.com/docs/connectors/building/authentication |
| Anthropic plugin directory | https://claude.ai/directory/manage | Choose Plugin bundle. Repository `GriffMurder/taskbullet-mcp-server`, plugin path `plugins/taskbullet`. A paid Claude plan is required. Local stdio belongs in the plugin, not in the connector form. The launcher is pinned to `@taskbullet/mcp-server@0.2.1`, so publish npm first. Docs: https://claude.com/docs/plugins/submit |
| Claude Code marketplace | none | No directory form. After this commit is on the default branch, users run `/plugin marketplace add GriffMurder/taskbullet-mcp-server` and then install `taskbullet@taskbullet`. |
| Cursor Marketplace | https://cursor.com/marketplace/publish | Submit the repository. Review is manual. The plugin is `plugins/taskbullet` (`.cursor-plugin/plugin.json`, `mcp.json`, and `rules/delegate-call-or-task.mdc`). Community listing is separate: https://cursor.directory |
| PulseMCP | https://www.pulsemcp.com/submit | Submissions are paused (notice last updated 3 September 2026). PulseMCP says to publish to the official registry and that it will pick the server up when submissions reopen. There is no form to send. |
| Smithery | https://smithery.ai/new | Current publish wants a public HTTPS streamable HTTP server. If auth is required, it wants OAuth. `smithery.yaml` is the stdio config for older importers. It is not what https://smithery.ai/new reads. The hosted agent URL is API-key auth, so it does not meet that OAuth requirement. A local listing is an MCPB bundle: `smithery mcp publish ./server.mcpb -n <namespace>/taskbullet`. This repo does not build that bundle. Docs: https://smithery.ai/docs/build/publish |
