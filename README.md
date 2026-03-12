# Dumb Friend — Web App

## Deploy to Vercel (5 minutes)

### Option A: GitHub + Vercel (recommended)

1. Create a new GitHub repo called `dumb-friend`
2. Upload all these files to the repo (drag and drop works on github.com)
3. Go to [vercel.com](https://vercel.com) and sign in with GitHub
4. Click "Import Project" → select your `dumb-friend` repo
5. Vercel auto-detects Vite and deploys. Done!
6. Your app is live at `dumb-friend.vercel.app`

### Option B: Vercel CLI

```bash
npm install -g vercel
cd dumb-friend-web
npm install
vercel
```

### Option C: Local development

```bash
cd dumb-friend-web
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Files

```
dumb-friend-web/
├── index.html          # Entry point with fonts + meta tags
├── package.json        # Dependencies (React, Supabase, Vite)
├── vite.config.js      # Build config
└── src/
    ├── main.jsx        # React entry
    ├── index.css       # Global styles + animations
    ├── supabase.js     # Supabase client config
    └── App.jsx         # Complete game (auth, lobby, game, results)
```

## How it works

- Auth via Supabase (email/password)
- Player 1 creates a room → gets a 4-letter code
- Player 2 enters the code → both start playing
- Real-time sync via Supabase Realtime (postgres_changes)
- 7 rounds with difficulty ramping (easy → medium → hard)
- IQ calculated from accuracy + speed
- Results screen with roast + share functionality
