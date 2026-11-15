# AgentDeck desktop

Official Windows (MSI, NSIS) and macOS (DMG) installers are built on GitHub
Actions from this tree. Each installer includes a Node 24 runtime plus the
compiled daemon, protocol, adapters, relay, and production dependencies. End
users do not need Node on PATH or a source checkout. Windows also needs
WebView2 (Tauri can bootstrap it). The builds are unsigned, so Windows
SmartScreen and macOS Gatekeeper will show a warning until a code-signing
certificate is added.

The default public relay is `wss://relay.agentdeckapp.com`. Login credentials
are passed only through environment variables, and daemon output is drained
without logging. Account data lives in Tauri's per-user app data directory
(`com.agentdeck.desktop`), used as `AGENTDECK_HOME`. The optional login
invoke argument `relay` overrides `AGENTDECK_RELAY`, then `relay.json`
(`relayUrl`) in that directory. No temporary relay URL is embedded.

`prepare:runtime` stages ignored files under `src-tauri/runtime` and packages
them as Tauri resources. In CI it downloads the official Node 24 build for the
current OS and architecture. Locally you can point it at an existing Node 24
tree with `AGENTDECK_NODE_DIR`.

To produce installers from a developer machine after `npm ci` and
`npm run build` at the repository root:

```bash
cd apps/desktop
npm ci
# Windows
npx tauri build --bundles msi,nsis
# macOS
npx tauri build --bundles dmg
```

On Windows, `./apps/desktop/scripts/build-windows.ps1` can also wire portable
tooling and the Visual Studio 2022 C++ Build Tools. Artifacts land in
`apps/desktop/src-tauri/target/release/bundle/{msi,nsis,dmg}`.

Login hides the window; the tray can reopen it or quit. Quit terminates only
the daemon started by this desktop process. Pairing remains a disabled
placeholder.
