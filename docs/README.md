# PickleMatch VN

A mobile platform for Vietnam's pickleball community to find, create, and join matches. Built with React Native (Expo) and Supabase.

## Features

- **Browse Sessions** — View open pickleball sessions with filters for skill level, location, price, and available slots
- **Find Sessions** — Search by city, skill level, date range, and availability
- **Create Session** — Multi-step wizard to book a court slot and configure match details (skill range, max players, approval requirement)
- **My Sessions** — Track sessions you've hosted or joined
- **Player Profiles** — View stats, ELO rating, and session history
- **OTP Authentication** — Phone number login via Supabase
- **Skill-based Matching** — ELO-based filtering to match players of similar ability

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo 54 |
| Language | TypeScript 5.9 |
| Routing | Expo Router (file-based) |
| Backend / DB | Supabase (PostgreSQL) |
| Auth | Supabase Phone OTP |
| State | React Hooks |
| Animations | React Native Reanimated |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Expo Go app on your phone (for development), or Android/iOS simulator
- A Supabase project with the required schema (see [Database Schema](#database-schema))

## Getting Started

1. **Clone the repo**

   ```bash
   git clone <repo-url>
   cd picklematch-vn
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure Supabase**

   Open [lib/supabase.ts](lib/supabase.ts) and set your project URL and anon key:

   ```ts
   const supabaseUrl = 'https://<your-project>.supabase.co'
   const supabaseAnonKey = '<your-anon-key>'
   ```

4. **Start the development server**

   ```bash
   npm start
   ```

   Scan the QR code with Expo Go, or press `a` for Android / `i` for iOS simulator.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start Expo dev server |
| `npm run android` | Run on Android emulator |
| `npm run ios` | Run on iOS simulator |
| `npm run web` | Run in browser |
| `npm run lint` | Run ESLint |
| `npm run reset-project` | Reset to blank Expo starter |

## Project Structure

```
picklematch-vn/
├── app/                    # File-based routes (Expo Router)
│   ├── (tabs)/             # Bottom tab screens
│   │   ├── index.tsx       # Home — browse sessions
│   │   ├── find-session.tsx
│   │   ├── my-sessions.tsx
│   │   └── profile.tsx
│   ├── session/[id].tsx    # Session detail
│   ├── player/[id].tsx     # Player profile
│   ├── create-session.tsx
│   ├── edit-profile.tsx
│   ├── login.tsx
│   └── profile-setup.tsx
├── lib/
│   ├── supabase.ts         # Supabase client
│   └── useAuth.ts          # Auth hook
├── components/             # Reusable UI components
├── constants/
│   └── theme.ts            # Design tokens
├── hooks/                  # Custom React hooks
└── assets/                 # Images and icons
```

## Database Schema

The app expects the following tables in your Supabase project:

| Table | Key Columns |
|---|---|
| `players` | `id`, `name`, `phone`, `city`, `elo`, `no_show_count` |
| `sessions` | `id`, `host_id`, `slot_id`, `status`, `elo_min`, `elo_max`, `max_players` |
| `session_players` | `session_id`, `player_id` |
| `courts` | `id`, `name`, `address`, `city` |
| `court_slots` | `id`, `court_id`, `start_time`, `end_time`, `price`, `status` |

## Skill Levels (ELO)

| Level | ELO Range |
|---|---|
| Beginner | < 1000 |
| Intermediate | 1000 – 1199 |
| Advanced | 1200 – 1399 |
| Expert | 1400+ |

## License

MIT
