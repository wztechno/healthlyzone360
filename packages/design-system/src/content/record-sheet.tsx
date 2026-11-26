import type { BadgeTone } from './badge.tsx';
import { Badge } from './badge.tsx';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { useRecordSplit } from './record-split.ts';

/**
 * The record sheet — option A of the `Record pop-up — no canopy` canvas (2026-11-17), the record
 * pop-up with the green band taken away.
 *
 * ```
 * ┌ INGREDIENT [ING-00142] ──────────────────────────────────────────────────── ✕ ┐
 * │ [photo] Tahini                                               LAST CHANGED   │
 * │         طحينة                                              12 Nov, 14:20   │
 * │         (Published) (For sale) (Pantry › Pastes)        by Hala · version 7 │
 * │ ┌ UNIT PRICE ─┬ COST / 100 G ┬ B2B PRICE ─┬ B2C PRICE ─┬ ENERGY ──────────┐  │
 * │ │ AED 38.00   │ AED 3.80     │ AED 5.20   │ AED 6.50   │ 595 kcal         │  │
 * │ └─────────────┴──────────────┴────────────┴────────────┴──────────────────┘  │
 * │ ┌ Allergens and diets ───────────────────────────────────────────────────┐   │
 * │ ┌ Nutrition per 100 g ───────────┐ ┌ Composition ──────────────────────┐    │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The record's name sits on the window's own white, larger than anything else on it; the figures a
 * reader opens the record for sit in one strip under it at 24px; every other answer is a white card
 * with a hairline, label on the start, value on the end at 16px. Nothing is drawn on a coloured
 * ground but the chips, so the data is what the eye finds first.
 */

/* ── the head ──────────────────────────────────────────────────────────────────────────────────── */

export interface SheetChip {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    readonly tone: BadgeTone;
    readonly testID?: string | undefined;
}

export interface SheetChanged {
    /** Translated — "Last changed". */
    readonly label: string;
    /** Formatted — "2 days ago". */
    readonly value: string;
    /** "by Hala · version 7". */
    readonly note?: string | undefined;
    readonly valueTestID?: string | undefined;
    readonly noteTestID?: string | undefined;
}

export interface RecordSheetHeadProps {
    /** Translated record name. */
    readonly title: string;
    /** The name in the other language, under the title. */
    readonly titleAside?: string | undefined;
    readonly titleAsideLang?: string | undefined;
    /** A {@link RecordThumb}, at the head's start. */
    readonly media?: ReactNode;
    /** The status first, then the filing. */
    readonly chips?: readonly SheetChip[] | undefined;
    /** Who touched it last, at the head's inline end. */
    readonly changed?: SheetChanged | undefined;
    /** Badges a page already renders as nodes, after the chips. */
    readonly badges?: ReactNode;
    /** Quiet lines under the chips, each with an id of its own. */
    readonly lines?: readonly { readonly text: string; readonly testID: string }[] | undefined;
    /** Buttons on the head itself, for a record whose next move is why it is opened. */
    readonly actions?: ReactNode;
    readonly titleTestID?: string | undefined;
    readonly testID: string;
}

export function RecordSheetHead({
    title,
    titleAside,
    titleAsideLang,
    media,
    chips = [],
    changed,
    badges,
    lines = [],
    actions,
    titleTestID,
    testID,
}: RecordSheetHeadProps) {
    const hasBadges = badges !== undefined && badges !== null && badges !== false;
    return (
        <View
            testID={testID}
            role="region"
            aria-label={title}
            className="z-auto flex-row flex-wrap items-center gap-x-5 gap-y-3"
        >
            {media}
            {/* `items-start`: each line is as wide as its words, so a name in the other script sits
                under the title instead of running to its own script's start. */}
            <View className="min-w-0 shrink flex-col items-start">
                <RNText
                    testID={titleTestID ?? `${testID}-title`}
                    accessibilityRole="header"
                    aria-level={1}
                    className="font-display text-role-title font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
                {titleAside === undefined || titleAside === '' ? null : (
                    <RNText
                        testID={`${testID}-title-aside`}
                        {...(titleAsideLang === undefined ? {} : { lang: titleAsideLang })}
                        className="mt-0.5 text-role-body font-medium text-content-secondary text-start"
                    >
                        {titleAside}
                    </RNText>
                )}
                {chips.length === 0 && !hasBadges ? null : (
                    <View
                        testID={`${testID}-chips`}
                        className="mt-2.5 flex-row flex-wrap items-center gap-1.5"
                    >
                        {chips.map((chip) => (
                            <Badge
                                key={chip.key}
                                testID={chip.testID}
                                tone={chip.tone}
                                size="lg"
                                label={chip.label}
                            />
                        ))}
                        {badges}
                    </View>
                )}
                {lines.map((line, index) => (
                    <RNText
                        key={line.testID}
                        testID={line.testID}
                        className={`${index === 0 ? 'mt-2' : 'mt-0.5'} text-role-caption text-content-secondary text-start`}
                    >
                        {line.text}
                    </RNText>
                ))}
            </View>
            {changed === undefined ? null : (
                <View testID={`${testID}-changed`} className="ms-auto flex-col items-end gap-0.5">
                    <RNText className="text-role-caption font-semibold uppercase tracking-wider text-content-secondary text-end">
                        {changed.label}
                    </RNText>
                    <RNText
                        testID={changed.valueTestID}
                        className="text-role-body font-semibold text-content-primary text-end"
                    >
                        {changed.value}
                    </RNText>
                    {changed.note === undefined ? null : (
                        <RNText
                            testID={changed.noteTestID}
                            className="text-role-caption text-content-secondary text-end"
                        >
                            {changed.note}
                        </RNText>
                    )}
                </View>
            )}
            {actions === undefined || actions === null ? null : (
                <View
                    testID={`${testID}-actions`}
                    className={`z-auto flex-row flex-wrap items-center gap-2 ${
                        changed === undefined ? 'ms-auto' : ''
                    }`}
                >
                    {actions}
                </View>
            )}
        </View>
    );
}

/* ── the figures ───────────────────────────────────────────────────────────────────────────────── */

export interface SheetFigure {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted. A dash where the record has none. */
    readonly value: string;
    /** A line under the value — "per kg", "margin 37 %". */
    readonly note?: string | undefined;
    /** `muted` for a dash; `warning` for a figure that needs doing something about. */
    readonly tone?: 'muted' | 'warning' | undefined;
    readonly testID?: string | undefined;
    readonly valueTestID?: string | undefined;
}

const FIGURE_INK = {
    plain: 'text-content-primary',
    muted: 'text-content-secondary',
    warning: 'text-warning-strong',
} as const;

/** The figures a reader opens the record for, in one strip of hairline-split cells. */
export function RecordFigures({
    figures,
    testID,
}: {
    readonly figures: readonly SheetFigure[];
    readonly testID: string;
}) {
    if (figures.length === 0) return null;
    return (
        <View
            testID={testID}
            role="list"
            className="flex-row flex-wrap overflow-hidden rounded-[20px] border border-stroke-subtle bg-surface-raised"
        >
            {figures.map((figure, index) => (
                <View
                    key={figure.key}
                    testID={figure.testID}
                    role="listitem"
                    className={`min-w-[140px] flex-col gap-1 px-4 pb-4 pt-3 ${
                        index === 0 ? '' : 'border-s border-stroke-subtle'
                    }`}

                    style={{ flexGrow: 1, flexBasis: 0 }}
                >
                    <RNText
                        numberOfLines={1}
                        className="text-role-caption font-semibold uppercase tracking-wider text-content-secondary text-start"
                    >
                        {figure.label}
                    </RNText>
                    <RNText
                        testID={figure.valueTestID}
                        numberOfLines={2}
                        className={`font-display text-role-title font-bold tabular-nums text-start ${
                            FIGURE_INK[figure.tone ?? 'plain']
                        }`}
                    >
                        {figure.value}
                    </RNText>
                    {figure.note === undefined ? null : (
                        <RNText className="text-role-caption text-content-secondary text-start">
                            {figure.note}
                        </RNText>
                    )}
                </View>
            ))}
        </View>
    );
}

/* ── the progress ──────────────────────────────────────────────────────────────────────────────── */

/* ── the cards ─────────────────────────────────────────────────────────────────────────────────── */

export interface SheetCardProps {
    /** Translated. Omitted, the card has no head. */
    readonly title?: string | undefined;
    /** Badges beside the title — Estimated, a count. */
    readonly aside?: ReactNode;
    /** An (i) or a caption at the head's inline end. */
    readonly trailing?: ReactNode;
    readonly children: ReactNode;
    readonly testID: string;
}

/** One answer of the record: a white card, a hairline, a 16px title. */
export function SheetCard({ title, aside, trailing, children, testID }: SheetCardProps) {
    return (
        <View
            testID={testID}
            role="region"
            aria-label={title}
            className="z-auto min-w-0 flex-col gap-2.5 rounded-[20px] border border-stroke-subtle bg-surface-raised px-5 pb-4 pt-4"
        >
            {title === undefined ? null : (
                <View className="z-auto flex-row flex-wrap items-center gap-2">
                    <RNText
                        testID={`${testID}-title`}
                        className="text-role-caption font-bold uppercase tracking-wider text-content-secondary text-start"
                    >
                        {title}
                    </RNText>
                    {aside}
                    {trailing === undefined || trailing === null ? null : (
                        <View className="z-auto ms-auto flex-row flex-wrap items-center gap-2">
                            {trailing}
                        </View>
                    )}
                </View>
            )}
            {children}
        </View>
    );
}

/**
 * The cards' layout: `top` across the whole width, then two columns where the window has room
 * (`useRecordSplit`), one under the other below that. A sheet with nothing for the end column lets
 * the start column take the whole width.
 */
export function SheetColumns({
    top,
    start,
    end,
    testID,
    startTestID,
    endTestID,
}: {
    readonly top?: ReactNode;
    readonly start: ReactNode;
    readonly end?: ReactNode;
    readonly testID: string;
    readonly startTestID?: string | undefined;
    readonly endTestID?: string | undefined;
}) {
    const split = useRecordSplit();
    const hasEnd = end !== undefined && end !== null && end !== false;
    return (
        <View testID={testID} className="z-auto flex-col gap-4">
            {top}
            <View
                className={
                    split && hasEnd ? 'z-auto flex-row items-start gap-4' : 'z-auto flex-col gap-4'
                }
            >
                <View
                    testID={startTestID}
                    className="z-auto min-w-0 flex-col gap-4"

                    style={split && hasEnd ? { flexGrow: 1, flexBasis: 0 } : undefined}
                >
                    {start}
                </View>
                {hasEnd ? (
                    <View
                        testID={endTestID}
                        className="z-auto min-w-0 flex-col gap-4"

                        style={split ? { flexGrow: 1, flexBasis: 0 } : undefined}
                    >
                        {end}
                    </View>
                ) : null}
            </View>
        </View>
    );
}

/* ── inside a card ─────────────────────────────────────────────────────────────────────────────── */

export interface SheetFact {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted, or a node for a value that is not plain text (chips). */
    readonly value: string | ReactNode;
    /** Drawn quiet — the value is a dash. */
    readonly empty?: boolean | undefined;
}

/** Past this a value is a sentence: it goes under its label, across the whole line. */
const SENTENCE_LENGTH = 36;

/**
 * A card's label/value pairs on hairlines: label on the start at 14px, value on the end at 16px.
 * `pairs` sets two to a line, for a card as wide as the window. Each row is `{testID}-{key}`, its
 * label `-label` and its value `-value`, as the board's field rows were.
 */
export function SheetFacts({
    facts,
    pairs = false,
    testID,
}: {
    readonly facts: readonly SheetFact[];
    readonly pairs?: boolean | undefined;
    readonly testID: string;
}) {
    return (
        <View testID={testID} className="overflow-hidden">
            <View className="-mt-px flex-row flex-wrap gap-x-8">
                {facts.map((fact) => {
                    const sentence =
                        typeof fact.value === 'string' && fact.value.length > SENTENCE_LENGTH;
                    return (
                        <View
                            key={fact.key}
                            testID={`${testID}-${fact.key}`}
                            className={`min-h-11 min-w-0 border-t border-stroke-subtle py-2.5 ${
                                sentence
                                    ? 'flex-col gap-1'
                                    : 'flex-row items-center justify-between gap-4'
                            }`}
                            style={{
                                flexBasis: pairs && !sentence ? '40%' : '100%',

                                flexGrow: 1,
                            }}
                        >
                            <RNText
                                testID={`${testID}-${fact.key}-label`}
                                className="shrink-0 text-role-caption text-content-secondary text-start"
                            >
                                {fact.label}
                            </RNText>
                            {typeof fact.value === 'string' ? (
                                <RNText
                                    testID={`${testID}-${fact.key}-value`}
                                    className={`min-w-0 shrink text-role-body tabular-nums ${
                                        sentence ? 'text-start' : 'text-end'
                                    } ${
                                        fact.empty === true
                                            ? 'font-medium text-content-secondary'
                                            : 'font-semibold text-content-primary'
                                    }`}
                                >
                                    {fact.value}
                                </RNText>
                            ) : (
                                <View
                                    testID={`${testID}-${fact.key}-value`}
                                    className="min-w-0 shrink flex-row flex-wrap justify-end gap-1.5"
                                >
                                    {fact.value}
                                </View>
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

export interface SheetTagRow {
    readonly key: string;
    /** Translated — "Contains", "May contain", "Diets". */
    readonly label: string;
    /** The chips, or a quiet dash. */
    readonly content: ReactNode;
    readonly testID?: string | undefined;
}

/** Rows of chips under a label each — the allergens a record contains, may contain, its diets. */
export function SheetTagRows({
    rows,
    testID,
}: {
    readonly rows: readonly SheetTagRow[];
    readonly testID: string;
}) {
    return (
        <View testID={testID} className="overflow-hidden">
            <View className="-mt-px flex-col">
                {rows.map((row) => (
                    <View
                        key={row.key}
                        testID={row.testID}
                        className="min-h-11 flex-row items-start gap-4 border-t border-stroke-subtle py-2"
                    >
                        <View className="w-32 shrink-0 pt-1">
                            <RNText className="text-role-caption text-content-secondary text-start">
                                {row.label}
                            </RNText>
                        </View>
                        <View className="min-w-0 shrink flex-row flex-wrap items-center gap-1.5">
                            {row.content}
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

/** A card's prose — composition, a note — at 16px. */
export function SheetText({
    text,
    empty = false,
    testID,
}: {
    readonly text: string;
    readonly empty?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <RNText
            testID={testID}
            className={`text-role-body leading-5 text-start ${
                empty ? 'text-content-secondary' : 'text-content-primary'
            }`}
        >
            {text}
        </RNText>
    );
}
