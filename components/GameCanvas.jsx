'use client';

import { useEffect, useRef } from 'react';
import { createGame } from '../lib/game/game.js';

/**
 * Thin React shell around the framework-free game engine (sim + Three.js
 * world + DOM UI). The engine owns everything inside #cb-root; React just
 * mounts / unmounts it. Boot failures are surfaced on-screen.
 */
export default function GameCanvas() {
  const rootRef = useRef(null);

  useEffect(() => {
    let game;
    try {
      game = createGame(null, rootRef.current);
      return () => game.destroy();
    } catch (err) {
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0e1420;color:#e8eef7;font:15px/1.6 sans-serif;padding:24px;text-align:center;z-index:99';
      box.innerHTML =
        '<div style="max-width:520px"><h2 style="margin:0 0 10px">⚠️ The game failed to start</h2>' +
        '<p style="margin:0 0 10px;opacity:.75">Please send a screenshot of this message.</p>' +
        '<pre style="white-space:pre-wrap;background:#131a29;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px;text-align:left;font-size:12px;color:#ff9c9c">' +
        String(err && err.stack ? err.stack : err).slice(0, 800) +
        '</pre></div>';
      rootRef.current.appendChild(box);
    }
  }, []);

  return (
    <div id="cb-root" ref={rootRef}>
      <noscript>This game requires JavaScript.</noscript>
    </div>
  );
}
