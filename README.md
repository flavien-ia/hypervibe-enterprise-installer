# Hypervibe Enterprise Installer

Bootstrap d'installation des harnais **Hypervibe Enterprise** (produit propriétaire, livré sous licence par [hypervibe.fr](https://hypervibe.fr)). Ce dépôt public ne contient **aucun** harnais : uniquement l'installateur de première fois, lisible en entier, qui enrôle un poste avec la clé d'accès de la personne et récupère les exemplaires filigranés.

## Installation

Dans un terminal :

```bash
claude plugin marketplace add flavien-ia/hypervibe-enterprise-installer
claude plugin install enterprise-installer@hypervibe-enterprise
```

Puis, dans Claude Code : `/install-hypervibe-enterprise`. La clé d'accès personnelle (elle commence par `hvs_` et attend dans l'espace app.hypervibe.fr, onglet Licence et téléchargements) se saisit dans une fenêtre à part, jamais dans la conversation.

Une fois les harnais installés, ce bootstrap n'a plus de rôle : les mises à jour passent par `/update-hypervibe-enterprise`, embarqué dans les harnais.

## Ce que fait l'installateur, et rien d'autre

1. Demande le rôle du poste (administrateur ou collaborateur).
2. Recueille la clé d'accès personnelle dans une fenêtre masquée, enregistrée localement (`~/.hypervibe`). Un poste installé avant les invitations peut encore y saisir la clé d'organisation (`HV-ENT-XXXX-XXXX`, ou la forme plus ancienne qu'il a reçue).
3. Enrôle le siège auprès de hypervibe.fr et reçoit son jeton. Un poste qui a déjà un siège le garde : jamais un second.
4. Télécharge le ou les harnais filigranés au nom de l'organisation, vérifie leur empreinte, les pose dans la marketplace locale de Claude Code et les active. Un harnais déjà installé, sous son nom actuel ou sous celui d'avant Hypervibe Enterprise, n'est pas réinstallé : sa propre mise à jour s'en charge.

Il n'envoie au serveur que la clé, un identifiant de siège aléatoire, le harnais demandé et le nom du plugin. Il ne bloque jamais rien : tout refus (licence suspendue, siège révoqué, hors ligne) se termine par un message.

---

**English.** First-install bootstrap for the proprietary Hypervibe Enterprise harnesses. This public repo contains none of them: only the fully readable installer, which enrols a seat with the person's own access key (`hvs_...`, found in their app.hypervibe.fr space) and fetches the watermarked copies from hypervibe.fr. Install with the two commands above, then run `/install-hypervibe-enterprise` in Claude Code. Updates are handled by `/update-hypervibe-enterprise` inside the harnesses themselves.
