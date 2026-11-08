import { gradients } from '@healthy360/design-tokens';
import { useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

/**
 * The record canopy — a record page's opening, drawn on the canopy band (option C of the
 * `Minimal view page` canvas).
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────────────────────────┐
 * │ [‹ Back] [photo] Tahini paste  طحينة  ● Published     Cost / 100 g  Margin  [Edit] │
 * │                  IG-014 · Ingredient · Pantry › Spreads                              │
 * │                  Last changed 2 days ago by Sara K. · Version 7                      │
 * │ ┌ ● Draft ──── ● Issued ──── ◐ Partly received ──── ○ Received ─────────────────┐  │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * It replaces the page header and the Record status card: what the record is, where it stands,
 * the two or three figures a reader opens it for, and every action it has left. The history strip
 * is optional — a record with a lifecycle (a supply order) draws it, a catalogue record does not.
 *
 * No size above the admin's `strong` role is used anywhere on it: the band is what catches the
 * eye, never the type. The two gradients are {@link PageHero}'s — the colour sweep and the scrim
 * along the reading direction that keeps the mint captions at AA wherever they sit.
 */

export type RecordCanopyTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface RecordCanopyFact {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted by the page. */
    readonly value: string;
    readonly testID?: string | undefined;
}

/** `done` happened, `partial` happened in part, `pending` has not happened. */
export type RecordCanopyStepState = 'done' | 'partial' | 'pending';

export interface RecordCanopyStep {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Formatted, or `null` for a step with nothing to say yet: the dash. */
    readonly at: string | null;
    readonly state: RecordCanopyStepState;
    readonly testID?: string | undefined;
}

export interface RecordCanopyCaptionPart {
    readonly text: string;
    readonly testID?: string | undefined;
}

/** A caption line: one text, or several parts joined by `separator` that each keep an id. */
export type RecordCanopyCaption =
    | RecordCanopyCaptionPart
    | {
          readonly parts: readonly RecordCanopyCaptionPart[];
          readonly separator: string;
          readonly testID?: string | undefined;
      };

export interface RecordCanopyProps {
    /** Translated record name. */
    readonly title: string;
    /** The name in the other language, beside the title. Omitted when there is none. */
    readonly titleAside?: string | undefined;
    readonly titleAsideLang?: string | undefined;
    readonly status?: { readonly label: string; readonly tone: RecordCanopyTone } | undefined;
    /** Badges a page already renders as nodes — a list's own status chip — after the status. */
    readonly titleBadges?: ReactNode | undefined;
    /** Overrides `{testID}-title` / `{testID}-status` for a page whose suites name them. */
    readonly titleTestID?: string | undefined;
    readonly statusTestID?: string | undefined;
    /**
     * One quiet line each under the title — identifiers, who changed it last. A line the page
     * already names by a test id of its own carries it.
     */
    readonly captions?: readonly (string | RecordCanopyCaption)[] | undefined;
    /** The record's picture or glyph, at the head's start. */
    readonly media?: ReactNode | undefined;
    /** The figures a reader opens the record for. Two or three. */
    readonly facts?: readonly RecordCanopyFact[] | undefined;
    /** Every action the record has left, at the head's inline end. */
    readonly actions?: ReactNode | undefined;
    /**
     * The way back — a `Button`, drawn first. Omitted in a `RecordDialog`, whose ✕ is the way
     * back; a record that is a route of its own still draws one.
     */
    readonly back?: ReactNode | undefined;
    readonly steps?: readonly RecordCanopyStep[] | undefined;
    /** Translated. The history strip's accessible name. */
    readonly stepsLabel?: string | undefined;
    /** The dash a step with nothing to say shows. */
    readonly noValue: string;
    readonly testID: string;
}

const PILL_CLASS: Readonly<Record<RecordCanopyTone, string>> = {
    success: 'bg-content-on-canopy-muted/20',
    warning: 'bg-warning/30',
    danger: 'bg-danger/30',
    neutral: 'bg-content-on-canopy/10',
};

const PILL_DOT_CLASS: Readonly<Record<RecordCanopyTone, string>> = {
    success: 'bg-content-on-canopy-muted',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-content-on-canopy/60',
};

const STEP_DOT_CLASS: Readonly<Record<RecordCanopyStepState, string>> = {
    done: 'bg-content-on-canopy-muted',
    partial: 'bg-warning',
    pending: 'border-2 border-content-on-canopy/45',
};

export function RecordCanopy({
    title,
    titleAside,
    titleAsideLang,
    status,
    titleBadges,
    titleTestID,
    statusTestID,
    captions = [],
    media,
    facts = [],
    actions,
    back,
    steps = [],
    stepsLabel,
    noValue,
    testID,
}: RecordCanopyProps) {
    const isRtl = useIsRtl();
    const scrimStart = isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const scrimEnd = isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 };

    return (
        // `z-10`, as the Record lens: a popover opened from an action must land over the tiles.
        <View
            testID={testID}
            role="region"
            aria-label={title}
            className="z-10 overflow-hidden rounded-xl shadow-elevation-card"
        >
            <LinearGradient
                colors={gradients.canopy.colours}
                locations={gradients.canopy.locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={gradients.canopyScrim.colours}
                start={scrimStart}
                end={scrimEnd}
                style={StyleSheet.absoluteFill}
            />

            <View className="z-auto flex-col gap-base p-base">
                <View className="z-auto flex-row flex-wrap items-center gap-x-5 gap-y-snug">
                    {back}
                    {media}

                    <View className="min-w-0 shrink flex-col gap-hair">
                        <View className="flex-row flex-wrap items-center gap-tight">
                            <RNText
                                testID={titleTestID ?? `${testID}-title`}
                                accessibilityRole="header"
                                aria-level={1}
                                className="text-role-strong font-bold text-content-on-canopy text-start"
                            >
                                {title}
                            </RNText>
                            {titleAside === undefined || titleAside === '' ? null : (
                                <RNText
                                    testID={`${testID}-title-aside`}
                                    {...(titleAsideLang === undefined
                                        ? {}
                                        : { lang: titleAsideLang })}
                                    className="text-role-strong text-content-on-canopy-muted text-start"
                                >
                                    {titleAside}
                                </RNText>
                            )}
                            {status === undefined ? null : (
                                <View
                                    testID={statusTestID ?? `${testID}-status`}
                                    className={`h-5 flex-row items-center gap-1.5 rounded-full px-2 ${PILL_CLASS[status.tone]}`}
                                >
                                    <View
                                        aria-hidden
                                        className={`h-2 w-2 rounded-full ${PILL_DOT_CLASS[status.tone]}`}
                                    />
                                    <RNText className="text-role-label font-semibold text-content-on-canopy">
                                        {status.label}
                                    </RNText>
                                </View>
                            )}
                            {titleBadges}
                        </View>
                        {captions.map((caption, index) => {
                            const line: RecordCanopyCaption =
                                typeof caption === 'string' ? { text: caption } : caption;
                            const key = `${String(index)}-${'text' in line ? line.text : line.parts.map((part) => part.text).join()}`;
                            return (
                                <RNText
                                    key={key}
                                    testID={line.testID ?? `${testID}-caption-${String(index)}`}
                                    className="text-role-label text-content-on-canopy-muted text-start"
                                >
                                    {'text' in line
                                        ? line.text
                                        : line.parts.map((part, at) => (
                                              <RNText key={`${String(at)}-${part.text}`}>
                                                  {at === 0 ? null : line.separator}
                                                  <RNText testID={part.testID}>{part.text}</RNText>
                                              </RNText>
                                          ))}
                                </RNText>
                            );
                        })}
                    </View>

                    {facts.length === 0 && actions === undefined ? null : (
                        <View className="z-auto ms-auto flex-row flex-wrap items-center gap-tight">
                            {facts.map((fact) => (
                                <View
                                    key={fact.key}
                                    className="min-w-[112px] flex-col gap-0.5 rounded-lg border border-content-on-canopy/15 bg-content-on-canopy/10 px-snug py-tight"
                                >
                                    <RNText className="text-role-label text-content-on-canopy-muted text-start">
                                        {fact.label}
                                    </RNText>
                                    <RNText
                                        testID={fact.testID ?? `${testID}-fact-${fact.key}`}
                                        className="text-role-strong font-bold tabular-nums text-content-on-canopy text-start"
                                    >
                                        {fact.value}
                                    </RNText>
                                </View>
                            ))}
                            {actions === undefined ? null : (
                                <View
                                    testID={`${testID}-actions`}
                                    className="z-auto flex-row flex-wrap items-center gap-tight"
                                >
                                    {actions}
                                </View>
                            )}
                        </View>
                    )}
                </View>

                {steps.length === 0 ? null : (
                    <View
                        testID={`${testID}-history`}
                        role="list"
                        aria-label={stepsLabel}
                        className="flex-row rounded-lg bg-surface-canopy-deep/60 px-base py-snug"
                    >
                        {steps.map((step, index) => {
                            const next = steps[index + 1];
                            return (
                                <View
                                    key={step.key}
                                    role="listitem"
                                    // eslint-disable-next-line no-restricted-syntax -- one step of the history strip: the steps share the strip equally.
                                    className="min-w-0 flex-1 flex-col gap-1.5"
                                >
                                    <View className="flex-row items-center">
                                        <View
                                            aria-hidden
                                            className={`h-3 w-3 rounded-full ${STEP_DOT_CLASS[step.state]}`}
                                        />
                                        <View
                                            aria-hidden
                                            // eslint-disable-next-line no-restricted-syntax -- the connector line runs to the next step's dot.
                                            className={`mx-1.5 h-0.5 flex-1 ${
                                                next === undefined
                                                    ? 'bg-transparent'
                                                    : next.state === 'pending'
                                                      ? 'bg-content-on-canopy/20'
                                                      : 'bg-content-on-canopy-muted'
                                            }`}
                                        />
                                    </View>
                                    <RNText className="text-role-label font-semibold text-content-on-canopy text-start">
                                        {step.label}
                                    </RNText>
                                    <RNText
                                        testID={step.testID}
                                        className="text-role-label tabular-nums text-content-on-canopy-muted text-start"
                                    >
                                        {step.at ?? noValue}
                                    </RNText>
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>
        </View>
    );
}

/** A record's glyph in the canopy's media slot, for a record that has no picture. */
export function RecordCanopyGlyph({ children }: { readonly children: ReactNode }) {
    return (
        <View
            aria-hidden
            className="h-12 w-12 items-center justify-center rounded-lg border border-content-on-canopy/20 bg-content-on-canopy/10"
        >
            {children}
        </View>
    );
}
