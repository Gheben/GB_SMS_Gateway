# GB SMS Gateway

Sistema di gestione e inoltro SMS per gateway GSM **Yeastar TG1600**, con interfaccia web moderna, autenticazione locale/LDAP/SSO e visibilità messaggi basata su gruppi Active Directory.

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

---

## Avvio rapido (Docker)

```bash
git clone git@git.ballarini.app:guido/GB-SMS-Gateway.git
cd GB-SMS-Gateway

# Crea il file di configurazione
cp backend/.env.example backend/.env
# Modifica backend/.env con i tuoi parametri

docker compose up -d
```

Frontend disponibile su `http://localhost:3000`, API backend su `http://localhost:4673`.

---

## Configurazione (`.env`)

```dotenv
# Database
DB_PATH=/app/data/smsgateway.db

# Server
PORT=4673

# Superadmin (creato automaticamente all'avvio)
SUPERADMIN_USERNAME=sysadmin
SUPERADMIN_PASSWORD=Password!   # Cambia in produzione!

# JWT
JWT_SECRET=your-very-long-random-secret
JWT_EXPIRES_IN=8h

# SSO tramite proxy (Authentik, NetScaler ADC, ecc.)
SSO_ENABLED=false
SSO_HEADER=X-Remote-User        # Header impostato dal proxy con lo username

# Email (SMTP)
# Configurabile dalla UI → Impostazioni
```

---

## Autenticazione

### Utenti locali
Credenziali memorizzate nel DB con password hash bcrypt (cost 12). Gestiti dalla sezione **Gestione utenti**.

### LDAP / Active Directory
Configurabile dalla UI → **Gestione utenti → LDAP / Active Directory**:

- Bind con account di servizio
- Ricerca utente tramite filtro personalizzabile (default: `sAMAccountName`)
- Risoluzione gruppi nested (modalità AD con `LDAP_MATCHING_RULE_IN_CHAIN` o BFS standard)
- Mapping gruppi DN → ruolo (`admin` / `user`) con permessi granulari
- Permessi = unione di tutti i gruppi corrispondenti; Admin prevale sempre

Al primo accesso LDAP l'utente viene inserito nel DB locale e aggiornato ad ogni login.

### SSO (Authentik / NetScaler / Nginx)
Se `SSO_ENABLED=true`, il frontend tenta automaticamente `GET /api/auth/sso` all'avvio.
Il proxy deve autenticare l'utente e aggiungere l'header configurato (es. `X-Remote-User: john.smith`) a ogni richiesta verso il backend.

Il backend legge lo username dall'header, lo risolve tramite LDAP (se configurato) e restituisce un JWT senza richiedere password. L'utente viene loggato automaticamente senza vedere la schermata di login.

**Configurazione Authentik**: Upstream Application → Advanced → Additional Headers → `X-Remote-User: {{ user.username }}`

---

## Regole di inoltro e visibilità messaggi

Le regole di inoltro definiscono:
- **Condizioni** di attivazione (mittente, testo, dispositivo — con regex support)
- **Destinatari email** per l'inoltro automatico
- **Gruppi di visibilità** (LDAP/AD Groups DN): se impostati, solo gli utenti in quei gruppi vedranno i messaggi instradati da quella regola

| Situazione | Visibilità |
|-----------|-----------|
| Admin / Superadmin | Tutti i messaggi |
| Utente + Gruppo AD | Messaggi delle regole dove il suo gruppo è incluso |
| Regola senza gruppi | Visibile a tutti gli utenti autenticati |

---

## Connessione al Yeastar TG1600

Il gateway si connette tramite AMI (porta 5038). Configurare in **Dispositivi**:

- **Host**: IP del TG1600
- **Porta**: `5038` (default AMI)
- **Username / Password**: credenziali AMI (configurate nel TG1600 → System → AMI)

Il backend mantiene la connessione persistente con riconnessione automatica e polling stato porte ogni 5 minuti.

---

## Struttura DB (SQLite)

| Tabella | Contenuto |
|---------|-----------|
| `devices` | Gateway Yeastar configurati |
| `ports` | Porte SIM con stato, operatore, IMEI, SIM number |
| `messages` | SMS inbound/outbound |
| `routing_rules` | Regole di inoltro con `allowed_groups` (JSON) |
| `rule_conditions` | Condizioni delle regole |
| `rule_targets` | Email destinatari |
| `dispatches` | Log inoltri email per ogni SMS |
| `users` | Utenti locali e LDAP (con `source`, `ldap_dn`) |
| `settings` | Configurazioni chiave-valore (SMTP, LDAP, template email) |

---

## Sviluppo locale

```bash
# Backend
cd backend
npm install
node --experimental-sqlite src/index.js

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev
```

Il frontend (Vite) gira su `http://localhost:3000` e proxia `/api` verso il backend su `localhost:4673`.

---

## Licenza

Uso privato — © 2026 Guido Ballarini

