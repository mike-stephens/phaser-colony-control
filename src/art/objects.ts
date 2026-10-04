import type { FoodKind } from '../sim/food';
import type { ColonyId } from '../sim/state';

/**
 * Props as SVG, top-down, centred in a 100 x 100 viewBox (-50..50).
 * Deterministic: shapes come from a small seeded generator, so the art is
 * identical every load.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svg = (size: number, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100"><defs>${defs}</defs>${body}</svg>`;

/** An irregular rounded blob path around (cx, cy). */
function blob(r: () => number, cx: number, cy: number, radius: number, wobble: number, points = 9): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = radius * (1 - wobble / 2 + r() * wobble);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  // Smooth closed curve through the points (midpoint quadratic smoothing).
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += i === 0 ? `M${mx.toFixed(1)} ${my.toFixed(1)}` : '';
    const [nx, ny] = pts[(i + 1) % pts.length];
    const [ax, ay] = pts[(i + 2) % pts.length];
    d += ` Q${nx.toFixed(1)} ${ny.toFixed(1)} ${((nx + ax) / 2).toFixed(1)} ${((ny + ay) / 2).toFixed(1)}`;
  }
  return d + 'Z';
}

const stoneGradient = (id: string, light: string, mid: string, dark: string) =>
  `<radialGradient id="${id}" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`;

export function foodSvg(kind: FoodKind, size: number): string {
  const r = rng(kind.length * 977 + 13);
  switch (kind) {
    case 'crumbs': {
      let body = '';
      const spots = [[0, 0, 22], [-24, 14, 11], [22, -16, 12], [18, 22, 9], [-20, -20, 8], [-30, -2, 6], [30, 6, 6]];
      for (const [x, y, s] of spots) {
        body += `<path d="${blob(r, x, y, s, 0.5, 7)}" fill="url(#crust)" stroke="#8a5a22" stroke-width="1.5"/>`;
        body += `<path d="${blob(r, x - s * 0.15, y - s * 0.15, s * 0.6, 0.5, 6)}" fill="#f6e3b0" fill-opacity="0.8"/>`;
      }
      return svg(size, body, stoneGradient('crust', '#f3d48c', '#d29d55', '#8a5a22'));
    }
    case 'seeds': {
      let body = '';
      const seeds = [[-14, -6, 20], [12, -12, -30], [4, 14, 70], [-20, 18, 120], [24, 14, 160]];
      for (const [x, y, rot] of seeds) {
        body += `<g transform="translate(${x} ${y}) rotate(${rot})">
          <path d="M-16 0 Q-12 -9 0 -8 Q14 -6 16 0 Q14 6 0 8 Q-12 9 -16 0Z" fill="#3a3530" stroke="#1d1a17" stroke-width="1.2"/>
          <path d="M-12 -3 Q2 -6 14 -1 M-12 3 Q2 6 14 1" stroke="#e8e2d4" stroke-width="1.6" fill="none" stroke-linecap="round"/>
          <path d="M-14 0 L15 0" stroke="#cfc6b4" stroke-width="1" />
        </g>`;
      }
      return svg(size, body);
    }
    case 'berries': {
      let body = `<path d="M6 -26 Q22 -40 34 -30 Q26 -18 10 -22Z" fill="#4c8a3a" stroke="#2c5a22" stroke-width="1.2"/>
        <path d="M8 -24 L30 -31" stroke="#2c5a22" stroke-width="1"/>`;
      const berries = [[-8, -6, 16], [14, 2, 15], [-2, 18, 15], [-24, 12, 12], [20, -16, 10]];
      for (const [x, y, s] of berries) {
        body += `<circle cx="${x}" cy="${y}" r="${s}" fill="url(#berry)" stroke="#5e0a2a" stroke-width="1.2"/>
          <ellipse cx="${x - s * 0.35}" cy="${y - s * 0.4}" rx="${s * 0.28}" ry="${s * 0.18}" fill="#ffffff" fill-opacity="0.65"/>`;
      }
      return svg(size, body, stoneGradient('berry', '#f06292', '#c2185b', '#6d0d33'));
    }
    case 'carcass': {
      // A dead spider on its back: pale belly, legs curled in.
      let legs = '';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const x1 = Math.cos(a) * 16;
        const y1 = Math.sin(a) * 14;
        const x2 = Math.cos(a + 0.5) * 30;
        const y2 = Math.sin(a + 0.5) * 26;
        const x3 = Math.cos(a + 1.2) * 22;
        const y3 = Math.sin(a + 1.2) * 18;
        legs += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${x2.toFixed(1)} ${y2.toFixed(1)} ${x3.toFixed(1)} ${y3.toFixed(1)}"/>`;
      }
      return svg(
        size,
        `<g stroke="#4a3a52" stroke-width="3" fill="none" stroke-linecap="round">${legs}</g>
         <ellipse cx="-6" cy="0" rx="20" ry="16" fill="#8d7a96" stroke="#3a2a44" stroke-width="1.5"/>
         <ellipse cx="14" cy="0" rx="11" ry="9" fill="#a593ad" stroke="#3a2a44" stroke-width="1.5"/>
         <path d="M-18 -4 L-2 4 M-18 4 L-2 -4" stroke="#5a4a64" stroke-width="2" stroke-linecap="round"/>`,
      );
    }
  }
}

/** Heap of pebbles that can be carried off to build walls. */
export function pebblePileSvg(size: number): string {
  const r = rng(4242);
  let body = '';
  const stones = [[-18, 10, 13], [14, 14, 12], [0, -6, 15], [-22, -16, 9], [22, -14, 10], [2, 24, 8], [-6, 8, 9]];
  stones.forEach(([x, y, s], i) => {
    const tone = ['#9c968c', '#8a8a86', '#a8a196', '#7d7a74'][i % 4];
    body += `<path d="${blob(r, x, y, s, 0.35, 8)}" fill="${tone}" stroke="#3f3d3a" stroke-width="1.4"/>
      <path d="${blob(r, x - s * 0.25, y - s * 0.3, s * 0.45, 0.4, 6)}" fill="#ffffff" fill-opacity="0.25"/>`;
  });
  return svg(size, body);
}

/** One wall tile: a packed heap of pebbles, slightly tinted per colony. */
export function wallSvg(colony: ColonyId, size: number): string {
  const r = rng(colony === 'black' ? 777 : 778);
  const tones =
    colony === 'black' ? ['#8e8a84', '#a19c94', '#77736d', '#b3ada3'] : ['#a08a80', '#b39a8e', '#8a7066', '#c4aa9c'];
  let body = `<rect x="-48" y="-48" width="96" height="96" rx="14" fill="#5a524a"/>`;
  for (let i = 0; i < 18; i++) {
    const x = -36 + (i % 5) * 18 + r() * 8 - 4;
    const y = -36 + Math.floor(i / 5) * 22 + r() * 8 - 4;
    const s = 11 + r() * 6;
    body += `<path d="${blob(r, x, y, s, 0.35, 8)}" fill="${tones[i % 4]}" stroke="#3a3530" stroke-width="1.6"/>
      <path d="${blob(r, x - s * 0.3, y - s * 0.3, s * 0.4, 0.4, 6)}" fill="#ffffff" fill-opacity="0.22"/>`;
  }
  return svg(size, body);
}

/** Nest mound: a ring of excavated soil around a dark entrance. */
export function nestSvg(colony: ColonyId, size: number): string {
  const r = rng(colony === 'black' ? 31 : 32);
  const soil = colony === 'black' ? ['#8a6b47', '#6e5236', '#a8875c'] : ['#9a5f3e', '#7a432a', '#c07a52'];
  let crumbs = '';
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 22 + r() * 22;
    crumbs += `<circle cx="${(Math.cos(a) * d).toFixed(1)}" cy="${(Math.sin(a) * d).toFixed(1)}" r="${(1.5 + r() * 2.5).toFixed(1)}" fill="${soil[i % 3]}"/>`;
  }
  return svg(
    size,
    `<path d="${blob(r, 0, 0, 44, 0.18, 14)}" fill="url(#mound)" stroke="${soil[1]}" stroke-width="1.5"/>
     ${crumbs}
     <ellipse cx="0" cy="0" rx="13" ry="11" fill="url(#hole)"/>`,
    `<radialGradient id="mound" cx="0.45" cy="0.4" r="0.6"><stop offset="0" stop-color="${soil[2]}"/><stop offset="0.6" stop-color="${soil[0]}"/><stop offset="1" stop-color="${soil[1]}"/></radialGradient>
     <radialGradient id="hole" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#050302"/><stop offset="0.7" stop-color="#1c120a"/><stop offset="1" stop-color="${soil[1]}"/></radialGradient>`,
  );
}

/** A collapsed nest. */
export function ruinSvg(size: number): string {
  const r = rng(99);
  let rubble = '';
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 36;
    rubble += `<path d="${blob(r, Math.cos(a) * d, Math.sin(a) * d, 4 + r() * 5, 0.5, 6)}" fill="${['#6a5a4a', '#57493c', '#7d6d5b'][i % 3]}"/>`;
  }
  return svg(
    size,
    `<path d="${blob(r, 0, 0, 40, 0.3, 12)}" fill="#4d4034" fill-opacity="0.85"/>${rubble}
     <path d="M-6 -4 L4 2 L-2 8" stroke="#2a2018" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  );
}
