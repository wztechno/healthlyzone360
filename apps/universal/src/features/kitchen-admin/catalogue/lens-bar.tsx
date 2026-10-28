import type { BarcodeScan } from '@healthy360/api-client/contracts';
import { Icon, Menu, SearchInput, Skeleton, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { CameraScanButton } from '../camera-scan-button.tsx';

/**
 * The Lens bar — a list page's figures, filters and actions as one object. It replaces the stat
 * cards and the toolbar under them (`catalogue-stat-cards.tsx`, `catalogue-toolbar.tsx`).
 *
 * ```
 * ┌───────────────────────────────────────────────────────────────────────────────────────┐
 * │ (All recipes 111) │ ● Published 29  ● Draft 80  ● Awaiting review 2 │ ◉ On sale 99   [+ New] │
 * ├▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆┤ <- the mix
 * │ [Kind All ▾] │ [⌕ Search recipes      ] [Status: Draft ×]        18 of 111  Clear │ ▤ ▦ ⫴ │
 * └───────────────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * - **Figures** are the cards' numbers on one line, each at its label's size. A figure with
 *   `onPress` is a filter: pressing it does what the number is about, and the one in force sits
 *   in a soft brand pill. (An underline was tried first; it ran into the mix directly below.)
 * - **The mix** is a 4px strip under the figures — how the list divides between its states, at a
 *   glance. It doubles as the rule between the two rows.
 * - **The query row** is scope (kind, category), search, the filters in force as removable tokens,
 *   the result count with one Clear, and the view controls.
 *
 * Colour is spent only on the dots, the mix and a figure that blocks work (`alarm`): red appears
 * nowhere else on the bar. Every row starts on the same 16px edge, so the figures and the search
 * line up. 16px rather than the design's 20: five figures and three actions then hold one line
 * beside the issue tray on a laptop.
 */

export type LensTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface LensFigure {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** `null` while the figure is still in flight — a placeholder holds its line. */
    readonly value: number | null;
    /** The dot's tone. Omit for the scope's total, which carries no dot. */
    readonly tone?: LensTone | undefined;
    /** A mark in place of the dot — the On sale eye. */
    readonly icon?: IconName | undefined;
    /** The figure is the filter in force. */
    readonly active?: boolean | undefined;
    /** Draws the figure in the danger ink while it is above zero: it blocks work. */
    readonly alarm?: boolean | undefined;
    /** A hairline before this figure, to start a new group. */
    readonly separated?: boolean | undefined;
    /** Makes the figure a filter. Omit for one with no filter behind it. */
    readonly onPress?: (() => void) | undefined;
    /** Required with `onPress`: names what pressing does. */
    readonly accessibilityLabel?: string | undefined;
}

export interface LensMixPart {
    readonly key: string;
    readonly value: number;
    readonly tone: LensTone;
    /** Faded: another part is the filter in force. */
    readonly dimmed?: boolean | undefined;
}

export interface LensToken {
    readonly key: string;
    /** Translated — "Status: Draft". */
    readonly label: string;
    readonly onRemove: () => void;
    readonly removeLabel: string;
}

export interface LensBarProps {
    /** Translated. The bar's accessible name. */
    readonly label: string;
    readonly figures: readonly LensFigure[];
    readonly mix?: readonly LensMixPart[] | undefined;
    /** Translated. What the mix says, for a screen reader. */
    readonly mixLabel?: string | undefined;
    /** Import, Export, the page's primary — at the figures' inline end. */
    readonly actions?: ReactNode | undefined;

    /** The scope pickers, before the search — kind, category. */
    readonly scope?: ReactNode | undefined;
    readonly search: string;
    readonly onSearchChange: (search: string) => void;
    readonly searchLabel: string;
    readonly searchPlaceholder?: string | undefined;
    readonly onScan?: ((scan: BarcodeScan) => void) | undefined;
    readonly tokens?: readonly LensToken[] | undefined;
    /** "18 of 111". `null` while the page is in flight. */
    readonly result: string | null;
    /** Drawn only while something is filtered. */
    readonly onClear?: (() => void) | undefined;
    readonly clearLabel: string;
    /**
     * Layout switch, column picker — at the query row's inline end. A function is told whether the
     * bar is narrow, so it can draw its controls as icons and keep the row on one line.
     */
    readonly trailing?: ReactNode | ((narrow: boolean) => ReactNode) | undefined;
    readonly testID: string;
}

/**
 * Below this the query row cannot hold the labelled view controls beside the search — what is left
 * of a laptop's page with the issue tray open. A full-width page stays well above it.
 */
const NARROW_BAR_WIDTH = 1000;

const DOT_CLASS: Readonly<Record<LensTone, string>> = {
    brand: 'bg-surface-brand',
    success: 'bg-success',
    warning: 'bg-warning-border',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-stroke-strong',
};

const BAR_CLASS: Readonly<Record<LensTone, string>> = {
    brand: 'bg-surface-brand',
    success: 'bg-success',
    warning: 'bg-warning-border',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-stroke',
};

export function LensBar({
    label,
    figures,
    mix,
    mixLabel,
    actions,
    scope,
    search,
    onSearchChange,
    searchLabel,
    searchPlaceholder,
    onScan,
    tokens = [],
    result,
    onClear,
    clearLabel,
    trailing,
    testID,
}: LensBarProps) {
    const mixTotal = mix?.reduce((sum, part) => sum + part.value, 0) ?? 0;
    // Wide until measured: a bare render (and every test) draws the labelled controls.
    const [narrow, setNarrow] = useState(false);
    const trailingNode = typeof trailing === 'function' ? trailing(narrow) : trailing;

    return (
        // `z-10`: RN-Web makes every View a stacking context at 0, so without a rank of its own the
        // bar — and every menu its pickers open — would sit under the list drawn after it.
        <View
            testID={testID}
            role="region"
            aria-label={label}
            onLayout={(event) => {
                setNarrow(event.nativeEvent.layout.width < NARROW_BAR_WIDTH);
            }}
            className="z-10 rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card"
        >
            {/*
             * `ps-2`: the pills carry 8px of their own, so their text starts on the query row's
             * 16px edge.
             */}
            <View
                className={`z-auto flex-row flex-wrap items-center gap-y-tight py-tight pe-snug ${
                    narrow ? 'ps-2.5' : 'ps-2'
                }`}
            >
                <View
                    testID={`${testID}-figures`}
                    className={`flex-row flex-wrap items-center ${narrow ? '' : 'gap-0.5'}`}
                >
                    {figures.map((figure) => (
                        <LensFigureCell
                            key={figure.key}
                            figure={figure}
                            narrow={narrow}
                            testID={`${testID}-figure-${figure.key}`}
                        />
                    ))}
                </View>
                {actions === undefined || actions === null ? null : (
                    <View
                        testID={`${testID}-actions`}
                        className="z-auto ms-auto flex-row items-center gap-tight ps-2"
                    >
                        {actions}
                    </View>
                )}
            </View>

            {/*
             * The mix, which is also the rule between the rows. Before the counts land — or on an
             * empty list — it is a plain hairline, so the bar's height never changes.
             */}
            <View
                testID={`${testID}-mix`}
                role="img"
                aria-label={mixLabel}
                className="h-1 flex-row gap-0.5 bg-surface-raised"
            >
                {mix === undefined || mixTotal === 0 ? (
                    // eslint-disable-next-line no-restricted-syntax -- the strip *is* the row; not a control.
                    <View className="h-px flex-1 self-end bg-brand-100" />
                ) : (
                    mix
                        .filter((part) => part.value > 0)
                        .map((part) => (
                            /*
                             * Each part's share of the strip as a percentage width, the issue
                             * tray's progress bar's own shape; `shrink` gives back the 2px gaps.
                             */
                            <View
                                key={part.key}
                                testID={`${testID}-mix-${part.key}`}
                                className={`h-1 shrink ${BAR_CLASS[part.tone]} ${part.dimmed === true ? 'opacity-25' : ''}`}
                                style={{ width: `${(part.value / mixTotal) * 100}%` }}
                            />
                        ))
                )}
            </View>

            <View className="z-auto flex-row flex-wrap items-center gap-tight py-tight pe-snug ps-4">
                {scope === undefined || scope === null ? null : (
                    <View className="z-auto flex-row items-center gap-tight">{scope}</View>
                )}
                {/* eslint-disable-next-line no-restricted-syntax -- the search absorbs the row; the exempt case. */}
                <View className="flex-1" style={{ minWidth: SEARCH_MIN_WIDTH }}>
                    <SearchInput
                        value={search}
                        onChangeText={onSearchChange}
                        label={searchLabel}
                        placeholder={searchPlaceholder}
                        size="sm"
                        testID={`${testID}-search`}
                    />
                </View>
                {onScan === undefined ? null : (
                    <CameraScanButton testID={`${testID}-camera`} onScan={onScan} />
                )}
                {tokens.map((token) => (
                    <View
                        key={token.key}
                        testID={`${testID}-token-${token.key}`}
                        className="h-control-sm flex-row items-center gap-1 rounded bg-surface-brand-subtle pe-1 ps-2.5"
                    >
                        <Text variant="label" tone="brand" numberOfLines={1}>
                            {token.label}
                        </Text>
                        <Pressable
                            testID={`${testID}-token-${token.key}-remove`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={token.removeLabel}
                            onPress={token.onRemove}
                            className="h-6 w-6 items-center justify-center rounded-sm hover:bg-brand-100"
                        >
                            <Icon name="close" size="sm" className="text-content-on-brand-subtle" />
                        </Pressable>
                    </View>
                ))}
                <View className="flex-row items-center gap-tight">
                    {result === null ? (
                        <Skeleton heightClassName="h-4" widthClassName="w-16" />
                    ) : (
                        <Text
                            testID={`${testID}-result`}
                            variant="body"
                            tone="secondary"
                            role="status"
                            className="tabular-nums"
                        >
                            {result}
                        </Text>
                    )}
                    {onClear === undefined ? null : (
                        <Pressable
                            testID={`${testID}-clear`}
                            role="button"
                            accessibilityRole="button"
                            onPress={onClear}
                            className="h-control-sm justify-center rounded px-2 hover:bg-brand-50"
                        >
                            <Text variant="strong" tone="brand">
                                {clearLabel}
                            </Text>
                        </Pressable>
                    )}
                </View>
                {trailingNode === undefined || trailingNode === null ? null : (
                    <>
                        <View aria-hidden className="mx-1 h-5 w-px bg-brand-100" />
                        <View className="z-auto flex-row items-center gap-tight">
                            {trailingNode}
                        </View>
                    </>
                )}
            </View>
        </View>
    );
}

export interface LensViewOption<T extends string> {
    readonly value: T;
    /** Translated — the option's accessible name, since only its glyph is drawn. */
    readonly label: string;
    readonly icon: IconName;
    readonly testID?: string | undefined;
}

/**
 * Table · Cards as two glyphs — the layout switch for a narrow Lens bar, where the labelled
 * segmented control would push the query row onto a second line.
 */
export function LensViewSwitch<T extends string>({
    label,
    value,
    onChange,
    options,
    testID,
}: {
    readonly label: string;
    readonly value: T;
    readonly onChange: (value: T) => void;
    readonly options: readonly LensViewOption<T>[];
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            role="radiogroup"
            aria-label={label}
            className="h-control-sm flex-row items-center gap-0.5 rounded border border-brand-100 bg-surface-base p-0.5"
        >
            {options.map((option) => {
                const on = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        testID={option.testID}
                        role="radio"
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ checked: on }}
                        onPress={() => {
                            onChange(option.value);
                        }}
                        className={`h-6 w-7 items-center justify-center rounded-sm ${
                            on ? 'bg-surface-brand-subtle' : 'hover:bg-surface-sunken'
                        }`}
                    >
                        <Icon
                            name={option.icon}
                            size="sm"
                            className={
                                on ? 'text-content-on-brand-subtle' : 'text-content-secondary'
                            }
                        />
                    </Pressable>
                );
            })}
        </View>
    );
}

export interface LensScopeOption<T extends string> {
    readonly value: T;
    readonly label: string;
    /** Shown beside the label in the menu; omit when the server could not count it. */
    readonly count?: number | undefined;
    readonly icon?: IconName | undefined;
    readonly testID?: string | undefined;
}

/**
 * A scope picker for the query row — "Kind  All ▾". A scope is not a filter: Clear leaves it, and it
 * is never a token, because it is the part of the catalogue the reader chose to stand in.
 */
export function LensScope<T extends string>({
    label,
    value,
    options,
    onChange,
    testID,
}: {
    readonly label: string;
    readonly value: T;
    readonly options: readonly LensScopeOption<T>[];
    readonly onChange: (value: T) => void;
    readonly testID: string;
}) {
    const current = options.find((option) => option.value === value);

    return (
        <Menu
            testID={testID}
            label={label}
            maxHeight={SCOPE_MENU_MAX_HEIGHT}
            sections={[
                {
                    items: options.map((option) => ({
                        key: option.value,
                        label:
                            option.count === undefined
                                ? option.label
                                : `${option.label} · ${String(option.count)}`,
                        icon: option.icon,
                        selected: option.value === value,
                        testID: option.testID,
                        onSelect: () => {
                            onChange(option.value);
                        },
                    })),
                },
            ]}
            trigger={({ triggerProps, toggle }) => (
                <Pressable
                    {...triggerProps}
                    testID={`${testID}-trigger`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={`${label}: ${current?.label ?? ''}`}
                    onPress={toggle}
                    className="h-control-sm flex-row items-center gap-1.5 rounded border border-brand-100 bg-surface-base pe-1.5 ps-2.5 hover:border-brand-300"
                >
                    <Text variant="body" tone="secondary">
                        {label}
                    </Text>
                    <Text variant="strong" numberOfLines={1}>
                        {current?.label ?? ''}
                    </Text>
                    <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                </Pressable>
            )}
        />
    );
}

/** Long enough for a category tree's top level without the menu running off a laptop screen. */
const SCOPE_MENU_MAX_HEIGHT = 360;

/** The narrowest the search gives way to: an order number and a short name. */
const SEARCH_MIN_WIDTH = 200;

/** A space the layout cannot collapse, so an otherwise empty line still takes its full height. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

function LensFigureCell({
    figure,
    narrow,
    testID,
}: {
    readonly figure: LensFigure;
    /** Beside the issue tray: 6px pills instead of 8, so the actions keep the first line. */
    readonly narrow: boolean;
    readonly testID: string;
}) {
    const active = figure.active === true;
    const value = figure.value;
    const alarm = figure.alarm === true && value !== null && value > 0;
    const zero = value === 0 && figure.tone !== undefined;
    const tone = figure.tone;

    /*
     * One line — mark, label, number — with the number at the label's own size and set apart by
     * weight alone. The figure in force is a soft brand pill rather than an underline, so nothing
     * on this row touches the mix drawn under it.
     */
    const body = (
        <>
            {figure.icon !== undefined ? (
                <Icon name={figure.icon} size="sm" className="text-content-on-brand-subtle" />
            ) : tone === undefined ? null : (
                <View
                    aria-hidden
                    className={
                        zero
                            ? 'h-2 w-2 rounded-full border border-stroke-strong'
                            : `h-2 w-2 rounded-full ${DOT_CLASS[tone]}`
                    }
                />
            )}
            <Text variant="label" tone={active ? 'primary' : 'secondary'} numberOfLines={1}>
                {figure.label}
            </Text>
            {value === null ? (
                // The number's own line box with nothing in it, so the bar is its loaded height.
                <View testID={`${testID}-loading`} className="flex-row items-center">
                    <Text variant="label" aria-hidden>
                        {NO_BREAK_SPACE}
                    </Text>
                    <Skeleton heightClassName="h-3" widthClassName="w-6" />
                </View>
            ) : (
                <Text
                    testID={`${testID}-value`}
                    variant="label"
                    tone={alarm ? 'danger' : zero ? 'secondary' : 'primary'}
                    className="font-semibold tabular-nums"
                >
                    {String(value)}
                </Text>
            )}
        </>
    );

    const cellClass = `h-control-sm flex-row items-center gap-1.5 rounded ${narrow ? 'px-1.5' : 'px-2'} ${
        active ? 'bg-surface-brand-subtle' : ''
    }`;

    return (
        <>
            {figure.separated === true ? (
                <View aria-hidden className="mx-0.5 h-4 w-px self-center bg-brand-100" />
            ) : null}
            {figure.onPress === undefined ? (
                <View testID={testID} className={cellClass}>
                    {body}
                </View>
            ) : (
                <Pressable
                    testID={testID}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={`${figure.label} ${value === null ? '' : String(value)}`.trim()}
                    accessibilityHint={figure.accessibilityLabel}
                    accessibilityState={{ selected: active }}
                    onPress={figure.onPress}
                    className={`${cellClass} ${active ? '' : 'hover:bg-surface-sunken'}`}
                >
                    {body}
                </Pressable>
            )}
        </>
    );
}
