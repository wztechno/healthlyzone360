import { Inline } from '@healthy360/design-system';
import { useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { ImageRequireSource } from 'react-native';

import { EntityImage } from '../media/entity-image.tsx';
import { CANOPY_COLOURS, CANOPY_LOCATIONS, SCRIM } from './page-hero.tsx';

/**
 * The split hero a storefront opens with — a canopy panel beside a photograph.
 *
 * ## How it differs from {@link PageHero}, and why both exist
 *
 * `PageHero` names a page: a band with a heading, a subtitle and a slot for the one thing you came
 * to do. It suits a *listing*, where the content below is the point and the band is a label on it.
 *
 * This is for a *storefront*, where the opening has to sell before it labels. The claim gets a
 * panel of its own at display size and the food gets equal billing beside it, because on a page
 * whose job is appetite, a photograph is not decoration — it is half the argument. The two are
 * siblings rather than variants of one component: folding them together would mean a single hero
 * branching on `hasImage` through its whole layout, and the two have different reasons to change.
 *
 * ## The panel and the photograph are one row that becomes two
 *
 * Side by side from `lg` up, stacked below it. The panel takes slightly more of the row than the
 * photograph — the design's `1.05fr 1fr` — because the headline sets to three lines at display size
 * and a narrower column breaks it to four, which changes where the eye lands.
 *
 * Both columns stretch to the taller of the two rather than being pinned to a fixed height. A
 * `min-h` here would be a guess that a translated headline eventually outgrows: Arabic runs longer
 * than English at the same point size, and a fixed band is exactly where that overflows.
 *
 * ## The scrim is not optional
 *
 * Same three layers and the same reasoning as `PageHero`: the colour sweep, a dark→transparent
 * scrim along the reading direction, then the content. The alpha floor for canopy text is measured
 * against the *flat* deep forest, and the sweep runs brighter than that at its far end — so without
 * the scrim the body copy fails AA over the bright stop. The gradient constants come from
 * `page-hero.tsx` so the two bands cannot drift apart.
 */
export interface StorefrontHeroProps {
    /** Standing fact above the headline — a delivery area, a next slot. Set in caps by the caller. */
    readonly eyebrow?: string | undefined;
    readonly title: string;
    readonly body?: string | undefined;
    /** The calls to action. Typically a primary and one quieter alternative. */
    readonly actions?: ReactNode;
    readonly imageSeed: string;
    readonly imageLabel: string;
    readonly imageSource?: ImageRequireSource | null | undefined;
    /**
     * An entity's own photograph, when the hero is showing a real thing rather than a marketing
     * slot. Takes effect only where `imageSource` is absent, matching `EntityImage`'s precedence.
     */
    readonly imageAssetId?: string | undefined;
    /**
     * The card over the foot of the photograph — what the picture is, and what it costs. Omitted
     * rather than filled with placeholder text when there is nothing true to put in it.
     */
    readonly overlay?: { readonly label: string; readonly value: string } | undefined;
    readonly testID?: string | undefined;
}

export function StorefrontHero({
    eyebrow,
    title,
    body,
    actions,
    imageSeed,
    imageLabel,
    imageSource,
    imageAssetId,
    overlay,
    testID = 'storefront-hero',
}: StorefrontHeroProps) {
    const isRtl = useIsRtl();
    const scrimStart = isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const scrimEnd = isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 };

    return (
        <View testID={testID} className="flex-col items-stretch gap-6 lg:flex-row">
            <View
                testID={`${testID}-panel`}
                // `lg:flex-[1.05]` against the photograph's `flex-1` is the design's 1.05fr 1fr.
                className="flex-1 overflow-hidden rounded-xl lg:flex-[1.05]"
            >
                <LinearGradient
                    colors={CANOPY_COLOURS}
                    locations={CANOPY_LOCATIONS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                />
                <LinearGradient
                    colors={SCRIM}
                    start={scrimStart}
                    end={scrimEnd}
                    style={StyleSheet.absoluteFill}
                />

                {/*
                 * `justify-between` with the actions in their own group: the claim sits at the top
                 * of the panel and the buttons at the bottom, so the panel's height is set by the
                 * photograph beside it without leaving the copy floating in the middle.
                 */}
                <View className="flex-1 justify-between gap-8 p-8 lg:p-11">
                    <View className="flex-col gap-4">
                        {eyebrow === undefined ? null : (
                            <RNText
                                testID={`${testID}-eyebrow`}
                                className="text-xs font-semibold uppercase tracking-widest text-content-on-canopy-muted text-start"
                            >
                                {eyebrow}
                            </RNText>
                        )}

                        <RNText
                            testID={`${testID}-title`}
                            accessibilityRole="header"
                            aria-level={1}
                            className="text-5xl leading-[1.05] tracking-display text-content-on-canopy text-start"
                        >
                            {title}
                        </RNText>

                        {body === undefined ? null : (
                            /*
                             * A measure in px, not `ch`. React Native does not resolve `ch`, so the
                             * design's 42-character measure is carried as the width that produces
                             * it at this size — the same substitution `PageHero` makes.
                             */
                            <RNText
                                testID={`${testID}-body`}
                                className="max-w-[480px] text-base leading-6 text-content-on-canopy-muted text-start"
                            >
                                {body}
                            </RNText>
                        )}
                    </View>

                    {actions === undefined ? null : (
                        <Inline space="sm" wrap>
                            {actions}
                        </Inline>
                    )}
                </View>
            </View>

            <View testID={`${testID}-media`} className="flex-1 overflow-hidden rounded-xl">
                {/*
                 * 4:3 rather than 16:9. At the width this column takes on a capped page, 4:3 lands
                 * within a few pixels of the panel's natural height, so the two columns finish
                 * level without either being pinned to a fixed height.
                 */}
                <EntityImage
                    testID={`${testID}-image`}
                    source={imageSource}
                    assetId={imageAssetId}
                    seed={imageSeed}
                    label={imageLabel}
                    aspect="card"
                    decorative
                    flush
                />

                {overlay === undefined ? null : (
                    /*
                     * Bottom-leading, which is neither of `EntityImage`'s overlay slots — those are
                     * top-leading and bottom-trailing. Positioned here rather than by widening that
                     * component's API for one caller. Logical insets, so it sits at the reading
                     * edge in both directions.
                     */
                    <View
                        testID={`${testID}-overlay`}
                        className="absolute bottom-5 start-5 max-w-[70%] rounded-lg bg-surface-raised p-4 shadow-elevation-2"
                    >
                        <RNText className="text-xs font-semibold uppercase tracking-widest text-content-secondary text-start">
                            {overlay.label}
                        </RNText>
                        <RNText className="mt-1 text-xl tracking-display text-content-primary text-start">
                            {overlay.value}
                        </RNText>
                    </View>
                )}
            </View>
        </View>
    );
}
