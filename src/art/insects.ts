import type { AntType } from '../sim/ants';
import type { ColonyId } from '../sim/state';

/**
 * Ants and spiders as SVG, drawn top-down facing +x (to the right), centred
 * on (0,0) in a 100 x 70 (ants) / 100 x 100 (spiders) viewBox. Each walk
 * frame differs only in leg angles: frame 0 is the standing pose, frames 1
 * and 2 swing alternate tripods of legs (L1 R2 L3 vs R1 L2 R3), as real ants
 * walk.
 */

interface Palette {
  base: string;
  light: string;
  dark: string;
  legs: string;
}

const PALETTES: Record<ColonyId, Palette> = {
  black: { base: '#2a2a31', light: '#6a6a78', dark: '#0c0c0f', legs: '#1a1a1f' },
  red: { base: '#b13a20', light: '#f0844f', dark: '#5e170b', legs: '#6b2111' },
};

interface Shape {
  gaster: [rx: number, ry: number];
  thorax: [rx: number, ry: number];
  head: [rx: number, ry: number];
  mandible: number;
  wings: boolean;
}

const SHAPES: Record<AntType, Shape> = {
  worker: { gaster: [14, 10.5], thorax: [8.5, 5], head: [7.5, 7], mandible: 5, wings: false },
  soldier: { gaster: [14, 11], thorax: [9, 5.5], head: [11, 10.5], mandible: 9, wings: false },
  queen: { gaster: [20, 13], thorax: [11, 7], head: [8, 7.5], mandible: 5, wings: true },
};

/** Ant SVG for one walk frame (0 = standing, 1/2 = mid-stride). */
export function antSvg(colony: ColonyId, type: AntType, frame: number, width: number, height: number): string {
  const p = PALETTES[colony];
  const sh = SHAPES[type];
  const gx = -8 - sh.gaster[0];
  const tx = 3;
  const hx = tx + sh.thorax[0] + sh.head[0] - 1;

  // Legs attach along the thorax: front, middle, back.
  const legSpecs = [
    { x: tx + 5, angle: 55, l1: 11, l2: 12, bend: -25 },
    { x: tx, angle: 95, l1: 12, l2: 13, bend: 5 },
    { x: tx - 5, angle: 135, l1: 12, l2: 15, bend: 22 },
  ];
  const swing = frame === 0 ? 0 : 14;
  let legs = '';
  for (const side of [-1, 1]) {
    legSpecs.forEach((leg, i) => {
      // Tripod gait: L1, R2, L3 swing together, then R1, L2, R3.
      const group = (i % 2 === 0) === (side === -1) ? 1 : -1;
      const dir = frame === 2 ? -group : group;
      const a = ((leg.angle + swing * dir) * Math.PI) / 180;
      const b = ((leg.angle + swing * dir + leg.bend) * Math.PI) / 180;
      const kx = leg.x + Math.cos(a) * leg.l1;
      const ky = side * Math.sin(a) * leg.l1;
      const fx = kx + Math.cos(b) * leg.l2;
      const fy = ky + side * Math.sin(b) * leg.l2;
      legs += `<path d="M${leg.x} ${side * 2} L${kx.toFixed(1)} ${ky.toFixed(1)} L${fx.toFixed(1)} ${fy.toFixed(1)}" />`;
    });
  }

  const antennae = [-1, 1]
    .map((s) => {
      const bx = hx + 4;
      return `<path d="M${bx} ${s * 3} Q${bx + 4} ${s * 10} ${bx + 9} ${s * 11} T${bx + 17} ${s * 8}" />`;
    })
    .join('');

  const m = sh.mandible;
  const mandibles = [-1, 1]
    .map(
      (s) =>
        `<path d="M${hx + sh.head[0] - 2} ${s * 3} Q${hx + sh.head[0] + m * 0.6} ${s * (3 + m * 0.4)} ${hx + sh.head[0] + m} ${s * 0.8}" />`,
    )
    .join('');

  const wings = sh.wings
    ? `<g fill="#e8f2ff" fill-opacity="0.38" stroke="#ffffff" stroke-opacity="0.6" stroke-width="0.8">
        <ellipse cx="${tx - 16}" cy="-9" rx="20" ry="6.5" transform="rotate(14 ${tx - 16} -9)"/>
        <ellipse cx="${tx - 16}" cy="9" rx="20" ry="6.5" transform="rotate(-14 ${tx - 16} 9)"/>
      </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-50 -35 100 70">
  <defs>
    <radialGradient id="g" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="${p.light}"/><stop offset="0.45" stop-color="${p.base}"/><stop offset="1" stop-color="${p.dark}"/>
    </radialGradient>
  </defs>
  <g stroke="${p.legs}" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round">${legs}</g>
  <g stroke="${p.legs}" stroke-width="1.3" fill="none" stroke-linecap="round">${antennae}</g>
  <g stroke="${p.dark}" stroke-width="2.4" fill="none" stroke-linecap="round">${mandibles}</g>
  <ellipse cx="${gx}" cy="0" rx="${sh.gaster[0]}" ry="${sh.gaster[1]}" fill="url(#g)" stroke="${p.dark}" stroke-width="1"/>
  <path d="M${gx - sh.gaster[0] * 0.35} ${-sh.gaster[1] * 0.9} Q${gx - sh.gaster[0] * 0.5} 0 ${gx - sh.gaster[0] * 0.35} ${sh.gaster[1] * 0.9}
           M${gx + sh.gaster[0] * 0.15} ${-sh.gaster[1] * 0.97} Q${gx} 0 ${gx + sh.gaster[0] * 0.15} ${sh.gaster[1] * 0.97}"
        stroke="${p.dark}" stroke-opacity="0.55" stroke-width="1" fill="none"/>
  <ellipse cx="-6" cy="0" rx="3" ry="2.6" fill="${p.base}" stroke="${p.dark}" stroke-width="0.8"/>
  <ellipse cx="${tx}" cy="0" rx="${sh.thorax[0]}" ry="${sh.thorax[1]}" fill="url(#g)" stroke="${p.dark}" stroke-width="1"/>
  ${wings}
  <ellipse cx="${hx}" cy="0" rx="${sh.head[0]}" ry="${sh.head[1]}" fill="url(#g)" stroke="${p.dark}" stroke-width="1"/>
  <ellipse cx="${hx + sh.head[0] * 0.35}" cy="${-sh.head[1] * 0.6}" rx="1.8" ry="1.3" fill="#0a0a0a"/>
  <ellipse cx="${hx + sh.head[0] * 0.35}" cy="${sh.head[1] * 0.6}" rx="1.8" ry="1.3" fill="#0a0a0a"/>
</svg>`;
}

/** Spider SVG, facing +x, for one walk frame (0 or 1). */
export function spiderSvg(frame: number, size: number): string {
  // Four legs per side, attached around the cephalothorax at (8, 0).
  const specs = [
    { angle: 40, l1: 16, l2: 20, bend: -35 },
    { angle: 75, l1: 17, l2: 19, bend: -10 },
    { angle: 110, l1: 17, l2: 19, bend: 15 },
    { angle: 145, l1: 16, l2: 21, bend: 35 },
  ];
  let legs = '';
  for (const side of [-1, 1]) {
    specs.forEach((leg, i) => {
      const group = (i % 2 === 0) === (side === -1) ? 1 : -1;
      const d = frame === 0 ? group * 9 : -group * 9;
      const a = ((leg.angle + d) * Math.PI) / 180;
      const b = ((leg.angle + d + leg.bend) * Math.PI) / 180;
      const rx = 8 + Math.cos(a) * 4;
      const ry = side * Math.sin(a) * 4;
      const kx = rx + Math.cos(a) * leg.l1;
      const ky = ry + side * Math.sin(a) * leg.l1;
      const fx = kx + Math.cos(b) * leg.l2;
      const fy = ky + side * Math.sin(b) * leg.l2;
      legs += `<path d="M${rx.toFixed(1)} ${ry.toFixed(1)} L${kx.toFixed(1)} ${ky.toFixed(1)} L${fx.toFixed(1)} ${fy.toFixed(1)}"/>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100">
  <defs>
    <radialGradient id="ab" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#8a6aa0"/><stop offset="0.5" stop-color="#3d2a4d"/><stop offset="1" stop-color="#1a1022"/>
    </radialGradient>
    <radialGradient id="ce" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#7a5c8f"/><stop offset="1" stop-color="#24182e"/>
    </radialGradient>
  </defs>
  <g stroke="#24182e" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round">${legs}</g>
  <ellipse cx="-14" cy="0" rx="19" ry="15.5" fill="url(#ab)" stroke="#120a18" stroke-width="1.2"/>
  <path d="M-26 0 L-20 -4 L-14 0 L-20 4 Z M-14 0 L-8 -5 L-2 0 L-8 5 Z" fill="#c8a8dc" fill-opacity="0.55"/>
  <ellipse cx="10" cy="0" rx="12" ry="10" fill="url(#ce)" stroke="#120a18" stroke-width="1.2"/>
  <g fill="#ff5a5a"><circle cx="19" cy="-3" r="1.6"/><circle cx="19" cy="3" r="1.6"/></g>
  <g fill="#ffd0d0"><circle cx="17" cy="-6" r="1"/><circle cx="17" cy="6" r="1"/><circle cx="21" cy="-1" r="0.9"/><circle cx="21" cy="1" r="0.9"/></g>
  <g stroke="#120a18" stroke-width="2" stroke-linecap="round"><path d="M21 -3 L25 -2"/><path d="M21 3 L25 2"/></g>
</svg>`;
}
