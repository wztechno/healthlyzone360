import { useBreakpoint } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

/**
 * A row of small labels that never grows past a fixed number of lines.
 *
 * ## Why a card needs this at all
 *
 * A meal carries between two and nine diet classifications, and rendered as a plain wrapping row
 * that is one line on one card and three on the next. In a grid the cost is not the tags — it is
 * that every card below the tallest one in its row is a different height, so the eye has no line to
 * run along. The pinned footer already fixes the *price*; this fixes everything above it.
 *
 * So the cluster is clamped to `maxRows` lines and the labels that do not fit are counted in a
 * trailing `+3 more`.
 *
 * ## The counter is a label, not a control
 *
 * Deliberately, and the reason is structural rather than aesthetic. The card it sits in is one
 * `button`, and a focusable thing inside a button is an axe `nested-interactive` failure — serious,
 * which the accessibility gate blocks on — as well as being unreachable to a screen reader, which
 * reads a button's label and never its innards. Making the counter pressable would therefore have
 * meant giving up the whole card as a press target, and a card you can only click two thirds of is
 * a worse trade than a count you cannot press. The full list is one press away on the meal's own
 * page, which is where the card goes anyway.
 *
 * ## Why it measures instead of showing a fixed number
 *
 * "Show the first four" is wrong at both ends: four long labels overflow two lines on a narrow
 * card, and four short ones waste half a line on a wide one. The grid's cards are between about
 * 300 and 375 units wide depending on the viewport, and the labels are translated — the Arabic
 * catalogue has completely different lengths. So the labels are measured and packed exactly the way
 * flexbox will lay them out, and the count falls out of the arithmetic.
 *
 * The measurement happens in a mirror layer: an absolutely positioned, zero-height copy of every
 * label plus the counter, which reports its widths without ever contributing to the layout. The
 * visible row is clipped to `maxRows` from the very first frame, so the card's height is settled
 * before the measurements arrive and the count that lands afterwards only ever changes what is
 * inside the block, never how tall it is.
 *
 * `onLayout` sits on plain views with no `className`, matching `Collapse` in the design system.
 *
 * ## Phones are left alone
 *
 * Below `md` the grid is a single column, every card is the full width of the screen, and there is
 * no neighbouring card for a mismatched height to be measured against — the problem this solves
 * does not exist there. So below `md` every label is rendered, exactly as before.
 */
export interface TagClusterItem {
    readonly key: string;
    readonly label: string;
}

export interface TagClusterProps {
    readonly tags: readonly TagClusterItem[];
    /** Lines the visible row is allowed to run to above `md`. Defaults to two. */
    readonly maxRows?: number | undefined;
    readonly testID?: string | undefined;
}

/** `gap-1.5` between labels, and the labels' own `min-h-[24px]`. Kept in sync by hand. */
const GAP = 6;
const ROW_HEIGHT = 24;

/** The counter's slot in the width table. Prefixed so it can never collide with a tag's key. */
const MORE_KEY = '__more';

/** How many lines `widths` needs when packed left to right into `available`, exactly as flexbox does. */
function rowsNeeded(widths: readonly number[], available: number): number {
    let rows = 1;
    let used = 0;
    for (const width of widths) {
        if (used === 0) {
            used = width;
            continue;
        }
        const extended = used + GAP + width;
        if (extended <= available) {
            used = extended;
        } else {
            rows += 1;
            used = width;
        }
    }
    return rows;
}

/**
 * How many labels to show. The counter is packed *with* them whenever it will be rendered, because
 * a count that only fits because the label it makes room for was left out is not a fit.
 */
function fittingCount(
    widths: readonly number[],
    moreWidth: number,
    available: number,
    maxRows: number,
): number {
    if (rowsNeeded(widths, available) <= maxRows) return widths.length;
    for (let count = widths.length - 1; count > 0; count -= 1) {
        if (rowsNeeded([...widths.slice(0, count), moreWidth], available) <= maxRows) {
            return count;
        }
    }
    return 0;
}

function TagLabel({ label }: { readonly label: string }) {
    return (
        <View className="min-h-[24px] justify-center rounded-full bg-surface-brand-subtle px-2.5">
            <RNText className="text-xs font-semibold text-content-on-brand-subtle">{label}</RNText>
        </View>
    );
}

/**
 * The counter, in the label's own shape but in the neutral tone.
 *
 * The tone is what stops it reading as one more classification — on a card people scan for what
 * they can eat, "+3 more" must not look like a dietary claim.
 */
function MoreLabel({ label }: { readonly label: string }) {
    return (
        <View className="min-h-[24px] justify-center rounded-full border border-stroke-subtle bg-surface-sunken px-2.5">
            <RNText className="text-xs font-semibold text-content-secondary">{label}</RNText>
        </View>
    );
}

export function TagCluster({ tags, maxRows = 2, testID }: TagClusterProps) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const [available, setAvailable] = useState<number | null>(null);
    const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});

    const clamping = atLeast('md') && tags.length > 0;

    const record = (key: string) => (event: LayoutChangeEvent) => {
        const width = Math.ceil(event.nativeEvent.layout.width);
        setWidths((current) => (current[key] === width ? current : { ...current, [key]: width }));
    };

    const measured: number[] = [];
    for (const tag of tags) {
        const width = widths[tag.key];
        if (width !== undefined) measured.push(width);
    }
    const moreWidth = widths[MORE_KEY];

    // Everything, or nothing: a count computed from a half-measured set would clamp to a width that
    // is not the one the row will be laid out at.
    const visible =
        clamping && available !== null && moreWidth !== undefined && measured.length === tags.length
            ? fittingCount(measured, moreWidth, available, maxRows)
            : tags.length;
    const hidden = tags.length - visible;

    if (tags.length === 0) return null;

    if (!clamping) {
        return (
            <View testID={testID} className="flex-row flex-wrap gap-1.5">
                {tags.map((tag) => (
                    <TagLabel key={tag.key} label={tag.label} />
                ))}
            </View>
        );
    }

    return (
        <View className="relative">
            {/*
             * The mirror. Zero height and clipped, so it contributes nothing to the row above or
             * below it, and hidden from assistive technology so the labels are not announced twice.
             * It never wraps: a label's own width is what the packing needs, not the width it
             * happens to be given on a line.
             */}
            <View
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute start-0 end-0 top-0 h-0 flex-row flex-nowrap overflow-hidden opacity-0"
            >
                {tags.map((tag) => (
                    <View key={tag.key} onLayout={record(tag.key)}>
                        <TagLabel label={tag.label} />
                    </View>
                ))}
                <View onLayout={record(MORE_KEY)}>
                    <MoreLabel label={t('marketplace:tags.more', { n: tags.length })} />
                </View>
            </View>

            <View
                testID={testID}
                onLayout={(event) => {
                    setAvailable(Math.floor(event.nativeEvent.layout.width));
                }}
            >
                <View
                    className="flex-row flex-wrap gap-1.5 overflow-hidden"
                    style={{ maxHeight: maxRows * ROW_HEIGHT + (maxRows - 1) * GAP }}
                >
                    {tags.slice(0, visible).map((tag) => (
                        <TagLabel key={tag.key} label={tag.label} />
                    ))}
                    {hidden > 0 ? (
                        <View testID={testID === undefined ? undefined : `${testID}-more`}>
                            <MoreLabel label={t('marketplace:tags.more', { n: hidden })} />
                        </View>
                    ) : null}
                </View>
            </View>
        </View>
    );
}
