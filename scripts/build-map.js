/**
 * =====================================================
 * BUILD SCRIPT - PRE-PROCESSA MAPPA EUROPA
 * =====================================================
 * Questo script:
 * 1. Scarica il TopoJSON mondiale
 * 2. Filtra solo i paesi europei
 * 3. Pre-calcola i path SVG
 * 4. Genera un file JSON leggero per il client
 * 
 * Esegui con: node scripts/build-map.js
 * =====================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Lista codici ISO dei paesi europei
const EUROPEAN_COUNTRY_IDS = [
    '008', '020', '040', '056', '070', '100', '112', '191', '196', '203',
    '208', '233', '246', '250', '276', '300', '348', '352', '372', '380',
    '428', '438', '440', '442', '807', '470', '498', '492', '499', '528',
    '578', '616', '620', '642', '643', '674', '688', '703', '705', '724',
    '752', '756', '804', '826', '336'
];

const EUROPEAN_NAMES = [
    'albania', 'andorra', 'austria', 'belarus', 'belgium', 'bosnia', 
    'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia',
    'finland', 'france', 'germany', 'greece', 'hungary', 'iceland',
    'ireland', 'italy', 'kosovo', 'latvia', 'liechtenstein', 'lithuania',
    'luxembourg', 'macedonia', 'malta', 'moldova', 'monaco', 'montenegro',
    'netherlands', 'norway', 'poland', 'portugal', 'romania', 'russia',
    'san marino', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden',
    'switzerland', 'ukraine', 'united kingdom', 'vatican', 'uk', 'britain'
];

const TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';

async function downloadJSON(url) {
    return new Promise((resolve, reject) => {
        console.log(`[Download] ${url}`);
        
        https.get(url, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
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
    console.log('[Build] Inizio build mappa Europa...\n');
    
    try {
        // 1. Scarica TopoJSON
        const topology = await downloadJSON(TOPOJSON_URL);
        console.log('[OK] TopoJSON scaricato\n');
        
        // 2. Estrai la chiave degli oggetti
        const objectKey = Object.keys(topology.objects)[0];
        const geometries = topology.objects[objectKey].geometries;
        
        console.log(`[Info] Totale geometrie nel file: ${geometries.length}`);
        
        // 3. Filtra paesi europei
        const europeanGeometries = geometries.filter(geo => {
            const id = String(geo.id || geo.properties?.iso_n3 || '');
            const name = geo.properties?.name || '';
            return isEuropeanCountry(id, name);
        });
        
        console.log(`[Europa] Paesi europei trovati: ${europeanGeometries.length}\n`);
        
        // Lista paesi trovati
        europeanGeometries.forEach(geo => {
            const name = geo.properties?.name || 'Unknown';
            const id = geo.id || geo.properties?.iso_n3 || 'N/A';
            console.log(`   - ${name} (ID: ${id})`);
        });
        
        // 4. Crea nuovo TopoJSON con solo Europa
        const europeTopology = {
            type: 'Topology',
            arcs: topology.arcs,
            objects: {
                europe: {
                    type: 'GeometryCollection',
                    geometries: europeanGeometries
                }
            }
        };
        
        // 5. Salva il file
        const outputDir = path.join(__dirname, '..', 'data');
        const outputPath = path.join(outputDir, 'europe.topojson');
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, JSON.stringify(europeTopology));
        
        const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);
        console.log(`\n[OK] File salvato: ${outputPath}`);
        console.log(`[Info] Dimensione: ${fileSizeKB} KB\n`);
        
        // 6. Genera anche lista adiacenze (se non esiste già una migliore)
        console.log('[Check] Verifica file adiacenze...');
        const adjPath = path.join(outputDir, 'adjacencies.json');
        
        if (fs.existsSync(adjPath)) {
            console.log('   File adiacenze già esistente, skip.\n');
        } else {
            console.log('   File adiacenze non trovato, verrà usato il calcolo runtime.\n');
        }
        
        console.log('[Done] Build completato con successo!');
        console.log('\n[Next] Prossimi passi:');
        console.log('   1. Avvia un server locale: npm start');
        console.log('   2. Apri http://localhost:5000 nel browser');
        
    } catch (error) {
        console.error('[Error] Errore durante la build:', error);
        process.exit(1);
    }
}

// Esegui
buildMap();
