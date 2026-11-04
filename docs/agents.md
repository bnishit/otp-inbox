# Connect an agent once

All clients use the same three tools: metadata lookup, wait, then claim. MCP (Model Context Protocol) is the shared way an agent calls those tools. A tool connection and a standing operating rule are separate: install both.

## Choose a connection

| Client | Path | Evidence / limit |
| --- | --- | --- |
| Codex | Local Python stdio adapter | Private predecessor used successfully; portable adapter smoke-tested locally |
| Claude Code | Same adapter, separate reader key | Private predecessor connected and claim isolation tested |
| ChatGPT Dot | Owner-private Sites plugin adapter | Private predecessor used for a real SMS login; public adapter locally tested |
| Instinct | Remote bearer MCP if available; otherwise private Python/REST integration | Integration recipe, not a tested native client connection |
| Meta Muse | Custom Connector to private REST API | Official custom-connector route; recipe not device/account tested |
| Other MCP clients | Stdio or authenticated `/mcp` | JSON POST transport, no SSE or built-in OAuth server |

Every reader key can access all captured mailboxes/SMS in that deployment. Names distinguish claims/revocation; they do not add mailbox-level authorization.

## Codex

After [setup](deploy.md), replace `/ABS/PATH/otp-inbox` with the actual clone path:

```sh
codex mcp add otp-inbox -- python3 /ABS/PATH/otp-inbox/agent.py \
  --config /ABS/PATH/otp-inbox/.local/agents/codex.json mcp
```

This config points at a private per-client file. It does not put the key on a command line. For manual config use the following in your existing `~/.codex/config.toml`, preserving unrelated settings:

```toml
[mcp_servers.otp-inbox]
command = "python3"
args = ["/ABS/PATH/otp-inbox/agent.py", "--config", "/ABS/PATH/otp-inbox/.local/agents/codex.json", "mcp"]
```

Add [agent-instructions.md](../examples/agent-instructions.md) to your global or project's `AGENTS.md`. Reload MCP or open a new chat and ask: “List OTP Inbox metadata, without claiming any code.” On Windows use the installed Python executable and absolute Windows paths. Don't copy a Mac-specific path.

Official: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp).

## Claude Code

```sh
claude mcp add --scope user --transport stdio otp-inbox -- \
  python3 /ABS/PATH/otp-inbox/agent.py \
  --config /ABS/PATH/otp-inbox/.local/agents/claude.json mcp
```

Use `/mcp` to check connection. Put the same standing instructions into `~/.claude/CLAUDE.md` or the relevant project's `CLAUDE.md`. Preserve existing instructions and permission settings. Approve tool use as the client requires; don't disable its safety controls.

Official: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## ChatGPT Dot (including a named personal Dot)

The tested connection used a **private ChatGPT Site** with its own plugin, not your laptop's stdio registration. Cloud agents cannot reach a Python process on your laptop through a local config file.

This repository includes `adapters/sites/worker.js` and `scripts/build_sites.py`. It is a **tool-only adapter**, not the maintainer's live private dashboard. The adapter trusts identity headers supplied by Sites and **must not** be deployed as a standalone public Worker where callers can forge those headers.

Use ChatGPT/Codex with Sites access and give it this setup brief:

> Create a new owner-private Site named OTP Inbox for my own deployment. Use this repository's `adapters/sites/worker.js` and the shared `tools.json`. Generate with `python3 scripts/build_sites.py --project-id THE_NEW_SITE_ID`, then use the generated `.local/sites/server/index.js` Worker and `.openai/hosting.json`. Keep the Site owner-only. Set runtime secrets `OTP_BRIDGE_URL` to my HTTPS backend, `OTP_OWNER_EMAIL` to my signed-in owner email, and `OTP_AGENT_TOKEN` to my dedicated dot reader key from private settings. Do not put any secrets in source or chat. Publish through the supported Sites source/version workflow, then install/connect its generated private plugin. Test metadata only. Never use the maintainer's project IDs, domain or credentials.

The build emits a Worker at `server/index.js` with `fetch(request, env)`; no dependencies or additional build step are needed. Sites project creation/publishing is account-dependent and uses the supported Sites tools, not a public unauthenticated deployment API. If Sites is unavailable in your account, this exact route is unavailable. A generic ChatGPT custom MCP connector may require OAuth; the bare `/mcp` endpoint here **does not implement OAuth**, so do not remove authentication to make it connect.

Once the plugin tools appear, give the Dot [the standing instructions](../examples/agent-instructions.md) and ask it to save those for your own authorized workflows. New chats may need plugin selection or a tool refresh. Platform approvals still apply.

Official implementation context: [OpenAI MCP server docs](https://developers.openai.com/plugins/build/mcp-server), [connect a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt). The Sites-specific owner/private plugin path depends on the Sites capability in that account.

## Instinct

No authoritative public Instinct setup UI was established during preparation, so this guide does not invent a menu or claim a tested native integration. Use the agent's available secure connection path:

1. If it accepts remote MCP with an Authorization header, use `https://YOUR-DOMAIN/mcp` and **its own** `instinct` reader key. Store the key using its secret/credential input, never a chat message or URL.
2. If it can run a private tool process, place `agent.py`, `tools.json`, and only `.local/agents/instinct.json` plus its matching `.env` on that agent's private machine, retaining relative paths. Register that stdio process or use the REST API below.
3. If it supports neither secure credentials nor custom tools, stop: a public no-auth endpoint is not a safe compatibility workaround.

Setup brief:

> Connect to my self-hosted OTP Inbox using its three documented tools and your dedicated reader credential from secure storage. Start with metadata lookup only. Keep the retrieval rule in your instructions, but never save codes. Use service, request time and exact email account to match before claim. Ask me only if the match or capture is unavailable.

## Meta Muse

Meta documents a **Custom Connector** flow for services outside its catalog. Ask Muse to build the private REST connector, instead of assuming a particular MCP settings screen:

> Create a Custom Connector for my OTP Inbox at `https://YOUR-DOMAIN`. Read this repo's `docs/api.md`. Store my dedicated Muse reader key through your Secure Credentials Store, not in conversation text. Expose only recent, wait and claim. Test metadata without claiming. Use service, request time and exact account/channel before a claim, never choose the newest blindly, and never print or retain a code. Keep these instructions for already-authorized login workflows and respect your approval rules.

Provide the key only in the product's secure credential flow. If that flow isn't available, don't paste it into chat. This is a setup recipe, not proof that a particular Muse account accepted the integration. For Muse Code or another stdio-capable client, use the Python adapter with the dedicated Muse config using that client's documented server schema.

Official: [Meta Custom Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/), [connector guidelines](https://platform.muse.ai/docs). Catalog submission is not required to publish this open-source repo, and this project is not a reviewed Muse catalog connector.

## Future agents and API-only runtimes

A stdio-capable client launches `python3 agent.py --config /path/to/its-config.json mcp`. A remote client POSTs MCP JSON to `/mcp` with its reader bearer key. No SSE subscription or OAuth issuer is included. Clients requiring OAuth need a properly authenticated adapter such as the private Sites route; never expose a keyless wrapper.

For a custom REST tool use [the API reference](api.md). Treat `otp_claim` as a sensitive read **with a reservation side effect**, not an ordinary idempotent public read. Same-client repeats recover a lost response; another client receives conflict. Multiple tasks using one key must still distinguish account/time themselves.

## The expected login trace

1. User authorizes a login task.
2. Agent records current time, then requests a code from that service.
3. It lists or waits with that `since`, service and exact account/channel.
4. It confirms the matching entry; ambiguity stays unresolved until narrowed.
5. It claims that entry and enters the literal code directly in the authorized login.
6. It reports the login outcome without printing the code. OTP possession does not authorize a purchase or security change.
