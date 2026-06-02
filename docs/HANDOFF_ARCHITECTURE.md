# Advanced Human Handoff + Broker Monitoring System

This scaffold adds a Node/Express + React handoff platform beside the existing Python bot. It is now shaped as a production-oriented sales operating console: dark dashboard, realtime handoff, JWT access tokens, refresh sessions, role-based team management, transcripts, analytics, follow-ups, and queue-ready webhook processing.

## Runtime Flow

1. Twilio sends all WhatsApp messages to `POST /webhooks/twilio/whatsapp`.
2. The backend stores the client message and emits it to broker dashboards over Socket.io.
3. The routing engine checks the conversation mode:
   - `AI`: AI analyzes and replies through the same Twilio WhatsApp number.
   - `SHADOW`: AI still replies, broker sees live messages, AI metadata, sentiment, score, and alerts.
   - `HUMAN`: AI stops replying. Broker replies from the dashboard through Twilio.
   - `HYBRID`: AI creates drafts and suggested replies. Broker can edit/send.
4. Webhooks are acknowledged immediately, then processed through a queue abstraction.
5. Smart notifications are created only for trigger conditions, not every message.
6. Transcript generation runs on close, broker takeover, or manual request.

The client never sees broker identity or a second phone number.

## New Project Layout

```text
handoff-backend/
  src/server.js
  src/routes/
  src/services/
  src/models/
  src/realtime/
handoff-dashboard/
  src/App.jsx
  src/styles.css
docs/HANDOFF_ARCHITECTURE.md
```

## Collections

- `users`: broker/admin login and roles.
- `sessions`: refresh-token sessions for logout and logout-everywhere.
- `conversations`: mode, assignment, insights, lead score, summaries.
- `messages`: client, AI, broker, system messages with delivery metadata.
- `broker_sessions`: shadow/takeover/hybrid activity.
- `transcripts`: JSON, TXT, and PDF transcript payloads.
- `notifications`: dashboard and external alerts with dedupe cooldown.
- `followups`: scheduled manual, AI, and inactivity reminders.
- `auditlogs`: broker actions and mode changes.

## Dashboard Modules

- Dashboard overview: active conversations, hot leads, intervention count, conversion rate, follow-ups, average AI confidence.
- Live Conversations: left inbox, center chat, right lead intelligence panel.
- Lead Boards: cold, warm, hot, and closed lead filtered views.
- Broker Team: create members, show roles, status, activity, and active lead counts.
- Transcripts: searchable archive for generated JSON/TXT/PDF transcripts.
- Notifications: priority alert center with dashboard-first delivery.
- Analytics: lightweight operational charts and lead activity.
- Settings: workspace, auth, queue, OAuth, and security readiness.

## Smart Notification Triggers

Implemented in `src/services/notificationService.js`:

- high intent or high lead score
- human/callback request
- angry/frustrated sentiment
- pricing/payment/negotiation terms
- AI confidence below 40%
- contact details shared
- high deal value when extracted

Each alert uses a 10-minute per-conversation dedupe window to avoid notification spam.

## Setup

One-command startup (backend + dashboard + ngrok):

```bash
cd /Users/shirsh/Downloads/Programming/WhatsApp\ V2
./start-handoff.sh
```

This script starts:

- backend on `http://localhost:8080`
- dashboard on `http://localhost:5173`
- ngrok tunnel and UI on `http://localhost:4040`

Press `Ctrl+C` in that terminal to stop all three services together.

Manual startup:

Backend:

```bash
cd handoff-backend
cp .env.example .env
npm install
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me npm run seed:admin
npm run dev
```

Dashboard:

```bash
cd handoff-dashboard
cp .env.example .env
npm install
npm run dev
```

Twilio WhatsApp webhook:

```text
POST https://YOUR_PUBLIC_URL/webhooks/twilio/whatsapp
```

The backend also accepts the old Python bot path during migration:

```text
POST https://YOUR_PUBLIC_URL/webhook/whatsapp
```

Twilio status callback:

```text
POST https://YOUR_PUBLIC_URL/webhooks/twilio/status
```

## Broker Registration

1. Create an admin account once:

```bash
cd handoff-backend
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me ADMIN_NAME="Main Admin" npm run seed:admin
```

2. Log in to the dashboard as admin.
3. Use the new `Create Broker` panel in the left sidebar.
4. Enter broker name, email, and temporary password.
5. Broker signs in from the same dashboard login screen.

## Security Notes

- JWT access tokens and refresh sessions are used for dashboard APIs and Socket.io.
- Logout-everywhere revokes active refresh sessions.
- Role-based access supports `super_admin`, `admin`, `broker`, and `viewer`.
- Twilio webhook validation is enforced in production mode.
- Broker actions are written to audit logs.
- API rate limiting is enabled in-process for local/dev use.
- Store production secrets in a secret manager. Do not commit `.env`.

## Production Gaps To Finish Before Launch

- Replace the in-memory queue wrapper with BullMQ backed by `REDIS_URL`.
- Replace in-memory rate limiting with Redis-backed limits for multi-instance deployments.
- Add durable outbound Twilio retry jobs.
- Add CRM adapter implementations for HubSpot, Zoho, and Salesforce.
- Add audio media download plus transcription provider.
- Add proper transactional email for verification and password reset token delivery.
- Add Google OAuth and optional 2FA implementation behind the existing settings placeholders.
