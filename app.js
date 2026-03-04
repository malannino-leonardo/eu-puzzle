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
            
            // Show welcome modal only if user hasn't dismissed it before
            if (!getCookie('tutorialSeen')) {
                showWelcomeModal();
            }
            
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
        const width = CONFIG.BOARD_WIDTH;
        const height = CONFIG.BOARD_HEIGHT;
        
        const centerX = width / 2;
        const centerY = height / 2;
        
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
        
        // Shuffle cluster order so distribution is random each game
        const clustersArray = Array.from(state.clusters.values());
        for (let i = clustersArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [clustersArray[i], clustersArray[j]] = [clustersArray[j], clustersArray[i]];
        }

        // Track placed bounding boxes (in absolute SVG space) for overlap prevention
        const placedBoxes = [];
        const BOX_PADDING = 8;
        const MAX_ATTEMPTS = 50;

        function getTranslatedBounds(cluster, tx, ty) {
            const countryId = Array.from(cluster.members)[0];
            const country = state.countries.get(countryId);
            if (!country || !country.bounds) return null;
            const [[minX, minY], [maxX, maxY]] = country.bounds;
            return {
                minX: minX + tx - BOX_PADDING,
                minY: minY + ty - BOX_PADDING,
                maxX: maxX + tx + BOX_PADDING,
                maxY: maxY + ty + BOX_PADDING
            };
        }

        function overlapsAny(box) {
            return placedBoxes.some(p =>
                box.maxX > p.minX && box.minX < p.maxX &&
                box.maxY > p.minY && box.minY < p.maxY
            );
        }

        clustersArray.forEach((cluster, index) => {
            const zone = zones[index % zones.length];
            let x, y, box;
            let attempts = 0;

            do {
                const localX = zone.x + Math.random() * zone.w;
                const localY = zone.y + Math.random() * zone.h;
                x = localX - centerX;
                y = localY - centerY;
                box = getTranslatedBounds(cluster, x, y);
                attempts++;
            } while (box && overlapsAny(box) && attempts < MAX_ATTEMPTS);

            if (box) placedBoxes.push(box);

            cluster.transform = { x, y, rotation: 0 };
            updateClusterTransform(cluster.element, cluster.transform);
        });
    }

    function mergeClusters(clusterA, clusterB) {
        // Merge B into A
        const a = state.clusters.get(clusterA);
        const b = state.clusters.get(clusterB);
        
        if (!a || !b) return;
        
        // Clear all snap preview classes from both clusters before merging
        // Also mark all of A's existing paths as snapped (they are confirmed in position)
        a.element.querySelectorAll('.country-path').forEach(path => {
            path.classList.remove('snap-preview', 'snap-error');
            path.classList.add('snapped');
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
        
        // Flash newly snapped countries
        b.members.forEach(countryId => {
            const pathEl = a.element.querySelector(`[data-country-id="${countryId}"]`);
            if (pathEl) {
                pathEl.classList.add('snap-connect');
                setTimeout(() => pathEl.classList.remove('snap-connect'), 550);
            }
        });
        
        // Pulse progress bar
        const progressFill = document.getElementById('progress-fill');
        if (progressFill) {
            progressFill.classList.remove('pulse');
            void progressFill.offsetWidth; // reflow
            progressFill.classList.add('pulse');
            setTimeout(() => progressFill.classList.remove('pulse'), 700);
        }
        
        // Update progress
        updateProgress();
        
        if (tutorialState.active) {
            // Check if we just merged France and Germany
            const step = TUTORIAL_STEPS[tutorialState.step];
            if (step && step.isSnapDemo) {
                const frId = '250', deId = '276';
                const frCluster = state.countryToCluster.get(frId);
                const deCluster = state.countryToCluster.get(deId);
                if (frCluster === deCluster) {
                    // Success! Advance tutorial
                     setTimeout(() => {
                        const nextBtn = document.getElementById('btn-next-tutorial');
                        if (nextBtn) nextBtn.style.display = '';
                        nextTutorialStep();
                     }, 500); 
                }
            }
        }
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
                // Snap burst visual effect
                createSnapRipple(draggedCluster.element);
                
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
        pinGroup.setAttribute('class', 'marker-pin');
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
        h3.style.background = 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)';
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
            
            row.innerHTML = `<strong style="color: #6366f1; display:block; margin-bottom:4px; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">${label}</strong><div class="popup-row-value" style="color: #333333; font-weight:600; font-size:1.1rem;">${value}</div>`;
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
            factDiv.innerHTML = `<strong style="color: #6366f1; display:block; margin-bottom:8px; font-weight:700; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.5px;">Curiosità</strong><span style="font-size: 1.05rem; line-height: 1.6;">${factText}</span>`;
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
        
        // Use a continuous loop to keep popup synced with marker during pan/zoom
        let animationFrameId;
        const updateLoop = () => {
            if (popup.parentElement) {
                updatePopupPosition(popup, marker);
                animationFrameId = requestAnimationFrame(updateLoop);
            }
        };
        animationFrameId = requestAnimationFrame(updateLoop);
        
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            
            popup.classList.add('closing');
            popup.addEventListener('animationend', () => {
                popup.remove();
            }, { once: true }); 
        });
    }

    function updatePopupPosition(popup, marker) {
        if (!popup || !marker) return;
        
        const rect = marker.getBoundingClientRect();
        
        // If marker is not visible or layout not ready, retry or abort
        if (rect.width === 0 && rect.height === 0) return;

        // Marker center point
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const popupRect = popup.getBoundingClientRect();
        // Use rendered dimensions or defaults if not yet rendered
        const width = popupRect.width || 360; 
        const height = popupRect.height || 200;
        
        // Environment bounds
        const header = document.querySelector('.game-header');
        const headerHeight = header ? header.getBoundingClientRect().height : 0;
        const padding = 15;
        const margin = 20; // The margin applied by CSS for the arrow space
        
        // Calculate available space in each direction
        // Safe buffer below header = headerHeight + padding
        const topLimit = headerHeight + padding;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        
        const spaceTop = rect.top - margin - height - topLimit;
        const spaceRight = viewportWidth - (rect.right + margin + width + padding);
        const spaceLeft = rect.left - margin - width - padding;
        const spaceBottom = viewportHeight - (rect.bottom + margin + height + padding);

        // Determine ideal orientation with hysteresis
        // Check current orientation first to prevent flickering
        const currentOrientation = Array.from(popup.classList).find(c => c.startsWith('orientation-'))?.replace('orientation-', '') || 'top';
        let orientation = currentOrientation;
        
        // Hysteresis buffer - keep current orientation if it's "close enough" to valid
        // or if switching would be too sensitive
        const hysteresis = 20; 
        
        let isCurrentValid = false;
        if (currentOrientation === 'top' && spaceTop >= -hysteresis) isCurrentValid = true;
        else if (currentOrientation === 'right' && spaceRight >= -hysteresis) isCurrentValid = true;
        else if (currentOrientation === 'left' && spaceLeft >= -hysteresis) isCurrentValid = true;
        else if (currentOrientation === 'bottom' && spaceBottom >= -hysteresis) isCurrentValid = true;
        
        // If current is definitely invalid (e.g. went way off screen), or if we weren't valid to begin with
        if (!isCurrentValid) {
            if (spaceTop >= 0) {
                orientation = 'top';
            } else if (spaceRight >= 0) {
                orientation = 'right';
            } else if (spaceLeft >= 0) {
                orientation = 'left';
            } else if (spaceBottom >= 0) {
                orientation = 'bottom';
            } else {
                 // If no perfect fit, pick dimension with max available space
                const max = Math.max(spaceTop, spaceRight, spaceLeft, spaceBottom);
                if (max === spaceTop) orientation = 'top';
                else if (max === spaceRight) orientation = 'right';
                else if (max === spaceLeft) orientation = 'left';
                else orientation = 'bottom';
            }
        }
        
        // Only update class if changed to avoid re-triggering animations if CSS uses them on class change
        if (orientation !== currentOrientation) {
            popup.classList.remove('orientation-top', 'orientation-right', 'orientation-left', 'orientation-bottom');
            popup.classList.add(`orientation-${orientation}`);
        }

        // Calculate Position & Arrow Offset
        let left, top, arrowOffset, maxOffset;
        
        if (orientation === 'top') {
            left = cx;
            top = rect.top; // CSS handles translateY(-100%) and margin-top
            
            // Clamp Horizontal
            const minX = padding + width/2;
            const maxX = viewportWidth - padding - width/2;
            const originalLeft = left;
            left = Math.max(minX, Math.min(left, maxX));
            arrowOffset = originalLeft - left;
            maxOffset = (width/2) - 24;

        } else if (orientation === 'bottom') {
            left = cx;
            top = rect.bottom; // CSS handles translateY(0) and margin-top
            
            const minX = padding + width/2;
            const maxX = viewportWidth - padding - width/2;
            const originalLeft = left;
            left = Math.max(minX, Math.min(left, maxX));
            arrowOffset = originalLeft - left;
            maxOffset = (width/2) - 24;

        } else if (orientation === 'right') {
            left = rect.right; // CSS handles margin-left
            top = cy; // CSS handles translateY(-50%)
            
            // Clamp Vertical
            // Top edge is at (top - height/2). Must be >= topLimit
            const minY = topLimit + height/2;
            const maxY = viewportHeight - padding - height/2;
            const originalTop = top;
            top = Math.max(minY, Math.min(top, maxY));
            arrowOffset = originalTop - top;
            maxOffset = (height/2) - 24;

        } else if (orientation === 'left') {
            left = rect.left; // CSS handles translateX(-100%) and margin-left
            top = cy; 
            
            const minY = topLimit + height/2;
            const maxY = viewportHeight - padding - height/2;
            const originalTop = top;
            top = Math.max(minY, Math.min(top, maxY));
            arrowOffset = originalTop - top;
            maxOffset = (height/2) - 24;
        }

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.position = 'fixed'; // Ensure fixed mapping
        
        // Validate and apply offset
        const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, arrowOffset));
        popup.style.setProperty('--arrow-offset', `${clampedOffset}px`);
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
        document.getElementById('btn-open-tutorial').addEventListener('click', showWelcomeModal);
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

        // In accessibility mode hide all pin markers; when disabled, reveal them all
        document.body.classList.toggle('accessibility-mode', state.clickMode);
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
    // COOKIE HELPERS
    // =====================================================

    function setCookie(name, value, days) {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    }

    function getCookie(name) {
        return document.cookie
            .split('; ')
            .find(row => row.startsWith(name + '='))
            ?.split('=')[1]
            ? decodeURIComponent(document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1] || '')
            : null;
    }

    function deleteCookie(name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
    }

    // =====================================================
    // SNAP RIPPLE BURST ANIMATION
    // =====================================================

    function createSnapRipple(clusterElement) {
        if (!clusterElement) return;

        const rect = clusterElement.getBoundingClientRect();
        if (!rect.width && !rect.height) return;

        const screenX = rect.left + rect.width / 2;
        const screenY = rect.top + rect.height / 2;

        const pt = state.svg.createSVGPoint();
        pt.x = screenX;
        pt.y = screenY;
        const svgPoint = pt.matrixTransform(state.svg.getScreenCTM().inverse());

        const startTime = performance.now();
        const duration = 620;

        // Ring ripple
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', svgPoint.x);
        ring.setAttribute('cy', svgPoint.y);
        ring.setAttribute('r', '0');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#10b981');
        ring.setAttribute('stroke-width', '5');
        state.svg.appendChild(ring);

        // Second ring (delayed)
        const ring2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring2.setAttribute('cx', svgPoint.x);
        ring2.setAttribute('cy', svgPoint.y);
        ring2.setAttribute('r', '0');
        ring2.setAttribute('fill', 'none');
        ring2.setAttribute('stroke', '#818cf8');
        ring2.setAttribute('stroke-width', '3');
        state.svg.appendChild(ring2);

        // Burst particles
        const particles = [];
        const numParticles = 8;
        const colors = ['#10b981', '#34d399', '#818cf8', '#fbbf24', '#6ee7b7', '#a78bfa', '#10b981', '#34d399'];

        for (let i = 0; i < numParticles; i++) {
            const angle = (i / numParticles) * Math.PI * 2 + Math.random() * 0.3;
            const speed = 30 + Math.random() * 30;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', svgPoint.x);
            circle.setAttribute('cy', svgPoint.y);
            circle.setAttribute('r', 2.5 + Math.random() * 2);
            circle.setAttribute('fill', colors[i]);
            state.svg.appendChild(circle);
            particles.push({ el: circle, angle, speed, delay: Math.random() * 60 });
        }

        function animateBurst(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - t, 2.5);

            // Ring 1
            ring.setAttribute('r', ease * 55);
            ring.setAttribute('stroke-opacity', (1 - t) * 0.85);
            ring.setAttribute('stroke-width', (1 - t * 0.7) * 5);

            // Ring 2 (slight delay)
            const t2 = Math.min(Math.max((elapsed - 100) / duration, 0), 1);
            const ease2 = 1 - Math.pow(1 - t2, 2.5);
            ring2.setAttribute('r', ease2 * 40);
            ring2.setAttribute('stroke-opacity', (1 - t2) * 0.6);

            // Particles
            particles.forEach(p => {
                const pe = Math.max(0, elapsed - p.delay);
                const pt_ = Math.min(pe / (duration * 0.75), 1);
                const pe_ = 1 - Math.pow(1 - pt_, 2);
                const dx = Math.cos(p.angle) * p.speed * pe_;
                const dy = Math.sin(p.angle) * p.speed * pe_;
                p.el.setAttribute('cx', svgPoint.x + dx);
                p.el.setAttribute('cy', svgPoint.y + dy);
                p.el.setAttribute('opacity', 1 - pt_);
            });

            if (t < 1) {
                requestAnimationFrame(animateBurst);
            } else {
                ring.remove();
                ring2.remove();
                particles.forEach(p => p.el.remove());
            }
        }

        requestAnimationFrame(animateBurst);
    }

    // =====================================================
    // WELCOME MODAL
    // =====================================================

    function showWelcomeModal() {
        const modal = document.getElementById('welcome-modal');
        if (!modal) return;

        // Reveal the modal with animation
        modal.classList.remove('hidden');
        modal.style.opacity = '0';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.style.transition = 'opacity 0.3s ease';
                modal.style.opacity = '1';
            });
        });

        // Use { once: true } to prevent listener stacking on repeated opens
        document.getElementById('btn-skip-tutorial').addEventListener('click', () => {
            setCookie('tutorialSeen', 'true', 365);
            hideWelcomeModal();
        }, { once: true });

        document.getElementById('btn-start-tutorial').addEventListener('click', () => {
            // Do NOT set cookie here, so welcome modal shows again next time
            hideWelcomeModal();
            setTimeout(startTutorial, 400);
        }, { once: true });
    }

    function hideWelcomeModal() {
        const modal = document.getElementById('welcome-modal');
        if (!modal) return;
        modal.style.transition = 'opacity 0.25s ease';
        modal.style.opacity = '0';
        setTimeout(() => modal.classList.add('hidden'), 280);
    }

    // =====================================================
    // TUTORIAL SYSTEM
    // =====================================================

    const TUTORIAL_STEPS = [
        {
            icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/>',
            selector: null,
            title: 'Benvenuto!',
            text: 'Sei qui per ricostruire la mappa dell\'Unione Europea. I 27 paesi sono sparsi ed il tuo obiettivo è rimetterli al loro posto! Questo tutorial ti guiderà passo dopo passo.',
            isMapStep: false
        },
        {
            icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 8h10M7 12h6"/>',
            selector: '#board-container',
            title: 'L\'Area di Gioco',
            text: 'Questa è l\'area di gioco. I pezzi del puzzle sono sparpagliati qui intorno. Trascina un paese verso il centro per iniziare a comporre la mappa dell\'Unione Europea!',
            isMapStep: true
        },
        {
            icon: '<circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="18" cy="12" r="2" fill="currentColor"/><path d="M8 12h8"/><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/>',
            selector: '#board-container',
            title: 'Significato dei Colori',
            text: 'I colori dei paesi indicano il loro stato attuale:',
            colorList: [
                { swatch: '#3b7dd8', shadow: '#3b7dd888', label: 'Blu', desc: 'Paese ancora da posizionare' },
                { swatch: '#8b5cf6', shadow: '#8b5cf688', label: 'Viola', desc: 'Paese evidenziato (hover)' },
                { swatch: '#10b981', shadow: '#10b98188', label: 'Verde', desc: 'Paese correttamente collegato' },
                { swatch: '#f59e0b', shadow: '#f59e0b88', label: 'Arancio / Oro', desc: 'Paese selezionato (solo in modalità accessibilità)' }
            ],
            isMapStep: true
        },
        {
            icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
            selector: '#board-container',
            title: 'Aggancia i Confini',
            text: 'Aggancia la Francia alla Germania. Avvicina i due paesi finché non si uniscono automaticamente. Frecce dorate ti mostreranno la direzione!',
            isMapStep: true,
            isSnapDemo: true
        },
        {
            icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', // Info icon
            selector: null, // Will handle manually
            title: 'Le Info e le Curiosità',
            text: 'Ora che hai collegato i paesi, clicca sul segnaposto per scoprire informazioni reali e curiosità! Nota bene: quando collegherai altri paesi a un gruppo già esistente, questa scheda si aprirà automaticamente!',
            isMapStep: true,
            isInfoDemo: true // New flag
        },
        {
            icon: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
            selector: '#btn-hint',
            title: 'Suggerimento',
            text: 'Sei bloccato? Questo pulsante evidenzia il paese più piccolo ancora non collegato. Usalo con parsimonia per non perdere il gusto della sfida!',
            isMapStep: false
        },
        {
            icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
            selector: '.progress-container',
            title: 'Barra di Progresso',
            text: 'Qui vedi quanti paesi hai già collegato al gruppo principale. L\'obiettivo è portare il contatore a 27 su 27!',
            isMapStep: false
        },
        {
            icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
            selector: '#btn-reset',
            title: 'Ricomincia',
            text: 'Se vuoi ricominciare da capo, usa il pulsante Reset. Tutti i pezzi vengono rimescolati e puoi provare di nuovo a tuo piacimento!',
            isMapStep: false
        },
        {
            icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
            selector: '#btn-open-tutorial',
            title: 'Riapri il Tutorial',
            text: 'Hai dubbi durante il gioco? Premi il pulsante "Tutorial" in cima alla pagina per riaprire questa guida in qualsiasi momento!',
            isMapStep: false
        },
        {
            icon: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
            selector: null,
            title: 'Sei Pronto!',
            text: 'Ora sai tutto quello che ti serve. Buona fortuna nel ricostruire l\'Unione Europea! Ricorda: puoi sempre riaprire questo tutorial dal pulsante in alto. Puoi farcela!',
            isMapStep: false
        }
    ];

    const tutorialState = {
        active: false,
        step: 0,
        highlightedElement: null,
        savedViewBox: null,
        snapDemoRafId: null
    };

    function startTutorial() {
        tutorialState.active = true;
        tutorialState.step = 0;

        const overlay = document.getElementById('tutorial-overlay');
        overlay.classList.remove('hidden');

        // Render progress dots
        const dotsEl = document.getElementById('tutorial-dots');
        dotsEl.innerHTML = '';
        TUTORIAL_STEPS.forEach((_, i) => {
            const dot = document.createElement('span');
            dot.className = 'tutorial-dot';
            dot.dataset.step = i;
            dotsEl.appendChild(dot);
        });

        // Bind navigation buttons
        document.getElementById('btn-next-tutorial').addEventListener('click', nextTutorialStep);
        document.getElementById('btn-prev-tutorial').addEventListener('click', prevTutorialStep);
        document.getElementById('btn-close-tutorial').addEventListener('click', closeTutorial);

        // Pressing Escape closes tutorial
        document.addEventListener('keydown', onTutorialEscape);

        // Clicking overlay background also advances
        document.getElementById('tutorial-overlay').addEventListener('click', (e) => {
            // Check if next button is disabled/hidden (like in Snap Demo)
            const nextBtn = document.getElementById('btn-next-tutorial');
            if (nextBtn.style.display !== 'none') {
                nextTutorialStep();
            }
        });

        // Arrange pieces for tutorial (France and Germany close)
        arrangeTutorialPieces();

        showTutorialStep(0);
    }

    function arrangeTutorialPieces() {
        // Reset all first
        scatterPieces();
        
        const frId = '250'; // France
        const deId = '276'; // Germany
        
        const frClusterId = state.countryToCluster.get(frId);
        const deClusterId = state.countryToCluster.get(deId);
        
        // If already connected, no need to move
        if (frClusterId === deClusterId) return;

        const frCluster = state.clusters.get(frClusterId);
        const deCluster = state.clusters.get(deClusterId);
        
        if (frCluster && deCluster) {
            // Position near center
            frCluster.transform = { x: -120, y: 0, rotation: 0 };
            deCluster.transform = { x: 120, y: 0, rotation: 0 };
            
            updateClusterTransform(frCluster.element, frCluster.transform);
            updateClusterTransform(deCluster.element, deCluster.transform);
        }
    }

    function onTutorialEscape(e) {
        if (e.key === 'Escape') closeTutorial();
    }

    function showTutorialStep(index) {
        // Clean up any anchored popup that might be open from previous steps (e.g. from Info Demo)
        document.querySelector('.anchored-popup')?.remove();

        const step = TUTORIAL_STEPS[index];
        if (!step) { closeTutorial(); return; }

        const tooltip = document.getElementById('tutorial-tooltip');
        const spotlight = document.getElementById('tutorial-spotlight');
        const total = TUTORIAL_STEPS.length;

        // Update step indicator
        document.getElementById('tutorial-step-num').textContent = index + 1;
        document.getElementById('tutorial-step-total').textContent = total;

        // Render icon
        const iconEl = document.getElementById('tutorial-step-icon');
        if (iconEl) {
            if (step.icon) {
                iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">${step.icon}</svg>`;
                iconEl.style.display = 'flex';
            } else {
                iconEl.style.display = 'none';
            }
        }

        // Update text content
        document.getElementById('tutorial-step-title').textContent = step.title;
        document.getElementById('tutorial-step-text').textContent = step.text;

        // Color list (step 3)
        const listEl = document.getElementById('tutorial-step-list');
        if (listEl) {
            if (step.colorList && step.colorList.length) {
                listEl.innerHTML = step.colorList.map(c =>
                    `<li class="tutorial-color-item">
                        <span class="tutorial-color-swatch" style="background:${c.swatch};box-shadow:0 0 6px ${c.shadow}"></span>
                        <span class="tutorial-color-label"><strong>${c.label}</strong></span>
                        <span class="tutorial-color-desc">${c.desc}</span>
                    </li>`
                ).join('');
                listEl.hidden = false;
            } else {
                listEl.hidden = true;
                listEl.innerHTML = '';
            }
        }

        // Show/hide Back button
        const prevBtn = document.getElementById('btn-prev-tutorial');
        const nextBtn = document.getElementById('btn-next-tutorial');
        if (prevBtn) prevBtn.style.display = index === 0 ? 'none' : '';

        // Default: Button visible and enabled
        if (nextBtn) {
            nextBtn.style.display = '';
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'auto';
            nextBtn.disabled = false;
        }

        // Handle phases 1 and 10 (index 0 and 9) initial positioning
        // Use visibility hidden to prevent jump
        tooltip.style.visibility = 'hidden';
        tooltip.classList.remove('hidden');

        if (index === 0 || index === TUTORIAL_STEPS.length - 1) {
             centerTutorialTooltip(tooltip);
             // Ensure it's not off-center before showing
             tooltip.style.transform = 'translate(-50%, -50%)'; 
        }

        if (step.isSnapDemo) {
            activateTutorialSnapDemo();
            // User must connect them to proceed - disable button but keep visible
            if (nextBtn) {
                 nextBtn.style.opacity = '0.5';
                 nextBtn.style.pointerEvents = 'none';
                 nextBtn.disabled = true;
            }

            // Check if they are already connected, if so, allow passing
            const frId = '250', deId = '276';
            if (state.countryToCluster.get(frId) === state.countryToCluster.get(deId)) {
                if (nextBtn) {
                    nextBtn.style.opacity = '1';
                    nextBtn.style.pointerEvents = 'auto';
                    nextBtn.disabled = false;
                }
            }
        } else if (step.isInfoDemo) {
             // Keep the view from snap demo but remove arrows
             const g = document.getElementById('tutorial-snap-demo');
             if (g) g.remove();
             if (tutorialState.snapDemoRafId) {
                cancelAnimationFrame(tutorialState.snapDemoRafId);
                tutorialState.snapDemoRafId = null;
             }
             
             // Point to Germany
             const deId = '276';
             const deClusterId = state.countryToCluster.get(deId);
             const deCluster = state.clusters.get(deClusterId);
             
             let targetEl;
             // Try to find the marker first (if connected)
             targetEl = deCluster?.element.querySelector(`.country-marker[data-for="${deId}"]`);
             // Fallback to path
             if (!targetEl) targetEl = document.querySelector(`[data-country-id="${deId}"]`);
             
             if (targetEl) {
                // Remove spotlight for Info Demo (Phase 5)
                spotlight.classList.add('hidden');

                // Don't show generic tooltip first
                // Wait for positioning
             }
             
        } else {
            deactivateTutorialSnapDemo();
        }

        // On last step: hide Close button, show only Inizia
        const closeBtn = document.getElementById('btn-close-tutorial');
        const isLast = index === total - 1;
        if (closeBtn) closeBtn.style.display = isLast ? 'none' : '';

        // During snap demo: let the user actually interact with the map
        const overlayEl = document.getElementById('tutorial-overlay');
        if (overlayEl) overlayEl.style.pointerEvents = (step.isSnapDemo || step.isInfoDemo) ? 'none' : '';

        // Pulsing glow on the map during map steps
        const boardContainer = document.getElementById('board-container');
        if (boardContainer) {
            if (step.isMapStep) {
                boardContainer.classList.add('tutorial-map-glow');
            } else {
                boardContainer.classList.remove('tutorial-map-glow');
            }
        }

        // Last step: change "Avanti" to "Inizia"
        if (index === total - 1) {
            nextBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" style="margin-right: 6px;">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>Inizia!`;
        } else {
            nextBtn.textContent = 'Avanti →';
        }

        // Update progress dots
        document.querySelectorAll('.tutorial-dot').forEach((dot, i) => {
            dot.classList.remove('active', 'done');
            if (i < index) dot.classList.add('done');
            else if (i === index) dot.classList.add('active');
        });

        // Spotlight handling
        if (step.selector) {
            const target = document.querySelector(step.selector);
            if (target) {
                // Phase 2 (index 1) and Phase 3 (index 2): Center-Bottom positioning
                if ((index === 1 || index === 2) && step.selector === '#board-container') {
                     // Hide spotlight for these broad steps
                     spotlight.classList.add('hidden');
                     
                     // Position before animation
                     tooltip.style.left = '50%';
                     tooltip.style.top = '';
                     tooltip.style.bottom = '10%'; // Center-bottom
                     tooltip.style.right = '';
                     tooltip.style.transform = 'translateX(-50%)';

                     tooltip.classList.remove('hidden');
                     tooltip.style.visibility = 'visible'; // Reveal
                     tooltip.classList.remove('animating', 'animating-x-centered', 'animating-centered');
                     void tooltip.offsetWidth;
                     tooltip.classList.add('animating-x-centered');

                } else {
                    const rect = target.getBoundingClientRect();
                    const padding = 8;
                    spotlight.style.top    = `${rect.top - padding}px`;
                    spotlight.style.left   = `${rect.left - padding}px`;
                    spotlight.style.width  = `${rect.width + padding * 2}px`;
                    spotlight.style.height = `${rect.height + padding * 2}px`;
                    spotlight.classList.remove('hidden');

                    // Position tooltip relative to the target
                    positionTutorialTooltip(target, tooltip);
                    
                    // Snap demo: pin tooltip to bottom-right corner so the countries are fully visible
                    if (step.isSnapDemo) {
                        tooltip.style.top    = '';
                        tooltip.style.left   = '';
                        tooltip.style.bottom = '1.5rem';
                        tooltip.style.right  = '1.5rem';
                        tooltip.style.transform = '';
                    }

                    tooltip.classList.remove('hidden');
                    tooltip.style.visibility = 'visible'; // Reveal
                    tooltip.classList.remove('animating', 'animating-x-centered', 'animating-centered');
                    void tooltip.offsetWidth; // reflow
                    tooltip.classList.add('animating');
                }
            } else {
                spotlight.classList.add('hidden');
                centerTutorialTooltip(tooltip);
                tooltip.classList.remove('hidden');
                tooltip.style.visibility = 'visible'; // Reveal
                tooltip.classList.remove('animating', 'animating-x-centered', 'animating-centered');
                void tooltip.offsetWidth;
                tooltip.classList.add('animating-centered');
            }
        } else if (step.isInfoDemo) {
            // Keep spotlight hidden (as requested per Phase 5 focus removal)
            spotlight.classList.add('hidden');
            
            tooltip.style.top    = '';
            tooltip.style.left   = '';
            tooltip.style.bottom = '1.5rem';
            tooltip.style.right  = '1.5rem';
            tooltip.style.transform = '';

            tooltip.classList.remove('hidden');
            tooltip.style.visibility = 'visible'; // Reveal
            tooltip.classList.remove('animating', 'animating-x-centered', 'animating-centered');
            void tooltip.offsetWidth;
            tooltip.classList.add('animating');

        } else {
            spotlight.classList.add('hidden');
            centerTutorialTooltip(tooltip);
            tooltip.classList.remove('hidden');
            tooltip.style.visibility = 'visible'; // Reveal
            tooltip.classList.remove('animating', 'animating-x-centered', 'animating-centered');
            void tooltip.offsetWidth;
            tooltip.classList.add('animating-centered');
        }

        tutorialState.step = index;
    }

    function positionTutorialTooltip(targetEl, tooltip) {
        // Clear any corner-pinned values from snap demo step
        tooltip.style.bottom = '';
        tooltip.style.right  = '';
        const targetRect = targetEl.getBoundingClientRect();
        const padding = 16;
        const tooltipW = tooltip.offsetWidth || 320;
        const tooltipH = tooltip.offsetHeight || 180;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let top = targetRect.bottom + padding;
        let left = targetRect.left + (targetRect.width / 2) - (tooltipW / 2);

        // Keep inside viewport
        if (left < padding) left = padding;
        if (left + tooltipW > vw - padding) left = vw - tooltipW - padding;
        if (top + tooltipH > vh - padding) {
             // Flip to top if no space below
             top = targetRect.top - tooltipH - padding;
        }

        // Ensure it doesn't go off-screen at the top
        if (top < padding) top = padding;

        tooltip.style.top  = `${top}px`;
        tooltip.style.left = `${left}px`;
        tooltip.style.transform = '';
    }

    function centerTutorialTooltip(tooltip) {
        tooltip.style.bottom = '';
        tooltip.style.right  = '';
        tooltip.style.top       = '50%';
        tooltip.style.left      = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
    }

    function nextTutorialStep() {
        const next = tutorialState.step + 1;
        if (next >= TUTORIAL_STEPS.length) {
            closeTutorial();
        } else {
            showTutorialStep(next);
        }
    }

    function prevTutorialStep() {
        const prev = tutorialState.step - 1;
        if (prev >= 0) showTutorialStep(prev);
    }

    function closeTutorial() {
        const wasActive = tutorialState.active;
        tutorialState.active = false;

        const overlay  = document.getElementById('tutorial-overlay');
        const tooltip  = document.getElementById('tutorial-tooltip');
        const spotlight = document.getElementById('tutorial-spotlight');

        overlay.classList.add('hidden');
        tooltip.classList.add('hidden');
        spotlight.classList.add('hidden');

        // Remove map glow
        const boardContainer = document.getElementById('board-container');
        if (boardContainer) boardContainer.classList.remove('tutorial-map-glow');

        // Clean up snap demo
        deactivateTutorialSnapDemo();

        document.removeEventListener('keydown', onTutorialEscape);

        if (wasActive) {
            setTimeout(resetGame, 300);
        }
    }

    function activateTutorialSnapDemo() {
        // France = '250', Germany = '276'
        const frId = '250', deId = '276';
        const frCountry = state.countries.get(frId);
        const deCountry = state.countries.get(deId);
        if (!frCountry || !deCountry) return;
        // If already active, don't re-render
        if (document.getElementById('tutorial-snap-demo')) return;

        // Helper: get current SVG position of a country centroid (centroid + cluster translate)
        const getPos = (country, id) => {
            const cluster = state.clusters.get(state.countryToCluster.get(id));
            return [
                country.centroid[0] + (cluster ? cluster.transform.x || 0 : 0),
                country.centroid[1] + (cluster ? cluster.transform.y || 0 : 0)
            ];
        };

        // Initial positions for viewBox zoom
        const frPos0 = getPos(frCountry, frId);
        const dePos0 = getPos(deCountry, deId);

        // Save current viewBox, then zoom to show both countries
        tutorialState.savedViewBox = { ...state.viewBox };
        const margin = 170;
        state.viewBox.x = Math.min(frPos0[0], dePos0[0]) - margin;
        state.viewBox.y = Math.min(frPos0[1], dePos0[1]) - margin;
        state.viewBox.w = Math.abs(frPos0[0] - dePos0[0]) + margin * 2;
        state.viewBox.h = Math.abs(frPos0[1] - dePos0[1]) + margin * 2;
        if (state.viewBox.w < 300) { const e = (300 - state.viewBox.w) / 2; state.viewBox.x -= e; state.viewBox.w = 300; }
        if (state.viewBox.h < 220) { const e = (220 - state.viewBox.h) / 2; state.viewBox.y -= e; state.viewBox.h = 220; }
        updateViewBox();

        // Build SVG overlay group (static structure; positions updated in RAF loop below)
        const ns = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('id', 'tutorial-snap-demo');
        g.setAttribute('pointer-events', 'none');

        // Arrowhead marker
        const defs = document.createElementNS(ns, 'defs');
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'tut-snap-arrow');
        marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '7'); marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const arrowPath = document.createElementNS(ns, 'path');
        arrowPath.setAttribute('d', 'M0,0 L0,6 L8,3 z');
        arrowPath.setAttribute('fill', '#f59e0b');
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        g.appendChild(defs);

        const makeArrow = () => {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('stroke', '#f59e0b');
            line.setAttribute('stroke-width', '4');
            line.setAttribute('stroke-dasharray', '12 6');
            line.setAttribute('stroke-dashoffset', '0');
            line.setAttribute('marker-end', 'url(#tut-snap-arrow)');
            line.setAttribute('class', 'tutorial-snap-arrow');
            return line;
        };
        const frArrow = makeArrow();
        const deArrow = makeArrow();
        g.appendChild(frArrow);
        g.appendChild(deArrow);

        const makeDot = () => {
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('r', '7');
            c.setAttribute('fill', '#f59e0b');
            c.setAttribute('class', 'tutorial-snap-dot');
            return c;
        };
        const frDot = makeDot();
        const deDot = makeDot();
        g.appendChild(frDot);
        g.appendChild(deDot);

        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('r', '12');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#f59e0b');
        ring.setAttribute('stroke-width', '3');
        ring.setAttribute('class', 'tutorial-snap-target');
        g.appendChild(ring);

        state.clustersContainer.appendChild(g);

        // RAF loop: update all positions dynamically as countries move
        const rafLoop = () => {
            if (!document.getElementById('tutorial-snap-demo')) return; // was removed

            const frPos = getPos(frCountry, frId);
            const dePos = getPos(deCountry, deId);
            const midX = (frPos[0] + dePos[0]) / 2;
            const midY = (frPos[1] + dePos[1]) / 2;

            const setArrow = (arrow, x1, y1, x2, y2) => {
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                arrow.setAttribute('x1', x1); arrow.setAttribute('y1', y1);
                arrow.setAttribute('x2', x2 - (dx / len) * 14);
                arrow.setAttribute('y2', y2 - (dy / len) * 14);
            };
            setArrow(frArrow, frPos[0], frPos[1], midX, midY);
            setArrow(deArrow, dePos[0], dePos[1], midX, midY);

            frDot.setAttribute('cx', frPos[0]); frDot.setAttribute('cy', frPos[1]);
            deDot.setAttribute('cx', dePos[0]); deDot.setAttribute('cy', dePos[1]);
            ring.setAttribute('cx', midX);      ring.setAttribute('cy', midY);

            // Re-apply highlight to both countries in case DOM was rebuilt during snap/merge
            /* [frId, deId].forEach(id => {
                const pathEl = document.querySelector(`[data-country-id="${id}"]`);
                if (pathEl && !pathEl.classList.contains('tutorial-snap-highlight')) {
                    pathEl.classList.add('tutorial-snap-highlight');
                }
            }); */

            tutorialState.snapDemoRafId = requestAnimationFrame(rafLoop);
        };
        tutorialState.snapDemoRafId = requestAnimationFrame(rafLoop);
    }

    function deactivateTutorialSnapDemo() {
        // Stop the RAF update loop
        if (tutorialState.snapDemoRafId) {
            cancelAnimationFrame(tutorialState.snapDemoRafId);
            tutorialState.snapDemoRafId = null;
        }

        const g = document.getElementById('tutorial-snap-demo');
        if (g) g.remove();

        document.querySelectorAll('.tutorial-snap-highlight').forEach(el =>
            el.classList.remove('tutorial-snap-highlight')
        );

        if (tutorialState.savedViewBox) {
            Object.assign(state.viewBox, tutorialState.savedViewBox);
            tutorialState.savedViewBox = null;
            updateViewBox();
        }
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
