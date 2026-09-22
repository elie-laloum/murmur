# Contributing

Use Node.js 24 and Git. Run `npm ci`, `npm run check`, `npm run format:check` and `npm run demo`. Container behavior changes also require `MURMUR_CONTAINER_TEST=1 npm run test:container` with Docker running and `node:24-bookworm-slim` pulled.

Keep modules small and contracts explicit. Comments should explain a non-obvious reason, use at most two lines, and appear only where needed. Add regression tests for behavior, especially failure and cleanup paths. Keep English and French documentation aligned.

GitLab is the private source of truth. GitHub is the public push mirror. Public issues and pull requests are welcome on GitHub; accepted changes are integrated into GitLab before synchronization. Mirroring transfers Git references, not issues or pull requests.

Do not put credentials, provider transcripts, private repositories or generated checkouts in a contribution. Model integration tests are opt-in and may incur provider charges.

## Français

Utilisez Node.js 24 et Git. Exécutez les vérifications ci-dessus avant toute contribution. Les commentaires doivent rester rares et ne pas dépasser deux lignes. Toute modification du comportement doit être accompagnée de tests pertinents. Maintenez les documentations française et anglaise cohérentes.

Les contributions publiques passent par GitHub, puis sont intégrées dans GitLab avant synchronisation du miroir.
