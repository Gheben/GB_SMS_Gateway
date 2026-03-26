# GB SMS Gateway — SMS Management System for Yeastar TG1600

![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-builtin-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

---

## 📋 Descrizione

**GB SMS Gateway** è un sistema completo per la gestione e il monitoraggio di SMS ricevuti e inviati tramite gateway GSM **Yeastar TG1600**. Permette di visualizzare i messaggi in tempo reale, configurare regole di inoltro automatico via email, gestire utenti con autenticazione locale, LDAP/Active Directory e SSO.

Ideale per aziende che utilizzano gateway GSM Yeastar e vogliono centralizzare la ricezione degli SMS con visibilità granulare basata su gruppi AD.

---

### ✨ Funzionalità principali

- 📊 **Dashboard in tempo reale** — Statistiche giornaliere: SMS ricevuti, inviati, falliti; stato connessione dispositivi
- 📥 **Inbox SMS** — Tutti gli SMS inbound con ricerca, filtro e anteprima
- 📤 **SMS inviati** — Storico messaggi outbound con stato consegna
- ✉️ **Invio SMS** — Form di invio manuale con selezione dispositivo e porta SIM
- 📡 **Gestione dispositivi** — Aggiungi/modifica dispositivi Yeastar con monitoraggio connessione AMI
- 🔌 **Gestione porte SIM** — Visualizza stato porte, operatore, IMEI, numero SIM assegnato
- 📋 **Regole di inoltro** — Motor di routing con condizioni multiple (mittente, testo, regex), priorità, stop-on-match e inoltro email/SMS
- 👁️ **Visibilità per gruppi** — Ogni regola può limitare la visibilità dei messaggi ai soli utenti LDAP/AD autorizzati
- 📊 **Report e statistiche** — Analisi SMS per giorno, per dispositivo, per regola con log inoltri
- ⚙️ **Impostazioni SMTP** — Configurazione mail server e template HTML email personalizzabile
- 👥 **Gestione utenti** — Ruoli `superadmin`, `admin`, `user` con permessi granulari per sezione
- 🏘️ **Gruppi locali** — Crea gruppi di utenti locali con ereditarietà permessi
- 📜 **Audit log** — Traccia completa di tutte le operazioni (solo superadmin)
- 🔐 **Autenticazione** — Locale, LDAP/Active Directory, SSO (Authentik, NetScaler ADC, Nginx)
- 🔄 **WebSocket** — Aggiornamenti in tempo reale su nuovi SMS e stato dispositivi
- 📱 **PWA** — Installabile come app su desktop e mobile
- 🔏 **SAML 2.0 / SSO aziendale** — Login federato tramite NetScaler, ADFS o Azure AD (SP-initiated, configurabile da UI)

---

## 🚀 Installazione

### Opzione 1: Docker (Raccomandato)

**Prerequisiti:**
- Docker e Docker Compose installati
- Porte disponibili: `4674` (frontend web)

**Deploy rapido:**

```bash
# Clona il repository
cd /volume3/docker   # Synology NAS
# oppure: cd /opt/docker  # Linux VPS

git clone https://git.ballarini.app/guido/GB-SMS-Gateway.git smsgateway
cd smsgateway

# Crea il file di configurazione
cp .env.example .env

# Modifica le variabili obbligatorie
vi .env   # imposta JWT_SECRET e SUPERADMIN_PASSWORD

# Avvia i container
docker compose up -d --build

# Verifica lo stato
docker ps

# Visualizza i log
docker logs smsgateway-backend
docker logs smsgateway-frontend
```

Accedi all'applicazione su `http://localhost:4674`

---

**Configurazione `docker-compose.yml`:**

```yaml
services:
  init-dirs:        # crea ./data e ./logs sull'host (Synology compat)
    image: alpine
    command: sh -c "mkdir -p /host/data /host/logs"

  backend:          # API + WebSocket, porta interna 4673
    depends_on:
      init-dirs:
        condition: service_completed_successfully

  frontend:         # React UI via nginx, porta 4674
    ports:
      - "${FRONTEND_PORT:-4674}:80"
```

Volumi persistenti:
- `./data/smsgateway.db` — Database SQLite (backup = copia questo file)
- `./logs/app.log` — Log applicazione

---

**Aggiornamento:**

```bash
cd /volume3/docker/smsgateway
git pull
docker compose down
docker compose up -d --build
```

---

### Opzione 2: Installazione manuale (sviluppo)

**Prerequisiti:**
- Node.js 22+ (richiesto per `node:sqlite` built-in)
- npm

**Passi:**

```bash
git clone https://git.ballarini.app/guido/GB-SMS-Gateway.git
cd GB-SMS-Gateway

# Backend
cd backend
npm install
cp .env.example .env   # configura le variabili
node --experimental-sqlite src/index.js

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev   # Vite dev server → http://localhost:3000
```

Il frontend (Vite) gira su `http://localhost:3000` e proxia `/api` verso il backend su `localhost:4673`.

---

## 🔑 Primo Accesso

All'avvio, il sistema crea automaticamente l'utente superamministratore:

- **Username**: `sysadmin` (configurabile via `SUPERADMIN_USERNAME`)
- **Password**: `Password!` (configurabile via `SUPERADMIN_PASSWORD`)

> ⚠️ **IMPORTANTE**: Cambia la password immediatamente dopo il primo accesso! Imposta un `JWT_SECRET` lungo e casuale nel `.env` prima di andare in produzione.

---

## ⚙️ Configurazione (`.env`)

```dotenv
# ─── Backend ────────────────────────────────────────────────────────
PORT=4673
LOG_LEVEL=info          # error | warn | info | debug
CORS_ORIGIN=*           # oppure: http://192.168.1.50:4674

# ─── Autenticazione ─────────────────────────────────────────────────
SUPERADMIN_USERNAME=sysadmin
SUPERADMIN_PASSWORD=Password!          # Cambia in produzione!
JWT_SECRET=cambia-con-stringa-lunga-e-casuale
JWT_EXPIRES_IN=8h                      # es. 8h, 1d, 7d

# ─── Frontend (solo Docker) ─────────────────────────────────────────
FRONTEND_PORT=4674

# ─── SSO tramite proxy (opzionale) ─────────────────────────────────
# SSO_ENABLED=true
# SSO_HEADER=X-Remote-User
```

> SMTP e LDAP si configurano direttamente dall'interfaccia web → **Impostazioni** e **Gestione utenti**.

---

## 🔐 Autenticazione

### Utenti locali
Credenziali memorizzate nel DB con password hashed bcrypt (cost 12). Gestiti dalla sezione **Gestione utenti**.

### LDAP / Active Directory
Configurabile dalla UI → **Gestione utenti → LDAP / Active Directory**:
- Bind con account di servizio
- Ricerca utente tramite filtro personalizzabile (default: `sAMAccountName`)
- Risoluzione gruppi nested (AD con `LDAP_MATCHING_RULE_IN_CHAIN` o BFS standard)
- Mapping gruppi DN → ruolo con permessi granulari
- Al primo accesso LDAP l'utente viene inserito nel DB locale e aggiornato ad ogni login

### SSO (Authentik / NetScaler ADC / Nginx)
Se `SSO_ENABLED=true`, il frontend tenta automaticamente `GET /api/auth/sso` all'avvio.

Il proxy autentica l'utente, aggiunge l'header `X-Remote-User: john.smith` a ogni richiesta.
Il backend legge lo username, lo risolve via LDAP (se configurato) e restituisce un JWT senza richiedere password.

> ℹ️ Abilitare `SSO_ENABLED=true` **non disabilita** il login manuale — i due meccanismi coesistono.

### SAML 2.0 (NetScaler / ADFS / Azure AD)
Flusso SP-initiated configurabile dall'UI → **Impostazioni → SAML / SSO** (solo Superadmin).

**Come configurare:**
1. Accedi come `sysadmin` → Impostazioni → tab **SAML / SSO**
2. Inserisci la SP Base URL (URL pubblico dell'applicazione, es. `https://smsgateway.azienda.it`)
3. Inserisci la **IdP SSO URL** e il **Certificato X.509** forniti dall'admin NetScaler
4. Configura il mapping attributi (attributo username, display name)
5. Scegli il ruolo di default per i nuovi utenti SAML *(usato solo se LDAP non ha mapping per i suoi gruppi)*
6. Salva e abilita

**Dati da comunicare al tecnico IdP (NetScaler):**

| Campo | Valore |
|-------|--------|
| ACS URL | `https://tuodominio/api/auth/saml/callback` |
| SP Entity ID | `https://tuodominio/api/auth/saml/metadata` |
| Binding | HTTP-POST |
| SP Metadata XML | `https://tuodominio/api/auth/saml/metadata` |
| NameID format | `unspecified` |
| Firma richiesta | Nessuna |
| Attributi raccomandati | `displayName`, `sAMAccountName`, `memberOf` |

**Risoluzione ruolo per utenti SAML (priorità):**
1. I gruppi AD vengono letti dall'attributo SAML `memberOf` **e/o** tramite lookup LDAP con service account
2. Se uno dei gruppi corrisponde a un mapping configurato in **LDAP → Mappatura gruppi**, viene usato quel ruolo/permessi
3. Se nessun gruppo corrisponde a un mapping LDAP, viene usato il **Ruolo predefinito** configurato nel tab SAML
4. Ad ogni accesso successivo il ruolo viene sincronizzato (se LDAP mapping attivo)

> Nessuna variabile `.env` necessaria — tutta la configurazione SAML è nel DB.

---

## 📖 Guida utente

### 1. Dashboard
Accedi a `http://localhost:4674` (Docker) o `http://localhost:3000` (dev).

Visualizza:
- Statistiche del giorno: SMS ricevuti, inviati, totale inbound, falliti
- Ultimi messaggi ricevuti
- Stato connessione dispositivi Yeastar

### 2. Inbox e SMS inviati
- **Inbox**: tutti gli SMS ricevuti, con ricerca per mittente, testo, dispositivo
- **Inviati**: storico messaggi outbound con stato consegna

### 3. Invio SMS
1. Vai su **Invia SMS**
2. Seleziona il dispositivo e la porta SIM
3. Inserisci il numero destinatario e il testo
4. Clicca **Invia**

### 4. Gestione dispositivi Yeastar
1. Vai su **Dispositivi**
2. Clicca **Aggiungi dispositivo**
3. Configura:
   - **Host**: IP del TG1600
   - **Porta AMI**: `5038` (default)
   - **Username / Password**: credenziali AMI (configurate nel TG1600 → System → AMI)
4. Il backend mantiene la connessione persistente con riconnessione automatica

### 5. Porte SIM
Visualizza lo stato di ogni porta SIM del dispositivo:
- Stato (registrata, non registrata, assente)
- Operatore carrier
- IMEI
- Numero SIM assegnato (editabile)

### 6. Regole di inoltro

Le regole determinano come vengono instradati gli SMS in ingresso:

1. Vai su **Regole**
2. Clicca **Nuova regola**
3. Configura:
   - **Nome** e **Priorità** (ordine di valutazione)
   - **Condizioni**: mittente, contenuto, dispositivo, porta — con operatori `=`, `contiene`, `regex`
   - **Operatore**: `TUTTI` (AND) o `ALMENO UNO` (OR)
   - **Destinatari email**: per inoltro automatico con template HTML
   - **Stop at match**: se attivo, le regole successive non vengono valutate
   - **Gruppi di visibilità**: DN LDAP/AD — solo gli utenti di quei gruppi vedranno i messaggi

> | Situazione | Visibilità |
> |-----------|-----------|
> | Admin / Superadmin | Tutti i messaggi |
> | Utente + Gruppo AD | Messaggi delle regole dove il suo gruppo è incluso |
> | Regola senza gruppi | Visibile a tutti gli utenti autenticati |

### 7. Impostazioni SMTP
Vai su **Impostazioni**:
- Configura host, porta, TLS, username/password SMTP
- Testa la configurazione con **Invia email di test**
- Personalizza il template HTML delle email di inoltro

### 8. Report
Vai su **Report** per visualizzare:
- SMS per giorno (grafico)
- SMS per dispositivo
- Inoltri per regola
- Log dettagliato degli inoltri email

### 9. Gestione utenti
Ruoli disponibili:
- **superadmin**: accesso totale + audit log
- **admin**: gestione utenti e configurazione
- **user**: accesso limitato ai permessi assegnati

Permessi granulari: `dashboard`, `inbox`, `sent`, `send`, `report`, `devices`, `ports`, `rules`, `settings`, `users`, `api`

### 10. Audit log (solo superadmin)
Accedi su **Audit log** per vedere tutte le operazioni eseguite: login, modifiche utenti, invio SMS, modifiche regole, ecc.

---

## 🗂️ Struttura del progetto

```
GB-SMS-Gateway/
├── backend/
│   ├── src/
│   │   ├── index.js              # Entry point Express + WebSocket
│   │   ├── db/
│   │   │   └── database.js       # Schema SQLite + migrations
│   │   ├── middleware/
│   │   │   └── authMiddleware.js # JWT, ruoli, permessi
│   │   ├── routes/               # 10 router Express
│   │   │   ├── auth.js           # login, SSO, /me
│   │   │   ├── messages.js       # inbox, sent, invio, stats
│   │   │   ├── devices.js        # CRUD dispositivi Yeastar
│   │   │   ├── ports.js          # stato e mappatura porte SIM
│   │   │   ├── rules.js          # regole di inoltro
│   │   │   ├── settings.js       # SMTP e template email
│   │   │   ├── users.js          # utenti, LDAP, permessi
│   │   │   ├── localGroups.js    # gruppi locali
│   │   │   ├── report.js         # statistiche e analytics
│   │   │   └── audit.js          # log di audit
│   │   ├── services/
│   │   │   ├── authService.js    # JWT, bcrypt, seed superadmin
│   │   │   ├── ldapService.js    # LDAP/AD integration
│   │   │   ├── samlService.js    # SAML 2.0 SP (node-saml)
│   │   │   ├── messageService.js # accesso messaggi con filtro permessi
│   │   │   ├── routingEngine.js  # motore di routing SMS
│   │   │   ├── deviceManager.js  # gestione connessioni AMI
│   │   │   ├── yeastarConnector.js # protocollo AMI Yeastar
│   │   │   ├── wsService.js      # WebSocket real-time
│   │   │   └── auditService.js   # audit trail
│   │   └── utils/
│   │       ├── logger.js         # Winston logger
│   │       └── encryption.js     # cifratura credenziali DB
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Routing React
│   │   ├── api.js                # Axios client + metodi API
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx   # JWT storage, SSO auto-login
│   │   ├── hooks/
│   │   │   └── useWebSocket.js   # Hook WebSocket
│   │   ├── pages/                # 13 pagine
│   │   │   ├── LoginPage.jsx
│   │   │   ├── SamlCallback.jsx  # riceve token JWT dal backend SAML
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Inbox.jsx
│   │   │   ├── Sent.jsx
│   │   │   ├── SendSMS.jsx
│   │   │   ├── Devices.jsx
│   │   │   ├── Ports.jsx
│   │   │   ├── Rules.jsx
│   │   │   ├── Settings.jsx
│   │   │   ├── Report.jsx
│   │   │   ├── UsersPage.jsx
│   │   │   └── AuditLog.jsx
│   │   └── components/           # Sidebar, MessageTable, StatCard, ...
│   ├── public/                   # PWA manifest + service worker
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
├── .env.example
├── .gitattributes
└── README.md
```

---

## 🔧 Stack tecnologico

### Backend
- **Node.js 22** — Runtime JavaScript con `node:sqlite` built-in
- **Express 4** — Web framework REST API
- **SQLite** (`node:sqlite`) — Database embedded, zero config
- **bcryptjs** — Hashing password (cost 12)
- **jsonwebtoken** — Autenticazione JWT stateless
- **ldapjs** — Integrazione LDAP/Active Directory
- **@node-saml/node-saml** — SAML 2.0 SP (SP-initiated, NetScaler/ADFS/AzureAD)
- **winston** — Logging strutturato
- **ws** — WebSocket server per aggiornamenti real-time

### Frontend
- **React 18** — UI component-based
- **Vite 5** — Build tool e dev server
- **Tailwind CSS 3** — Utility-first styling
- **Axios** — HTTP client con interceptor JWT
- **PWA** — Service worker + manifest per installazione offline

### Infrastruttura
- **Docker** + **Docker Compose** — Deploy containerizzato
- **nginx** — Reverse proxy frontend + gzip + cache headers
- **AMI** (Asterisk Manager Interface) — Connessione al Yeastar TG1600

---

## 📊 API Endpoints

### Autenticazione
- `POST /api/auth/login` — Login con username/password
- `GET /api/auth/sso` — Login SSO via header proxy
- `GET /api/auth/me` — Info utente corrente dal token JWT
- `GET /api/auth/saml/status` — Verifica se SAML è abilitato *(pubblico)*
- `GET /api/auth/saml/metadata` — SP Metadata XML per configurazione IdP *(pubblico)*
- `GET /api/auth/saml/login` — Avvio flusso SAML SP-initiated (redirect a IdP)
- `POST /api/auth/saml/callback` — ACS endpoint (POST dall'IdP dopo autenticazione)

### Messaggi
- `GET /api/messages` — Lista messaggi (filtri: direction, device_id, search, paginazione)
- `GET /api/messages/stats` — Statistiche (received_today, sent_today, total_inbound, failed)
- `GET /api/messages/:id` — Dettaglio messaggio
- `POST /api/messages/send` — Invia SMS (device, porta, destinatario, testo)

### Dispositivi
- `GET /api/devices` — Lista dispositivi con stato connessione
- `POST /api/devices` — Crea dispositivo Yeastar
- `PUT /api/devices/:id` — Modifica dispositivo
- `DELETE /api/devices/:id` — Elimina dispositivo

### Porte SIM
- `GET /api/ports?device_id=` — Stato porte SIM del dispositivo
- `PUT /api/ports/:device_id/:port_number/info` — Aggiorna numero SIM / operatore

### Regole di inoltro
- `GET /api/rules` — Lista regole con condizioni e destinatari
- `POST /api/rules` — Crea regola (condizioni, email targets, gruppi visibilità)
- `PUT /api/rules/:id` — Modifica regola
- `DELETE /api/rules/:id` — Elimina regola

### Impostazioni
- `GET/POST /api/settings/smtp` — Configurazione SMTP
- `POST /api/settings/smtp/test` — Test invio email
- `GET/POST /api/settings/email-template` — Template HTML email
- `GET/POST /api/settings/email-subject` — Oggetto email personalizzato
- `GET/POST /api/settings/saml` — Configurazione SAML 2.0 *(solo superadmin)*

### Utenti e gruppi
- `GET/POST /api/users` — Lista / crea utenti
- `PUT/DELETE /api/users/:id` — Modifica / elimina utente
- `GET/POST /api/users/ldap-settings` — Configurazione LDAP
- `POST /api/users/ldap-test` — Test connessione LDAP
- `GET/POST /api/groups` — Gestione gruppi locali
- `POST /api/groups/:id/members` — Aggiungi utente a gruppo

### Report e audit
- `GET /api/report?days=30` — Statistiche SMS aggregati
- `GET /api/audit` — Log di audit con filtri (solo superadmin)
- `DELETE /api/audit?days=N` — Purge voci vecchie

### Health check
- `GET /api/health` — Stato backend e dispositivi connessi

---

## 🗃️ Database SQLite

| Tabella | Contenuto |
|---------|-----------|
| `devices` | Gateway Yeastar configurati |
| `ports` | Porte SIM con stato, operatore, IMEI, numero SIM |
| `messages` | SMS inbound/outbound |
| `routing_rules` | Regole di inoltro con `allowed_groups` (JSON) |
| `rule_conditions` | Condizioni delle regole |
| `rule_targets` | Email destinatari degli inoltri |
| `dispatches` | Log inoltri email per ogni SMS |
| `users` | Utenti locali e LDAP (`source`, `ldap_dn`, `ldap_groups`) |
| `settings` | Configurazioni chiave-valore (SMTP, LDAP, template email) |
| `audit_log` | Audit trail completo delle operazioni |

---

## 🔒 Sicurezza

- ✅ **Password hashing** — bcrypt con cost 12
- ✅ **JWT stateless** — Token firmati con segreto configurabile, scadenza impostabile
- ✅ **Middleware auth** — Ogni route verifica ruolo e permessi specifici
- ✅ **Input validation** — express-validator su tutti gli endpoint pubblici
- ✅ **SQL Injection** — Prepared statements (SQLite built-in)
- ✅ **Helmet** — HTTP security headers automatici
- ✅ **CORS** — Origine configurabile (default `*`, restringi in produzione)
- ✅ **Credenziali LDAP cifrate** — Stored nel DB con cifratura AES
- ✅ **SSO sicuro** — Endpoint `/api/auth/sso` disabilitato di default; va abilitato solo se il proxy impedisce accesso diretto al backend
- ✅ **Audit trail** — Tutte le operazioni sensibili vengono tracciate nel log di audit

---

## 🐛 Troubleshooting

### Il container non parte
```bash
docker logs smsgateway-backend
```

Errori comuni:
- `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` → immagine Node.js troppo vecchia, servono Node 22+ e il flag `--experimental-sqlite`
- `Bind mount failed` → le cartelle `./data` e `./logs` non esistono sull'host (il servizio `init-dirs` le crea automaticamente)

### Password errata al login su Docker
Possibile causa: il file `.env` ha line ending `CRLF` (copiato da Windows). Fix:
```bash
sed -i 's/\r//' .env
docker compose down && docker compose up -d --build
```

### Dispositivo Yeastar non si connette
- Verifica che l'AMI sia abilitato nel TG1600 (System → AMI → Enable)
- Controlla host, porta (default `5038`), username e password AMI
- Verifica che il firewall non blocchi la porta 5038

### Nessun SMS ricevuto
- Verifica lo stato porte in **Porte SIM** — le SIM devono essere in stato "Registrata"
- Controlla che almeno una regola di inoltro sia attiva

---

## 🔄 Backup e Ripristino

### Backup manuale
```bash
# Il database è un singolo file SQLite
cp /volume3/docker/smsgateway/data/smsgateway.db smsgateway_$(date +%Y%m%d).db
```

### Ripristino
```bash
docker compose down
cp smsgateway_backup.db /volume3/docker/smsgateway/data/smsgateway.db
docker compose up -d
```

### Backup automatico (cron)
```bash
# Aggiungere al crontab (crontab -e)
0 3 * * * cp /volume3/docker/smsgateway/data/smsgateway.db /backup/smsgateway_$(date +\%Y\%m\%d).db
```

---

## 📝 Changelog

### v1.1.0 (Marzo 2026)
- ✅ Fix: `node:sqlite` → richiede Node 22+ e `--experimental-sqlite`
- ✅ Fix: Dockerfile aggiornato a `node:22-alpine`
- ✅ Fix: `.gitattributes` per line ending LF (compatibilità Synology)
- ✅ Fix: `.trim()` su `SUPERADMIN_PASSWORD` per prevenire bug CRLF
- ✅ Fix: servizio `init-dirs` in docker-compose per creare cartelle bind mount su Synology
- ✅ Remote git multipli: `git.ballarini.app` + `git.airdolomiti.it`
- ✅ Logging diagnostico login

### v1.0.0 (Gennaio 2026)
- ✅ Monitoraggio real-time porte SIM (segnale, operatore, IMEI)
- ✅ Ricezione e inoltro SMS con motore di routing
- ✅ Invio SMS manuale
- ✅ Inoltro email automatico con template HTML personalizzabile
- ✅ Autenticazione locale + LDAP/AD + SSO
- ✅ Visibilità messaggi per gruppi LDAP/AD
- ✅ Report e statistiche
- ✅ Gestione utenti con ruoli e permessi granulari
- ✅ Gruppi locali con ereditarietà permessi
- ✅ Audit log completo
- ✅ WebSocket per aggiornamenti real-time
- ✅ PWA installabile
- ✅ Deploy Docker con volumi persistenti

---

## 🤝 Contribuire

1. Fai un fork del progetto
2. Crea un branch (`git checkout -b feature/NuovaFunzionalita`)
3. Committa le modifiche (`git commit -m 'feat: aggiungi NuovaFunzionalita'`)
4. Push del branch (`git push origin feature/NuovaFunzionalita`)
5. Apri una Pull Request

---

## 📄 Licenza

Uso privato — © 2026 Guido Ballarini

---

## 👨‍💻 Autore

**Guido Ballarini**

- 💼 LinkedIn: [Guido Ballarini](https://www.linkedin.com/in/guido-ballarini/)
- ☕ Buy Me a Coffee: [guidoballau](https://buymeacoffee.com/guidoballau)

---

## 💖 Supporta il progetto

Se trovi utile questo progetto, offrimi un caffè! ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-guidoballau-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/guidoballau)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/donate/?hosted_button_id=8RF28JBPLYASN)

⭐ Se ti piace il progetto, lascia una stella! ⭐

*Made with ❤️ by Guido Ballarini — © 2026*


---

## Funzionalità principali

- **Monitoraggio real-time** delle porte SIM (stato, operatore, segnale, IMEI)
- **Ricezione e inoltro SMS** tramite regole configurabili (routing engine)
- **Invio SMS** manuale da dashboard web
- **Inoltro email** automatico al match delle regole con template HTML personalizzabile
- **Autenticazione** locale, LDAP/Active Directory e SSO (Authentik, NetScaler ADC)
- **Autorizzazioni per gruppo AD**: ogni regola di inoltro può limitare la visibilità dei messaggi a specifici gruppi
- **Report e statistiche** SMS ricevuti/inviati
- **Gestione utenti** completa con ruoli: `superadmin`, `admin`, `user`
- **PWA** installabile su desktop e mobile

---

## Stack tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Backend | Node.js 25 + Express 4 |
| Database | SQLite (`node:sqlite`, builtin Node.js 25) |
| Frontend | React 18 + Vite 5 + Tailwind CSS 3 |
| Auth | JWT (jsonwebtoken) + bcryptjs + ldapjs |
| Connettore | AMI (Asterisk Manager Interface) → Yeastar TG1600 |
| Container | Docker + Docker Compose |

---

## Struttura del progetto

```
GB-SMS-Gateway/
├── backend/
│   ├── src/
│   │   ├── db/            # Database SQLite (schema + migrations)
│   │   ├── middleware/    # Auth middleware (JWT, roles)
│   │   ├── routes/        # Express routes (auth, users, messages, rules, ports, devices, settings)
│   │   ├── services/      # Business logic (authService, ldapService, messageService, routingEngine, deviceManager, yeastarConnector)
│   │   ├── utils/         # Logger (winston)
│   │   └── index.js       # Entry point
│   ├── data/              # SQLite DB (bind mount Docker)
│   ├── logs/              # Log files (bind mount Docker)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/    # Sidebar, layout
│   │   ├── contexts/      # AuthContext (JWT, SSO auto-login)
│   │   ├── pages/         # Dashboard, Inbox, Sent, SendSMS, Ports, Devices, Rules, Report, Settings, UsersPage, LoginPage
│   │   └── api.js         # Axios client + API methods
│   └── public/            # PWA assets (manifest, service worker, icons)
├── docker-compose.yml
└── README.md
```
