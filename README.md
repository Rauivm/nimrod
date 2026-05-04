# foundry-nimrod

Private social platform for RPG players using Foundry VTT.

## Stack

- **Backend**: Fastify (Node.js) + PostgreSQL
- **Frontend**: React + Vite
- **Realtime**: WebSockets
- **Auth**: Cloudflare Access (trusted headers)
- **Deployment**: Docker + Docker Compose

## Features

- 📜 **Taverna (Feed)** — Post messages, react with likes, real-time updates
- ⚔ **Missões** — Create/join/manage missions with player + reserve slots
- 🪦 **Cemitério** — Memorial for fallen characters with tribute/decay system
- 🗺 **Mapas** — GM uploads, players download
- 🔴 **Foundry Button** — One-click entry to Foundry VTT

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env: set FOUNDRY_URL
docker compose up --build
```

App at `http://localhost` · Backend at `http://localhost:3001`

## Local Development

### Backend

```bash
cd backend
cp .env.example .env
# Edit DATABASE_URL, FOUNDRY_URL
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Auth

In production, Cloudflare Access injects:
- `cf-access-authenticated-user-email`
- `cf-access-user-name`

In development, set `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_USER_ROLE` in backend `.env`.

To make a user GM, use the API:
```bash
PATCH /users/:id/role  { "role": "GM" }
# (must be authenticated as GM — set DEV_USER_ROLE=GM for first setup)
```

## API Routes

### Auth/Config
| Method | Path | Description |
|--------|------|-------------|
| GET | /config | Returns foundryUrl |
| GET | /me | Current user |
| PATCH | /me | Update name |
| GET | /users | List all users |
| PATCH | /users/:id/role | Change role (GM only) |

### Posts
| Method | Path | Description |
|--------|------|-------------|
| GET | /posts | Feed (paginated) |
| POST | /posts | Create post |
| POST | /posts/:id/like | Toggle like |
| DELETE | /posts/:id | Delete own post |

### Missions
| Method | Path | Description |
|--------|------|-------------|
| GET | /missions | List (filter: ?status=OPEN\|CLOSED\|FINISHED) |
| GET | /missions/:id | Detail + participants |
| POST | /missions | Create (GM) |
| PATCH | /missions/:id | Edit |
| DELETE | /missions/:id | Delete |
| POST | /missions/:id/join | Join / reserve |
| DELETE | /missions/:id/join | Leave |
| POST | /missions/:id/invite | Invite user (bypass slots) |
| POST | /missions/:id/rate | Rate 1–5 (finished only) |

### Cemetery
| Method | Path | Description |
|--------|------|-------------|
| GET | /cemetery | List characters |
| POST | /cemetery | Add character |
| POST | /cemetery/:id/tribute | Toggle tribute |
| DELETE | /cemetery/:id | Remove |

### Maps
| Method | Path | Description |
|--------|------|-------------|
| GET | /maps | List maps |
| POST | /maps | Upload (GM only, multipart) |
| DELETE | /maps/:id | Remove (GM only) |

## Cemetery Tribute System

| Count | Display |
|-------|---------|
| 0 | 🪦 |
| 1–4 | 🌹 (roses) |
| 5–9 | 💐 (bouquet) |
| 10–19 | 👑 (crown) |
| 20–29 | 👑👑 |
| 30+ | 👑👑👑 |

Decay: -1 tribute/day after 5 days of inactivity (cron at 03:00).

## WebSocket Events

| Event | Payload |
|-------|---------|
| CONNECTED | `{ ts }` |
| POST_CREATED | post object |
| POST_LIKED | `{ postId, likeCount, liked }` |
| POST_DELETED | `{ postId }` |
| MISSION_CREATED | mission object |
| MISSION_UPDATED | mission object |
| MISSION_DELETED | `{ missionId }` |
