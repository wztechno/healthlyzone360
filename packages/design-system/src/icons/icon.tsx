import { useIsRtl } from '@healthy360/i18n';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { drawIcon } from './icon-drawing';

/**
 * Icons.
 *
 * Phase 1 draws icons as typographic glyphs rather than pulling in `react-native-svg`. Two reasons,
 * both practical: an SVG library is a *native* module, which would mean a config plugin, an
 * expo-doctor entry and a rebuild of every development client for decorative artwork; and a glyph
 * inherits the surrounding text colour and size for free, which is what a design system wants
 * anyway. Every icon here is decorative — meaning always lives in an adjacent label — so nothing is
 * lost accessibly. Swapping the implementation later is a change to this one file.
 *
 * Direction: `chevronStart` / `chevronEnd` resolve their glyph from the *active locale*, not from a
 * CSS transform. That matters because the NativeWind spike found that inline logical style props do
 * not re-mirror on a live web `dir` change (notes/nativewind-spike.md §4) — but re-picking a
 * character does, since the component re-renders when the locale changes.
 *
 * ## Which characters are in bounds, and why it is not a block rule
 *
 * Nothing in this application sets a `fontFamily` on text, so an icon renders in the *platform's*
 * default font and whatever that font falls back to — Roboto then Noto on Android, not the bundled
 * Inter. A codepoint the platform cannot draw becomes a tofu box, and a tofu box in the top bar is
 * a visible defect on the first screen anybody sees.
 *
 * The tempting rule is "stay inside well-covered Unicode blocks". Measured against the fonts this
 * repository actually ships, that rule does not hold: `star` U+2605 and `warning` U+26A0 are both
 * Miscellaneous Symbols and both present in Inter, while `close` U+2715, `success` U+2714 and
 * `more` U+22EF are in blocks usually called safe and are absent from it. Coverage is a property of
 * the codepoint, not of the range it happens to fall in.
 *
 * So the real constraint is **age**, and it is enforced as an explicit reviewed list in
 * `icon.test.tsx` rather than as a range check that would pass characters nothing can draw. Every
 * glyph here comes from the repertoire that has been in system fonts for decades — Zapf Dingbats,
 * Geometric Shapes, the card suits, arrows, the cp437-heritage symbols. Four characters were
 * removed for failing that standard: `basket` was U+26C3 BLACK DRAUGHTS KING, `lock` U+26BF SQUARED
 * KEY, `filter` U+269F THREE LINES CONVERGING LEFT and `leaf` U+2766 FLORAL HEART — all obscure
 * enough that font vendors routinely skip them, and the first of those was semantically a checkers
 * piece sitting in the marketplace top bar.
 *
 * Adding a glyph means adding a line to that list, which is the point: the question gets asked once,
 * deliberately, instead of being discovered by a user.
 */
export const ICON_GLYPHS = {
    chevronForward: '›',
    chevronBackward: '‹',
    chevronDown: '⌄',
    chevronUp: '⌃',
    check: '✓',
    close: '✕',
    plus: '+',
    minus: '−',
    eye: '◉',
    eyeOff: '◌',
    warning: '⚠',
    info: 'ⓘ',
    error: '✖',
    success: '✔',
    offline: '⊘',
    menu: '☰',
    search: '⌕',
    user: '◍',
    device: '▭',
    organisation: '◈',
    branch: '◇',
    signOut: '⇥',
    refresh: '⟳',
    prototype: '◊',
    dot: '•',
    dotOutline: '◦',
    star: '★',
    starOutline: '☆',
    filter: '▽',
    calendar: '▤',
    more: '⋯',
    /*
     * The Catalogue's two row actions, closing the gap the Catalogue handoff's §10.0 left open.
     *
     * `pen` is the substitute that handoff names (§4.5). **`archive` is not** — it asks for `▤`,
     * which `calendar` above already holds, and the next candidate `▣` is `basket`; the test below
     * asserts a distinct glyph per name, and two names sharing a character is a row action that
     * looks like a date filter. `▥` is the nearest unclaimed mark in the same Geometric Shapes
     * block, so it carries the same coverage argument as the three neighbours already shipping.
     */
    pen: '✎',
    archive: '▥',
    /*
     * Closing the gap `consumer-items.ts` and `onboarding/steps.ts` both used to record.
     *
     * Still characters, not drawings. The handoff's §2.8 originally specified stroked 24×24 SVGs;
     * that was written without this file in front of it, and adopting it would have meant
     * `react-native-svg` — a native module, a config plugin, an expo-doctor entry and a rebuild of
     * every development client — to draw seven decorative marks. The reference art in the design
     * files indicates *meaning and weight*, not form, so the nearest glyph that carries the right
     * meaning is the right answer and approximate fidelity is the accepted outcome.
     *
     * Note what is deliberately absent: `search`, `filter`, `calendar`, `refresh` and `user`
     * already existed. Five of the eight the handoff lists were never missing.
     */
    basket: '▣',
    home: '⌂',
    plate: '◯',
    lock: '⊗',
    leaf: '♣',
    medicalCross: '✚',
    sparkle: '✧',
    sun: '☀',
    moon: '☾',
    /*
     * The time-field trigger (Workbench handoff §1b). On the web it is drawn — see
     * `icon-drawing.web.tsx` — and this character is the native fallback, from the same Geometric
     * Shapes block as `archive` and `basket`.
     */
    clock: '◷',
    /*
     * The sort direction on a table header. These two were already shipping as bare text in the
     * Catalogue's column headers, so their coverage is proven; naming them lets the web draw them.
     */
    arrowUp: '↑',
    arrowDown: '↓',
} as const;

export type IconGlyphName = keyof typeof ICON_GLYPHS;

/** Names that follow the writing direction instead of a fixed side. */
export const DIRECTIONAL_ICON_NAMES = ['chevronStart', 'chevronEnd'] as const;
export type DirectionalIconName = (typeof DIRECTIONAL_ICON_NAMES)[number];

/**
 * Names that exist to be drawn — the workspace module rail's marks, the list pages' stat-card
 * marks and the kitchen modules' own marks, from Lucide (ISC). Each has no character of its own: on native, where nothing is drawn, it
 * falls back to a glyph the reviewed repertoire already holds — the one its call sites carried
 * before, as near as one name allows — so the repertoire does not grow by characters nobody needs.
 */
export const DRAWN_ICON_FALLBACKS = {
    dashboard: 'home',
    receipt: 'basket',
    clipboardCheck: 'check',
    chefHat: 'leaf',
    tag: 'organisation',
    package: 'calendar',
    shield: 'lock',
    userCircle: 'user',
    list: 'calendar',
    fileDraft: 'eyeOff',
    hidden: 'eyeOff',
    alert: 'warning',
    languages: 'warning',
    coins: 'warning',
    circleCheck: 'check',
    circleX: 'error',
    truck: 'user',
    wallet: 'basket',
    utensils: 'plate',
    cookingPot: 'calendar',
    layers: 'check',
    wheat: 'basket',
    circleHelp: 'info',
    handshake: 'lock',
    ban: 'dotOutline',
    infoCircle: 'info',
    trendingUp: 'calendar',
    trendingDown: 'warning',
    trendFlat: 'minus',
    send: 'basket',
    lockOpen: 'eyeOff',
    clipboardList: 'calendar',
    shoppingCart: 'basket',
    packageCheck: 'check',
    percent: 'check',
    calendarDays: 'calendar',
    listChecks: 'calendar',
    banknote: 'calendar',
    chartColumn: 'calendar',
    calculator: 'menu',
    bookOpen: 'calendar',
    shoppingBag: 'device',
    droplet: 'device',
    salad: 'device',
    snowflake: 'device',
    wheatOff: 'warning',
    fileText: 'menu',
    calendarRange: 'calendar',
    mapPin: 'filter',
    boxes: 'menu',
    packageOpen: 'branch',
    notebookText: 'menu',
    scrollText: 'calendar',
    badgeCheck: 'search',
    users: 'user',
    keyRound: 'lock',
    layoutGrid: 'basket',
    funnel: 'filter',
    searchLens: 'search',
    /*
     * The workspace's marks — `/workspace`'s tiles and the workspace pages. Each falls back to the
     * glyph its tile or page carried, so native reads as it did; `shieldPlus` alone takes `branch`,
     * because `lock` went to `handshake` first and the tiles must stay distinct on native too.
     */
    store: 'home',
    heartPulse: 'user',
    apple: 'leaf',
    stethoscope: 'medicalCross',
    monitor: 'device',
    bike: 'basket',
    building: 'organisation',
    shieldPlus: 'branch',
    settings: 'prototype',
    monitorSmartphone: 'device',
    smartphone: 'device',
    swatchBook: 'prototype',
} as const satisfies Readonly<Record<string, IconGlyphName>>;
export type DrawnIconName = keyof typeof DRAWN_ICON_FALLBACKS;

export type IconName = IconGlyphName | DirectionalIconName | DrawnIconName;

export const ICON_SIZES = ['sm', 'md', 'lg'] as const;
export type IconSize = (typeof ICON_SIZES)[number];

const SIZE_CLASS: Readonly<Record<IconSize, string>> = {
    sm: 'text-xs',
    md: 'text-base',
    lg: 'text-xl',
};

export interface IconProps extends Omit<TextProps, 'children' | 'className' | 'style'> {
    readonly name: IconName;
    readonly size?: IconSize | undefined;
    readonly className?: string | undefined;
    /**
     * Only set this when the icon is the *sole* carrier of meaning. Everywhere else leave it off:
     * the icon is then hidden from assistive technology and the adjacent text does the talking.
     */
    readonly label?: string | undefined;
    readonly testID?: string | undefined;
}

export function resolveIconGlyph(name: IconName, isRtl: boolean): string {
    if (name === 'chevronEnd') {
        return isRtl ? ICON_GLYPHS.chevronBackward : ICON_GLYPHS.chevronForward;
    }
    if (name === 'chevronStart') {
        return isRtl ? ICON_GLYPHS.chevronForward : ICON_GLYPHS.chevronBackward;
    }
    if (name in DRAWN_ICON_FALLBACKS) {
        return ICON_GLYPHS[DRAWN_ICON_FALLBACKS[name as DrawnIconName]];
    }
    return ICON_GLYPHS[name as IconGlyphName];
}

export function Icon({ name, size = 'md', className, label, testID, ...rest }: IconProps) {
    const isRtl = useIsRtl();
    const decorative = label === undefined;

    /*
     * Six action names are drawn rather than typed on the web (Workbench handoff §1a): the row
     * actions `eye` / `pen` / `archive`, the overflow `more`, and the picker triggers `calendar` /
     * `clock`. A character cannot carry the stroke the design asks for, and a stroked SVG inherits
     * the text colour exactly as the glyph does. Native keeps the glyph — `react-native-svg` is a
     * native module this file has already declined — so `drawIcon` answers `null` there.
     *
     * The workspace rail's marks (`DRAWN_ICON_FALLBACKS`, plus `signOut`) are drawn the same way,
     * and they and the three row actions are Lucide's drawings rather than the handoff's.
     */
    const drawing = drawIcon(name, size, className, decorative ? undefined : label, testID, isRtl);
    if (drawing !== null) return drawing;

    return (
        <Text
            {...rest}
            testID={testID}
            className={cx(SIZE_CLASS[size], 'leading-none', className)}
            accessible={!decorative}
            accessibilityElementsHidden={decorative}
            importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
            aria-hidden={decorative}
            {...(decorative ? {} : { accessibilityRole: 'image', accessibilityLabel: label })}
        >
            {resolveIconGlyph(name, isRtl)}
        </Text>
    );
}
