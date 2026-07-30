import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export const SPINNER_SIZES = ['small', 'large'] as const;
export type SpinnerSize = (typeof SPINNER_SIZES)[number];

export interface SpinnerProps {
    readonly size?: SpinnerSize | undefined;
    /** Accessible name. Defaults to the translated "Loading…". */
    readonly label?: string | undefined;
    /** Show the label as text beside the indicator as well as announcing it. */
    readonly showLabel?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Spinner.
 *
 * `role="progressbar"` with no `aria-valuenow` is the correct encoding for an indeterminate
 * progress indicator, and `aria-busy` tells assistive technology the region is still settling.
 * A bare `ActivityIndicator` announces nothing at all, which leaves a screen reader user with
 * silence where a sighted user sees motion.
 */
export function Spinner({
    size = 'small',
    label,
    showLabel = false,
    className,
    testID,
}: SpinnerProps) {
    const { t } = useTranslation();
    const text = label ?? t('common:state.loading');

    return (
        <View
            testID={testID}
            role="progressbar"
            accessibilityRole="progressbar"
            accessibilityLabel={text}
            aria-label={text}
            aria-busy
            aria-live="polite"
            className={cx('flex-row items-center gap-2', className)}
        >
            <ActivityIndicator size={size} accessibilityElementsHidden aria-hidden />
            {showLabel ? (
                <RNText className="text-sm text-content-secondary text-start">{text}</RNText>
            ) : null}
        </View>
    );
}
