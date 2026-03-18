#!/usr/bin/env node

/**
 * inject-supabase-config.js
 *
 * Generates scripts/supabase-config.js from environment variables.
 * Called during build process (especially on Netlify).
 *
 * Reads:
 *   SUPABASE_URL - your Supabase project URL
 *   SUPABASE_ANON_KEY - your Supabase anonymous key
 *
 * If either is missing, logs a warning and exits gracefully.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const configPath = path.join(__dirname, 'supabase-config.js');

// Check if credentials are present
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
        '[inject-supabase-config] WARNING: SUPABASE_URL or SUPABASE_ANON_KEY not set.\n' +
        '  If running locally, copy scripts/supabase-config.example.js to scripts/supabase-config.js\n' +
        '  and fill in your credentials manually.\n' +
        '  If deploying to Netlify, set these environment variables in Site Settings.\n' +
        '  Skipping config generation.'
    );
    process.exit(0);
}

// Generate the config file
const configContent = `/**
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

window.SUPABASE_URL     = '${SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
`;

try {
    fs.writeFileSync(configPath, configContent, 'utf8');
    console.log('[inject-supabase-config] ✓ Generated scripts/supabase-config.js');
} catch (err) {
    console.error('[inject-supabase-config] ERROR: Failed to write config file:', err.message);
    process.exit(1);
}
