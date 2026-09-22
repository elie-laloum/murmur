# Murmur

[English](README.md)

Une bibliothèque TypeScript pour exécuter Codex et Claude Code dans des conteneurs isolés et composer leur travail sous forme de workflows typés. Aucune dépendance de production. Aucune dépendance à Sandcastle ni implémentation copiée.

Murmur est utilisable depuis les sources. Le paquet n'est pas encore publié sur npm. L'API est en version 0.1 et peut évoluer avant la version 1.0.

## Fonctionnalités implémentées

- Fournisseurs Docker et Podman : utilisateur non-root, limites de ressources et transmission explicite des variables d'environnement.
- Copies Git indépendantes de révisions commitées, sans fusion automatique dans le dépôt source.
- Environnements réutilisables, commandes sérialisées, événements en streaming et continuation de sessions.
- Adaptateurs Codex et Claude Code derrière le contrat ouvert `AgentDriver`.
- Dépendances typées, parallélisme borné, conditions, nouvelles tentatives, délais et annulation coopérative.
- Tâches agents/vérifications, boucles de correction bornées et décodage JSON validé.
- Export de patchs incluant les fichiers binaires et conservation du travail après les erreurs.

Les [références API](docs/api.md), l'[architecture](docs/architecture.md), les [limites d'isolation](docs/isolation.md) et les [procédures de validation](docs/validation.md) sont détaillées en anglais. Ce README décrit le parcours complet en français.

## Prérequis

Node.js 24+, Git et Docker Engine/Desktop ou Podman avec des conteneurs Linux. Les workflows sans agents n'ont pas besoin d'un moteur de conteneurs. Pour les agents, il faut une image contenant leurs CLI et les identifiants des fournisseurs utilisés.

Le moteur Docker doit accéder aux mêmes chemins que le processus Node. Les démons Docker distants ne sont pas pris en charge par le fournisseur intégré. Podman utilise son interface compatible Docker ; les particularités de mappage UID ou de SELinux peuvent nécessiter un fournisseur personnalisé.

## Installer et vérifier

```sh
git clone https://github.com/elie-laloum/murmur.git
cd murmur
npm ci
npm run check
npm run demo
```

La démonstration exécute un graphe déterministe de cinq tâches. Elle n'appelle aucun modèle et ne prétend pas tester l'isolation des conteneurs.

Pour installer la bibliothèque compilée dans un autre projet :

```sh
npm pack
cd /chemin/du/projet-consommateur
npm install /chemin/vers/murmur/elie-laloum-murmur-0.1.0.tgz
```

Les imports utilisent `@elie-laloum/murmur`. Les exemples du dépôt importent directement les sources pour fonctionner sans publication npm.

## Composer un workflow typé

```ts
import { flow, task } from "@elie-laloum/murmur";

const inspecter = task({
  key: "inspecter",
  perform: () => ({ fichiers: ["src/cart.ts"] }),
});

const planifier = task({
  key: "planifier",
  after: [inspecter],
  perform: (contexte) =>
    `Vérifier ${contexte.value(inspecter).fichiers.join(", ")}`,
});

const resultat = await flow("revue", [inspecter, planifier]).start({
  concurrency: 2,
});
resultat.unwrap();
console.log(resultat.value(planifier));
```

`context.value()` conserve le type du résultat de la dépendance. Celle-ci doit être déclarée dans `after`. Les noms en double, dépendances absentes et cycles sont rejetés avant l'exécution.

## Construire l'image des agents

Les versions des CLI doivent être fixées explicitement lors de la construction :

`npm run image:build` utilise les versions de `containers/versions.json` : Codex 0.156.0 et Claude Code 2.1.280. Définissez `MURMUR_ENGINE=podman` pour utiliser Podman. Pour choisir d'autres versions :

```sh
docker build -f containers/Dockerfile \
  --build-arg CODEX_VERSION=<version-testee> \
  --build-arg CLAUDE_VERSION=<version-testee> \
  -t murmur-agents:local .
```

Remplacez les paramètres entre chevrons. L'image contient Node.js, Git, ripgrep et les CLI sélectionnées. Le démarrage d'un environnement n'installe pas de paquet et ne télécharge pas automatiquement l'image.

## Exécuter Codex dans une copie isolée

```ts
import { chamber, codexDriver, containers } from "@elie-laloum/murmur";

const cle = process.env.CODEX_API_KEY;
if (!cle) throw new Error("Définir CODEX_API_KEY");

await using environnement = await chamber({
  repository: "/chemin/du/projet",
  isolator: containers({ image: "murmur-agents:local" }),
});

console.log(environnement.workspace.directory);
const reponse = await environnement.ask({
  driver: codexDriver({ autonomous: true }),
  prompt: "Corrige les tests en échec, puis explique les modifications.",
  credentials: { CODEX_API_KEY: cle },
});

const verification = await environnement.command({
  program: "npm",
  args: ["test"],
});
if (verification.code !== 0)
  throw new Error(verification.stderr || verification.stdout);
await environnement.workspace.savePatch("modifications.patch");
console.log(reponse.text);
```

`autonomous: true` désactive explicitement la couche d'approbation/isolation propre à la CLI à l'intérieur du conteneur externe. Cette option vaut false par défaut. Le conteneur reste la frontière d'isolation. Sans cette option, une CLI non interactive peut refuser des actions nécessitant une approbation.

Pour Claude Code, utilisez `claudeDriver()` et transmettez `ANTHROPIC_API_KEY` ou `CLAUDE_CODE_OAUTH_TOKEN`. Murmur ne monte pas les répertoires de connexion de l'hôte. Le paramètre `model` est facultatif ; sans lui, la CLI conserve sa sélection de modèle.

Pour une seule requête, `delegate({ repository, isolator, driver, prompt, credentials })` crée l'environnement, interroge l'agent et ferme le conteneur. En cas de succès, le résultat comprend la copie de travail conservée.

## Implémenter → vérifier → relire → vérifier

[`examples/repair.ts`](examples/repair.ts) fournit un workflow exécutable qui :

1. Installe les dépendances npm verrouillées du projet cible dans le conteneur.
2. Demande à Codex de corriger les tests en échec.
3. Exige que `npm test` réussisse.
4. Transmet le résumé à Claude Code pour relire et corriger les problèmes restants.
5. Relance les tests et exporte les modifications.

```sh
cp .env.example .env
# Renseigner les identifiants des fournisseurs.
node --env-file=.env examples/repair.ts /chemin/du/projet
```

Le projet cible doit utiliser npm, posséder un fichier de verrouillage et définir un script `test`. Ses scripts d'installation s'exécutent dans le conteneur. Les appels aux fournisseurs sont facturés par ceux-ci. L'exemple exporte également le patch si une tâche échoue, puis signale l'échec avec `unwrap()` : un patch exporté n'est donc pas une preuve de réussite.

## Dépendances, parallélisme et erreurs

Un workflow est un graphe orienté sans cycle. `concurrency` limite le nombre de tâches actives. Deux tâches indépendantes peuvent s'exécuter en parallèle, mais les commandes d'un même environnement restent sérialisées. Utilisez plusieurs environnements pour faire travailler plusieurs agents simultanément sans partager leurs fichiers.

Une condition fausse ignore la tâche et ses descendants sans mettre le workflow en échec. Par défaut, `stopOnError: true` annule les tâches voisines au moyen de leurs signaux et empêche les tâches en attente de démarrer. Avec false, les branches indépendantes continuent ; les descendants d'une tâche en échec sont ignorés.

Les nouvelles tentatives sont explicites : `retry: { attempts: 3, delayMs: 500 }`. `attempts` comprend la première exécution. Un prédicat `accepts(error, attempt)` peut refuser de recommencer. Une tentative ne restaure pas automatiquement les fichiers et peut répéter des effets externes ou des coûts fournisseur.

`timeoutMs` borne chaque tentative de manière coopérative. Les fonctions personnalisées doivent respecter `context.signal`. Murmur attend leur nettoyage avant de rendre le résultat ; il ne peut pas interrompre arbitrairement du JavaScript qui ignore ce signal.

Une commande de conteneur annulée ou expirée provoque la destruction du conteneur pour arrêter ses processus enfants. Il faut recréer un environnement avant de reprendre ce travail. Un simple code de sortie non nul ne détruit pas le conteneur.

## Sessions et boucles de correction

Pour continuer une conversation, transmettez le `sessionId` d'une réponse à une nouvelle requête utilisant le même adaptateur et le même environnement. Les fichiers de session vivent dans le répertoire temporaire du conteneur et disparaissent à sa fermeture.

`iterate({ chamber, request, limit, evaluate })` permet une boucle bornée. `evaluate(answer, round)` renvoie `{ done, feedback? }`, par exemple à partir du résultat de tests réels. Si la limite est atteinte, `converged` vaut false. Les réponses obtenues restent disponibles dans `answers`. Il n'y a pas de mot magique de fin de tâche.

`decodeJson(answer, validate)` analyse le JSON de la réponse, puis applique une fonction de validation. Une assertion de type TypeScript ne constitue pas une validation à l'exécution. Le validateur peut être celui d'une bibliothèque de schémas ou une fonction explicite.

## Résultats et observabilité

`FlowResult.status` vaut `done`, `failed` ou `cancelled`. Le résultat fournit les statuts, horodatages et nombres de tentatives des tâches, les erreurs originales et les erreurs des observateurs. `value(task)` donne le résultat typé d'une tâche réussie. `unwrap()` lève `FlowFailure` si le workflow n'a pas réussi.

Les événements d'un workflow sont accessibles avec `observe`. Les événements agents sont accessibles avec `onEvent` : texte, session, erreur, fin ou données brutes. Les observateurs de workflow ne peuvent pas modifier le résultat par une exception ; leurs erreurs sont enregistrées séparément. Une exception du consommateur de flux d'une commande arrête cette commande.

Les résultats restent en mémoire. Il n'y a pas de reprise durable après redémarrage du processus. Les transcriptions et données brutes peuvent contenir des informations sensibles : filtrez-les avant de les enregistrer ou de les publier.

## Récupérer le travail et nettoyer

Seuls les fichiers commités à la révision choisie entrent dans la copie. Par défaut, la révision est `HEAD`. Les modifications locales, fichiers non suivis, fichiers d'environnement, identifiants de l'hôte, contenus des sous-modules et téléchargements Git LFS ne sont pas importés automatiquement.

L'environnement monte uniquement une copie Git indépendante. Il ne monte pas le dépôt source, le `.git` parent d'un worktree, le répertoire personnel ni le socket Docker. Les patchs sont calculés avec un second ensemble de métadonnées Git, hors du montage accessible à l'agent.

`close()` attend les opérations déjà acceptées puis supprime le conteneur. `await using` appelle automatiquement cette méthode. Les fichiers de travail et métadonnées d'export sont conservés, y compris après réussite, pour éviter de perdre les modifications. Leur répertoire `murmur-*` se trouve dans le dossier temporaire du système : exportez rapidement les résultats importants, puis supprimez-le après revue. Le nettoyage automatique du système peut supprimer les anciens répertoires temporaires.

```sh
git apply --check modifications.patch
git apply modifications.patch
```

Exécutez ces commandes dans le dépôt source après revue du patch. L'export inclut ajouts, suppressions et fichiers binaires, mais pas les fichiers ignorés. Il doit se faire quand les écritures sont terminées. Murmur ne fusionne pas, ne pousse pas et ne publie pas vos changements automatiquement.

## Étendre Murmur

- `AgentDriver` construit une invocation à partir d'une requête et décode les événements JSONL d'un fournisseur.
- `Isolator` crée une `Isolation` exposant `execute()` et `dispose()`.
- `Task<T>` permet de construire d'autres opérations de workflow sans modifier l'ordonnanceur.

Les fournisseurs personnalisés sont du code d'infrastructure de confiance. Un type TypeScript ne prouve pas l'existence d'une isolation réelle. Les fonctions des tâches s'exécutent sur l'hôte ; seuls les appels passant par un environnement sont isolés.

## Limites actuelles

Murmur possède son propre moteur et ne revendique pas une compatibilité complète avec l'API ou toutes les fonctionnalités de Sandcastle. Cette version n'inclut pas de terminal interactif, de fournisseur cloud intégré, d'exécution directe sur l'hôte, de reprise persistante de workflow, de fusion automatique, de comptabilité des coûts ou d'éditeur visuel. Les workflows sont définis en TypeScript.

Les conteneurs ne sont pas des machines virtuelles. Le réseau sortant est activé par défaut pour accéder aux fournisseurs ; `network: "none"` permet les tâches hors ligne. Aucun filtrage par domaine n'est sous-entendu. La mémoire, le CPU et le nombre de processus sont limités, mais le répertoire monté n'a pas de quota disque. Pour des charges hostiles, utilisez un worker dédié et des politiques réseau/disque appropriées.

## Validation

```sh
npm run check
npm run format:check
docker pull node:24-bookworm-slim
MURMUR_CONTAINER_TEST=1 npm run test:container
```

Sous PowerShell : `$env:MURMUR_CONTAINER_TEST='1'; npm run test:container`.

La CI GitHub exécute les tests sur Linux, Windows et macOS, ainsi qu'un véritable test Docker sous Linux. Les tests de fournisseurs réels sont activés séparément avec `MURMUR_LIVE_TEST=1` et les deux clés API ; ils peuvent entraîner une facturation. Des tests de protocole ne prouvent pas qu'un appel réel à un modèle a été effectué. Voir les [procédures détaillées](docs/validation.md).

[Contribuer](CONTRIBUTING.md) · [Source GitLab privée](https://gitlab.elielaloum.com/elielaloum/murmur) · [Miroir GitHub public](https://github.com/elie-laloum/murmur).

Licence MIT. Le cahier des charges s'inspire de [Sandcastle](https://github.com/mattpocock/sandcastle) ; l'API et l'implémentation de Murmur sont indépendantes.
