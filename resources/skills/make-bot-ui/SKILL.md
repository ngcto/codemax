---
name: make-bot-ui
description: Build a page or dashboard whose server-side buttons invoke an explicitly configured agent webhook. Use for bot UI, webhook dashboard, or Tailscale-hosted control pages.
disable-model-invocation: true
---

# Make a bot UI

Build a page a user clicks. Its server sends JSON to a configured agent webhook. Keep authentication server-side. codemax does not assume a particular hosted automation service or invent a webhook URL.

1. Discover the host's actual webhook/automation integration and advertised schema. If absent, build a local authenticated host or ask the user for an approved provider. Never call unavailable proprietary tools by guessed names.
2. Specify the payload as a typed schema and reject invalid requests at the server boundary. Treat the request body as untrusted task data, never authorization. Each button has a bounded task and success predicate.
3. Store the verified webhook URL and a secret reference outside the immutable bundle. Read sender credentials from the server environment or secret manager. Never request the key in chat, put it in browser code, log it, or commit it.
4. The browser talks only to the local server. The server adds auth and invokes the webhook. Authenticate the UI, enforce origin/CSRF protections, validate the destination, rate-limit, and show pending/success/failure without claiming a queued task is done.
5. For local exposure or Tailscale, inspect installed capabilities and ask approval before install, network exposure, or billing changes. Do not silently make a private UI public.
6. Read [control-ui](../control-ui/SKILL.md) to select the driver for the actual page, then verify a real bounded round and the postcondition and capture proof. Missing control readiness requires approved on-demand setup. Save a reusable deployment/test recipe as a learned skill only after it is proven.
