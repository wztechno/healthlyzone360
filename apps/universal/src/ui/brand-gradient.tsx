import { cx } from '@healthy360/design-system';
import { gradients } from '@healthy360/design-tokens';
import { useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * The mood board's signature green→violet gradient, as a legible surface.
 *
 * ## Why there are two gradients, not one
 *
 * White text over the vivid brand gradient is not legible on its own: white on the emerald midpoint
 * is 3.3:1 and on the lime highlight far less, well under WCAG AA. So a second, *leading-edge* scrim
 * (dark → transparent along the reading direction) sits between the colour and the content: the copy
 * lands on the dark side and clears AA, while the bright end of the gradient still shows through
 * where there is no text. axe cannot measure contrast over a gradient and would pass it regardless —
 * this is for the reader, not the checker.
 *
 * The scrim runs along the writing direction, so it flips for Arabic (dark on the right, where the
 * text now starts) without the colour gradient itself having to mirror.
 */
export type BrandGradientVariant = 'hero' | 'accent';

/**
 * The vivid colour gradient per variant — emerald → lime → violet for the hero, violet → emerald for
 * the AI accent — and the scrim laid over it. Both come from the token set, where the mood board's
 * palette lives. Diagonal, top-leading to bottom-trailing.
 */
const COLOUR = { hero: gradients.hero, accent: gradients.accent } as const;
const SCRIM = { hero: gradients.heroScrim, accent: gradients.accentScrim } as const;

export interface BrandGradientProps {
    readonly variant?: BrandGradientVariant | undefined;
    readonly children: ReactNode;
    /** Applied to the content layer (padding, gap, layout). */
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function BrandGradient({
    variant = 'hero',
    children,
    className,
    testID,
}: BrandGradientProps) {
    const isRtl = useIsRtl();
    // Colour runs corner-to-corner; the scrim runs along the writing direction so the dark side is
    // always where the text starts.
    const scrimStart = isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const scrimEnd = isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 };

    return (
        <View testID={testID} className="overflow-hidden rounded-3xl">
            <LinearGradient
                colors={COLOUR[variant].colours}
                locations={COLOUR[variant].locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={SCRIM[variant].colours}
                start={scrimStart}
                end={scrimEnd}
                style={StyleSheet.absoluteFill}
            />
            <View className={cx(className)}>{children}</View>
        </View>
    );
}
