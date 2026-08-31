---
name: install-hypervibe-team
description: First-time installation of the Hypervibe Team harnesses on this machine. Asks whether this seat is the organisation admin or a collaborator, collects the personal access key (hvs_..., from the person's app.hypervibe.fr space ; the legacy organisation key is still accepted for pre-invitation machines) in a masked OS window (never through the chat), enrols the seat with hypervibe.fr, downloads the watermarked copies and registers them in Claude Code. Use when the user says "installe hypervibe team", "/install-hypervibe-team", "install the team plugin", or has just installed this bootstrap plugin and wants the real harnesses.
---

# Installer Hypervibe Team sur ce poste

Tu es l'installateur de première fois des harnais Hypervibe Team. Ce plugin-ci (le bootstrap) ne contient aucun harnais : il enrôle le poste auprès de la licence de l'organisation et va chercher les exemplaires filigranés sur hypervibe.fr. Une fois les harnais posés, il ne sert plus à rien : les mises à jour passent par `/update-hypervibe-team`, qui vit dans les harnais eux-mêmes.

Public possiblement non technique : phrases simples, pas de jargon.

## Étape 1 - Quel rôle sur ce poste ?

Via `AskUserQuestion` (header `Rôle`) :

> Sur ce poste, tu es plutôt :
> - **Administrateur de l'organisation** : la personne qui pilote (crée les projets, invite les collaborateurs, tient les accès). Les deux harnais s'installent.
> - **Collaborateur** : tu produis sur les projets de l'équipe. Seul le harnais collaborateur s'installe.

Retenir `HARNESS=both` (admin) ou `HARNESS=collab` (collaborateur).

## Étape 2 - La clé d'accès, en fenêtre masquée

Prévenir d'une phrase :

> Ton invitation t'a ouvert un compte sur app.hypervibe.fr : dans l'onglet « Licence et téléchargements » t'attend ta **clé d'accès personnelle** (elle commence par `hvs_`). Elle ne passe jamais par notre conversation : une petite fenêtre va s'ouvrir pour la saisir.

(Un poste installé avant les invitations peut encore saisir la clé d'organisation `HV-TEAM-XXXX-XXXX` : la fenêtre accepte les deux.)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/window.mjs"
```

La fenêtre bloque jusqu'à la saisie (3 essais) ou l'abandon. Code de sortie 0 = clé enregistrée sur le poste ; 2 = abandon, proposer de reprendre plus tard et s'arrêter là ; autre = la fenêtre n'a pas pu s'ouvrir, le message d'erreur donne la commande à lancer à la main.

## Étape 3 - Enrôler et installer

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/install.mjs" --harness <HARNESS>
```

Une ligne JSON par harnais. Lire chaque ligne :

- `ok: true` → installé (`version`, `installPath`). Continuer.
- `code: "deja_installe"` → ce harnais est déjà là ; dire que la mise à jour se fait par `/update-hypervibe-team` dans une session où il est chargé.
- `code: "licence_revoquee" | "licence_suspendue" | "siege_revoque"` → transmettre le message tel quel : c'est l'organisation ou Hypervibe qui a fermé ce droit, rien à forcer.
- `code: "poste_non_invite" | "jeton_inconnu"` → ce poste n'a pas d'invitation valable : transmettre le message (l'admin de l'organisation invite depuis app.hypervibe.fr, la personne y trouve sa clé personnelle), proposer de relancer une fois la clé récupérée.
- `code: "harnais_reserve"` → le harnais administrateur demande le rôle d'administrateur : transmettre le message (c'est l'admin principal qui promeut, depuis son tableau de bord).
- `code: "hors_ligne"` → réessayer plus tard, rien n'est cassé.
- `code: "registre_inconnu"` → le zip est prêt (chemin dans `zip`) ; guider l'installation manuelle : Claude Desktop, onglet Code, Personnaliser, Plugins, Ajouter, Téléverser un plugin, choisir ce fichier.
- Tout autre échec → transmettre le message, proposer de réessayer.

## Étape 4 - Redémarrer et démarrer

Si au moins un harnais est `ok: true` :

> C'est installé. **Ferme et relance Claude Code** pour charger le harnais, puis lance **`/start`** : il met en route ton poste (outils, coffre de clés, licence). La clé que tu viens de saisir est déjà enregistrée, on ne te la redemandera pas.

Proposer enfin de désinstaller ce bootstrap (il a fini son travail) : `claude plugin uninstall team-installer@hypervibe-team`, ou le laisser, il ne fait rien tout seul.

## Ce que ce plugin ne fait jamais

- Il ne lit ni n'écrit rien d'autre que : le dossier `~/.hypervibe` (clé, siège), le dossier des plugins de Claude Code, et `settings.json` (activation du plugin posé).
- Il n'envoie à hypervibe.fr que : la clé saisie, l'identifiant de siège tiré au hasard, le harnais demandé. Jamais de contenu de ta machine.
- Il ne force rien : licence révoquée, quota dépassé, serveur muet, tout se termine par un message, jamais par un blocage.
