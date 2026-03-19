# React Frontend

This folder contains the React version of the ordering frontend.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`

## Runtime config

The app reads config from `public/config.js`.
You can also use Vite env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_DEFAULT_EMAIL`

## Routes

- `/` member login and registration
- `/order` order form
- `/history` member order history
- `/profile` member profile
- `/change-password` password update
- `/payment` payment method selection
- `/pending-order` pending order status
- `/admin` admin dashboard
