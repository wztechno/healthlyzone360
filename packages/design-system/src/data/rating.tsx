import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const RATING_VARIANTS = ['stars', 'dots'] as const;
export type RatingVariant = (typeof RATING_VARIANTS)[number];

export const RATING_SIZES = ['sm', 'md'] as const;
export type RatingSize = (typeof RATING_SIZES)[number];

export interface RatingProps {
    /** What is being rated, e.g. "Average customer rating". Becomes the accessible name. */
    readonly label: string;
    readonly value: number;
    readonly max?: number | undefined;
    /** Number of ratings behind the average, shown in brackets when supplied. */
    readonly count?: number | undefined;
    readonly variant?: RatingVariant | undefined;
    readonly size?: RatingSize | undefined;
    /**
     * One glyph and the figure, rather than the whole scale.
     *
     * For a rating that has to share a line with something else — a card title, a row of a table —
     * where five glyphs plus a summary would take the line's whole width and push the title onto a
     * second one. The accessible name is unchanged: the scale is still announced in full, it is
     * simply not drawn five times.
     */
    readonly compact?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Rating — display only.
 *
 * Deliberately not interactive. Submitting a rating is a write to a backend that does not exist in
 * this phase, and a row of stars that looks pressable but changes nothing is precisely the dead
 * control the specification forbids. When rating submission is built it gets its own component with
 * its own radio-group semantics; this one stays a read-out.
 *
 * The glyphs are decorative and hidden from assistive technology. The **numeric label is always
 * rendered** — "4.6 / 5" as visible text — because counting partially filled stars is not something
 * a low-vision user, a screen reader user, or anyone in a hurry should be asked to do. `compact`
 * shortens that figure to the value alone beside a single glyph, which is legible for the same
 * reason a temperature beside a thermometer is; the scale stays in the accessible name.
 */
export function Rating({
    label,
    value,
    max = 5,
    count,
    variant = 'stars',
    size = 'md',
    compact = false,
    className,
    testID,
}: RatingProps) {
    const { t } = useTranslation();
    const safeMax = Math.max(1, Math.trunc(max));
    const clamped = Math.max(0, Math.min(safeMax, value));
    const filled = Math.round(clamped);
    const summary = t('designSystem:rating.summary', {
        value: clamped.toFixed(1),
        max: safeMax,
    });

    const glyphSize = size === 'sm' ? 'sm' : 'md';
    // One glyph in compact, and it is always the filled one: it is a mark saying "this is a
    // rating", not a bar to be read off. The value beside it carries the measurement.
    const glyphCount = compact ? 1 : safeMax;

    return (
        <View
            testID={testID}
            accessibilityRole="text"
            accessibilityLabel={
                count === undefined
                    ? `${label}: ${summary}`
                    : `${label}: ${summary}, ${t('designSystem:rating.count', { count })}`
            }
            className={cx('flex-row items-center gap-1.5', className)}
        >
            <View
                testID={testID === undefined ? undefined : `${testID}-glyphs`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="flex-row items-center gap-0.5"
            >
                {Array.from({ length: glyphCount }, (_unused, index) => (
                    <Icon
                        key={index}
                        size={glyphSize}
                        name={
                            variant === 'stars'
                                ? compact || index < filled
                                    ? 'star'
                                    : 'starOutline'
                                : compact || index < filled
                                  ? 'dot'
                                  : 'dotOutline'
                        }
                        className={
                            compact || index < filled ? 'text-rating' : 'text-content-secondary'
                        }
                    />
                ))}
            </View>

            <RNText
                testID={testID === undefined ? undefined : `${testID}-value`}
                className="text-sm font-medium text-content-primary"
            >
                {compact ? clamped.toFixed(1) : summary}
            </RNText>

            {count === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-count`}
                    className="text-xs text-content-secondary"
                >
                    {t('designSystem:rating.count', { count })}
                </RNText>
            )}
        </View>
    );
}
