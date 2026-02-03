/**
 * =====================================================
 * PUZZLE UNIONE EUROPEA - MAIN APPLICATION
 * =====================================================
 * Un puzzle interattivo per ricostruire l'Unione Europea
 * con paesi che si agganciano ai confini reali.
 * =====================================================
 */

(function() {
    'use strict';

    // =====================================================
    // CONFIGURATION
    // =====================================================
    const CONFIG = {
        // TopoJSON source (Natural Earth 50m resolution)
        TOPOJSON_URL: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
        
        // Snap threshold in pixels
        SNAP_THRESHOLD: 20,
        
        // Board dimensions (will be calculated based on viewport)
        BOARD_WIDTH: 1000,
        BOARD_HEIGHT: 700,
        
        // Projection settings
        PROJECTION_CENTER: [15, 54], // Center on Europe
        PROJECTION_SCALE: 600,
        
        // Initial scatter settings
        SCATTER_PADDING: 50,
        ROTATION_RANGE: 0, // degrees - set to 0 to keep countries properly oriented
        
        // Animation durations
        SNAP_DURATION: 200,
        
        // European country ISO codes (ISO 3166-1 numeric)
        EUROPEAN_COUNTRIES: [
            '040',
            '056',
            '100',
            '191',
            '196',
            '203',
            '208',
            '233',
            '246',
            '250',
            '276',
            '300',
            '348',
            '372',
            '380',
            '428',
            '440',
            '442',
            '470',
            '528',
            '616',
            '620',
            '642',
            '703',
            '705',
            '724',
            '752'
        ]
    };

    // =====================================================
    // GLOBAL STATE
    // =====================================================
    const state = {
        // Game data
        countries: new Map(),       // countryId -> { name, path, centroid, ... }
        adjacencies: new Map(),     // countryId -> Set of neighbor ids
        countryInfo: new Map(),     // countryId -> { capital, population, fact, ... }
        
        // Cluster management
        clusters: new Map(),        // clusterId -> { members: Set, transform: {x, y, rotation}, element }
        countryToCluster: new Map(), // countryId -> clusterId
        nextClusterId: 0,
        
        // Interaction state
        selectedCluster: null,
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        clusterStartTransform: { x: 0, y: 0 },
        hoveredCountry: null,
        
        // Click-to-select mode (accessibility)
        clickMode: false,
        selectedForAttach: null,
        
        // DOM references
        svg: null,
        clustersContainer: null,
        projection: null,
        pathGenerator: null,
        
        // Zoom and pan state
        viewBox: { x: 0, y: 0, w: 1000, h: 700 },
        isPanning: false,
        panStart: { x: 0, y: 0 },
        viewBoxStart: { x: 0, y: 0 },
        zoomLevel: 0.6,
        minZoom: 0.5,
        maxZoom: 4,
        
        // Game progress
        totalCountries: 0,
        connectedCountries: 0,
        gameComplete: false
    };

    // =====================================================
    // INITIALIZATION
    // =====================================================
    
    async function init() {
        showLoading(true);
        
        try {
            // Setup DOM references
            setupDOMReferences();
            
            // Load country info data
            await loadCountryInfo();
            
            // Load and process TopoJSON
            await loadAndProcessMap();
            
            // Calculate adjacencies
            calculateAdjacencies();
            
            // Initialize clusters (one per country)
            initializeClusters();
            
            // Render initial state
            renderClusters();
            
            // Scatter pieces randomly
            scatterPieces();
            
            // Setup event listeners
            setupEventListeners();
            
            // Update progress
            updateProgress();
            
            showLoading(false);
            
            console.log('[Puzzle UE] Initialized!');
            console.log(`[Info] Loaded ${state.countries.size} countries`);
            
        } catch (error) {
            console.error('Failed to initialize game:', error);
            showError('Errore nel caricamento del gioco. Ricarica la pagina.');
        }
    }

    function setupDOMReferences() {
        state.svg = document.getElementById('game-board');
        state.clustersContainer = document.getElementById('clusters-container');
        
        // Calculate board dimensions based on container
        const container = document.getElementById('board-container');
        const rect = container.getBoundingClientRect();
        CONFIG.BOARD_WIDTH = rect.width;
        CONFIG.BOARD_HEIGHT = rect.height;
        
        // Initialize viewBox state
        state.viewBox = { x: 0, y: 0, w: CONFIG.BOARD_WIDTH, h: CONFIG.BOARD_HEIGHT };
        
        // Set SVG viewBox
        updateViewBox();
    }
    
    function updateViewBox() {
        const { x, y, w, h } = state.viewBox;
        state.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    }

    async function loadCountryInfo() {
        try {
            const response = await fetch('data/countries.json');
            if (!response.ok) throw new Error('Country data not found');
            
            const data = await response.json();
            data.forEach(country => {
                state.countryInfo.set(country.id, country);
            });
        } catch (error) {
            console.warn('Could not load country info, using defaults:', error);
            // Will use default values
        }
    }

    async function loadAndProcessMap() {
        // Fetch TopoJSON
        const response = await fetch(CONFIG.TOPOJSON_URL);
        if (!response.ok) throw new Error('Failed to load map data');
        
        const topology = await response.json();
        
        // Get the countries feature collection
        const countriesKey = Object.keys(topology.objects)[0];

        // --- MERGE CYPRUS (SOUTH & NORTH) AT TOPOLOGY LEVEL ---
        // This removes the internal border line by merging geometries
        const rawGeometries = topology.objects[countriesKey].geometries;
        const cyprusGeo = rawGeometries.find(g => String(g.id || '') === '196');
        const nCyprusGeo = rawGeometries.find(g => g.properties?.name === 'N. Cyprus');
        
        let mergedCyprusGeoJSON = null;
        if (cyprusGeo && nCyprusGeo) {
             // topojson.merge returns the merged GeoJSON geometry (MultiPolygon)
             // This effectively dissolves the shared border
             mergedCyprusGeoJSON = topojson.merge(topology, [cyprusGeo, nCyprusGeo]);
        }
        // ------------------------------------------------------

        const geojson = topojson.feature(topology, topology.objects[countriesKey]);
        
        // --- APPLY MERGED GEOMETRY ---
        if (mergedCyprusGeoJSON) {
            // Find indices in the generated GeoJSON
            const cIdx = geojson.features.findIndex(f => String(f.id || '') === '196');
            const nIdx = geojson.features.findIndex(f => f.properties?.name === 'N. Cyprus');
            
            if (cIdx !== -1) {
                // Remove N. Cyprus first (if nIdx > cIdx, cIdx stays valid)
                // If nIdx < cIdx, cIdx shifts. Safest to remove N. Cyprus then find Cyprus again or handle indices.
                
                // Update Cyprus geometry
                geojson.features[cIdx].geometry = mergedCyprusGeoJSON;
                
                // Remove N. Cyprus
                if (nIdx !== -1) {
                    geojson.features.splice(nIdx, 1);
                }
            }
       }
       // -----------------------------
        
        // Setup projection centered on Europe
        state.projection = d3.geoMercator()
            .center(CONFIG.PROJECTION_CENTER)
            .scale(CONFIG.PROJECTION_SCALE)
            .translate([CONFIG.BOARD_WIDTH / 2, CONFIG.BOARD_HEIGHT / 2]);
        
        state.pathGenerator = d3.geoPath().projection(state.projection);
        
        // Filter to European countries and process
        const europeanFeatures = geojson.features.filter(feature => {
            const id = String(feature.id || feature.properties?.iso_n3 || '');
            const name = feature.properties?.name || '';
            
            // Check if in our European list or by name matching
            return isEuropeanCountry(id, name);
        });

        // Process each country
        europeanFeatures.forEach(feature => {
            const id = String(feature.id || feature.properties?.iso_n3 || Math.random());
            let name = feature.properties?.name || 'Unknown';
            
            // Override with Italian name from countryInfo if available
            const countryInfo = state.countryInfo.get(id);
            if (countryInfo && countryInfo.name) {
                name = countryInfo.name;
            }
            
            const filteredFeature = filterFeatureToEurope(feature, state.pathGenerator);
            if (!filteredFeature) {
                console.log(`[Skip] ${name} - no European geometry after filtering`);
                return;
            }
            
            // Generate SVG path
            const pathD = state.pathGenerator(filteredFeature);
            if (!pathD) return;
            
            // Calculate centroid for snapping calculations
            const centroid = state.pathGenerator.centroid(filteredFeature);
            if (!centroid || isNaN(centroid[0])) return;
            
            // Calculate bounds
            const bounds = state.pathGenerator.bounds(filteredFeature);
            
            state.countries.set(id, {
                id,
                name,
                pathD,
                centroid,
                bounds,
                feature: filteredFeature
            });
        });
        
        state.totalCountries = state.countries.size;
    }

    function isEuropeanCountry(id, name) {
        // Check by ID
        if (CONFIG.EUROPEAN_COUNTRIES.includes(id)) return true;
        
        // Check by name (fallback)
        const europeanNames = [
            'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden'
        ];
        
        const nameLower = name.toLowerCase();
        return europeanNames.some(n => nameLower.includes(n));
    }
    
    // Check if geometry centroid is within European bounds (exclude overseas territories)
    function isInEuropeanBounds(feature, pathGenerator) {
        return isGeometryInEuropeanBounds(feature.geometry, pathGenerator);
    }

    function isGeometryInEuropeanBounds(geometry, pathGenerator) {
        const tempFeature = { type: 'Feature', properties: {}, geometry };
        const bounds = pathGenerator.bounds(tempFeature);
        if (!bounds) return false;
        
        const minX = bounds[0][0];
        const maxX = bounds[1][0];
        const minY = bounds[0][1];
        const maxY = bounds[1][1];
        
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        
        // Tight bounds to exclude overseas territories (French Guiana, Caribbean, etc.)
        // Board is approx 1000x700
        const europeMinX = -200;
        const europeMaxX = 1200;
        const europeMinY = -200;
        const europeMaxY = 900;
        
        return cx >= europeMinX && cx <= europeMaxX && cy >= europeMinY && cy <= europeMaxY;
    }

    function filterFeatureToEurope(feature, pathGenerator) {
        if (!feature?.geometry) return null;
        
        const geometry = feature.geometry;
        if (geometry.type === 'Polygon') {
            return isGeometryInEuropeanBounds(geometry, pathGenerator) ? feature : null;
        }
        
        if (geometry.type === 'MultiPolygon') {
            const kept = geometry.coordinates.filter(coords => {
                const polygonGeometry = { type: 'Polygon', coordinates: coords };
                return isGeometryInEuropeanBounds(polygonGeometry, pathGenerator);
            });
            
            if (!kept.length) return null;
            return {
                ...feature,
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: kept
                }
            };
        }
        
        return feature;
    }

    function calculateAdjacencies() {
        // Pre-calculate which countries share borders
        // Using a proximity-based approach with the actual geometries
        
        const countries = Array.from(state.countries.values());
        
        countries.forEach(country => {
            state.adjacencies.set(country.id, new Set());
        });
        
        // Check each pair of countries
        for (let i = 0; i < countries.length; i++) {
            for (let j = i + 1; j < countries.length; j++) {
                const a = countries[i];
                const b = countries[j];
                
                // Check if bounding boxes are close enough to potentially be neighbors
                if (boundingBoxesOverlap(a.bounds, b.bounds, 5)) {
                    // More precise check using centroids distance relative to size
                    const dist = distance(a.centroid, b.centroid);
                    const avgSize = (getCountrySize(a) + getCountrySize(b)) / 2;
                    
                    // Countries are adjacent if close relative to their size
                    if (dist < avgSize * 1.5) {
                        state.adjacencies.get(a.id).add(b.id);
                        state.adjacencies.get(b.id).add(a.id);
                    }
                }
            }
        }
        
        // Load pre-computed adjacencies if available (more accurate)
        loadPrecomputedAdjacencies();
    }

    async function loadPrecomputedAdjacencies() {
        try {
            const response = await fetch('data/adjacencies.json');
            if (!response.ok) return;
            
            const data = await response.json();
            
            // Merge with calculated adjacencies
            Object.entries(data).forEach(([countryId, neighbors]) => {
                if (state.adjacencies.has(countryId)) {
                    neighbors.forEach(n => state.adjacencies.get(countryId).add(n));
                }
            });
        } catch (error) {
            console.warn('Using calculated adjacencies');
        }
    }

    function boundingBoxesOverlap(a, b, padding = 0) {
        if (!a || !b) return false;
        return !(a[1][0] + padding < b[0][0] || 
                 b[1][0] + padding < a[0][0] ||
                 a[1][1] + padding < b[0][1] || 
                 b[1][1] + padding < a[0][1]);
    }

    function getCountrySize(country) {
        const bounds = country.bounds;
        const width = bounds[1][0] - bounds[0][0];
        const height = bounds[1][1] - bounds[0][1];
        return Math.sqrt(width * width + height * height);
    }

    function distance(a, b) {
        return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
    }

    // =====================================================
    // CLUSTER MANAGEMENT
    // =====================================================

    function initializeClusters() {
        state.countries.forEach((country, id) => {
            const clusterId = state.nextClusterId++;
            
            state.clusters.set(clusterId, {
                id: clusterId,
                members: new Set([id]),
                transform: { x: 0, y: 0, rotation: 0 },
                element: null
            });
            
            state.countryToCluster.set(id, clusterId);
        });
    }

    function renderClusters() {
        state.clustersContainer.innerHTML = '';
        
        state.clusters.forEach((cluster, clusterId) => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'cluster-group');
            g.setAttribute('data-cluster-id', clusterId);
            g.setAttribute('tabindex', '0');
            g.setAttribute('role', 'button');
            g.setAttribute('aria-label', getClusterLabel(cluster));
            
            // Apply transform
            updateClusterTransform(g, cluster.transform);
            
            // Add country paths
            cluster.members.forEach(countryId => {
                const country = state.countries.get(countryId);
                if (!country) return;
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', country.pathD);
                path.setAttribute('class', 'country-path');
                path.setAttribute('data-country-id', countryId);
                path.setAttribute('aria-label', country.name);
                
                g.appendChild(path);
            });
            
            cluster.element = g;
            state.clustersContainer.appendChild(g);
        });
    }

    function getClusterLabel(cluster) {
        const names = Array.from(cluster.members)
            .map(id => state.countries.get(id)?.name || 'Unknown')
            .slice(0, 3);
        
        if (cluster.members.size > 3) {
            return `Cluster con ${names.join(', ')} e altri ${cluster.members.size - 3} paesi`;
        }
        return names.join(', ');
    }

    function updateClusterTransform(element, transform) {
        const { x, y, rotation } = transform;
        element.setAttribute('transform', `translate(${x}, ${y}) rotate(${rotation})`);
    }

    function scatterPieces() {
        const padding = CONFIG.SCATTER_PADDING;
        const width = CONFIG.BOARD_WIDTH;
        const height = CONFIG.BOARD_HEIGHT;
        
        // Calculate the center area to avoid (where Europe will be assembled)
        const centerX = width / 2;
        const centerY = height / 2;
        const avoidRadius = Math.min(width, height) * 0.15;
        
        // Define scatter zones around the edges of the board
        const margin = 80;
        const scatterWidth = Math.min(200, width * 0.25);
        const scatterHeight = Math.min(200, height * 0.25);
        
        const zones = [
            // Top edge
            { x: margin, y: margin, w: width - 2 * margin, h: scatterHeight },
            // Bottom edge
            { x: margin, y: height - margin - scatterHeight, w: width - 2 * margin, h: scatterHeight },
            // Left edge
            { x: margin, y: margin + scatterHeight, w: scatterWidth, h: height - 2 * margin - 2 * scatterHeight },
            // Right edge
            { x: width - margin - scatterWidth, y: margin + scatterHeight, w: scatterWidth, h: height - 2 * margin - 2 * scatterHeight }
        ];
        
        const clustersArray = Array.from(state.clusters.values());
        
        clustersArray.forEach((cluster, index) => {
            // Distribute clusters across zones
            const zone = zones[index % zones.length];
            
            // Random position within the zone, then offset to keep pieces visible
            const localX = zone.x + Math.random() * zone.w;
            const localY = zone.y + Math.random() * zone.h;
            
            // Convert to transform offset from center (since paths are in map space centered)
            const x = localX - centerX;
            const y = localY - centerY;
            
            // No rotation - keep countries properly oriented as they appear on the map
            const rotation = 0;
            
            cluster.transform = { x, y, rotation };
            updateClusterTransform(cluster.element, cluster.transform);
        });
    }

    function mergeClusters(clusterA, clusterB) {
        // Merge B into A
        const a = state.clusters.get(clusterA);
        const b = state.clusters.get(clusterB);
        
        if (!a || !b) return;
        
        // Clear all snap preview classes from both clusters before merging
        a.element.querySelectorAll('.country-path').forEach(path => {
            path.classList.remove('snap-preview', 'snap-error');
        });
        b.element.querySelectorAll('.country-path').forEach(path => {
            path.classList.remove('snap-preview', 'snap-error');
        });
        
        // Update cluster membership
        b.members.forEach(countryId => {
            a.members.add(countryId);
            state.countryToCluster.set(countryId, clusterA);
        });

        // 1. Move paths from B to A first (so they are "below" future markers)
        b.members.forEach(countryId => {
            const country = state.countries.get(countryId);
            if (!country) return;
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', country.pathD);
            path.setAttribute('class', 'country-path snapped');
            path.setAttribute('data-country-id', countryId);
            path.setAttribute('aria-label', country.name);
            
            a.element.appendChild(path);
        });

        // 2. Move markers from B to A
        b.element.querySelectorAll('.country-marker').forEach(marker => {
            a.element.appendChild(marker);
        });

        // 3. CRITICAL: Bring ALL A's existing markers to front
        // so they are not covered by the newly added paths from B.
        a.element.querySelectorAll('.country-marker').forEach(marker => {
            a.element.appendChild(marker); // Moves to end of children list (top)
        });
        
        // Remove cluster B
        b.element.remove();
        state.clusters.delete(clusterB);
        
        // Update aria label
        a.element.setAttribute('aria-label', getClusterLabel(a));
        
        // Remove focus from the merged cluster to prevent it from staying focused
        if (document.activeElement === a.element) {
            a.element.blur();
        }
        
        // Update progress
        updateProgress();
        
        // Check for completion
        checkCompletion();
    }

    // =====================================================
    // SNAPPING LOGIC
    // =====================================================

    function checkSnapOnDrop(draggedClusterId) {
        const draggedCluster = state.clusters.get(draggedClusterId);
        if (!draggedCluster) return;
        
        let bestSnap = null;
        let bestDistance = CONFIG.SNAP_THRESHOLD;
        
        // Check against all other clusters
        state.clusters.forEach((otherCluster, otherClusterId) => {
            if (otherClusterId === draggedClusterId) return;
            
            // Check if any country in dragged cluster is adjacent to any in other cluster
            draggedCluster.members.forEach(draggedCountryId => {
                const draggedCountry = state.countries.get(draggedCountryId);
                const neighbors = state.adjacencies.get(draggedCountryId) || new Set();
                
                otherCluster.members.forEach(otherCountryId => {
                    if (!neighbors.has(otherCountryId)) return;
                    
                    const otherCountry = state.countries.get(otherCountryId);
                    
                    // Calculate required transform for perfect alignment
                    const requiredTransform = calculateRequiredTransform(
                        draggedCountry, 
                        draggedCluster.transform,
                        otherCountry,
                        otherCluster.transform
                    );
                    
                    // Calculate distance from current to required transform
                    const dist = distance(
                        [draggedCluster.transform.x, draggedCluster.transform.y],
                        [requiredTransform.x, requiredTransform.y]
                    );
                    
                    if (dist < bestDistance) {
                        bestDistance = dist;
                        bestSnap = {
                            targetClusterId: otherClusterId,
                            requiredTransform
                        };
                        
                        // Highlight adjacent country
                        const adjacentEl = document.getElementById(otherCountryId);
                        if (adjacentEl) {
                             adjacentEl.classList.add('adjacent-hint');
                             // Remove class after a short delay so it doesn't get stuck
                             // or handle removal in snap logic
                             setTimeout(() => adjacentEl.classList.remove('adjacent-hint'), 500);
                        }
                    }
                });
            });
        });
        
        if (bestSnap) {
            // Determine popup candidate based on cluster sizes
            const targetCluster = state.clusters.get(bestSnap.targetClusterId);
            let popupCountryId = null;
            
            if (targetCluster) {
                const draggedSize = draggedCluster.members.size;
                const targetSize = targetCluster.members.size;
                
                // "Only when two countries that weren't connected to anything previously, don't show anchored popup; 
                // in any other case, show the popup of the new single country connected to the others"
                if (draggedSize === 1 && targetSize === 1) {
                    // Start of a new cluster -> No popup, but add markers to both countries
                    popupCountryId = null; 
                } else if (draggedSize === 1) {
                    // Single country connecting to existing cluster -> Show popup
                    popupCountryId = Array.from(draggedCluster.members)[0];
                } else if (targetSize === 1) {
                    // Single country (target) being connected to -> Show popup
                    popupCountryId = Array.from(targetCluster.members)[0];
                }
            }

            // Animate snap
            animateSnap(draggedCluster, bestSnap.requiredTransform, () => {
                mergeClusters(bestSnap.targetClusterId, draggedClusterId);
                
                // Add markers to both countries involved in the snap
                draggedCluster.members.forEach(id => addCountryMarker(id));
                const targetCluster = state.clusters.get(bestSnap.targetClusterId);
                if (targetCluster) {
                    targetCluster.members.forEach(id => addCountryMarker(id));
                }
                
                if (popupCountryId) {
                    showAnchoredPopup(popupCountryId);
                }
            });
            return true;
        }
        
        return false;
    }

    function showAnchoredPopup(countryId) {
        const country = state.countries.get(countryId);
        if (!country) return;

        // Add visual marker
        addCountryMarker(countryId);

        // Show popup with a slight delay to ensure marker is rendered
        setTimeout(() => {
            createAnchoredPopup(countryId);
        }, 50);
    }

    function addCountryMarker(countryId) {
        const clusterId = state.countryToCluster.get(countryId);
        if (clusterId === undefined) return;
        
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;
        
        if (cluster.element.querySelector(`.country-marker[data-for="${countryId}"]`)) return;

        const country = state.countries.get(countryId);
        
        const markerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        markerGroup.setAttribute('class', 'country-marker');
        markerGroup.setAttribute('data-for', countryId);
        markerGroup.setAttribute('role', 'button');
        markerGroup.setAttribute('aria-label', `Info ${country.name}`);
        
        // Position at centroid
        const cx = country.centroid[0];
        const cy = country.centroid[1];
        
        markerGroup.setAttribute('transform', `translate(${cx}, ${cy})`);
        
        const pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Center the pin tip (12, 24) at the centroid (0,0 local). Scaled 1.5x (18, 36)
        pinGroup.setAttribute('transform', 'translate(-18, -36) scale(1.5)'); 
        
        // Solid Pin Shape
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z');
        path.setAttribute('fill', 'var(--success-color)');
        path.setAttribute('stroke', '#fff'); 
        path.setAttribute('stroke-width', '1.5');
        
        // White Dot in center
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', '12');
        dot.setAttribute('cy', '9');
        dot.setAttribute('r', '3.5');
        dot.setAttribute('fill', '#fff');
        
        pinGroup.appendChild(path);
        pinGroup.appendChild(dot);
        markerGroup.appendChild(pinGroup);
        
        markerGroup.addEventListener('click', (e) => {
            e.stopPropagation();
            createAnchoredPopup(countryId);
        });
        
        markerGroup.addEventListener('pointerdown', (e) => e.stopPropagation());

        cluster.element.appendChild(markerGroup);
    }

    function createAnchoredPopup(countryId) {
        const existing = document.querySelector('.anchored-popup');
        if (existing) existing.remove();
        
        const country = state.countries.get(countryId);
        const info = state.countryInfo.get(countryId) || { capital: '?', population: '?', area: '?', facts: [] };
        
        const popup = document.createElement('div');
        popup.className = 'anchored-popup';
        // Inline styles to ensure overriding
        popup.style.background = '#ffffff';
        popup.style.color = '#000000';
        popup.style.border = 'none'; // Clear border to let shadow shine
        popup.style.borderRadius = '16px'; // Modern radius
        popup.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05)'; // Deep shade
        popup.style.overflow = 'hidden'; // Clip content to radius
        // Animation handled by CSS class .anchored-popup
        
        // Handle facts (array) - Random fact selection
        let factText = '';
        if (info.facts && Array.isArray(info.facts) && info.facts.length > 0) {
            const randomIndex = Math.floor(Math.random() * info.facts.length);
            factText = info.facts[randomIndex]; 
        } else if (info.fact) {
            factText = info.fact;
        }

        // Header
        const h3 = document.createElement('h3');
        h3.textContent = country.name;
        h3.style.color = '#ffffff';
        h3.style.background = 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)';
        h3.style.padding = '18px 20px 14px 20px'; // Increased padding
        h3.style.margin = '0';
        h3.style.fontSize = '1.4rem';
        h3.style.fontWeight = '700';
        h3.style.textTransform = 'uppercase';
        h3.style.letterSpacing = '0.5px';
        h3.style.borderBottom = '4px solid #fbbf24'; // Thicker accent

        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'popup-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Chiudi');
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '12px';
        closeBtn.style.right = '12px';
        closeBtn.style.background = 'rgba(255,255,255,0.2)';
        closeBtn.style.border = 'none';
        closeBtn.style.color = '#ffffff';
        closeBtn.style.width = '32px'; // Bigger touch target
        closeBtn.style.height = '32px';
        closeBtn.style.borderRadius = '50%';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.zIndex = '10';
        closeBtn.style.fontSize = '1.5rem';
        closeBtn.style.display = 'flex';
        closeBtn.style.alignItems = 'center';
        closeBtn.style.justifyContent = 'center';

        // Details Container
        const detailsContainer = document.createElement('div');
        detailsContainer.className = 'popup-details';
        detailsContainer.style.padding = '20px'; // More breathing room
        detailsContainer.style.background = '#ffffff';
        detailsContainer.style.color = '#000000';

        const addRow = (label, value) => {
            if (!value) return;
            const row = document.createElement('div');
            row.className = 'popup-row';
            row.style.marginBottom = '12px';
            row.style.color = '#000000';
            row.style.paddingBottom = '10px';
            row.style.borderBottom = '1px solid #f0f0f0';
            
            row.innerHTML = `<strong style="color: #1d4ed8; display:block; margin-bottom:4px; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">${label}</strong><div class="popup-row-value" style="color: #333333; font-weight:600; font-size:1.1rem;">${value}</div>`;
            detailsContainer.appendChild(row);
        };

        addRow('Capitale', info.capital);
        addRow('Popolazione', info.population);
        addRow('Superficie', info.area);

        // Fact
        const factDiv = document.createElement('div');
        if (factText) {
            factDiv.className = 'popup-fact';
            factDiv.style.backgroundColor = '#f0f4ff';
            factDiv.style.padding = '18px 20px'; 
            factDiv.style.color = '#333333';
            factDiv.style.borderTop = '1px solid #e5ecff';
            // Bigger font for fact
            factDiv.innerHTML = `<strong style="color: #1d4ed8; display:block; margin-bottom:8px; font-weight:700; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.5px;">Curiosità</strong><span style="font-size: 1.05rem; line-height: 1.6;">${factText}</span>`;
        }

        popup.appendChild(h3);
        popup.appendChild(closeBtn);
        popup.appendChild(detailsContainer);
        if (factText) popup.appendChild(factDiv);

        
        const clusterId = state.countryToCluster.get(countryId);
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;

        const marker = cluster.element.querySelector(`.country-marker[data-for="${countryId}"]`);
        if (!marker) return;

        document.body.appendChild(popup);
        
        popup._markerElement = marker;
        popup._countryId = countryId;
        
        updatePopupPosition(popup, marker);
        requestAnimationFrame(() => updatePopupPosition(popup, marker));
        
        const updateOnEvent = () => {
            if (popup.parentElement) {
                updatePopupPosition(popup, marker);
            }
        };
        
        state.svg.addEventListener('wheel', updateOnEvent, true);
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.svg.removeEventListener('wheel', updateOnEvent, true);
            popup.remove();
        });
    }

    function updatePopupPosition(popup, marker) {
        if (!popup || !marker) return;
        
        const rect = marker.getBoundingClientRect();
        
        // If marker is not visible or layout not ready, retry or abort
        if (rect.width === 0 && rect.height === 0) return;

        // Position relative to viewport (fixed)
        // Center horizontally on marker, place above marker
        const left = rect.left + (rect.width / 2);
        const top = rect.top; // transform translate -100% in CSS moves it up
        
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.position = 'fixed';
    }

    function calculateRequiredTransform(draggedCountry, draggedTransform, targetCountry, targetTransform) {
        // The correct relative position is when both countries are at their
        // original map positions (transform = 0,0)
        // 
        // For dragged country to align with target:
        // draggedCountry.centroid + draggedTransform = correct position
        // targetCountry.centroid + targetTransform = target's current position
        //
        // For correct alignment, dragged transform should match target transform
        
        return {
            x: targetTransform.x,
            y: targetTransform.y,
            rotation: targetTransform.rotation
        };
    }

    function animateSnap(cluster, targetTransform, callback) {
        const startTransform = { ...cluster.transform };
        const startTime = performance.now();
        
        function animate(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / CONFIG.SNAP_DURATION, 1);
            
            // Easing function
            const eased = 1 - Math.pow(1 - progress, 3);
            
            cluster.transform = {
                x: startTransform.x + (targetTransform.x - startTransform.x) * eased,
                y: startTransform.y + (targetTransform.y - startTransform.y) * eased,
                rotation: startTransform.rotation + (targetTransform.rotation - startTransform.rotation) * eased
            };
            
            updateClusterTransform(cluster.element, cluster.transform);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                callback();
            }
        }
        
        requestAnimationFrame(animate);
    }

    function showSnapPreview(clusterId, isValid) {
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;
        
        cluster.element.querySelectorAll('.country-path').forEach(path => {
            path.classList.remove('snap-preview', 'snap-error');
            if (isValid) {
                path.classList.add('snap-preview');
            }
        });
    }

    function clearSnapPreviews() {
        document.querySelectorAll('.country-path').forEach(path => {
            path.classList.remove('snap-preview', 'snap-error');
        });
    }

    function showSnapError(cluster) {
        cluster.element.querySelectorAll('.country-path').forEach(path => {
            path.classList.add('snap-error');
            setTimeout(() => path.classList.remove('snap-error'), 300);
        });
    }

    // =====================================================
    // EVENT HANDLERS
    // =====================================================

    function setupEventListeners() {
        // Pointer events for drag
        state.svg.addEventListener('pointerdown', onPointerDown);
        state.svg.addEventListener('pointermove', onPointerMove);
        state.svg.addEventListener('pointerup', onPointerUp);
        state.svg.addEventListener('pointercancel', onPointerUp);
        
        // Zoom with mouse wheel
        state.svg.addEventListener('wheel', onWheel, { passive: false });
        
        // Right mouse button for panning
        state.svg.addEventListener('mousedown', onMouseDownPan);
        state.svg.addEventListener('mousemove', onMouseMovePan);
        state.svg.addEventListener('mouseup', onMouseUpPan);
        state.svg.addEventListener('mouseleave', onMouseUpPan);
        
        // Prevent context menu on right-click (for pan)
        state.svg.addEventListener('contextmenu', e => e.preventDefault());
        
        // Prevent default touch behaviors
        state.svg.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        
        // Keyboard navigation
        state.svg.addEventListener('keydown', onKeyDown);
        
        // Click for info panel
        state.svg.addEventListener('click', onCountryClick);
        
        // Hover for tooltip
        state.svg.addEventListener('mousemove', onMouseMove);
        state.svg.addEventListener('mouseleave', hideTooltip);
        
        // UI buttons
        document.getElementById('btn-reset').addEventListener('click', resetGame);
        document.getElementById('btn-hint').addEventListener('click', showHint);
        document.getElementById('btn-close-panel').addEventListener('click', closeInfoPanel);
        document.getElementById('btn-restart').addEventListener('click', resetGame);
        
        // Zoom controls
        document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
        document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
        document.getElementById('btn-zoom-reset').addEventListener('click', resetZoom);
        
        // Accessibility mode toggle
        document.getElementById('click-mode-toggle').addEventListener('change', toggleClickMode);
        
        // Window resize
        window.addEventListener('resize', debounce(onResize, 250));
    }

    function onPointerDown(e) {
        // If clicking outside popup, close it
        // Check if target is inside an existing popup or is a marker
        if (!e.target.closest('.anchored-popup') && !e.target.closest('.country-marker')) {
            document.querySelector('.anchored-popup')?.remove();
        }

        const clusterElement = e.target.closest('.cluster-group');
        if (!clusterElement) return;
        
        const clusterId = parseInt(clusterElement.dataset.clusterId);
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;
        
        // Prevent dragging with right click (reserved for panning)
        if (e.button === 2) return;
        
        // Handle click mode (accessibility)
        if (state.clickMode) {
            handleClickModeSelect(clusterId);
            return;
        }
        
        // Start drag
        state.isDragging = true;
        state.selectedCluster = clusterId;
        
        state.dragStart = getSVGPoint(e);
        state.clusterStartTransform = { ...cluster.transform };
        
        // Visual feedback
        clusterElement.classList.add('dragging');
        clusterElement.querySelectorAll('.country-path').forEach(p => {
            p.classList.add('dragging');
        });
        
        // Bring to front
        state.clustersContainer.appendChild(clusterElement);
        
        // Capture pointer
        clusterElement.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
        if (!state.isDragging || state.selectedCluster === null) return;
        
        const cluster = state.clusters.get(state.selectedCluster);
        if (!cluster) return;
        
        const point = getSVGPoint(e);
        const dx = point.x - state.dragStart.x;
        const dy = point.y - state.dragStart.y;
        
        cluster.transform = {
            x: state.clusterStartTransform.x + dx,
            y: state.clusterStartTransform.y + dy,
            rotation: state.clusterStartTransform.rotation
        };
        
        updateClusterTransform(cluster.element, cluster.transform);
        
        // Check for potential snap while dragging
        checkSnapPreviewWhileDragging(state.selectedCluster);
    }

    function onPointerUp(e) {
        if (!state.isDragging || state.selectedCluster === null) return;
        
        const cluster = state.clusters.get(state.selectedCluster);
        if (cluster) {
            cluster.element.classList.remove('dragging');
            cluster.element.querySelectorAll('.country-path').forEach(p => {
                p.classList.remove('dragging');
            });
            
            // Check for snap
            const snapped = checkSnapOnDrop(state.selectedCluster);
            
            if (!snapped) {
                clearSnapPreviews();
            }
        }
        
        state.isDragging = false;
        state.selectedCluster = null;
    }

    function checkSnapPreviewWhileDragging(draggedClusterId) {
        const draggedCluster = state.clusters.get(draggedClusterId);
        if (!draggedCluster) return;
        
        clearSnapPreviews();
        
        let foundPotentialSnap = false;
        
        state.clusters.forEach((otherCluster, otherClusterId) => {
            if (otherClusterId === draggedClusterId) return;
            
            // Check if any countries are adjacent
            let hasAdjacentCountry = false;
            
            draggedCluster.members.forEach(draggedCountryId => {
                const neighbors = state.adjacencies.get(draggedCountryId) || new Set();
                
                otherCluster.members.forEach(otherCountryId => {
                    if (neighbors.has(otherCountryId)) {
                        hasAdjacentCountry = true;
                    }
                });
            });
            
            if (hasAdjacentCountry) {
                // Check distance
                const dist = distance(
                    [draggedCluster.transform.x, draggedCluster.transform.y],
                    [otherCluster.transform.x, otherCluster.transform.y]
                );
                
                if (dist < CONFIG.SNAP_THRESHOLD * 2) {
                    showSnapPreview(draggedClusterId, true);
                    showSnapPreview(otherClusterId, true);
                    foundPotentialSnap = true;
                }
            }
        });
    }

    function getSVGPoint(e) {
        const svg = state.svg;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // =====================================================
    // ZOOM AND PAN
    // =====================================================
    
    function onWheel(e) {
        e.preventDefault();
        
        // Inverted: scroll up (negative deltaY) = zoom in, scroll down = zoom out
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = state.zoomLevel * delta;
        
        // Clamp zoom level
        if (newZoom < state.minZoom || newZoom > state.maxZoom) return;
        
        // Get mouse position in SVG coordinates before zoom
        const svgPoint = getSVGPoint(e);
        
        // Calculate new viewBox dimensions
        const newW = CONFIG.BOARD_WIDTH / newZoom;
        const newH = CONFIG.BOARD_HEIGHT / newZoom;
        
        // Calculate new viewBox position to zoom towards mouse cursor
        const dx = (state.viewBox.w - newW) * ((svgPoint.x - state.viewBox.x) / state.viewBox.w);
        const dy = (state.viewBox.h - newH) * ((svgPoint.y - state.viewBox.y) / state.viewBox.h);
        
        state.viewBox.x += dx;
        state.viewBox.y += dy;
        state.viewBox.w = newW;
        state.viewBox.h = newH;
        state.zoomLevel = newZoom;
        
        updateViewBox();
        updateZoomDisplay();
    }
    
    function onMouseDownPan(e) {
        // Right mouse button (button === 2) for panning
        if (e.button === 2) {
            e.preventDefault();
            document.querySelector('.anchored-popup')?.remove();
            state.isPanning = true;
            state.panStart = { x: e.clientX, y: e.clientY };
            state.viewBoxStart = { x: state.viewBox.x, y: state.viewBox.y };
            state.svg.style.cursor = 'grabbing';
        }
    }
    
    function onMouseMovePan(e) {
        if (!state.isPanning) return;
        
        // Calculate how much to pan based on current zoom level
        const scale = state.viewBox.w / CONFIG.BOARD_WIDTH;
        const dx = (state.panStart.x - e.clientX) * scale;
        const dy = (state.panStart.y - e.clientY) * scale;
        
        // Calculate new position
        let newX = state.viewBoxStart.x + dx;
        let newY = state.viewBoxStart.y + dy;
        
        // Define pan boundaries (allow some padding beyond board edges)
        const panPadding = 500; // pixels of padding beyond content
        const minX = -panPadding;
        const maxX = CONFIG.BOARD_WIDTH + panPadding - state.viewBox.w;
        const minY = -panPadding;
        const maxY = CONFIG.BOARD_HEIGHT + panPadding - state.viewBox.h;
        
        // Constrain the viewBox position
        state.viewBox.x = Math.max(minX, Math.min(maxX, newX));
        state.viewBox.y = Math.max(minY, Math.min(maxY, newY));
        
        updateViewBox();
    }
    
    function onMouseUpPan(e) {
        if (state.isPanning) {
            state.isPanning = false;
            state.svg.style.cursor = '';
        }
    }
    
    function updateZoomDisplay() {
        const zoomText = document.getElementById('zoom-level-text');
        if (zoomText) {
            zoomText.textContent = Math.round(state.zoomLevel * 100) + '%';
        }
    }
    
    function zoomIn() {
        const newZoom = state.zoomLevel * 1.2;
        if (newZoom > state.maxZoom) return;
        
        // Zoom towards center
        const centerX = state.viewBox.x + state.viewBox.w / 2;
        const centerY = state.viewBox.y + state.viewBox.h / 2;
        
        const newW = CONFIG.BOARD_WIDTH / newZoom;
        const newH = CONFIG.BOARD_HEIGHT / newZoom;
        
        state.viewBox.x = centerX - newW / 2;
        state.viewBox.y = centerY - newH / 2;
        state.viewBox.w = newW;
        state.viewBox.h = newH;
        state.zoomLevel = newZoom;
        
        updateViewBox();
        updateZoomDisplay();
    }
    
    function zoomOut() {
        const newZoom = state.zoomLevel * 0.8;
        if (newZoom < state.minZoom) return;
        
        // Zoom from center
        const centerX = state.viewBox.x + state.viewBox.w / 2;
        const centerY = state.viewBox.y + state.viewBox.h / 2;
        
        const newW = CONFIG.BOARD_WIDTH / newZoom;
        const newH = CONFIG.BOARD_HEIGHT / newZoom;
        
        state.viewBox.x = centerX - newW / 2;
        state.viewBox.y = centerY - newH / 2;
        state.viewBox.w = newW;
        state.viewBox.h = newH;
        state.zoomLevel = newZoom;
        
        updateViewBox();
        updateZoomDisplay();
    }
    
    function resetZoom() {
        state.zoomLevel = 1;
        state.viewBox = { x: 0, y: 0, w: CONFIG.BOARD_WIDTH, h: CONFIG.BOARD_HEIGHT };
        updateViewBox();
        updateZoomDisplay();
    }

    function onKeyDown(e) {
        const focused = document.activeElement;
        if (!focused?.classList.contains('cluster-group')) return;
        
        const clusterId = parseInt(focused.dataset.clusterId);
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;
        
        const step = e.shiftKey ? 10 : 5;
        
        switch (e.key) {
            case 'ArrowLeft':
                cluster.transform.x -= step;
                break;
            case 'ArrowRight':
                cluster.transform.x += step;
                break;
            case 'ArrowUp':
                cluster.transform.y -= step;
                break;
            case 'ArrowDown':
                cluster.transform.y += step;
                break;
            case 'Enter':
            case ' ':
                // Try to snap
                checkSnapOnDrop(clusterId);
                return;
            default:
                return;
        }
        
        e.preventDefault();
        updateClusterTransform(cluster.element, cluster.transform);
    }

    function onCountryClick(e) {
        if (state.isDragging) return;
        
        const path = e.target.closest('.country-path');
        if (!path) return;
        
        const countryId = path.dataset.countryId;
        showCountryInfo(countryId);
    }

    function onMouseMove(e) {
        if (state.isDragging) {
            hideTooltip();
            return;
        }
        
        const path = e.target.closest('.country-path');
        if (path) {
            const countryId = path.dataset.countryId;
            const country = state.countries.get(countryId);
            if (country) {
                showTooltip(country.name, e.clientX, e.clientY);
            }
        } else {
            hideTooltip();
        }
    }

    // =====================================================
    // CLICK MODE (ACCESSIBILITY)
    // =====================================================

    function toggleClickMode(e) {
        state.clickMode = e.target.checked;
        state.selectedForAttach = null;
        
        document.querySelectorAll('.country-path.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }

    function handleClickModeSelect(clusterId) {
        if (state.selectedForAttach === null) {
            // First selection
            state.selectedForAttach = clusterId;
            const cluster = state.clusters.get(clusterId);
            cluster.element.querySelectorAll('.country-path').forEach(p => {
                p.classList.add('selected');
            });
        } else if (state.selectedForAttach === clusterId) {
            // Deselect
            const cluster = state.clusters.get(clusterId);
            cluster.element.querySelectorAll('.country-path').forEach(p => {
                p.classList.remove('selected');
            });
            state.selectedForAttach = null;
        } else {
            // Try to attach
            const result = tryAttachClusters(state.selectedForAttach, clusterId);
            
            // Clear selection
            document.querySelectorAll('.country-path.selected').forEach(el => {
                el.classList.remove('selected');
            });
            state.selectedForAttach = null;
            
            if (!result) {
                const cluster = state.clusters.get(clusterId);
                if (cluster) showSnapError(cluster);
            }
        }
    }

    function tryAttachClusters(clusterAId, clusterBId) {
        const clusterA = state.clusters.get(clusterAId);
        const clusterB = state.clusters.get(clusterBId);
        
        if (!clusterA || !clusterB) return false;
        
        // Check if they share an adjacent country
        let canAttach = false;
        
        clusterA.members.forEach(countryA => {
            const neighbors = state.adjacencies.get(countryA) || new Set();
            clusterB.members.forEach(countryB => {
                if (neighbors.has(countryB)) {
                    canAttach = true;
                }
            });
        });
        
        if (canAttach) {
            // Move cluster B to align with cluster A
            clusterB.transform = { ...clusterA.transform };
            updateClusterTransform(clusterB.element, clusterB.transform);
            
            // Merge
            mergeClusters(clusterAId, clusterBId);
            return true;
        }
        
        return false;
    }

    // =====================================================
    // INFO PANEL
    // =====================================================

    // Map country ISO codes to flag file codes
    const countryFlagMap = {
        '008': 'ALB_landscape', '020': 'AND_landscape', '040': 'AUT_landscape', '056': 'BEL_landscape', '070': 'BIH_landscape',
        '100': 'BUL_landscape', '112': 'BLR_landscape', '191': 'CRO_landscape', '196': 'CYP_landscape', '203': 'CZE_landscape',
        '208': 'DEN_landscape', '233': 'EST_landscape', '246': 'FIN_landscape', '250': 'FRA_landscape', '276': 'GER_landscape',
        '300': 'GRE_landscape', '348': 'HUN_landscape', '352': 'ISL_landscape', '372': 'IRL_landscape', '380': 'ITA_landscape',
        '428': 'LAT_landscape', '438': 'LIE_landscape', '440': 'LTU_landscape', '442': 'LUX_landscape', '807': 'MKD_landscape',
        '470': 'MLT_landscape', '498': 'MDA_landscape', '492': 'MON_landscape', '499': 'MNE_landscape', '528': 'NED_landscape',
        '578': 'NOR_landscape', '616': 'POL_landscape', '620': 'POR_landscape', '642': 'ROU_landscape', '643': 'RUS_landscape',
        '674': 'SMR_landscape', '688': 'SRB_landscape', '703': 'SVK_landscape', '705': 'SLO_landscape', '724': 'ESP_landscape',
        '752': 'SWE_landscape', '756': 'SUI_landscape', '804': 'UKR_landscape', '826': 'GBR_landscape', '336': 'SMR_landscape'
    };
    
    function showCountryInfo(countryId) {
        const country = state.countries.get(countryId);
        const info = state.countryInfo.get(countryId) || {};
        
        if (!country) return;
        
        const panel = document.getElementById('info-panel');
        const clusterId = state.countryToCluster.get(countryId);
        const cluster = state.clusters.get(clusterId);
        const isConnected = cluster && cluster.members.size > 1;
        
        // Update content
        document.getElementById('info-country-name').textContent = info.name || country.name;
        document.getElementById('info-capital').textContent = info.capital || 'N/D';
        document.getElementById('info-population').textContent = info.population || 'N/D';
        document.getElementById('info-area').textContent = info.area || 'N/D';
        
        // Show random fact
        if (info.facts && info.facts.length > 0) {
            const randomFact = info.facts[Math.floor(Math.random() * info.facts.length)];
            document.getElementById('info-fact').textContent = randomFact;
        } else {
            document.getElementById('info-fact').textContent = info.fact || 'Informazioni non disponibili.';
        }
        
        // Flag - use SVG from assets/flags folder
        const flagContainer = document.getElementById('info-flag');
        const flagCode = countryFlagMap[countryId] || countryId.toLowerCase();
        const flagPath = `assets/flags/${flagCode}.svg`;
        
        // Load SVG flag
        fetch(flagPath)
            .then(response => {
                if (!response.ok) throw new Error('Flag not found');
                return response.text();
            })
            .then(svgContent => {
                flagContainer.innerHTML = svgContent;
                const svgEl = flagContainer.querySelector('svg');
                if (svgEl) {
                    const width = parseFloat(svgEl.getAttribute('width')) || 640;
                    const height = parseFloat(svgEl.getAttribute('height')) || 480;
                    
                    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
                    svgEl.removeAttribute('width');
                    svgEl.removeAttribute('height');
                    svgEl.style.width = '100%';
                    svgEl.style.height = '100%';
                    svgEl.style.display = 'block';
                    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
                }
            })
            .catch(() => {
                flagContainer.innerHTML = '<div class="flag-placeholder"></div>';
            });
        
        // Status
        const statusEl = document.getElementById('info-status');
        statusEl.innerHTML = isConnected
            ? '<span class="status-badge connected"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Collegato</span>'
            : '<span class="status-badge loose"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Non collegato</span>';
        
        // Show panel
        panel.classList.remove('hidden');
        panel.classList.add('visible');
    }

    function closeInfoPanel() {
        const panel = document.getElementById('info-panel');
        panel.classList.add('hidden');
        panel.classList.remove('visible');
    }

    // =====================================================
    // TOOLTIP
    // =====================================================

    let tooltipElement = null;

    function showTooltip(text, x, y) {
        if (!tooltipElement) {
            tooltipElement = document.createElement('div');
            tooltipElement.className = 'country-tooltip';
            document.body.appendChild(tooltipElement);
        }
        
        tooltipElement.textContent = text;
        tooltipElement.style.left = `${x}px`;
        tooltipElement.style.top = `${y}px`;
        tooltipElement.style.display = 'block';
    }

    function hideTooltip() {
        if (tooltipElement) {
            tooltipElement.style.display = 'none';
        }
    }

    // =====================================================
    // GAME LOGIC
    // =====================================================

    function updateProgress() {
        // Count how many countries are in the largest cluster
        let maxClusterSize = 0;
        let totalClusters = state.clusters.size;
        
        state.clusters.forEach(cluster => {
            if (cluster.members.size > maxClusterSize) {
                maxClusterSize = cluster.members.size;
            }
        });
        
        state.connectedCountries = maxClusterSize > 1 ? maxClusterSize : 0;
        
        // Update UI
        const progressText = document.getElementById('progress-text');
        const progressFill = document.getElementById('progress-fill');
        
        progressText.textContent = `${state.connectedCountries} / ${state.totalCountries}`;
        progressFill.style.width = `${(state.connectedCountries / state.totalCountries) * 100}%`;
    }

    function checkCompletion() {
        // Game is complete when there's only one cluster
        if (state.clusters.size === 1) {
            state.gameComplete = true;
            showCompletionOverlay();
        }
    }

    function showCompletionOverlay() {
        document.getElementById('completion-overlay').classList.remove('hidden');
    }

    function resetGame() {
        // Hide completion overlay
        document.getElementById('completion-overlay').classList.add('hidden');
        
        // Close info panel
        closeInfoPanel();
        
        // Reset state
        state.clusters.clear();
        state.countryToCluster.clear();
        state.nextClusterId = 0;
        state.selectedCluster = null;
        state.isDragging = false;
        state.gameComplete = false;
        state.selectedForAttach = null;
        
        // Reinitialize
        initializeClusters();
        renderClusters();
        scatterPieces();
        updateProgress();
    }

    function showHint() {
        // Clear previous hint highlights
        const existingCircle = document.getElementById('hint-circle');
        if (existingCircle) existingCircle.remove();

        // Gather all single unconnected countries
        const candidates = [];
        state.clusters.forEach(cluster => {
            if (cluster.members.size === 1) {
                const countryId = Array.from(cluster.members)[0];
                const country = state.countries.get(countryId);
                if (country) {
                    candidates.push({ 
                        cluster, 
                        country, 
                        size: getCountrySize(country) 
                    });
                }
            }
        });

        if (candidates.length === 0) return;

        // Sort by size ascending (smallest first)
        candidates.sort((a, b) => a.size - b.size);
        
        // Pick the smallest
        const best = candidates[0];
        const path = best.cluster.element.querySelector('.country-path');

        if (path) {
            showHintCircle(path);
        }
    }

    function showHintCircle(targetPath) {
        // Get visual center and size of the path
        const rect = targetPath.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Convert center to SVG coordinates
        const pt = state.svg.createSVGPoint();
        pt.x = centerX;
        pt.y = centerY;
        const svgP = pt.matrixTransform(state.svg.getScreenCTM().inverse());

        // Calculate radius in SVG units
        // We map a point at the edge of the bounding box to SVG space to measure distance
        const ptEdge = state.svg.createSVGPoint();
        ptEdge.x = centerX + rect.width / 2;
        ptEdge.y = centerY;
        const svgPEdge = ptEdge.matrixTransform(state.svg.getScreenCTM().inverse());
        
        // Determine radius: Max of width/height aspect, plus padding
        // Using screen rectangle diagonal approximation converted to SVG units
        let radius = Math.abs(svgPEdge.x - svgP.x);
        
        // Enforce a minimum visibility size and add generous padding
        // "roughly the position" -> large circle
        radius = Math.max(radius * 2, 50); 

        // Create the circle element
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', svgP.x);
        circle.setAttribute('cy', svgP.y);
        circle.setAttribute('r', radius);
        circle.setAttribute('id', 'hint-circle');
        circle.setAttribute('class', 'hint-circle');
        
        // Append to SVG (ensure it's on top of clusters)
        state.svg.appendChild(circle);
        
        // Remove after animation (matches CSS duration)
        setTimeout(() => {
            if (circle.parentNode) {
                circle.remove();
            }
        }, 3000);
    }

    // =====================================================
    // UI HELPERS
    // =====================================================

    function showLoading(show) {
        let overlay = document.querySelector('.loading-overlay');
        
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'loading-overlay';
                overlay.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p class="loading-text">Caricamento mappa...</p>
                `;
                document.body.appendChild(overlay);
            }
        } else {
            if (overlay) {
                overlay.remove();
            }
        }
    }

    function showError(message) {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.innerHTML = `
                <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" width="48" height="48"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <p class="loading-text" style="color: #ef4444;">${message}</p>
            `;
        }
    }

    function onResize() {
        const container = document.getElementById('board-container');
        const rect = container.getBoundingClientRect();
        
        // Update config
        CONFIG.BOARD_WIDTH = rect.width;
        CONFIG.BOARD_HEIGHT = rect.height;
        
        // Update SVG viewBox
        state.svg.setAttribute('viewBox', `0 0 ${CONFIG.BOARD_WIDTH} ${CONFIG.BOARD_HEIGHT}`);
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // =====================================================
    // BOOTSTRAP
    // =====================================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
