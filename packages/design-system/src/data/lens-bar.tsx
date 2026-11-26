import { SearchInput } from '../forms/search-input.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { InfoTip } from '../overlays/info-tip.tsx';
import { Text } from '../primitives/text.tsx';
import { Skeleton } from '../status/skeleton.tsx';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

/**
 * The Lens bar — every admin list's toolbar: its figures, filters and actions as one object.
 *
 * ```
 *  (All recipes 111) (● Published 29) (● Draft 80) (● Awaiting review 2)      [Import] [+ New]
 * ╭──▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆──────────────────────────────────────────────────────────────╮
 * │ [Kind All ▾] [⌕ Search recipes                  ] [Status: Draft ×]  18 of 111 Clear  ▦ │
 * ├────────────────────────────────────────────────────────────────────────────────────────┤ <- the list, `joined`
 * ```
 *
 * - **Figures** stand on the page as chips, the actions at their end. A figure with `onPress` is a
 *   filter: pressing it does what the number is about, and the one in force is filled soft green.
 * - **The mix** rides the top edge of the query row's card — how the list divides between its
 *   states, at a glance.
 * - **The query row** is scope (kind, category, period), search, the filters in force as removable
 *   tokens, the result count with one Clear, and the view controls. It is the top of the list's
 *   card: the list under it passes `joined` and closes the card.
 *
 * Colour is spent only on the dots, the mix and a figure that blocks work (`alarm`).
 *
 * A row of figures without the rest — a home page's counts, a record's facts — is
 * {@link FigureChips}.
 */

export type LensTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface LensFigure {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** `null` while the figure is still in flight — a placeholder holds its line. */
    readonly value: number | null;
    /**
     * The figure as drawn, when it is not a plain count — a sum of money, a weight. The page owns the
     * numbering system, so it formats. `value` still decides the alarm and the hollow zero dot.
     */
    readonly display?: string | undefined;
    /** The dot's tone. Omit for the scope's total, which carries no dot. */
    readonly tone?: LensTone | undefined;
    /** A mark in place of the dot — the On sale eye. */
    readonly icon?: IconName | undefined;
    /** The figure is the filter in force. */
    readonly active?: boolean | undefined;
    /** Translated. Why the figure is what it is, behind an (i) beside it — never a line on the bar. */
    readonly info?: string | undefined;
    /**
     * Translated. A quiet word after the number — the planner's "×1.86", "+5 % waste". Drawn only
     * by the chip look (`LensFigureCell chip`), where the figure has room for it.
     */
    readonly note?: string | undefined;
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
    /** Omit the three for a page with nothing to search — a day's report, a window's totals. */
    readonly search?: string | undefined;
    readonly onSearchChange?: ((search: string) => void) | undefined;
    readonly searchLabel?: string | undefined;
    readonly searchPlaceholder?: string | undefined;
    /**
     * Enter in the search does something besides filter — a scan field that looks a code up. The
     * field keeps focus after it and stops correcting what is typed, because what is typed is a code.
     */
    readonly onSearchSubmit?: (() => void) | undefined;
    /** A scan button beside the search (the app's camera scanner) — the app owns the camera. */
    readonly scanAction?: ReactNode | undefined;
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
    /** The list under it passes `joined` too and closes the card. */
    readonly joined?: boolean | undefined;
    /** Banners between the figures and the card — a paused kitchen, a capped list. */
    readonly notice?: ReactNode | undefined;
    /**
     * The search holds a 300px pill and the count moves to the row's end (the Orders
     * canvas's `.srch.sm`), instead of the search absorbing the row.
     */
    readonly compactSearch?: boolean | undefined;
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
    onSearchSubmit,
    scanAction,
    tokens = [],
    result,
    onClear,
    clearLabel,
    trailing,
    joined = false,
    notice,
    compactSearch = false,
    testID,
}: LensBarProps) {
    const mixTotal = mix?.reduce((sum, part) => sum + part.value, 0) ?? 0;
    // Wide until measured: a bare render (and every test) draws the labelled controls.
    const [narrow, setNarrow] = useState(false);
    const trailingNode = typeof trailing === 'function' ? trailing(narrow) : trailing;

    return (
        <SplitLens
            label={label}
            figures={figures}
            mixParts={mixParts(mix, mixTotal, testID)}
            mixLabel={mixLabel}
            actions={actions}
            joined={joined}
            notice={notice}
            narrow={narrow}
            onNarrow={setNarrow}
            testID={testID}
        >
            <View className="z-auto flex-row flex-wrap items-center gap-tight p-2">
                {scope === undefined || scope === null ? null : (
                    <View className="z-auto flex-row flex-wrap items-center gap-tight">
                        {scope}
                    </View>
                )}
                {onSearchChange === undefined ? null : (
                    <View
                        className={compactSearch ? 'w-field shrink' : 'flex-1'}
                        style={{ minWidth: SEARCH_MIN_WIDTH }}
                    >
                        <SearchInput
                            value={search ?? ''}
                            onChangeText={onSearchChange}
                            label={searchLabel ?? ''}
                            placeholder={searchPlaceholder}
                            size="sm"
                            className="!h-desk-toolbar !rounded-full !border-transparent !bg-surface-sunken"
                            lens={compactSearch}
                            {...(onSearchSubmit === undefined
                                ? {}
                                : {
                                      onSubmitEditing: onSearchSubmit,
                                      blurOnSubmit: false,
                                      autoCorrect: false,
                                      autoCapitalize: 'none' as const,
                                  })}
                            testID={`${testID}-search`}
                        />
                    </View>
                )}
                {scanAction}
                <LensTokens tokens={tokens} testID={testID} />
                {result === null ? (
                    <Skeleton heightClassName="h-4" widthClassName="w-16" />
                ) : (
                    <Text
                        testID={`${testID}-result`}
                        variant="label"
                        tone="secondary"
                        role="status"
                        className={`!text-role-body font-semibold tabular-nums ${
                            compactSearch ? 'ms-auto' : ''
                        }`}
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
                {trailingNode === undefined || trailingNode === null ? null : (
                    <View className="z-auto ms-auto flex-row items-center gap-tight">
                        {trailingNode}
                    </View>
                )}
            </View>
        </SplitLens>
    );
}

/** The filters in force, each removable on its own — in the query row. */
function LensTokens({
    tokens,
    testID,
}: {
    readonly tokens: readonly LensToken[];
    readonly testID: string;
}) {
    return (
        <>
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
        </>
    );
}

/**
 * Each part's share of the strip as a percentage width, the issue tray's progress bar's own shape;
 * `shrink` gives back the 2px gaps. `null` before the counts land, or on an empty list.
 */
function mixParts(
    mix: readonly LensMixPart[] | undefined,
    total: number,
    testID: string,
): ReactNode[] | null {
    if (mix === undefined || total === 0) return null;
    return mix
        .filter((part) => part.value > 0)
        .map((part) => (
            <View
                key={part.key}
                testID={`${testID}-mix-${part.key}`}
                className={`h-1 shrink ${BAR_CLASS[part.tone]} ${part.dimmed === true ? 'opacity-25' : ''}`}
                style={{ width: `${(part.value / total) * 100}%` }}
            />
        ));
}

/**
 * The bar's frame.
 *
 * ```
 *  (Open now 16) (● Past due 3) (● Needs a driver 8)            [Pause kitchen ▾] [+ New order]
 * ╭──▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆──────────────────────────────────────────────────────────────╮
 * │ [Today|Overdue|Next 7 days] [From] [To] (Placed) (Confirmed) [Kind All ▾] [⌕ …] 16 of 16 ▦ │
 * ├────────────────────────────────────────────────────────────────────────────────────────┤ <- the list, `joined`
 * ```
 *
 * The figures stand on the page as chips with the actions at their end; the query row is the top
 * of the list's card, and the mix rides that card's top edge, inset from its corners.
 */
function SplitLens({
    label,
    figures,
    mixParts: parts,
    mixLabel,
    actions,
    joined,
    notice,
    narrow,
    onNarrow,
    testID,
    children,
}: {
    readonly notice: ReactNode;
    readonly label: string;
    readonly figures: readonly LensFigure[];
    readonly mixParts: ReactNode[] | null;
    readonly mixLabel: string | undefined;
    readonly actions: ReactNode;
    readonly joined: boolean;
    readonly narrow: boolean;
    readonly onNarrow: (narrow: boolean) => void;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    return (
        <View
            testID={testID}
            role="region"
            aria-label={label}
            onLayout={(event) => {
                onNarrow(event.nativeEvent.layout.width < NARROW_BAR_WIDTH);
            }}
            className="z-10 flex-col gap-3"
        >
            {figures.length === 0 && (actions === undefined || actions === null) ? null : (
                <View className="z-auto flex-row flex-wrap items-center gap-tight">
                    <View
                        testID={`${testID}-figures`}
                        className="min-w-0 shrink flex-row flex-wrap items-center gap-1.5"
                    >
                        {figures.map((figure) => (
                            <LensFigureCell
                                key={figure.key}
                                figure={figure}
                                narrow={narrow}
                                chip
                                testID={`${testID}-figure-${figure.key}`}
                            />
                        ))}
                    </View>
                    {actions === undefined || actions === null ? null : (
                        <View
                            testID={`${testID}-actions`}
                            className="z-auto ms-auto flex-row items-center gap-2"
                        >
                            {actions}
                        </View>
                    )}
                </View>
            )}
            {notice}
            <View
                className={`z-auto border border-stroke-subtle bg-surface-raised ${
                    joined ? 'rounded-t-panel border-b-0' : 'rounded-panel'
                }`}
            >
                <View
                    testID={`${testID}-mix`}
                    role="img"
                    aria-label={mixLabel}
                    className="absolute -top-px end-4 start-4 h-1 flex-row gap-0.5 overflow-hidden rounded-b-sm"
                >
                    {parts}
                </View>
                {children}
            </View>
        </View>
    );
}

/** The query row carries scope pickers before the search, so the search gives way early. */
const SEARCH_MIN_WIDTH = 150;

/** A space the layout cannot collapse, so an otherwise empty line still takes its full height. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

export function LensFigureCell({
    figure,
    narrow,
    chip = false,
    fill = false,
    testID,
}: {
    readonly figure: LensFigure;
    /** Beside the issue tray: 6px pills instead of 8, so the actions keep the first line. */
    readonly narrow: boolean;
    /** The Lens bar's look: each figure a bordered chip standing on the page. Off for a record's facts, drawn inline. */
    readonly chip?: boolean | undefined;
    /**
     * With `chip`: the chip takes its cell's whole width and the number moves to its end, so a
     * grid of chips reads as label | value columns (the batch planner's summary).
     */
    readonly fill?: boolean | undefined;
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
            <Text
                variant="label"
                tone={active ? 'primary' : 'secondary'}
                numberOfLines={1}
                className={
                    chip
                        ? `!text-role-body font-semibold ${active ? '!text-content-on-brand-subtle' : ''}`
                        : ''
                }
            >
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
                    className={
                        chip
                            ? `!text-role-body font-bold tabular-nums ${active ? '!text-content-on-brand-subtle' : ''} ${fill ? 'ms-auto' : ''}`
                            : 'font-semibold tabular-nums'
                    }
                >
                    {figure.display ?? String(value)}
                </Text>
            )}
            {chip && figure.note !== undefined && value !== null ? (
                <Text
                    testID={`${testID}-note`}
                    variant="caption"
                    tone={active ? 'primary' : 'secondary'}
                    numberOfLines={1}
                    className={`tabular-nums ${active ? '!text-content-on-brand-subtle' : ''}`}
                >
                    {figure.note}
                </Text>
            ) : null}
        </>
    );

    // Beside the press target, never inside it: a button cannot hold a button.
    const info =
        figure.info === undefined ? null : (
            <InfoTip label={figure.label} text={figure.info} testID={`${testID}-info`} />
        );

    const cellClass = chip
        ? `h-10 flex-row items-center gap-2 rounded-xl border px-[14px] web:transition-colors ${
              active
                  ? 'border-surface-brand bg-surface-brand-subtle'
                  : 'border-stroke-subtle bg-surface-raised'
          }`
        : `h-control-sm flex-row items-center gap-1.5 rounded ${narrow ? 'px-1.5' : 'px-2'} ${
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
                    {info}
                </View>
            ) : info !== null ? (
                <View className={cellClass}>
                    <Pressable
                        testID={testID}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={`${figure.label} ${value === null ? '' : (figure.display ?? String(value))}`.trim()}
                        accessibilityHint={figure.accessibilityLabel}
                        accessibilityState={{ selected: active }}
                        onPress={figure.onPress}
                        className="flex-row items-center gap-2"
                    >
                        {body}
                    </Pressable>
                    {info}
                </View>
            ) : (
                <Pressable
                    testID={testID}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={`${figure.label} ${value === null ? '' : (figure.display ?? String(value))}`.trim()}
                    accessibilityHint={figure.accessibilityLabel}
                    accessibilityState={{ selected: active }}
                    onPress={figure.onPress}
                    className={`${cellClass} ${
                        active ? '' : chip ? 'hover:border-stroke' : 'hover:bg-surface-sunken'
                    }`}
                >
                    {body}
                </Pressable>
            )}
        </>
    );
}

export interface FigureChipsProps {
    readonly figures: readonly LensFigure[];
    /**
     * Each chip takes an equal share of the row (never under 150px) and its number moves to its
     * end, so the row reads as label | value columns — a home page's counts, a summary.
     */
    readonly fill?: boolean | undefined;
    readonly testID: string;
}

/**
 * A row of figures without a list under them — the kitchen home's counts, a record's facts. The
 * Lens bar's own chips, so a number you can press looks the same on every page.
 */
export function FigureChips({ figures, fill = false, testID }: FigureChipsProps) {
    return (
        <View testID={testID} className="flex-row flex-wrap items-center gap-1.5">
            {figures.map((figure) =>
                fill ? (
                    <View
                        key={figure.key}
                        className="flex-row"
                        style={{ flexGrow: 1, flexBasis: 0, minWidth: FILL_MIN_WIDTH }}
                    >
                        <View className="flex-1">
                            <LensFigureCell
                                figure={figure}
                                narrow={false}
                                chip
                                fill
                                testID={`${testID}-${figure.key}`}
                            />
                        </View>
                    </View>
                ) : (
                    <LensFigureCell
                        key={figure.key}
                        figure={figure}
                        narrow={false}
                        chip
                        testID={`${testID}-${figure.key}`}
                    />
                ),
            )}
        </View>
    );
}

/** A filled chip's narrowest: a two-word label and a four-digit count. */
const FILL_MIN_WIDTH = 150;
