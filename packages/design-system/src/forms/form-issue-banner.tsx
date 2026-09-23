import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * FormIssueBanner — what stands between a form and its save, in one line under the header.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ ✖ 3 required  [ Designation (EN) ] [ Category ] [ Unit price ]   │
 * └──────────────────────────────────────────────────────────────────┘
 * ┌───────────────────────────────┐
 * │ ⚠ 1 warning  [ Waste ]        │
 * └───────────────────────────────┘
 * ```
 *
 * The count says how much is wrong; each chip names one field and takes the reader to it. A long
 * form's error is otherwise a red line somewhere below the fold, and a Save that "does nothing" is
 * the bug report that follows. The chips are the point — a banner that only counted would send the
 * reader hunting for the fields it had just declined to name.
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

const TONE_ICON: Readonly<Record<FormIssueTone, IconName>> = {
    danger: 'error',
    warning: 'warning',
    info: 'info',
};

const TONE_FRAME: Readonly<Record<FormIssueTone, string>> = {
    danger: 'bg-danger-subtle border-danger-border',
    warning: 'bg-warning-subtle border-warning-border',
    info: 'bg-info-subtle border-info-border',
};

const TONE_TEXT: Readonly<Record<FormIssueTone, string>> = {
    danger: 'text-danger-on-subtle',
    warning: 'text-warning-on-subtle',
    info: 'text-info-on-subtle',
};

const TONE_MARK: Readonly<Record<FormIssueTone, string>> = {
    danger: 'text-danger-strong',
    warning: 'text-warning-strong',
    info: 'text-info-strong',
};

const TONE_CHIP_BORDER: Readonly<Record<FormIssueTone, string>> = {
    danger: 'border-danger-border',
    warning: 'border-warning-border',
    info: 'border-info-border',
};

export function FormIssueBanner({ tone, summary, items, className, testID }: FormIssueBannerProps) {
    const density = useDensity();
    const textClass = density === 'compact' ? 'text-role-label' : 'text-sm font-medium';
    const chipTextClass = density === 'compact' ? 'text-role-caption' : 'text-xs font-medium';

    return (
        <View
            testID={testID}
            // `alert` for the one that blocks: it appears because a save was refused, and that is
            // news the reader has to hear. A warning is a status and waits its turn.
            role={tone === 'danger' ? 'alert' : 'status'}
            accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
            aria-live="polite"
            // The design's geometry: 30px tall at least, a 6px corner, 10px in from the start and 6px
            // from the end — the chips sit closer to the edge than the mark does.
            className={cx(
                'min-h-[30px] flex-row flex-wrap items-center self-start gap-tight rounded-md border py-1 pe-1.5 ps-2.5',
                TONE_FRAME[tone],
                className,
            )}
        >
            <Icon name={TONE_ICON[tone]} size="sm" className={TONE_MARK[tone]} />
            <RNText
                testID={testID === undefined ? undefined : `${testID}-summary`}
                className={cx(textClass, TONE_TEXT[tone])}
            >
                {summary}
            </RNText>
            {/* The chips are one group, 4px apart — closer to each other than to the count. */}
            <View className="flex-row flex-wrap items-center gap-1">
                {items.map((item) => (
                    <Pressable
                        key={item.key}
                        testID={testID === undefined ? undefined : `${testID}-${item.key}`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        onPress={item.onPress}
                        className={cx(
                            'h-5 flex-row items-center rounded-sm border bg-surface-raised px-[7px]',
                            TONE_CHIP_BORDER[tone],
                        )}
                    >
                        <RNText className={cx(chipTextClass, TONE_TEXT[tone])}>{item.label}</RNText>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}
