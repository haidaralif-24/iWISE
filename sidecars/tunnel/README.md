# Tunnel sidecar

The tunnel is the only route from the cloud chat service to the local MCP server, so it needs a
public HTTPS URL that forwards to it.

- cloudflared (Cloudflare Tunnel): quick tunnels give a random URL per run.
- ngrok: check whether a free static domain is still offered.

Put the downloaded binary here (it is git-ignored if you add it to .gitignore)
and bundle it as a Tauri sidecar later.
The public endpoint MUST be authenticated.
