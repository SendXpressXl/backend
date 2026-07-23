<div align="center">

# SendXpress Backend

**REST API for cross-border social commerce with Stellar escrow.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase)](https://supabase.com/)
[![Stellar](https://img.shields.io/badge/Stellar-Horizon-7C68EE)](https://stellar.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## Overview

This is the backend API for **SendXpress** — a social commerce platform where importers discover products from global suppliers, negotiate in real-time chat, and pay safely through smart contract escrow on Stellar.

The API handles user management, social feed, marketplace listings, real-time chat, and orchestrates Stellar transactions for the escrow deal lifecycle.

**Related repos:**
- [SendXpress/mobile](https://github.com/SendXpress/mobile) — SwiftUI iOS app
- [SendXpress/smartcontract](https://github.com/SendXpress/smartcontract) — Soroban escrow contract

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 20 | Fast, lightweight, huge ecosystem |
| **Framework** | Express 4 | Minimal, well-understood REST framework |
| **Database** | Supabase (Postgres) | Instant setup, Realtime for chat, Row Level Security, image storage |
| **Blockchain** | Stellar SDK | Horizon API for accounts/balances, transaction building for escrow |
| **Auth** | Stellar wallet signature | Challenge-response verification against Ed25519 public key |

---

## API Routes

### Users

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/users` | Create or find user by Stellar wallet address |
| `GET` | `/api/users/:wallet` | Fetch user profile |
| `PATCH` | `/api/users/:id/role` | Set buyer or seller role |

### Social Feed

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/posts` | Fetch posts with user join (newest first) |
| `POST` | `/api/posts` | Create a new post (text, image, tagged listing) |
| `POST` | `/api/posts/:id/like` | Toggle like on a post |

### Marketplace

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/listings` | Fetch active listings with seller info |
| `POST` | `/api/listings` | Create a listing (seller role required) |
| `GET` | `/api/listings/:id` | Fetch single listing detail |

### Chat

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/chat/conversations` | Fetch conversations for a user |
| `POST` | `/api/chat/conversations` | Create or find a conversation for a listing (atomic upsert, dedupes on listing_id + buyer_id + seller_id) |
| `GET` | `/api/chat/messages` | Fetch messages in a conversation — cursor-paginated, newest first (`?conversationId=&cursor=&limit=`) |
| `POST` | `/api/chat/messages` | Send a message + update conversation timestamp |
| `POST` | `/api/chat/conversations/:id/read` | Mark messages read up to `message_id` for the calling side of the conversation |

### Escrow Deals

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/deals` | Create escrow deal — build Stellar tx, lock XLM, store in DB |
| `GET` | `/api/deals` | Fetch deals for a user (as buyer or seller) |
| `POST` | `/api/deals/:id/ship` | Seller marks deal as shipped |
| `POST` | `/api/deals/:id/confirm` | Buyer confirms receipt — release funds via Stellar tx |
| `POST` | `/api/deals/:id/dispute` | Either party raises a dispute |
| `POST` | `/api/deals/:id/cancel` | Buyer cancels before shipment — refund via Stellar tx |
| `GET` | `/api/deals/:id/transitions` | Audit trail of status changes for a deal |
| `GET` | `/api/deals/:id/verify` | Check each recorded transaction hash against Horizon |

---

## Project Structure

```
backend/
├── package.json
├── .env.example
└── src/
    ├── index.js                  Entry point — Express app, route mounting
    │
    ├── config/
    │   ├── supabase.js           Supabase client (Postgres + Realtime)
    │   └── stellar.js            Horizon server + network passphrase
    │
    ├── routes/
    │   ├── users.js              User CRUD + role assignment
    │   ├── posts.js              Social feed + likes
    │   ├── listings.js           Marketplace CRUD
    │   ├── chat.js               Conversations + messages
    │   └── deals.js              Full escrow deal lifecycle
    │
    ├── services/
    │   └── escrow.js             Stellar transaction builders
    │                             (lockFunds, releaseFunds, refund)
    │
    ├── middleware/
    │   └── auth.js               Wallet signature verification
    │
    └── tests/                    Test directory
```

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **A Supabase project** (free tier works) — [supabase.com](https://supabase.com)
- **Stellar testnet** access (no account needed — uses Horizon public API)

### Setup

```bash
git clone https://github.com/SendXpress/backend.git
cd backend
cp .env.example .env
```

Fill in your `.env`:

```bash
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
STELLAR_NETWORK=testnet
STELLAR_HORIZON=https://horizon-testnet.stellar.org
ESCROW_SECRET_KEY=S_YOUR_ESCROW_ACCOUNT_SECRET
```

### Run

```bash
npm install
npm run dev          # starts with --watch for auto-reload
```

### Verify

```bash
curl http://localhost:3000/api/health
# → {"status":"ok"}
```

---

## Escrow Service

The `escrow.js` service builds and submits Stellar transactions for the deal lifecycle:

| Function | What it does |
|---|---|
| `lockFunds(buyerSecret, escrowPublic, amount, memo)` | Buyer sends XLM to the escrow holding account |
| `releaseFunds(escrowSecret, sellerPublic, amount, memo)` | Escrow releases XLM to the seller on confirmation |
| `refund(escrowSecret, buyerPublic, amount, memo)` | Escrow returns XLM to buyer on cancellation |

All transactions use Stellar's native XLM with the deal ID as a memo for traceability.

---

## Database Schema

The API expects these Supabase tables (create via SQL editor):

| Table | Key columns |
|---|---|
| `users` | id, wallet, handle, display_name, avatar_url, role, created_at |
| `posts` | id, user_id, text, image_url, tagged_listing_id, likes_count, created_at |
| `listings` | id, seller_id, title, description, price, category, moq, ship_days, image_url, status |
| `conversations` | id, listing_id, buyer_id, seller_id, last_message, last_at, buyer_last_read_message_id, seller_last_read_message_id |
| `messages` | id, conversation_id, sender_id, type, body, offer_amount, offer_status, created_at |
| `deals` | id, buyer, seller, amount, description, status, shipped_at, tx_ledger, release_ledger, refund_ledger, created_at |
| `deal_transitions` | id, deal_id, actor_wallet, from_status, to_status, reason, created_at |

`sql/deal_transitions_and_expiry.sql` has the exact statements for the `shipped_at` column and the `deal_transitions` table. `sql/escrow_confirmed_ledgers.sql` adds `tx_ledger`, `release_ledger`, and `refund_ledger`.

`conversations` also needs a unique constraint on `(listing_id, buyer_id, seller_id)` so the create-conversation upsert can dedupe correctly:

```sql
ALTER TABLE conversations
  ADD CONSTRAINT conversations_listing_buyer_seller_key
  UNIQUE (listing_id, buyer_id, seller_id);

ALTER TABLE conversations
  ADD COLUMN buyer_last_read_message_id  uuid REFERENCES messages(id),
  ADD COLUMN seller_last_read_message_id uuid REFERENCES messages(id);
```

---

## License

MIT
