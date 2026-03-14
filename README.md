# The EU Puzzle

An interactive puzzle to reconstruct the European Union (27 member states) using real geographical borders.

## Features
- **27 Countries to Connect**: EU member states only.
- **Automatic Snap**: Countries lock in place when moved near correct neighbors.
- **Facts & Trivia**: 10 random facts for each country.
- **Main Menu**: Starting interface to launch the game.
- **Interactive Tutorial**: Step-by-step guide to learn how to play.
- **Sound Effects & Music**: Soundtrack and audio feedback during gameplay.
- **Updated Interface**: High-contrast colors (ocean blues and green countries) with improved zoom.

## Difficulty Modes

The game offers three difficulty levels to suit different skill levels:

### Easy Mode
- Country silhouettes are displayed as guides on the map.
- Drag countries near their correct positions and they snap automatically to their silhouettes.
- Perfect for beginners or those learning European geography.

### Medium Mode
- No visual guides; you must rely on geographical adjacency.
- Countries automatically snap together when positioned near their correct neighboring countries.
- Requires knowledge of which countries are adjacent to each other.

### Hard Mode
- No guides and countries are randomly rotated (0°, 90°, 180°, or 270°).
- You must manually rotate pieces by right-clicking them.
- Countries only snap when both positioned correctly AND rotated to approximately 0°.
- For experienced players seeking a true challenge.

## Installation & Setup
1. Ensure you have Node.js installed.
2. Clone the repository.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the project:
   ```bash
   npm run dev
   ```
5. Open **http://localhost:3000** in your browser.

## Technologies
- **D3.js** & **TopoJSON** for map management.
- **Node.js** for build scripting. 
