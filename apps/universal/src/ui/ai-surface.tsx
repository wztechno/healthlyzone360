import { Button } from '@healthy360/design-system';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, View } from 'react-native';

/**
 * The two violet surfaces, and the only two.
 *
 * Rule 5 gives `accent-surface` one job: marking machine-generated content. Not premium, not
 * "featured", not a band that happens to want attention — during this pass two panels were found
 * wearing violet for exactly those reasons, one of them a call to action offering a *human*
 * dietitian, which is the confusion the rule exists to prevent. Keeping both surfaces in one file
 * is part of enforcing that: there is a single place to look to see everywhere violet appears as
 * meaning, and adding a third means editing this file and answering the question.
 *
 * ## Why neither needs a scrim, and {@link PageHero} does
 *
 * The canopy band runs into a bright green and its mint body copy fails AA over the far stop, so
 * that band carries a dark→transparent scrim between the colour and the content. This gradient
 * never gets light enough to need one. Measured with the repository's own `contrastRatio`, white
 * is 7.1:1 over `#6D28D9`, 10.95:1 over `#4C1D95` and 6.12:1 over the `#157043` endpoint — which
 * is in fact the *lightest* stop of the three, not the violet, and the reason the numbers were run
 * rather than eyeballed.
 *
 * The body copy is where it mattered. Mint at 85% — the opacity the canopy band uses — is 4.52:1
 * over that green stop, two hundredths above the line, so it sits at 95% here instead: 5.21:1 at
 * the worst stop, which is margin rather than luck.
 *
 * That margin turned out to be necessary rather than cautious. §4 puts the green at 160%, past the
 * visible range, where it would only tint the far corner — but `expo-linear-gradient` clamps stop
 * locations to 1, so it renders at 100% and the corner really does reach `#157043`. Checked in the
 * browser, not assumed: the computed value comes back `… rgb(21, 112, 67) 100%`.
 *
 * ## On the angles
 *
 * `expo-linear-gradient` takes normalised start and end points, not a CSS angle, so §4's 120deg
 * and 150deg are approximated by the endpoints below rather than stated. The first attempt used
 * bottom-left → top-right, which resolves to 45deg — the mirror of what was asked for, and visible
 * as such. These sweep top-left to bottom-right, which is the direction the design draws.
 *
 * ## The pill is not decoration either
 *
 * `AI DIETITIAN` is stated in words on the surface itself, because Rule 5's other half — and the
 * thing `virtual-dietitian/state-presentation.ts` asserts by test — is that machine origin is never
 * carried by colour alone. Somebody who cannot see the violet must still be told.
 */

/**
 * §4 Rule 5: `linear-gradient(120deg, #6D28D9 0%, #4C1D95 62%, #157043 160%)`.
 *
 * The third stop is written at 1 rather than 1.6 because that is what actually renders — the
 * library clamps it — and a constant that says 1.6 while the browser draws 1.0 is a lie that
 * costs somebody an afternoon.
 */
const BAND_COLOURS = ['#6d28d9', '#4c1d95', '#157043'] as const;
const BAND_LOCATIONS = [0, 0.62, 1] as const;

/** The rail's own sweep — steeper, and only the two violets. */
const RAIL_COLOURS = ['#6d28d9', '#4c1d95'] as const;

function OriginPill({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    return (
        <View
            testID={testID}
            className="self-start rounded-full border border-content-on-canopy/30 bg-surface-raised/15 px-3 py-1"
        >
            <RNText className="text-xs font-bold uppercase tracking-widest text-content-on-canopy">
                {t('virtualDietitian:origin.ai')}
            </RNText>
        </View>
    );
}

export interface AiBandProps {
    readonly title: string;
    readonly body: string;
    /** The single call to action. One, deliberately — a band offering three is a menu. */
    readonly actionLabel: string;
    readonly onAction: () => void;
    readonly testID?: string | undefined;
}

/**
 * The full-width band. One headline, one line of body, one white call to action.
 */
export function AiBand({ title, body, actionLabel, onAction, testID = 'ai-band' }: AiBandProps) {
    return (
        <View
            testID={testID}
            // The shadow is violet-tinted rather than neutral, for the same reason the card
            // elevation is canopy-tinted: a grey cast under a saturated panel reads as grime.
            className="overflow-hidden rounded-xl shadow-elevation-card-hover"
        >
            <LinearGradient
                colors={BAND_COLOURS}
                locations={BAND_LOCATIONS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={StyleSheet.absoluteFill}
            />

            <View className="flex-row flex-wrap items-center justify-between gap-4 p-6">
                <View className="min-w-[260px] flex-1 flex-col gap-2">
                    <OriginPill testID={`${testID}-origin`} />
                    <RNText
                        testID={`${testID}-title`}
                        className="font-display text-xl leading-tight tracking-display text-content-on-canopy text-start"
                    >
                        {title}
                    </RNText>
                    <RNText className="max-w-[560px] text-sm text-content-on-canopy-muted/95 text-start">
                        {body}
                    </RNText>
                </View>

                {/*
                 * `secondary` is the white fill on this surface — a `primary` here would be
                 * brand-green on violet, which is two brand colours fighting for the same button.
                 */}
                <Button
                    testID={`${testID}-action`}
                    variant="secondary"
                    label={actionLabel}
                    onPress={onAction}
                />
            </View>
        </View>
    );
}

export interface AiRailCardProps {
    readonly title: string;
    readonly body: string;
    readonly actionLabel: string;
    readonly onAction: () => void;
    readonly testID?: string | undefined;
}

/**
 * The narrow form, for a column beside content rather than a band across it.
 *
 * Same pill and same vocabulary as {@link AiBand}, stacked instead of laid out in a row: at rail
 * width a headline and a button on one line would give the button about forty pixels.
 */
export function AiRailCard({
    title,
    body,
    actionLabel,
    onAction,
    testID = 'ai-rail-card',
}: AiRailCardProps) {
    return (
        <View testID={testID} className="overflow-hidden rounded-xl shadow-elevation-card">
            <LinearGradient
                colors={RAIL_COLOURS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />

            <View className="flex-col gap-3 p-5">
                <OriginPill testID={`${testID}-origin`} />
                <RNText
                    testID={`${testID}-title`}
                    className="font-display text-xl leading-tight tracking-display text-content-on-canopy text-start"
                >
                    {title}
                </RNText>
                <RNText className="text-sm text-content-on-canopy-muted/95 text-start">
                    {body}
                </RNText>
                <Button
                    testID={`${testID}-action`}
                    variant="secondary"
                    block
                    label={actionLabel}
                    onPress={onAction}
                />
            </View>
        </View>
    );
}
