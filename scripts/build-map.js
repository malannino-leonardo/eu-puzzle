/**
 * =====================================================
 * BUILD SCRIPT - PREPROCESSES EUROPE MAP
 * =====================================================
 * This script:
 * 1. Downloads the world TopoJSON
 * 2. Filters only European countries (GeoJSON)
 * 3. Rebuilds a compact TopoJSON with only EU arcs
 * 4. Generates a lightweight JSON file for the client
 *
 * Run with: node scripts/build-map.js
 * =====================================================
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const topojsonClient = require('topojson-client');
const topojsonServer = require('topojson-server');

// List of ISO codes for European countries
const EUROPEAN_COUNTRY_IDS = [
    '040', '056', '100', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '372', '380', '428', '440', '442', '470', '528', '616', '620', '642', '703', '705', '724', '752'
];

const EUROPEAN_NAMES = [
    'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden'
];

const TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

function downloadJSON(url) {
    return new Promise((resolve, reject) => {
        console.log(`[Download] ${url}`);
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadJSON(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function isEuropeanCountry(id, name) {
    if (EUROPEAN_COUNTRY_IDS.includes(String(id))) return true;
    const nameLower = (name || '').toLowerCase();
    return EUROPEAN_NAMES.some(n => nameLower.includes(n));
}

async function buildMap() {
    console.log('[Build] Starting Europe map build...\n');

    try {
        // 1. Download world TopoJSON
        const worldTopology = await downloadJSON(TOPOJSON_URL);
        console.log('[OK] TopoJSON downloaded\n');

        // 2. Convert entire world to GeoJSON FeatureCollection
        const objectKey = Object.keys(worldTopology.objects)[0];
        const worldGeoJSON = topojsonClient.feature(worldTopology, worldTopology.objects[objectKey]);

        console.log(`[Info] Total features in file: ${worldGeoJSON.features.length}`);

        // 3. Filter only European countries
        const euFeatures = worldGeoJSON.features.filter(f => {
            const id   = String(f.id || f.properties?.iso_n3 || '');
            const name = f.properties?.name || '';
            return isEuropeanCountry(id, name);
        });

        console.log(`[Europe] European countries found: ${euFeatures.length}\n`);
        euFeatures.forEach(f => {
            const name = f.properties?.name || 'Unknown';
            const id   = f.id || f.properties?.iso_n3 || 'N/A';
            console.log(`   - ${name} (ID: ${id})`);
        });

        // 4. Rebuild a compact TopoJSON with ONLY European arcs
        // Quantization 1e5 = 100,000 levels → good quality/size tradeoff
        const euGeoJSON  = { type: 'FeatureCollection', features: euFeatures };
        const rawTopology = topojsonServer.topology({ countries: euGeoJSON });
        const euTopology  = topojsonClient.quantize(rawTopology, 1e5);

        // 5. Save the file
        const outputDir  = path.join(__dirname, '..', 'data');
        const outputPath = path.join(outputDir, 'europe.topojson');

        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        fs.writeFileSync(outputPath, JSON.stringify(euTopology));
        const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);

        console.log(`\n[OK] File saved: ${outputPath}`);
        console.log(`[Info] Size: ${fileSizeKB} KB (EU only, compressed arcs)\n`);

        // 6. Check adjacency file
        console.log('[Check] Checking adjacency file...');
        const adjPath = path.join(outputDir, 'adjacencies.json');
        if (fs.existsSync(adjPath)) {
            console.log('   Adjacency file already exists, skipping.\n');
        } else {
            console.log('   Adjacency file not found, runtime calculation will be used.\n');
        }

        console.log('[Done] Build completed successfully!');
        console.log('\n[Next] Next steps:');
        console.log('   1. Start a local server: npm start');
        console.log('   2. Open http://localhost:5000 in your browser');

    } catch (error) {
        console.error('[Error] Error during build:', error);
        process.exit(1);
    }
}

buildMap();
