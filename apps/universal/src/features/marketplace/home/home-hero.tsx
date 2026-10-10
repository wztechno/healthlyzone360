import { gradients } from '@healthy360/design-tokens';
import { useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { Eyebrow } from '../../../ui/eyebrow.tsx';

export interface HomeHeroLayoutProps {
    readonly testID: string;
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    /** The primary and the white secondary button, in that order. */
    readonly actions: ReactNode;
    readonly imageLabel: string;
    readonly imageAssetId: string | undefined;
    readonly imageSeed: string;
    /** The white card over the photograph's foot: an eyebrow and "name · price". */
    readonly overlay: { readonly label: string; readonly value: string } | undefined;
}

/**
 * The home's opening, drawn to HealthZone's `home` hero rather than through `ui/storefront-hero`.
 *
 * Same idea as that component — a canopy claim beside a photograph, `1.05fr 1fr` — but the home's
 * is the largest type on the site and the shared one is set for a kitchen's name: a 60-unit
 * three-line headline against 48, a 440-unit floor so the two columns open at the design's height
 * whatever the copy, the eyebrow and overlay label on the shared `Eyebrow`, and the overlay card on
 * the page colour (`--surface2`) rather than on a raised white. Built here rather than by widening
 * the shared one for one caller; the report proposes folding it back.
 *
 * The scrim is kept for the same reason the shared hero keeps it: canopy-muted body copy is only AA
 * against the flat deep end of the sweep.
 */
export function HomeHeroLayout({
    testID,
    eyebrow,
    title,
    body,
    actions,
    imageLabel,
    imageAssetId,
    imageSeed,
    overlay,
}: HomeHeroLayoutProps) {
    const isRtl = useIsRtl();

    return (
        <View testID={testID} className="flex-col items-stretch gap-7 lg:flex-row">
            <View
                testID={`${testID}-panel`}
                className="overflow-hidden rounded-xl lg:min-h-[440px] lg:flex-[1.05]"
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
                    start={isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 }}
                    end={isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                />

                {/* The claim at the top, the buttons at the foot: the design's space-between. */}
                <View className="flex-1 justify-between gap-8 p-8 lg:px-11 lg:pb-10 lg:pt-11">
                    <View className="flex-col">
                        <Eyebrow testID={`${testID}-eyebrow`} tone="canopy">
                            {eyebrow}
                        </Eyebrow>
                        <RNText
                            testID={`${testID}-title`}
                            accessibilityRole="header"
                            aria-level={1}
                            className="mt-4 font-display text-4xl font-bold leading-[40px] tracking-display text-content-on-canopy text-start sm:text-5xl sm:leading-[48px] lg:text-6xl lg:leading-[58px]"
                        >
                            {title}
                        </RNText>
                        {/* The design's 42ch measure, as the width it comes to at this size. */}
                        <RNText
                            testID={`${testID}-body`}
                            className="mt-3 max-w-[420px] text-base leading-[26px] text-content-on-canopy-muted text-start"
                        >
                            {body}
                        </RNText>
                    </View>

                    <View className="flex-row flex-wrap gap-2.5">{actions}</View>
                </View>
            </View>

            <View
                testID={`${testID}-media`}
                className="relative overflow-hidden rounded-xl lg:min-h-[440px] lg:flex-1"
            >
                <View className="lg:absolute lg:inset-0">
                    <EntityImage
                        testID={`${testID}-image`}
                        assetId={imageAssetId}
                        seed={imageSeed}
                        label={imageLabel}
                        aspect="card"
                        decorative
                        flush
                        className="lg:h-full"
                    />
                </View>

                {overlay === undefined ? null : (
                    <View
                        testID={`${testID}-overlay`}
                        className="absolute bottom-5 start-5 max-w-[70%] rounded-lg bg-surface-base px-4 py-3"
                    >
                        <Eyebrow>{overlay.label}</Eyebrow>
                        <RNText className="mt-1 font-display text-xl font-bold tracking-display tabular-nums text-content-primary text-start">
                            {overlay.value}
                        </RNText>
                    </View>
                )}
            </View>
        </View>
    );
}
