import { createElement, useEffect } from 'react';
import { View } from 'react-native';

/**
 * The address preview's map, on the web — the Account board's: a street grid, three roads and a few
 * blocks across the canopy, with a pin in the middle that bobs while two rings pulse out from under
 * it. Drawn, not fetched: there is no map service behind it. It says "this is a place"; the words
 * under it say which.
 *
 * Every colour is a token variable, never a literal. The motion is CSS keyframes, so it costs no
 * JavaScript per frame, and `prefers-reduced-motion` stops it.
 */

const STYLE_ID = 'h360-address-map';
const STYLES = `
@keyframes h360-pin-ping{from{transform:scale(1);opacity:.9}to{transform:scale(5);opacity:0}}
@keyframes h360-pin-bob{0%,100%{transform:none}50%{transform:translateY(-4px)}}
.h360-pin-ring{position:absolute;top:-10px;left:-10px;width:20px;height:20px;border-radius:999px;border:2px solid rgb(var(--h360-color-stage-green));animation:h360-pin-ping 2.2s ease-out infinite}
.h360-pin-ring.h360-late{animation-delay:1.1s}
.h360-pin{position:absolute;top:-46px;left:-20px;width:40px;height:46px;color:rgb(var(--h360-color-stage-green));filter:drop-shadow(0 6px 10px rgb(0 0 0 / .35));animation:h360-pin-bob 3s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.h360-pin-ring,.h360-pin{animation:none}.h360-pin-ring{opacity:.5}}
`;

function useMapStyles(): void {
    useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.head.appendChild(style);
    }, []);
}

const ON_CANOPY = 'var(--h360-color-on-canopy)';
const STAGE_GREEN = 'var(--h360-color-stage-green)';

/** The grid's lines, every 36 units across a 400 × 220 field. */
const GRID = [
    ...Array.from({ length: 12 }, (_, index) => `M${String(index * 36)} 0V220`),
    ...Array.from({ length: 7 }, (_, index) => `M0 ${String(index * 36)}H400`),
];

const ROADS: readonly { readonly d: string; readonly width: number }[] = [
    { d: 'M-10 160C80 140 140 90 210 110S330 60 410 40', width: 10 },
    { d: 'M120 -10C130 60 170 120 160 230', width: 7 },
    { d: 'M260 230C250 170 300 120 410 130', width: 5 },
];

function streets() {
    return createElement(
        'svg',
        {
            viewBox: '0 0 400 220',
            preserveAspectRatio: 'xMidYMid slice',
            'aria-hidden': true,
            style: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
        },
        createElement(
            'g',
            { fill: 'none', stroke: `rgb(${ON_CANOPY} / .08)`, strokeWidth: 1 },
            ...GRID.map((d) => createElement('path', { key: d, d })),
        ),
        createElement(
            'g',
            { fill: 'none', stroke: `rgb(${ON_CANOPY} / .18)`, strokeLinecap: 'round' },
            ...ROADS.map((road) =>
                createElement('path', { key: road.d, d: road.d, strokeWidth: road.width }),
            ),
        ),
        createElement(
            'g',
            { fill: `rgb(${STAGE_GREEN} / .12)` },
            createElement('rect', { x: 30, y: 20, width: 60, height: 40, rx: 8 }),
            createElement('rect', { x: 290, y: 150, width: 70, height: 44, rx: 8 }),
            createElement('circle', { cx: 330, cy: 40, r: 22 }),
        ),
    );
}

function pin() {
    return createElement(
        'span',
        {
            'aria-hidden': true,
            style: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0 },
        },
        createElement('span', { className: 'h360-pin-ring' }),
        createElement('span', { className: 'h360-pin-ring h360-late' }),
        createElement(
            'svg',
            { className: 'h360-pin', viewBox: '0 0 40 46' },
            createElement('path', {
                d: 'M20 45s16-14 16-27A16 16 0 0 0 4 18c0 13 16 27 16 27z',
                fill: 'currentColor',
            }),
            createElement('circle', {
                cx: 20,
                cy: 18,
                r: 6,
                fill: 'rgb(var(--h360-color-surface-canopy))',
            }),
        ),
    );
}

export function AddressMap({ testID }: { readonly testID?: string | undefined }) {
    useMapStyles();
    return (
        <View testID={testID} aria-hidden className="relative h-[220px] overflow-hidden">
            {streets()}
            {pin()}
        </View>
    );
}
