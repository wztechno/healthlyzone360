import { Breadcrumbs } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import { useIsRtl } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

/**
 * The canopy band a browse, list or landing page opens with.
 *
 * ## Why this exists
 *
 * Every listing in the product used to open the same way — a breadcrumb, an H1, a subtitle and then
 * a form field — so nothing above the fold said what kind of place you had arrived at. The band is
 * the moment of weight: it names the page in the display face at a size nothing else on the screen
 * uses, and it gives the search or the primary pair of actions somewhere to live that is not the
 * top of the content.
 *
 * It is deliberately **not** for editors or settings screens. Those have no hero content, and a
 * 48px heading over a form is decoration pretending to be hierarchy (§4, Rule 3).
 *
 * ## Why there is a scrim, and why the alpha floor is not enough on its own
 *
 * §1.3 sets a minimum alpha of 0.62 for text on the canopy, measured against the flat colour
 * `#0B3B26`, where `rgba(220,252,231,0.62)` is 5.42:1. That floor does **not** hold across the
 * gradient: the same text is 4.43:1 over `surface-canopy-deep` and roughly 3.3:1 over the bright
 * stop the band runs into. Measured, not assumed — `packages/design-tokens/src/colour.test.ts`
 * pins it in the failing direction so this reason cannot quietly rot.
 *
 * So the band is three layers, following the pattern {@link BrandGradient} already proves in this
 * repository: the colour gradient, then a dark→transparent scrim along the *reading direction*, and
 * the content on top. Text therefore lands on the dark side and clears AA wherever it sits, while
 * the bright end still shows through where there is no text. An automated checker cannot measure
 * contrast over a gradient and would pass the band either way — the scrim is for the reader.
 *
 * The scrim runs along the writing direction rather than a fixed side, so it flips for Arabic
 * without the colour gradient having to mirror. That is the same reason `BrandGradient` does it,
 * and it is why the hero needs no `rtl:` variant, which NativeWind cannot honour on native anyway.
 *
 * The optional radial glow §1.2 describes is **not** here: `expo-linear-gradient` has no radial
 * mode, and §1.2 calls the glow optional. Approximating it with a second linear pass would be a
 * different effect wearing its name.
 */

/**
 * The canopy sweep: deep forest into a brighter green. Matches §1.2's 135° gradient.
 *
 * Exported so {@link StorefrontHero} paints the same band from the same three values. Two heroes
 * carrying two copies of this sweep is how they drift a shade apart and the difference gets blamed
 * on the screen rather than on the duplication.
 */
export const CANOPY_COLOURS = ['#0b3b26', '#124f33', '#0e6b41'] as const;
export const CANOPY_LOCATIONS = [0, 0.58, 1] as const;

/**
 * How dark the leading edge of the scrim is.
 *
 * Enough that the mint body copy clears AA at the bright end of the sweep, which is the whole
 * reason the layer exists. The trailing end stays largely transparent so the band still brightens.
 */
export const SCRIM = ['rgba(11,59,38,0.92)', 'rgba(11,59,38,0.35)'] as const;

export interface PageHeroProps {
    /** Rendered inside the band, so the page's position is part of its opening rather than above it. */
    readonly breadcrumbs?: readonly BreadcrumbItem[] | undefined;
    readonly title: string;
    readonly subtitle?: string | undefined;
    /** Short facts about the listing — counts, filters in force. Pills, not controls. */
    readonly chips?: readonly string[] | undefined;
    /** The trailing column: a search panel, or a pair of calls to action. */
    readonly trailing?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

export function PageHero({
    breadcrumbs,
    title,
    subtitle,
    chips,
    trailing,
    testID = 'page-hero',
}: PageHeroProps) {
    const isRtl = useIsRtl();
    const scrimStart = isRtl ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const scrimEnd = isRtl ? { x: 0, y: 0 } : { x: 1, y: 0 };

    return (
        <View testID={testID} className="overflow-hidden rounded-xl">
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

            <View className="flex-row flex-wrap items-start justify-between gap-6 p-8">
                <View className="min-w-[280px] flex-1 flex-col gap-3">
                    {breadcrumbs === undefined || breadcrumbs.length === 0 ? null : (
                        <Breadcrumbs
                            testID={`${testID}-breadcrumbs`}
                            items={breadcrumbs}
                            tone="canopy"
                        />
                    )}

                    <RNText
                        testID={`${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        // `text-5xl` with the display leading pulled in, and the one place
                        // `tracking-display` is for: at 48px, normal tracking reads loose and
                        // `tracking-tight` (−0.4px) is a tenth of what is needed.
                        className="text-5xl leading-[1.05] tracking-display text-content-on-canopy text-start"
                    >
                        {title}
                    </RNText>

                    {subtitle === undefined ? null : (
                        <RNText
                            testID={`${testID}-subtitle`}
                            // A measure, not a width: past about 60 characters the eye loses the
                            // start of the next line. `ch` is not a unit React Native resolves, so
                            // this is the pixel equivalent at this size.
                            className="max-w-[640px] text-base text-content-on-canopy-muted text-start"
                        >
                            {subtitle}
                        </RNText>
                    )}

                    {chips === undefined || chips.length === 0 ? null : (
                        <View
                            testID={`${testID}-chips`}
                            className="flex-row flex-wrap items-center gap-2 pt-1"
                        >
                            {chips.map((chip) => (
                                <View
                                    key={chip}
                                    className="min-h-touch justify-center rounded-full border border-content-on-canopy-muted/30 bg-surface-raised/10 px-4"
                                >
                                    <RNText className="text-sm font-medium text-content-on-canopy-muted">
                                        {chip}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {trailing === undefined ? null : (
                    <View
                        testID={`${testID}-trailing`}
                        className="w-full flex-col gap-3 md:w-[380px]"
                    >
                        {trailing}
                    </View>
                )}
            </View>
        </View>
    );
}
