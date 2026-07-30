import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import NativeWindSpikeScreen from '../app/index.tsx';
import { AppProviders } from '../src/providers.tsx';

/**
 * NativeWind spike — native render leg (plan §19).
 *
 * Two things are proven here:
 *   1. the spike screen renders under jest-expo with the workspace packages resolving from source;
 *   2. the direction-sensitive layout is expressed with **logical** properties only —
 *      `marginStart` / `paddingStart` / `borderStartWidth`, never `marginLeft` / `left`.
 *
 * The style-level assertion is the load-bearing one: NativeWind resolves `className` through the
 * Metro CSS pipeline, which does not run under Jest, so class names alone would prove nothing about
 * the rendered styles. The source-level scan at the bottom covers the class-name path instead.
 *
 * `render` is asynchronous in React Native Testing Library 14 and must be awaited before `screen`
 * is populated.
 */

const PHYSICAL_STYLE_KEYS = [
    'marginLeft',
    'marginRight',
    'paddingLeft',
    'paddingRight',
    'left',
    'right',
    'borderLeftWidth',
    'borderRightWidth',
    'borderLeftColor',
    'borderRightColor',
];

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
            (accumulator, entry) => ({ ...accumulator, ...flattenStyle(entry) }),
            {},
        );
    }
    if (style !== null && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

/** Fixed safe-area metrics: the test renderer never fires `onLayout`, so nothing would render. */
const TEST_METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function renderSpike() {
    return render(
        <AppProviders initialMetrics={TEST_METRICS}>
            <NativeWindSpikeScreen />
        </AppProviders>,
    );
}

describe('NativeWind spike screen', () => {
    it('renders every section of the spike', async () => {
        await renderSpike();

        expect(screen.queryByTestId('spike-screen')).not.toBeNull();
        for (const section of [
            'section-logical',
            'section-colour',
            'section-typography',
            'section-spacing',
            'section-elevation',
            'section-nutrition',
        ]) {
            expect(screen.queryByTestId(section)).not.toBeNull();
        }
    });

    it('renders translated copy rather than raw keys', async () => {
        await renderSpike();

        expect(screen.getByTestId('spike-title')).toHaveTextContent('NativeWind styling spike');
        expect(screen.getByTestId('current-direction')).toHaveTextContent(/Left to right$/);
    });

    it('lays the direction-sensitive row out with logical properties only', async () => {
        await renderSpike();

        const style = flattenStyle(screen.getByTestId('logical-row').props.style);

        expect(style.marginStart).toBe(16);
        expect(style.marginEnd).toBe(4);
        expect(style.paddingStart).toBe(12);
        expect(style.borderStartWidth).toBe(4);

        // React Native's logical text alignment follows the writing direction.
        const leading = flattenStyle(screen.getByTestId('logical-leading').props.style);
        expect(leading.textAlign).toBe('auto');

        // Physical direction properties must never appear — they do not mirror in Arabic.
        expect(
            PHYSICAL_STYLE_KEYS.filter(
                (key) => style[key] !== undefined || leading[key] !== undefined,
            ),
        ).toEqual([]);
    });

    it('renders both font families with their per-script line heights', async () => {
        await renderSpike();

        expect(flattenStyle(screen.getByTestId('sample-latin').props.style).lineHeight).toBe(27);
        expect(flattenStyle(screen.getByTestId('sample-arabic').props.style).lineHeight).toBe(32);
    });

    it('renders all six elevation levels with native shadow objects', async () => {
        await renderSpike();

        for (const level of [0, 1, 2, 3, 4, 5]) {
            const style = flattenStyle(screen.getByTestId(`elevation-${level}`).props.style);
            expect(style).toHaveProperty('shadowRadius');
            expect(style).toHaveProperty('elevation');
        }
    });

    it('renders every nutrition stop with its pattern name, not colour alone', async () => {
        await renderSpike();

        for (const [level, pattern] of [
            ['optimal', 'solid'],
            ['good', 'diagonal-sparse'],
            ['moderate', 'diagonal-dense'],
            ['high', 'crosshatch'],
            ['excessive', 'dots-dense'],
        ] as const) {
            expect(screen.getByTestId(`nutrition-${level}`)).toHaveTextContent(
                new RegExp(`${level}${pattern}`),
            );
        }
    });

    it('offers the theme and locale toggles the spike is judged on', async () => {
        await renderSpike();

        expect(screen.queryByTestId('toggle-theme')).not.toBeNull();
        expect(screen.queryByTestId('toggle-locale')).not.toBeNull();
    });
});

/**
 * Class-name leg of the RTL policy. The root ESLint rule enforces this at lint time; asserting it
 * here as well means the spike itself fails loudly if someone reaches for a physical utility.
 */
describe('spike screen source', () => {
    const source = readFileSync(join(__dirname, '..', 'app', 'index.tsx'), 'utf8');

    it('uses logical Tailwind utilities', () => {
        for (const utility of ['ps-', 'pe-', 'ms-', 'me-', 'border-s-', 'text-start']) {
            expect(source.includes(utility)).toBe(true);
        }
    });

    it('contains no physical direction utilities or direction variants', () => {
        const classNames = [...source.matchAll(/className="([^"]*)"/g)].flatMap((match) =>
            (match[1] ?? '').split(/\s+/).filter(Boolean),
        );

        expect(classNames.length).toBeGreaterThan(10);

        const banned =
            /^(?:[a-z0-9-]+:)*-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-.*)?$/;
        const variants = /(?:^|:)(?:rtl|ltr):/;

        const offenders = classNames.filter((name) => banned.test(name) || variants.test(name));
        expect(offenders).toEqual([]);
    });
});
