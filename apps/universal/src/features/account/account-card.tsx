import { Text as RNText } from 'react-native';

/**
 * The pieces every panel of the HealthZone `account` screen is built from.
 *
 * The design draws Orders, Profile, Addresses, Payment methods and Notifications as the same white
 * card — `--card` on a `--line` hairline, 16px corners — with a 21px display-face title. Written
 * once here so the five panels cannot drift apart; the preference row's `chip()` pills are the
 * shared `PillChip`.
 */

/** The design's card: raised fill, default hairline, 16px corners. Padding is the caller's. */
export const ACCOUNT_CARD = 'flex-col rounded-xl border border-stroke bg-surface-raised';

/**
 * The card title — the design's `font:700 21px var(--f-display)`, snapped to `text-xl`. Not
 * `Heading`: its level 2 is `text-2xl` on the customer ladder, a step larger than the design.
 */
export function PanelTitle({
    children,
    testID,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
}) {
    return (
        <RNText
            testID={testID}
            accessibilityRole="header"
            aria-level={2}
            className="font-display text-xl font-bold tracking-display text-content-primary text-start"
        >
            {children}
        </RNText>
    );
}
