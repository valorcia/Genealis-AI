# Navigateur autonome sur un serveur (Oracle Cloud gratuit, Hetzner, OVHcloud…)

Le navigateur autonome ne peut pas tourner sur Vercel. Un petit serveur Linux allumé en permanence le remplace
avantageusement : pas besoin de laisser un PC allumé. Le serveur va chercher ses missions auprès de votre application
(aucun port à ouvrir, rien n'entre).

## 1. Créer la machine (Oracle Cloud « Always Free »)

1. Console Oracle Cloud → menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name** : `genealis`.
3. **Image and shape** → *Edit* :
   - Image : **Canonical Ubuntu 24.04** si elle est proposée, sinon **Oracle Linux 9** (image par défaut, prise en charge aussi) ;
   - Shape : **Ampere** → `VM.Standard.A1.Flex`, **1 OCPU, 6 GB** (mention *Always Free-eligible*).
   - Si Oracle répond « Out of capacity » : essayez un autre *Availability domain*, ou la forme AMD
     `VM.Standard.E2.1.Micro` (gratuite aussi, 1 Go : le script ajoute alors de l'espace d'échange, c'est plus lent).
4. **Networking** : laissez les valeurs proposées (une adresse IP publique doit être attribuée).
5. **Add SSH keys** : *Generate a key pair for me* → **Save private key** (gardez ce fichier `.key`).
6. **Create**. Quand l'état passe à **RUNNING**, notez la **Public IP address**.

## 2. Se connecter au serveur

Le plus simple, sans rien installer : **Cloud Shell** (icône `>_` en haut à droite de la console Oracle).
1. Dans Cloud Shell, menu ⚙ → **Upload** → choisissez le fichier `.key` téléchargé.
2. Tapez (remplacez `IP` par l'adresse publique) :
   ```
   chmod 600 ssh-key-*.key
   ssh -i ssh-key-*.key opc@IP     (Oracle Linux)   —   ou ubuntu@IP si vous avez pu choisir Ubuntu
   ```
   Répondez `yes` à la première question.

Depuis un PC Windows, PowerShell fonctionne aussi : `ssh -i "$HOME\Downloads\ssh-key-XXXX.key" ubuntu@IP`.

## 3. Installer GENEALIS (une commande)

```
curl -fsSL https://raw.githubusercontent.com/valorcia/Genealis-AI/main/scripts/install-server-linux.sh | sudo bash
```

Le script demande :
- l'adresse de l'application (Entrée = `https://genealis-ai.vercel.app`) ;
- votre **mot de passe d'accès** (celui de l'écran de connexion de l'application) ;
- votre clé Gemini (facultatif : sert uniquement à l'agent IA du navigateur, la recherche déterministe fonctionne sans).

Ils sont rangés dans `/etc/genealis-worker.env`, lisible seulement par l'administrateur du serveur. Le navigateur
démarre automatiquement, y compris après un redémarrage du serveur. Comptez 5 à 10 minutes.

## 4. Vérifier

Application → **Recherche IA** → **Centre d'investigation** : la carte doit afficher **Navigateur autonome connecté**.

| Besoin | Commande (sur le serveur) |
|---|---|
| Voir ce que fait le navigateur | `journalctl -u genealis-worker -f` |
| Redémarrer / arrêter | `sudo systemctl restart genealis-worker` / `sudo systemctl stop genealis-worker` |
| Mettre à jour GENEALIS | relancer la commande d'installation (réglages conservés) |
| Changer le mot de passe ou la clé | `sudo nano /etc/genealis-worker.env` puis redémarrer |

## Ce qui change par rapport au PC

- Pas d'écran : quand un site demande une vérification humaine (CAPTCHA, connexion), la mission passe en
  **BLOQUÉE** et apparaît dans le Centre d'investigation avec le lien : ouvrez-le vous-même sur votre téléphone,
  faites la recherche, importez l'acte, puis « J'ai terminé ».
- Testé dans l'environnement de développement (Ubuntu 24.04, x86) : installation, Chromium, Browser Use, réglages,
  fichier de service. **Pas encore testé sur une machine Oracle ARM réelle** : signalez tout message d'erreur.
