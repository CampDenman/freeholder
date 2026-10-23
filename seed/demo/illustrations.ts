// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo's pictures: generated coastal illustrations (C1.38).
//
// The demo used to ship bands of gradient as "photographs", and every hero
// read as a blank placeholder to anyone evaluating the product. Real
// photographs cannot ship here — they would be somebody's copyright and
// megabytes in a repository people fork — so these are drawn: layered
// headlands, water, light and a few figures, generated from code at install
// time. They are original to this repository (Apache-2.0, like the rest of
// it), weigh a few kilobytes as SVG, and still exercise everything that
// matters: sharp rasterises them, the media pipeline builds AVIF and WebP
// renditions at every width, and pages reserve real intrinsic dimensions.

const W = 1600;
const H = 1067;
/**
 * Rasterised at 1200 × 800: wide enough for a wide image block, and small
 * enough that the media pipeline builds its 400 and 800 renditions without
 * the 1600-wide AVIF encode that dominated the playground's hourly reset.
 */
const OUT_W = 1200;
const OUT_H = 800;

/** Deterministic wobble so every ridge is irregular but identical per build. */
function ridge(seed: number, base: number, amplitude: number, steps = 24): string {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const points: string[] = [`0,${H}`];
  for (let i = 0; i <= steps; i += 1) {
    const x = (W / steps) * i;
    const y = base - Math.sin((i / steps) * Math.PI) * amplitude * 0.6 - next() * amplitude * 0.5;
    points.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  points.push(`${W},${H}`);
  return points.join(" ");
}

interface Palette {
  skyTop: string;
  skyBottom: string;
  sun: string;
  far: string;
  mid: string;
  near: string;
  water: string;
  shine: string;
}

const DUSK: Palette = {
  skyTop: "#24384d",
  skyBottom: "#e7b98f",
  sun: "#f6d7a8",
  far: "#5d7186",
  mid: "#3a4c60",
  near: "#1d2a37",
  water: "#4f6578",
  shine: "#f3cfa0",
};

const FOG: Palette = {
  skyTop: "#9fb0bb",
  skyBottom: "#e3e8ea",
  sun: "#f4f5f2",
  far: "#b9c5cc",
  mid: "#8a9ca8",
  near: "#4f6170",
  water: "#a9b8c1",
  shine: "#f2f4f3",
};

const DAWN: Palette = {
  skyTop: "#41587a",
  skyBottom: "#f2c6b4",
  sun: "#fde3c8",
  far: "#8a8fae",
  mid: "#5c6589",
  near: "#2c3352",
  water: "#6b7799",
  shine: "#fbd7c0",
};

function landscape(p: Palette, seed: number, extra = ""): string {
  const horizon = 690;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.skyTop}"/>
      <stop offset="1" stop-color="${p.skyBottom}"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.water}"/>
      <stop offset="1" stop-color="${p.near}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${p.sun}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${p.sun}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="1080" cy="560" r="260" fill="url(#glow)"/>
  <circle cx="1080" cy="560" r="62" fill="${p.sun}"/>
  <polygon points="${ridge(seed, horizon - 40, 160)}" fill="${p.far}" opacity="0.85"/>
  <polygon points="${ridge(seed + 7, horizon + 10, 120)}" fill="${p.mid}"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#sea)"/>
  ${[0, 1, 2, 3, 4, 5, 6]
    .map(
      (i) =>
        `<rect x="${960 - i * 18}" y="${horizon + 16 + i * 26}" width="${240 + i * 36}" height="3" rx="1.5" fill="${p.shine}" opacity="${(0.7 - i * 0.08).toFixed(2)}"/>`,
    )
    .join("\n  ")}
  <polygon points="0,${H} 0,${horizon + 120} 260,${horizon + 70} 520,${horizon + 150} 760,${H}" fill="${p.near}"/>
  ${extra}
</svg>`;
}

/** Two figures walking the tideline — the portrait session. */
function figures(colour: string): string {
  const person = (x: number, scale: number) => `
  <g transform="translate(${x} 860) scale(${scale})" fill="${colour}">
    <circle cx="0" cy="-118" r="16"/>
    <path d="M-18,-98 Q0,-108 18,-98 L24,-30 L12,-30 L8,40 L-8,40 L-12,-30 L-24,-30 Z"/>
  </g>`;
  return person(980, 1) + person(1030, 0.92);
}

/** The studio wall: a window onto the strait and prints drying in a row. */
function studio(): string {
  const prints = [0, 1, 2, 3, 4]
    .map((i) => {
      const x = 180 + i * 250;
      const tone = ["#c9b8a3", "#a7b4bf", "#d7c3b0", "#9fb1a5", "#c2c8cf"][i];
      return `<line x1="${x + 90}" y1="210" x2="${x + 90}" y2="250" stroke="#6b5a49" stroke-width="3"/>
  <rect x="${x}" y="250" width="180" height="230" fill="#f6f2ea"/>
  <rect x="${x + 16}" y="266" width="148" height="170" fill="${tone}"/>`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e9e4da"/>
  <rect y="760" width="${W}" height="${H - 760}" fill="#b49a7c"/>
  <rect y="752" width="${W}" height="10" fill="#8d7458"/>
  <line x1="120" y1="210" x2="1480" y2="210" stroke="#6b5a49" stroke-width="4"/>
  ${prints}
  <rect x="520" y="560" width="560" height="190" fill="#f6f2ea" stroke="#8d7458" stroke-width="10"/>
  <rect x="535" y="575" width="530" height="80" fill="#a9bccb"/>
  <rect x="535" y="655" width="530" height="80" fill="#6f879b"/>
  <line x1="800" y1="575" x2="800" y2="735" stroke="#8d7458" stroke-width="8"/>
</svg>`;
}

/** A wall calendar, open on a coastal month. */
function calendar(): string {
  const days = Array.from({ length: 35 }, (_, i) => {
    const x = 470 + (i % 7) * 96;
    const y = 640 + Math.floor(i / 7) * 62;
    return `<rect x="${x}" y="${y}" width="84" height="50" rx="4" fill="#f1ede5"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#d9dfe3"/>
  <rect x="440" y="120" width="720" height="880" rx="10" fill="#fbfaf6"/>
  <svg x="470" y="150" width="660" height="440" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${landscape(DAWN, 23).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
  ${days}
</svg>`;
}

/** A gift card on a linen ground. */
function giftCard(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e8e1d6"/>
  <g transform="rotate(-6 800 530)">
    <rect x="380" y="290" width="840" height="500" rx="28" fill="#24384d"/>
    <svg x="380" y="290" width="840" height="300" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${landscape(DUSK, 41).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
    <rect x="440" y="650" width="320" height="22" rx="11" fill="#f6d7a8"/>
    <rect x="440" y="700" width="200" height="16" rx="8" fill="#9fb0bb"/>
  </g>
</svg>`;
}

export const ILLUSTRATIONS = {
  coastline: () => landscape(DUSK, 11),
  portrait: () => landscape(DUSK, 17, figures("#1a2430")),
  studio,
  fog: () => landscape(FOG, 29),
  dawn: () => landscape(DAWN, 5),
  headland: () => landscape({ ...DUSK, skyBottom: "#c7d3da", sun: "#eef2f3" }, 37),
  calendar,
  giftCard,
};
