import { InputManager } from './input';

/** Key bindings, also used to render the help overlay. */
export const KEY_BINDINGS: { keys: string; action: string }[] = [
  { keys: 'W / S', action: 'Collective up / down' },
  { keys: '↑ / ↓', action: 'Cyclic forward (nose down) / aft (nose up)' },
  { keys: '← / →', action: 'Cyclic left / right (bank)' },
  { keys: 'A / D', action: 'Pedals (yaw), optional' },
  { keys: 'T', action: 'Select next landing area ahead' },
  { keys: 'C', action: 'Cockpit / chase camera' },
  { keys: 'Mouse drag', action: 'Look around' },
  { keys: 'P / Esc', action: 'Pause' },
  { keys: 'M', action: 'Mute' },
];

export function attachKeyboard(input: InputManager, target: Window = window) {
  const held = new Set<string>();
  const axis = (neg: string[], pos: string[]) => (pos.some((k) => held.has(k)) ? 1 : 0) - (neg.some((k) => held.has(k)) ? 1 : 0);

  const refresh = () => {
    input.keyCollective = axis(['KeyS'], ['KeyW']);
    // ArrowUp pushes the cyclic forward: nose down (negative pitch input).
    input.keyPitch = axis(['ArrowUp', 'KeyI'], ['ArrowDown', 'KeyK']);
    input.keyRoll = axis(['ArrowLeft', 'KeyJ'], ['ArrowRight', 'KeyL']);
    input.keyPedal = axis(['KeyA'], ['KeyD']);
  };

  const flightKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'Space']);

  target.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (flightKeys.has(e.code)) e.preventDefault();
    input.mode = 'keyboard';
    if (!e.repeat) {
      switch (e.code) {
        case 'KeyT':
          input.emit('cycleTarget');
          break;
        case 'KeyC':
          input.emit('camera');
          break;
        case 'KeyP':
        case 'Escape':
          input.emit('pause');
          break;
        case 'KeyR':
          input.emit('restart');
          break;
        case 'KeyM':
          input.emit('mute');
          break;
        case 'Enter':
          input.emit('confirm');
          break;
      }
    }
    held.add(e.code);
    refresh();
  });
  target.addEventListener('keyup', (e) => {
    held.delete(e.code);
    refresh();
  });
  target.addEventListener('blur', () => {
    held.clear();
    refresh();
  });
}
