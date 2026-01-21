/**
 * =====================================================
 * PUZZLE EUROPA - MAIN APPLICATION
 * =====================================================
 * Un puzzle interattivo per ricostruire l'Europa
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
        ROTATION_RANGE: 30, // degrees
        
        // Animation durations
        SNAP_DURATION: 200,
        
        // European country ISO codes (ISO 3166-1 numeric)
        EUROPEAN_COUNTRIES: [
            '008', // Albania
            '020', // Andorra
            '040', // Austria
            '056', // Belgium
            '070', // Bosnia and Herzegovina
            '100', // Bulgaria
            '112', // Belarus
            '191', // Croatia
            '196', // Cyprus
            '203', // Czech Republic
            '208', // Denmark
            '233', // Estonia
            '246', // Finland
            '250', // France
            '276', // Germany
            '300', // Greece
            '348', // Hungary
            '352', // Iceland
            '372', // Ireland
            '380', // Italy
            '428', // Latvia
            '438', // Liechtenstein
            '440', // Lithuania
            '442', // Luxembourg
            '807', // North Macedonia
            '470', // Malta
            '498', // Moldova
            '492', // Monaco
            '499', // Montenegro
            '528', // Netherlands
            '578', // Norway
            '616', // Poland
            '620', // Portugal
            '642', // Romania
            '643', // Russia
            '674', // San Marino
            '688', // Serbia
            '703', // Slovakia
            '705', // Slovenia
            '724', // Spain
            '752', // Sweden
            '756', // Switzerland
            '804', // Ukraine
            '826', // United Kingdom
            '336', // Vatican City (Holy See)
            // Kosovo (not always in datasets, but we'll try)
            '-99'  // Kosovo placeholder
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
        
        // Audio
        musicEnabled: false,
        
        // DOM references
        svg: null,
        clustersContainer: null,
        projection: null,
        pathGenerator: null,
        
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
            
            console.log('🎮 Puzzle Europa initialized!');
            console.log(`📊 Loaded ${state.countries.size} countries`);
            
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
        
        // Set SVG viewBox
        state.svg.setAttribute('viewBox', `0 0 ${CONFIG.BOARD_WIDTH} ${CONFIG.BOARD_HEIGHT}`);
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
        const geojson = topojson.feature(topology, topology.objects[countriesKey]);
        
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
            const name = feature.properties?.name || 'Unknown';
            
            // Generate SVG path
            const pathD = state.pathGenerator(feature);
            if (!pathD) return;
            
            // Calculate centroid for snapping calculations
            const centroid = state.pathGenerator.centroid(feature);
            if (!centroid || isNaN(centroid[0])) return;
            
            // Calculate bounds
            const bounds = state.pathGenerator.bounds(feature);
            
            state.countries.set(id, {
                id,
                name,
                pathD,
                centroid,
                bounds,
                feature
            });
        });
        
        state.totalCountries = state.countries.size;
    }

    function isEuropeanCountry(id, name) {
        // Check by ID
        if (CONFIG.EUROPEAN_COUNTRIES.includes(id)) return true;
        
        // Check by name (fallback)
        const europeanNames = [
            'albania', 'andorra', 'austria', 'belarus', 'belgium', 'bosnia', 
            'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia',
            'finland', 'france', 'germany', 'greece', 'hungary', 'iceland',
            'ireland', 'italy', 'kosovo', 'latvia', 'liechtenstein', 'lithuania',
            'luxembourg', 'macedonia', 'malta', 'moldova', 'monaco', 'montenegro',
            'netherlands', 'norway', 'poland', 'portugal', 'romania', 'russia',
            'san marino', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden',
            'switzerland', 'ukraine', 'united kingdom', 'vatican', 'uk', 'britain'
        ];
        
        const nameLower = name.toLowerCase();
        return europeanNames.some(n => nameLower.includes(n));
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
        
        // Calculate the "correct" center area (where Europe should be assembled)
        const centerX = width / 2;
        const centerY = height / 2;
        const safeRadius = Math.min(width, height) * 0.25;
        
        state.clusters.forEach(cluster => {
            let x, y;
            let attempts = 0;
            
            // Generate random position avoiding the center
            do {
                x = padding + Math.random() * (width - 2 * padding) - width / 2;
                y = padding + Math.random() * (height - 2 * padding) - height / 2;
                attempts++;
            } while (
                Math.sqrt(x * x + y * y) < safeRadius && 
                attempts < 50
            );
            
            // Random rotation
            const rotation = (Math.random() - 0.5) * CONFIG.ROTATION_RANGE * 2;
            
            cluster.transform = { x, y, rotation };
            updateClusterTransform(cluster.element, cluster.transform);
        });
    }

    function mergeClusters(clusterA, clusterB) {
        // Merge B into A
        const a = state.clusters.get(clusterA);
        const b = state.clusters.get(clusterB);
        
        if (!a || !b) return;
        
        // Update cluster membership
        b.members.forEach(countryId => {
            a.members.add(countryId);
            state.countryToCluster.set(countryId, clusterA);
        });
        
        // Move paths from B to A
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
        
        // Remove cluster B
        b.element.remove();
        state.clusters.delete(clusterB);
        
        // Update aria label
        a.element.setAttribute('aria-label', getClusterLabel(a));
        
        // Play sound
        playSound('correct');
        
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
                    }
                });
            });
        });
        
        if (bestSnap) {
            // Animate snap
            animateSnap(draggedCluster, bestSnap.requiredTransform, () => {
                mergeClusters(bestSnap.targetClusterId, draggedClusterId);
            });
            return true;
        }
        
        return false;
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
        playSound('wrong');
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
        document.getElementById('btn-music').addEventListener('click', toggleMusic);
        document.getElementById('btn-hint').addEventListener('click', showHint);
        document.getElementById('btn-close-panel').addEventListener('click', closeInfoPanel);
        document.getElementById('btn-restart').addEventListener('click', resetGame);
        
        // Accessibility mode toggle
        document.getElementById('click-mode-toggle').addEventListener('change', toggleClickMode);
        
        // Window resize
        window.addEventListener('resize', debounce(onResize, 250));
    }

    function onPointerDown(e) {
        const clusterElement = e.target.closest('.cluster-group');
        if (!clusterElement) return;
        
        const clusterId = parseInt(clusterElement.dataset.clusterId);
        const cluster = state.clusters.get(clusterId);
        if (!cluster) return;
        
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
        document.getElementById('info-fact').textContent = info.fact || 'Informazioni non disponibili.';
        
        // Flag
        const flagImg = document.getElementById('info-flag-img');
        const flagPath = info.flag || `assets/flags/${countryId}.png`;
        flagImg.src = flagPath;
        flagImg.alt = `Bandiera di ${info.name || country.name}`;
        flagImg.onerror = () => { flagImg.src = ''; };
        
        // Status
        const statusEl = document.getElementById('info-status');
        statusEl.innerHTML = isConnected
            ? '<span class="status-badge connected">✓ Collegato</span>'
            : '<span class="status-badge loose">○ Non collegato</span>';
        
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
        
        state.connectedCountries = maxClusterSize;
        
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
        playSound('correct');
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
        // Find a loose piece that can be attached somewhere
        let hintCluster = null;
        let targetCluster = null;
        
        state.clusters.forEach((cluster, clusterId) => {
            if (hintCluster) return;
            
            // Find a cluster that has adjacent pieces in another cluster
            cluster.members.forEach(countryId => {
                const neighbors = state.adjacencies.get(countryId) || new Set();
                
                neighbors.forEach(neighborId => {
                    const neighborClusterId = state.countryToCluster.get(neighborId);
                    if (neighborClusterId !== clusterId) {
                        hintCluster = cluster;
                        targetCluster = state.clusters.get(neighborClusterId);
                    }
                });
            });
        });
        
        if (hintCluster && targetCluster) {
            // Highlight both clusters
            hintCluster.element.classList.add('hint-highlight');
            targetCluster.element.classList.add('hint-highlight');
            
            setTimeout(() => {
                hintCluster.element.classList.remove('hint-highlight');
                targetCluster.element.classList.remove('hint-highlight');
            }, 2000);
        }
    }

    // =====================================================
    // AUDIO
    // =====================================================

    function toggleMusic() {
        state.musicEnabled = !state.musicEnabled;
        const btn = document.getElementById('btn-music');
        const audio = document.getElementById('audio-bg');
        
        if (state.musicEnabled) {
            audio.play().catch(() => {});
            btn.textContent = '🔊 Musica';
            btn.classList.remove('muted');
        } else {
            audio.pause();
            btn.textContent = '🔇 Musica';
            btn.classList.add('muted');
        }
    }

    function playSound(type) {
        try {
            const audioId = type === 'correct' ? 'audio-correct' : 'audio-wrong';
            const audio = document.getElementById(audioId);
            if (audio) {
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
        } catch (error) {
            // Silently fail if audio not available
        }
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
                <p class="loading-text" style="color: #ef4444;">❌ ${message}</p>
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
