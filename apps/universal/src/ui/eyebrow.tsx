import { cx } from '@healthy360/design-system';
import { Text as RNText } from 'react-native';

/**
 * The small uppercase label HealthZone sets above a heading, a figure or a group — "ORDER
 * SUMMARY", "DIETARY PREFERENCES · APPLIED TO RECOMMENDATIONS", "LUNCH CUTOFF 11:30 AM".
 *
 * The design draws it in IBM Plex Mono at 11px with `.1em` tracking. Mono is not coming back
 * (CLAUDE.md, "Sequencing"), so it is Inter at the nearest step — `text-xs`, uppercase,
 * `tracking-widest` — which keeps the one thing the mono was doing: reading as a label, not prose.
 *
 * One component, because every customer screen uses it and five local copies had already begun to
 * disagree on weight and tracking. The tone follows the surface it sits on, never a literal.
 */
export type EyebrowTone = 'secondary' | 'primary' | 'brand' | 'canopy';

const TONE_CLASS: Readonly<Record<EyebrowTone, string>> = {
    secondary: 'text-content-secondary',
    primary: 'text-content-primary',
    brand: 'text-content-on-brand-subtle',
    canopy: 'text-content-on-canopy-muted',
};

export interface EyebrowProps {
    readonly children: string;
    readonly tone?: EyebrowTone | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Eyebrow({ children, tone = 'secondary', className, testID }: EyebrowProps) {
    return (
        <RNText
            testID={testID}
            className={cx(
                'text-xs font-medium uppercase tracking-widest text-start',
                TONE_CLASS[tone],
                className,
            )}
        >
            {children}
        </RNText>
    );
}
