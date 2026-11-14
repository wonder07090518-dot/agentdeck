# AgentDeck TLS relay

Build from the repository root with `npm run build`. First start requires `openssl` on PATH when no certificate/key are supplied.

```sh
npm run agentdeck -- relay --home /tmp/agentdeck-relay --port 8443
npm run agentdeck -- serve --relay wss://127.0.0.1:8443 --relay-secret /tmp/agentdeck-relay/relay.json --tls-insecure
```

Use `--tls-cert` and `--tls-key` for an existing TLS identity. `--public-url wss://your-host` sets the address embedded in pairing offers. The bind defaults to loopback; public tunnels and their verification are managed separately. `--tls-insecure` is only for the daemon connecting to a development self-signed certificate.

The relay home contains TLS files, relay.json (daemon bootstrap secret), and devices.json (SHA-256 token hashes and device metadata). Business messages are never persisted. Pairing codes exist only in memory for five minutes. Device tokens remain bound to a machine across relay restarts and can be revoked by that daemon or the same device.
