# Getting the chat client to reach the local MCP server

The cloud chat service has to reach a server running on this laptop. That means a public HTTPS
endpoint, which means a tunnel. There are two ways to do it, and they trade setup pain for URL
stability.

Both binaries are already installed in `sidecars/tunnel/` by `./setup.sh`, so neither path needs a
download:

| Binary | Version | Account needed |
|---|---|---|
| `sidecars/tunnel/cloudflared` | 2026.10.2 | no |
| `sidecars/tunnel/ngrok` | 3.39.11 | yes (authtoken) |

`./run.sh --tunnel` picks one for you: ngrok if it has an authtoken configured, cloudflared if it
does not.

## Path A — no account, no auth (cloudflared quick tunnel)

```bash
sidecars/tunnel/cloudflared tunnel --url http://127.0.0.1:8787
```

It prints something like `https://random-words-here.trycloudflare.com`. No signup, no token, no
config. Works immediately. **This is the path that has actually been verified on this machine.**

**Cost:** the hostname is different every time you start it. That means the connector URL in the
chat service has to be updated at the start of every session — about twenty seconds of manual work,
but it cannot be automated, because the connector lives in the chat service's settings, not in our
app.

Use this when: you are testing, or you do not want to create an account.

## Path B — one-time auth, stable URL (ngrok)

```bash
sidecars/tunnel/ngrok config add-authtoken <your-authtoken>   # once per machine
sidecars/tunnel/ngrok http 8787
```

The ngrok free plan assigns one **dev domain** to your account, for example
`your-name.ngrok-free.app`. That hostname does not change between restarts, so the connector is
added once and never touched again.

**Already set up on this machine.** The config lives at
`~/Library/Application Support/ngrok/ngrok.yml` on macOS (not `~/.config/ngrok/ngrok.yml`), and it
holds an authtoken. A tunnel was run and verified end to end on 2026-10-21 — see the spike notes.

Compose the full URL once:

```
https://your-name.ngrok-free.app/mcp?token=<PIP_MCP_TOKEN>
```

That URL form only works when the server is started with `PIP_ALLOW_QUERY_TOKEN=1`. Without it, use
the plain `/mcp` URL and send `Authorization: Bearer <token>` as a header instead.

Use this when: you are demoing, or you want the setup to survive restarts.

Free-plan limits are not a constraint for this project: 1 GB/month, 20 000 requests, 3 online
endpoints, no idle timeout. The browser interstitial that ngrok shows does not apply to API clients;
if a request ever hits it, send `ngrok-skip-browser-warning` with any value.

## Can the target user skip ngrok auth?

**Only by accepting a changing URL.** There is no free option that is simultaneously stable, free,
and account-less — that combination is what accounts exist to sell.

The options, honestly:

| Option | Account needed | URL stable | Verdict |
|---|---|---|---|
| cloudflared quick tunnel | no | no | Best zero-setup path. Re-paste the URL each session |
| ngrok free | yes, one-time | yes | Best demo path. Set up once, forget |
| cloudflared named tunnel | yes + own domain | yes | More work than ngrok for the same result |
| Bundling our own ngrok token | — | yes | **No.** Shipping a credential to every user gets the account banned |
| Tailscale Funnel | yes | yes | Another account, no better than ngrok |

For a shipped product, the honest answer is: **default to cloudflared, offer ngrok as an
opt-in upgrade.** Zero-setup for everyone, stable URLs for anyone willing to make an account.

For this project, use ngrok. You are demoing on your own laptop, the auth is one command, and a
stable URL removes a whole class of demo-day failure.

## After the tunnel is up

1. `curl https://<tunnel-host>/health` → expect `ok`. This proves the tunnel forwards, with no
   token involved. If this fails, the problem is the tunnel, not the connector.
2. Add the connector in the chat service. Either `https://<tunnel-host>/mcp` plus an
   `Authorization: Bearer <PIP_MCP_TOKEN>` header, or — with `PIP_ALLOW_QUERY_TOKEN=1` —
   `https://<tunnel-host>/mcp?token=<PIP_MCP_TOKEN>` as a single URL.
3. Ask the chat to call `reveal_secret`. Expect `The eagle lands at midnight.`

### The proxy gotcha

If `curl` through the tunnel answers `http 000` but the tunnel log shows a healthy connection,
a proxy is in the way. This machine has `HTTP_PROXY`/`HTTPS_PROXY` set, and the proxy cannot reach
the `trycloudflare.com` hostname. Send the request with the proxy unset:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  curl https://<tunnel-host>/health
```

`run.sh --tunnel` and the tunnel commands in this document already do this.

### What was actually verified

Through a live cloudflared tunnel, from outside the machine:

| Check | Result |
|---|---|
| `GET /health` | `ok` |
| `POST /mcp` with no token | `401` |
| `POST /mcp` with the token, `tools/list` | all five tools listed |
| `read_document_as_markdown` on a DOCX | Markdown, fenced as untrusted, with a token estimate |
| `read_document_as_markdown` on `/etc/passwd` | refused — "path is outside the allowed folders" |

## When it does not work

| Symptom | Meaning |
|---|---|
| `401` in the server log | Request arrived, credentials rejected. Check the token in the URL |
| Nothing in the server log | The tunnel is not forwarding. Check `/health` through the tunnel |
| Connector added but no tools listed | Wrong path. It must be `/mcp`, not the bare host |
| Works in curl, not in the client | The client may need the `Authorization` header instead of `?token=` |

## Never commit the token

Pass it at launch: `PIP_MCP_TOKEN=... npm run dev`. If it lands in git history it is compromised
forever, and this server can read files.
