import { InfoTip, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { LensFigureCell } from './lens-bar.tsx';
import type { LensFigure, LensTone } from './lens-bar.tsx';

/**
 * The Record lens — a record page's state, figures and facts as one object. It is the Lens bar's
 * counterpart for a single record, and replaces the stat cards over a record and the rail of cards
 * beside it (Status, Cost, Record).
 *
 * ```
 * ┌───────────────────────────────────────────────────────────────────────────────────────┐
 * │ [Completed] Barbecue Dip │ ● Confirmed Oct 12, 2:07 PM ─ ● Started 2:09 PM ─ ○ …  [Sheet] │
 * ├───────────────────────────────────────────────────────────────────────────────────────┤
 * │ Planned   Runs     Produced   Rejected   Variance  │ ● Usable                          │
 * │ 1 kg      ×0.685   1 kg       0 kg       0 kg      │   1 kg                            │
 * ├───────────────────────────────────────────────────────────────────────────────────────┤
 * │ Lot 261012-001-7  Made on Oct 12, 2026  Use by …  │ Estimated cost —  ● Cost per unit … │
 * └───────────────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * - **The head** is what the record is and where it stands: its badge and name, its history as
 *   steps, and every action it has left at the inline end.
 * - **The figures** are the record's numbers, centred in the lens and each label centred over its
 *   value at the label's own size — weight sets the value apart, never size.
 * - **The facts** are the Lens bar's figure cells on a sunken strip: identifiers, dates and money.
 *
 * No sentence lives on it. Why a figure is what it is goes behind an (i) beside it.
 */

export interface RecordLensFigure {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted by the page, which owns the numbering system. */
    readonly value: string;
    /** A dot before the label — the figure the record is for. */
    readonly tone?: LensTone | undefined;
    /** Nothing to say yet: the value is drawn quiet, and a dot hollow. */
    readonly empty?: boolean | undefined;
    /** A hairline before this figure, to start a new group. */
    readonly separated?: boolean | undefined;
    /** Translated. Behind an (i) beside the label. */
    readonly info?: string | undefined;
    readonly testID?: string | undefined;
}

/** A Lens bar figure, with the testID its page already names it by. */
export interface RecordLensFact extends LensFigure {
    readonly testID?: string | undefined;
}

export interface RecordLensStep {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted. `null` for a step that has not happened: a hollow dot and the dash. */
    readonly at: string | null;
    readonly testID?: string | undefined;
}

export interface RecordLensProps {
    /** Translated. The lens's accessible name. */
    readonly label: string;
    /** The record's badge and name, at the head's start. */
    readonly heading: ReactNode;
    /** The record's history, drawn after the heading. */
    readonly steps?: readonly RecordLensStep[] | undefined;
    /** Translated. The history's accessible name. */
    readonly stepsLabel?: string | undefined;
    /** Every action the record has left, at the head's inline end. */
    readonly actions?: ReactNode | undefined;
    readonly figures: readonly RecordLensFigure[];
    /** A note someone wrote on the record, under the figures. */
    readonly note?: string | null | undefined;
    readonly facts: readonly RecordLensFact[];
    /** The dash a step that has not happened shows. */
    readonly noValue: string;
    readonly testID: string;
}

const DOT_CLASS: Readonly<Record<LensTone, string>> = {
    brand: 'bg-surface-brand',
    success: 'bg-success',
    warning: 'bg-warning-border',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-stroke-strong',
};

const HOLLOW_DOT = 'h-2 w-2 rounded-full border border-stroke-strong';

export function RecordLens({
    label,
    heading,
    steps = [],
    stepsLabel,
    actions,
    figures,
    note,
    facts,
    noValue,
    testID,
}: RecordLensProps) {
    return (
        // `z-10`, as the Lens bar: an (i) on the facts must open over the table drawn after it.
        <View
            testID={testID}
            role="region"
            aria-label={label}
            className="z-10 rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card"
        >
            <View className="z-auto flex-row flex-wrap items-center gap-x-3 gap-y-tight py-tight pe-snug ps-4">
                <View className="flex-row flex-wrap items-center gap-tight">{heading}</View>
                {steps.length === 0 ? null : (
                    <>
                        <View aria-hidden className="h-4 w-px bg-brand-100" />
                        <View
                            testID={`${testID}-history`}
                            role="list"
                            aria-label={stepsLabel}
                            className="flex-row flex-wrap items-center gap-1.5"
                        >
                            {steps.map((step, index) => (
                                <View
                                    key={step.key}
                                    role="listitem"
                                    className="flex-row items-center gap-1.5"
                                >
                                    {index === 0 ? null : (
                                        <View aria-hidden className="h-px w-5 bg-stroke" />
                                    )}
                                    <View
                                        aria-hidden
                                        className={
                                            step.at === null
                                                ? HOLLOW_DOT
                                                : `h-2 w-2 rounded-full ${DOT_CLASS.brand}`
                                        }
                                    />
                                    <Text variant="label" tone="secondary" numberOfLines={1}>
                                        {step.label}
                                    </Text>
                                    <Text
                                        testID={step.testID}
                                        variant="label"
                                        tone={step.at === null ? 'secondary' : 'primary'}
                                        className="font-semibold tabular-nums"
                                    >
                                        {step.at ?? noValue}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </>
                )}
                {actions === undefined || actions === null ? null : (
                    <View
                        testID={`${testID}-actions`}
                        className="z-auto ms-auto flex-row flex-wrap items-center gap-tight ps-2"
                    >
                        {actions}
                    </View>
                )}
            </View>

            <View aria-hidden className="h-px bg-brand-100" />

            <View
                testID={`${testID}-figures`}
                className="flex-row flex-wrap items-start justify-center gap-x-8 gap-y-3 px-4 py-3"
            >
                {figures.map((figure) => (
                    <RecordFigureCell key={figure.key} figure={figure} />
                ))}
            </View>

            {note === undefined || note === null || note === '' ? null : (
                <View className="px-4 pb-3">
                    <Text variant="label" tone="secondary" testID={`${testID}-note`}>
                        {note}
                    </Text>
                </View>
            )}

            <View aria-hidden className="h-px bg-brand-100" />

            {/* `ps-2`: the cells carry 8px of their own, so their text starts on the 16px edge. */}
            <View
                testID={`${testID}-facts`}
                className="z-auto flex-row flex-wrap items-center gap-0.5 rounded-b-panel bg-surface-base py-tight pe-snug ps-2"
            >
                {facts.map((fact) => (
                    <LensFigureCell
                        key={fact.key}
                        figure={fact}
                        narrow={false}
                        testID={fact.testID ?? `${testID}-fact-${fact.key}`}
                    />
                ))}
            </View>
        </View>
    );
}

function RecordFigureCell({ figure }: { readonly figure: RecordLensFigure }) {
    const empty = figure.empty === true;

    return (
        <>
            {figure.separated === true ? (
                <View aria-hidden className="w-px self-stretch bg-brand-100" />
            ) : null}
            <View className="flex-col items-center gap-0.5">
                <View className="flex-row items-center gap-1.5">
                    {figure.tone === undefined ? null : (
                        <View
                            aria-hidden
                            className={
                                empty
                                    ? HOLLOW_DOT
                                    : `h-2 w-2 rounded-full ${DOT_CLASS[figure.tone]}`
                            }
                        />
                    )}
                    <Text variant="label" tone="secondary" numberOfLines={1}>
                        {figure.label}
                    </Text>
                    {figure.info === undefined ? null : (
                        <InfoTip label={figure.label} text={figure.info} />
                    )}
                </View>
                <Text
                    testID={figure.testID}
                    variant="label"
                    tone={empty ? 'secondary' : 'primary'}
                    className="font-semibold tabular-nums"
                >
                    {figure.value}
                </Text>
            </View>
        </>
    );
}
