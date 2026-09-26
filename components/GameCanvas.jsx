'use client';

import { useEffect, useRef } from 'react';
import { createGame } from '../lib/game/engine.js';

/**
 * Thin React shell around the framework-free game engine.
 * The engine owns everything inside #cb-root (canvas, HUD, toolbar,
 * modals); React just mounts / unmounts it.
 */
export default function GameCanvas() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const game = createGame(canvasRef.current, rootRef.current);
    return () => game.destroy();
  }, []);

  return (
    <div id="cb-root" ref={rootRef}>
      <canvas ref={canvasRef} />
      <noscript>This game requires JavaScript.</noscript>
    </div>
  );
}
