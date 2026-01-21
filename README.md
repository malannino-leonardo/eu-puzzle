# Puzzle Europa

Un puzzle interattivo per ricostruire l'Europa con i confini reali dei paesi. Trascina i pezzi e attaccali ai paesi confinanti per completare il continente!

![Puzzle Europa Screenshot](assets/screenshot.png)

## Come Giocare

1. **Trascina** un paese (pezzo del puzzle) sulla board
2. **Avvicinalo** a un paese confinante reale (es. Italia > Svizzera)
3. Se la posizione è corretta, i pezzi si **agganciano automaticamente**
4. I pezzi agganciati formano un **cluster** che si muove insieme
5. **Clicca** su un paese per vedere informazioni, capitale e curiosità
6. Completa il puzzle connettendo **tutti i paesi europei**!

## Avvio Rapido

### Metodo 1: Server statico semplice (consigliato)

```bash
# Con Python (già installato su Mac/Linux)
python -m http.server 8000

# OPPURE con Python 2
python -m SimpleHTTPServer 8000

# OPPURE con Node.js
npx serve .
```

Poi apri: **http://localhost:8000**

### Metodo 2: Con Live Reload (sviluppo)

```bash
# Installa dipendenze
npm install

# Avvia con live-server
npm run dev
```

Poi apri: **http://localhost:3000**

### Metodo 3: Aprire direttamente

Su alcuni browser puoi aprire `index.html` direttamente, ma potresti avere problemi CORS nel caricamento dei dati JSON. Si consiglia un server locale.

## Struttura Progetto

```
progetto-europa/
├── index.html          # Pagina principale
├── styles.css          # Stili CSS
├── app.js              # Logica di gioco principale
├── package.json        # Configurazione npm
├── README.md           # Questo file
│
├── data/
│   ├── countries.json  # Info paesi (capitale, curiosità, ecc.)
│   └── adjacencies.json # Relazioni di confine tra paesi
│
├── assets/
│   ├── flags/          # Bandiere dei paesi (PNG)
│   │   ├── it.png
│   │   ├── fr.png
│   │   └── ...
│   └── sfx/            # Effetti audio
│       ├── correct.mp3 # Suono aggancio corretto
│       ├── wrong.mp3   # Suono errore
│       └── bg.mp3      # Musica di sottofondo
│
└── scripts/
    └── build-map.js    # Script per pre-processare mappa (opzionale)
```

## Configurazione

### Modificare le soglie di snap

In `app.js`, nella sezione `CONFIG`:

```javascript
const CONFIG = {
    SNAP_THRESHOLD: 20,        // Pixel di distanza per aggancio
    ROTATION_RANGE: 30,        // Gradi di rotazione iniziale
    // ...
};
```

### Aggiungere/Modificare un paese

1. **Dati paese** - Modifica `data/countries.json`:

```json
{
    "id": "380",           // Codice ISO 3166-1 numerico
    "name": "Italia",
    "capital": "Roma",
    "population": "60 milioni",
    "area": "301.340 km²",
    "flag": "assets/flags/it.png",
    "fact": "Curiosità interessante..."
}
```

2. **Adiacenze** - Modifica `data/adjacencies.json`:

```json
{
    "380": ["250", "756", "040", "705"],  // Italia confina con Francia, Svizzera, Austria, Slovenia
    // ...
}
```

3. **Bandiera** - Aggiungi immagine in `assets/flags/` con nome del codice paese (es. `it.png`)

### Codici ISO dei paesi europei

| Paese | Codice | Paese | Codice |
|-------|--------|-------|--------|
| Albania | 008 | Lituania | 440 |
| Andorra | 020 | Lussemburgo | 442 |
| Austria | 040 | Macedonia Nord | 807 |
| Belgio | 056 | Malta | 470 |
| Bosnia | 070 | Moldavia | 498 |
| Bulgaria | 100 | Monaco | 492 |
| Bielorussia | 112 | Montenegro | 499 |
| Croazia | 191 | Paesi Bassi | 528 |
| Cipro | 196 | Norvegia | 578 |
| Rep. Ceca | 203 | Polonia | 616 |
| Danimarca | 208 | Portogallo | 620 |
| Estonia | 233 | Romania | 642 |
| Finlandia | 246 | Russia | 643 |
| Francia | 250 | San Marino | 674 |
| Germania | 276 | Serbia | 688 |
| Grecia | 300 | Slovacchia | 703 |
| Ungheria | 348 | Slovenia | 705 |
| Islanda | 352 | Spagna | 724 |
| Irlanda | 372 | Svezia | 752 |
| Italia | 380 | Svizzera | 756 |
| Lettonia | 428 | Ucraina | 804 |
| Liechtenstein | 438 | Regno Unito | 826 |
| Vaticano | 336 | | |

## Personalizzazione Stili

I colori principali sono definiti come CSS variables in `styles.css`:

```css
:root {
    --country-fill: #3b82f6;      /* Colore paese */
    --country-stroke: #1e40af;    /* Bordo paese */
    --country-hover: #60a5fa;     /* Hover paese */
    --country-selected: #fbbf24;  /* Paese selezionato */
    --success-color: #22c55e;     /* Snap corretto */
    --error-color: #ef4444;       /* Errore */
}
```

## Audio

Inserisci i file audio nella cartella `assets/sfx/`:

- `correct.mp3` - Riprodotto quando due pezzi si agganciano
- `wrong.mp3` - Riprodotto quando si tenta un aggancio non valido
- `bg.mp3` - Musica di sottofondo (loop)

Se i file non esistono, il gioco funziona comunque senza audio.

## Accessibilita

Il gioco supporta:

- **Modalità click**: Attiva la checkbox in basso a sinistra per usare click-to-select invece del drag
- **Navigazione tastiera**: Usa Tab per selezionare cluster, frecce per muovere, Enter/Spazio per agganciare
- **ARIA labels**: I paesi hanno etichette accessibili per screen reader
- **Focus visibile**: Indicatori visivi per la navigazione da tastiera

## Build Script (Opzionale)

Se vuoi pre-processare la mappa per ottimizzare il caricamento:

```bash
npm install
npm run build
```

Questo scarica il TopoJSON mondiale, filtra solo l'Europa e genera un file ottimizzato.

## Browser Supportati

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+
- Mobile: iOS Safari 13+, Chrome Android 80+

## Note Tecniche

- **Nessun framework pesante**: Solo D3.js (per geometrie) e TopoJSON-client (per parsing)
- **Pointer Events**: Supporto unificato per mouse, touch e stylus
- **SVG transforms**: Le trasformazioni sono applicate ai gruppi, non ai path, per performance ottimali
- **Cluster system**: I paesi agganciati condividono lo stesso gruppo SVG `<g>`

## Risoluzione Problemi

### "Failed to load map data"
- Verifica la connessione internet (il TopoJSON è caricato da CDN)
- Prova a ricaricare la pagina

### I paesi non si agganciano
- Devono essere paesi realmente confinanti
- La distanza deve essere inferiore alla soglia (20px default)
- Le trasformazioni devono corrispondere (allineamento corretto)

### Errori CORS
- Non aprire `index.html` direttamente da file://
- Usa un server locale (vedi "Avvio Rapido")

## Licenza

MIT License - Usa liberamente per scopi educativi e personali.

## Contributi

Contributi benvenuti! Puoi:
- Aggiungere più curiosità sui paesi
- Migliorare le bandiere
- Aggiungere effetti sonori
- Tradurre in altre lingue
- Segnalare bug

---

Buon divertimento con il Puzzle Europa!