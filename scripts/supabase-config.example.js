/**
 * Supabase Configuration — Browser "Environment Variables"
 *
 * This file serves as the browser equivalent of environment variables
 * for a static HTML/JS application (no build tool required).
 *
 * SETUP:
 *   1. Copy this file: cp scripts/supabase-config.example.js scripts/supabase-config.js
 *   2. Fill in your real credentials below
 *   3. scripts/supabase-config.js is gitignored — never commit real keys
 *
 * GET YOUR CREDENTIALS:
 *   → https://supabase.com → Your Project → Settings → API
 *   → Copy "Project URL" and "anon / public" key
 *
 * NOTE: The anon key is safe to expose in browser code — it is read-only by
 * default and protected by Row-Level Security (RLS) policies.
 * Never expose the "service_role" secret key in client-side code.
 */

window.SUPABASE_URL      = 'https://your-project-id.supabase.co';
window.SUPABASE_ANON_KEY = 'your-anon-public-key-here';
window.APP_DOMAIN = '';
