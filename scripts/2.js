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

window.SUPABASE_URL     = 'https://aumyskvyecjtsblcdamu.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1bXlza3Z5ZWNqdHNibGNkYW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MjQ2NTUsImV4cCI6MjA4OTEwMDY1NX0.KEVGhZ-6s78sslsp4U6xLWXD9BEmKKKM8B44LKs-5Ro';
