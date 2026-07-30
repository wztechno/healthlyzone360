import { createI18n } from '@healthy360/i18n';
import { render } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

/**
 * Test harness for the design system.
 *
 * Every component that owns intrinsic copy resolves it through i18next, so the tests render inside
 * a real instance loaded with the committed catalogues — not a stub that echoes keys. That is what
 * lets the same test assert, in English and then in Arabic, that a component renders *translated*
 * text rather than a key, which is the failure this catches.
 */
export type TestLocale = 'en' | 'ar';

/**
 * One instance per locale, reused across renders. A fresh i18next instance per render initialises
 * asynchronously and produces overlapping `act()` scopes, which turns unrelated assertions flaky.
 */
const instances = new Map<TestLocale, ReturnType<typeof createI18n>>();

export function makeTestI18n(locale: TestLocale = 'en') {
    const existing = instances.get(locale);
    if (existing !== undefined) return existing;
    const created = createI18n({ locale });
    instances.set(locale, created);
    return created;
}

export function withI18n(node: ReactNode, locale: TestLocale = 'en'): ReactElement {
    return <I18nextProvider i18n={makeTestI18n(locale)}>{node}</I18nextProvider>;
}

export async function renderWithI18n(
    node: ReactNode,
    locale: TestLocale = 'en',
): Promise<RenderResult> {
    return render(withI18n(node, locale));
}

/** Flattens a possibly-nested React Native `style` prop into one object. */
export function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
            (accumulator, entry) => ({ ...accumulator, ...flattenStyle(entry) }),
            {},
        );
    }
    if (style !== null && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

/**
 * Physical style keys and Tailwind utilities that must never appear.
 *
 * NativeWind resolves `className` through the Metro CSS pipeline, which does not run under Jest, so
 * the class string arrives at the rendered node untouched. That makes the class string itself the
 * honest thing to assert on: it is exactly what NativeWind will compile.
 */
export const BANNED_STYLE_KEYS = [
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
] as const;

const PHYSICAL_UTILITY =
    /(^|\s)(?:[a-z0-9-]+:)*-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-[^\s]*)?($|\s)/;

const DIRECTION_VARIANT = /(^|\s|:)(?:rtl|ltr):/;

export function assertLogicalClassName(className: unknown): void {
    if (typeof className !== 'string') return;
    expect(className).not.toMatch(PHYSICAL_UTILITY);
    expect(className).not.toMatch(DIRECTION_VARIANT);
}

export function assertLogicalStyle(style: unknown): void {
    const flat = flattenStyle(style);
    for (const key of BANNED_STYLE_KEYS) {
        expect(Object.keys(flat)).not.toContain(key);
    }
}

/** Walks a rendered subtree and asserts every node is direction-safe. */
export function assertSubtreeIsLogical(root: {
    readonly props: Record<string, unknown>;
    readonly children: readonly unknown[];
}): void {
    assertLogicalClassName(root.props['className']);
    assertLogicalStyle(root.props['style']);
    for (const child of root.children) {
        if (typeof child === 'object' && child !== null && 'props' in child) {
            assertSubtreeIsLogical(
                child as { props: Record<string, unknown>; children: readonly unknown[] },
            );
        }
    }
}
