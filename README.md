# Hypervibe Team Installer

Bootstrap d'installation des harnais **Hypervibe Team** (produit propriétaire, livré sous licence par [hypervibe.fr](https://hypervibe.fr)). Ce dépôt public ne contient **aucun** harnais : uniquement l'installateur de première fois, lisible en entier, qui enrôle un poste avec la clé de licence de l'organisation et récupère les exemplaires filigranés.

## Installation

Dans un terminal :

```bash
claude plugin marketplace add flavien-ia/hypervibe-team-installer
claude plugin install team-installer@hypervibe-team
```

Puis, dans Claude Code : `/install-hypervibe-team`. La clé d'accès personnelle (elle commence par `hvs_` et attend dans l'espace app.hypervibe.fr, onglet Licence et téléchargements) se saisit dans une fenêtre à part, jamais dans la conversation.

Une fois les harnais installés, ce bootstrap n'a plus de rôle : les mises à jour passent par `/update-hypervibe-team`, embarqué dans les harnais.

## Ce que fait l'installateur, et rien d'autre

1. Demande le rôle du poste (administrateur ou collaborateur).
2. Recueille la clé d'accès personnelle dans une fenêtre masquée, enregistrée localement (`~/.hypervibe`). Un poste installé avant les invitations peut encore y saisir la clé d'organisation `HV-TEAM-XXXX-XXXX`.
3. Enrôle le siège auprès de hypervibe.fr et reçoit son jeton.
4. Télécharge le ou les harnais filigranés au nom de l'organisation, vérifie leur empreinte, les pose dans la marketplace locale de Claude Code et les active.

Il n'envoie au serveur que la clé, un identifiant de siège aléatoire et le harnais demandé. Il ne bloque jamais rien : tout refus (licence suspendue, siège révoqué, hors ligne) se termine par un message.

---

**English.** First-install bootstrap for the proprietary Hypervibe Team harnesses. This public repo contains none of them: only the fully readable installer, which enrols a seat with the person's own access key (`hvs_...`, found in their app.hypervibe.fr space) and fetches the watermarked copies from hypervibe.fr. Install with the two commands above, then run `/install-hypervibe-team` in Claude Code. Updates are handled by `/update-hypervibe-team` inside the harnesses themselves.
