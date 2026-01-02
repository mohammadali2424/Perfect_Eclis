# Eclis World (Telegram Bot)

## Run (local)

```bash
npm i
cp .env.example .env
npm run dev
```

## Commands
- `!راهنما`
- `!ایکسپی +10 شکار گرگ`
- `!ایکسپی نمایش`

## Architecture goals
- Modular modules under `src/modules/*`
- No module imports concrete DB clients; adapters live under `src/adapters/*`
- Swap Render/Supabase with your future server by changing adapters + env
