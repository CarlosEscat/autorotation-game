// B612 is bundled with the game: no third-party request before first paint, and it works offline.
import '@fontsource/b612/latin-400.css';
import '@fontsource/b612/latin-700.css';
import './style.css';
import { Game } from './game/game';

const root = document.getElementById('app')!;
const game = new Game(root);
// Development only: lets a browser check place the helicopter. Stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;

// Block page scroll, pinch-zoom and the context menu while playing.
document.addEventListener(
  'touchmove',
  (e) => {
    // Menus and the debrief may scroll on small screens; nothing else may.
    if (!(e.target as HTMLElement).closest?.('.panel')) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Prefer landscape where the browser allows it (installed PWA / fullscreen).
const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
orientation?.lock?.('landscape').catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
  });
}
