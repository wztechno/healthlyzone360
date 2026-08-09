import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * A numbered page control.
 *
 * Only the kitchen catalogue has one. Everything else in the application walks a cursor and offers
 * "Load more", because the collections a customer reads are written while they are being read and
 * offset pagination silently skips and repeats rows when that happens. `docs/api/conventions.md`
 * carries the full argument and names the five endpoints where it does not apply.
 *
 * ## Why an ellipsis rather than every page
 *
 * A kitchen with nine hundred ingredients has thirty-six pages, and thirty-six controls in a row is
 * not a control — it is a wall. The window shows the first page, the last page, and the pages
 * either side of the current one, which is enough to step, to jump to either end, and to see where
 * you are. Getting to page 19 of 36 takes the search box, not the page control; that is what the
 * search box is for, and it is the reason the catalogue got numbered pages in the first place.
 *
 * The gaps are rendered as text and marked `aria-hidden`, because "…" announced between two page
 * numbers tells a screen reader user nothing they cannot get from the numbers themselves.
 *
 * ## What it does not do
 *
 * There is no page-size control and no "jump to page" field. Both are real features; neither is
 * needed by a list whose page size the screen chooses, and an unused control in a toolbar costs
 * every reader the moment it takes to decide it is not for them.
 */

export interface PaginationProps {
    /** 1-based. Clamped into range, so a stale deep link lands somewhere rather than nowhere. */
    readonly page: number;
    /** `0` when there is nothing to page through; the control then renders nothing at all. */
    readonly totalPages: number;
    readonly onPageChange: (page: number) => void;
    /**
     * How many pages to show either side of the current one. `1` gives at most seven controls —
     * first, gap, three, gap, last — which fits a narrow screen without wrapping.
     */
    readonly siblingCount?: number | undefined;
    /** Landmark name. Defaults to the translated word for the control. */
    readonly label?: string | undefined;
    /** Disables every control without unmounting it, so the row does not collapse mid-fetch. */
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

type Slot = { readonly kind: 'page'; readonly page: number } | { readonly kind: 'gap' };

/**
 * The pages to draw, in order.
 *
 * Exported because the windowing is the part with an off-by-one in it, and a unit test over the
 * array is a far better way to pin that than a test that renders seven buttons and counts them.
 */
export function paginationSlots(
    page: number,
    totalPages: number,
    siblingCount = 1,
): readonly Slot[] {
    if (totalPages <= 0) return [];

    const current = Math.min(Math.max(1, page), totalPages);
    const siblings = Math.max(0, siblingCount);

    // First, last, current, its siblings, and the two gaps. Below that many pages the window would
    // hide nothing, so every page is drawn.
    const windowSize = siblings * 2 + 5;
    if (totalPages <= windowSize) {
        return Array.from({ length: totalPages }, (_, index) => ({
            kind: 'page' as const,
            page: index + 1,
        }));
    }

    // The run drawn when the current page is near an end. Sized so the control is `windowSize`
    // wide wherever you are: a row that grows and shrinks as you page moves the buttons under the
    // pointer, so Next lands on 5 and then on 4 without either being pressed.
    const edgeRun = siblings * 2 + 3;

    let start: number;
    let end: number;

    if (current <= siblings + 2) {
        start = 2;
        end = edgeRun;
    } else if (current >= totalPages - (siblings + 1)) {
        start = totalPages - edgeRun + 1;
        end = totalPages - 1;
    } else {
        start = current - siblings;
        end = current + siblings;
    }

    const slots: Slot[] = [{ kind: 'page', page: 1 }];

    // A gap is only worth drawing where it replaces more than one page. Where it would replace
    // exactly one, that page is drawn instead — the row is the same width either way, and "…"
    // hiding a single number is a worse trade than the number.
    if (start > 3) slots.push({ kind: 'gap' });
    else if (start === 3) slots.push({ kind: 'page', page: 2 });

    for (let index = start; index <= end; index++) slots.push({ kind: 'page', page: index });

    if (end < totalPages - 2) slots.push({ kind: 'gap' });
    else if (end === totalPages - 2) slots.push({ kind: 'page', page: totalPages - 1 });

    slots.push({ kind: 'page', page: totalPages });
    return slots;
}

export function Pagination({
    page,
    totalPages,
    onPageChange,
    siblingCount = 1,
    label,
    disabled = false,
    className,
    testID,
}: PaginationProps) {
    const { t } = useTranslation();

    // Nothing to page through is not an empty control — it is no control. A row of one disabled
    // button under a list of three rows is furniture that says only that the list is short.
    if (totalPages <= 1) return null;

    const current = Math.min(Math.max(1, page), totalPages);
    const slots = paginationSlots(current, totalPages, siblingCount);
    const atStart = current <= 1;
    const atEnd = current >= totalPages;

    const step = (target: number) => () => {
        onPageChange(Math.min(Math.max(1, target), totalPages));
    };

    const stepClass = (inactive: boolean) =>
        cx(
            'min-h-touch min-w-touch items-center justify-center rounded-md border px-3',
            inactive
                ? 'border-stroke-subtle bg-surface-sunken'
                : 'border-stroke-subtle bg-surface-raised',
        );

    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={label ?? t('designSystem:pagination.label')}
            accessibilityLabel={label ?? t('designSystem:pagination.label')}
            className={cx('flex-row flex-wrap items-center justify-center gap-1', className)}
        >
            <Pressable
                testID={testID === undefined ? undefined : `${testID}-previous`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('designSystem:pagination.previous')}
                accessibilityState={{ disabled: disabled || atStart }}
                aria-disabled={disabled || atStart}
                disabled={disabled || atStart}
                focusable={!(disabled || atStart)}
                onPress={step(current - 1)}
                className={stepClass(disabled || atStart)}
            >
                <Icon
                    name="chevronStart"
                    size="sm"
                    className={
                        disabled || atStart ? 'text-content-disabled' : 'text-content-secondary'
                    }
                />
            </Pressable>

            {slots.map((slot, index) =>
                slot.kind === 'gap' ? (
                    <RNText
                        key={`gap-${String(index)}`}
                        aria-hidden
                        importantForAccessibility="no-hide-descendants"
                        className="min-w-touch px-1 text-center text-sm text-content-disabled"
                    >
                        {'…'}
                    </RNText>
                ) : (
                    <Pressable
                        key={`page-${String(slot.page)}`}
                        testID={testID === undefined ? undefined : `${testID}-page-${String(slot.page)}`}
                        role="button"
                        accessibilityRole="button"
                        // The number alone reads as "3" with no clue what it selects, and the
                        // current page is announced by `aria-current` rather than by its weight —
                        // a bold digit is not information a screen reader can pass on.
                        accessibilityLabel={t('designSystem:pagination.page', { page: slot.page })}
                        aria-current={slot.page === current ? 'page' : undefined}
                        accessibilityState={{ selected: slot.page === current, disabled }}
                        disabled={disabled}
                        focusable={!disabled}
                        onPress={step(slot.page)}
                        className={cx(
                            'min-h-touch min-w-touch items-center justify-center rounded-md border px-3',
                            slot.page === current
                                ? 'border-surface-brand bg-surface-brand'
                                : 'border-stroke-subtle bg-surface-raised',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-sm',
                                slot.page === current
                                    ? 'font-bold text-content-on-brand'
                                    : 'text-content-secondary',
                            )}
                        >
                            {String(slot.page)}
                        </RNText>
                    </Pressable>
                ),
            )}

            <Pressable
                testID={testID === undefined ? undefined : `${testID}-next`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('designSystem:pagination.next')}
                accessibilityState={{ disabled: disabled || atEnd }}
                aria-disabled={disabled || atEnd}
                disabled={disabled || atEnd}
                focusable={!(disabled || atEnd)}
                onPress={step(current + 1)}
                className={stepClass(disabled || atEnd)}
            >
                <Icon
                    name="chevronEnd"
                    size="sm"
                    className={
                        disabled || atEnd ? 'text-content-disabled' : 'text-content-secondary'
                    }
                />
            </Pressable>
        </View>
    );
}
