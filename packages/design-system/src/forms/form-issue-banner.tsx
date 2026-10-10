import { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { useSummariseFields } from './form-issue-scope.tsx';

/**
 * FormIssueBanner — what stands between a form and its save, in one line under the header.
 *
 * ```
 *  ⊗ 3 required  [ Designation (EN) ] [ Category ] [ Unit price ]     <- on the danger fill
 *  △ 1 warning  [ Waste ]                                            <- on the warning fill
 * ```
 *
 * The count says how much is wrong; each chip names one field and takes the reader to it. A long
 * form's error is otherwise a red line somewhere below the fold, and a Save that "does nothing" is
 * the bug report that follows. The chips are the point — a banner that only counted would send the
 * reader hunting for the fields it had just declined to name.
 *
 * ## The field does not say it twice
 *
 * A chip that carries `fieldId` stands in for that field's own message: inside a `FormIssueScope`
 * the field keeps its red edge and drops the line of copy under it (Badges & Callouts, 2a). Leave
 * `fieldId` off when the chip says less than the field would — one `Packs` chip over a table whose
 * rows each say what is wrong with them — and the field goes on saying it.
 *
 * ## One banner per tone, never one per field
 *
 * Errors and warnings are different claims — one blocks the save, the other only says a value is
 * unusual — so they are two banners with two marks rather than one list with mixed chips. A form
 * that has both draws both, error first.
 *
 * ## It does not decide when to appear
 *
 * The form does. The Catalogue editors draw the error banner once a save has been attempted,
 * because a new record opens with every required field empty and a banner listing all of them
 * before anyone has typed a letter is an accusation rather than help. Warnings can show at once:
 * they are about a value somebody has already entered.
 *
 * Tone is carried by the mark as well as the fill, as every status surface here does (WCAG 1.4.1):
 * a cross for `danger`, a triangle for `warning`, a circled `i` for `info`.
 */

export const FORM_ISSUE_TONES = ['danger', 'warning', 'info'] as const;
export type FormIssueTone = (typeof FORM_ISSUE_TONES)[number];

export interface FormIssueItem {
    readonly key: string;
    /** The field's own label, already translated — the word the reader will find on the form. */
    readonly label: string;
    /** Takes the reader to the field: switches to its tab, scrolls it into view, focuses it. */
    readonly onPress: () => void;
    /**
     * The id of the `FormField` this chip stands for, when the chip says all its message would. The
     * field then drops that message while the banner shows. See `FormIssueScope`.
     */
    readonly fieldId?: string | undefined;
}

export interface FormIssueBannerProps {
    readonly tone: FormIssueTone;
    /** The count, already translated — `3 required`, `1 warning`, `2 at zero`. */
    readonly summary: string;
    readonly items: readonly FormIssueItem[];
    readonly className?: string | undefined;
    /** Root `{testID}`; chips `{testID}-{key}`. */
    readonly testID?: string | undefined;
}

/** Lucide's marks on the web; each falls back to its glyph (✖ ⚠ ⓘ) on native. */
const TONE_ICON: Readonly<Record<FormIssueTone, IconName>> = {
    danger: 'circleX',
    warning: 'alert',
    info: 'infoCircle',
};

const TONE_FILL: Readonly<Record<FormIssueTone, string>> = {
    danger: 'bg-danger-subtle',
    warning: 'bg-warning-subtle',
    info: 'bg-info-subtle',
};

const TONE_TEXT: Readonly<Record<FormIssueTone, string>> = {
    danger: 'text-danger-on-subtle',
    warning: 'text-warning-on-subtle',
    info: 'text-info-on-subtle',
};

/** The mark's ink: the tone's `DEFAULT`, fuller than the count so the shape leads the line. */
const TONE_MARK: Readonly<Record<FormIssueTone, string>> = {
    danger: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
};

/*
 * A chip's edge is the tone's ink at a fraction — enough to say "this belongs to the strip" on the
 * white, not so much that three chips read as three alerts. It firms up under the pointer, which is
 * the only hint that a chip goes somewhere. Amber needs the heavier fraction to show at all.
 */
const TONE_CHIP_EDGE: Readonly<
    Record<FormIssueTone, { readonly rest: string; readonly hover: string }>
> = {
    danger: { rest: 'border-danger/20', hover: 'border-danger/50' },
    warning: { rest: 'border-warning/30', hover: 'border-warning/70' },
    info: { rest: 'border-info/20', hover: 'border-info/50' },
};

export function FormIssueBanner({ tone, summary, items, className, testID }: FormIssueBannerProps) {
    const density = useDensity();
    const summaryClass =
        density === 'compact' ? 'text-role-label font-semibold' : 'text-sm font-semibold';
    const chipTextClass = density === 'compact' ? 'text-role-label' : 'text-xs font-medium';
    useSummariseFields(items.flatMap((item) => (item.fieldId === undefined ? [] : [item.fieldId])));

    return (
        <View
            testID={testID}
            // `alert` for the one that blocks: it appears because a save was refused, and that is
            // news the reader has to hear. A warning is a status and waits its turn.
            role={tone === 'danger' ? 'alert' : 'status'}
            accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
            aria-live="polite"
            /*
             * The soft strip (Badges & Callouts, 2a): the tone's fill and no border, 32px tall at
             * least, 10px in from the start and 4px from the end — the chips sit closer to the edge
             * than the mark does, so the last one looks tucked in rather than floating.
             */
            className={cx(
                'min-h-8 flex-row flex-wrap items-center self-start gap-2 rounded-md py-1 pe-1 ps-2.5',
                TONE_FILL[tone],
                className,
            )}
        >
            <Icon
                testID={testID === undefined ? undefined : `${testID}-icon`}
                name={TONE_ICON[tone]}
                size="sm"
                className={TONE_MARK[tone]}
            />
            <RNText
                testID={testID === undefined ? undefined : `${testID}-summary`}
                className={cx(summaryClass, TONE_TEXT[tone])}
            >
                {summary}
            </RNText>
            {/* The chips are one group, 4px apart — closer to each other than to the count. */}
            <View className="flex-row flex-wrap items-center gap-1">
                {items.map((item) => (
                    <IssueChip
                        key={item.key}
                        item={item}
                        tone={tone}
                        textClass={chipTextClass}
                        testID={testID === undefined ? undefined : `${testID}-${item.key}`}
                    />
                ))}
            </View>
        </View>
    );
}

/** One field, named as the form names it: white on the strip, so it reads as a thing to press. */
function IssueChip({
    item,
    tone,
    textClass,
    testID,
}: {
    readonly item: FormIssueItem;
    readonly tone: FormIssueTone;
    readonly textClass: string;
    readonly testID: string | undefined;
}) {
    const [hovered, setHovered] = useState(false);
    const edge = TONE_CHIP_EDGE[tone];

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={item.onPress}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            className={cx(
                'h-6 flex-row items-center rounded-sm border bg-surface-raised px-2',
                hovered ? edge.hover : edge.rest,
            )}
        >
            <RNText className={cx(textClass, TONE_TEXT[tone])}>{item.label}</RNText>
        </Pressable>
    );
}
