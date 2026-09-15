import { Breadcrumbs } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

/**
 * The opening of a HealthZone listing: a trail, a title, the count, and one control beside them.
 *
 * ## Why this is not a `PageHero` variant
 *
 * `PageHero` is a *band* — two stacked gradients, a directional scrim, and light text sitting on
 * top of them. Everything it does exists to make copy legible over colour. This has no colour to be
 * legible over: it is body text on the page surface, and the weight comes from the size of the
 * title and the space around it rather than from a filled rectangle. Adding a `variant="flat"` to
 * the hero would mean a component whose entire reason for existing is switched off in half its call
 * sites, so the two are siblings under `ui/` instead. The canopy band is still right for
 * `/kitchens` and `/dietitians`, which keep using it.
 *
 * ## The count is the subtitle
 *
 * HealthZone's catalogue writes the result count where a listing usually writes a description, and
 * that is the better use of the line: "Showing 6 of 40" moves when a filter changes, and a sentence
 * about the catalogue does not. `meta` is deliberately a plain string the screen has already
 * pluralised and translated — splitting a sentence around its number does not survive Arabic.
 *
 * ## `trailing` sits on the title's baseline, not above it
 *
 * The row is `items-end`, so a sort control beside a 36px title lines up with the title's foot
 * rather than floating against its cap. It wraps below the title block on a narrow viewport, which
 * is why the block carries `min-w-[280px]`: without it the two children share the width and the
 * title breaks a word per line long before the row is actually too tight.
 */
export interface ListingHeaderProps {
    /** Above the title, on the page surface — not inside a band, so `tone="default"`. */
    readonly breadcrumbs?: readonly BreadcrumbItem[] | undefined;
    readonly title: string;
    /** The line under the title. On a filterable listing this is the result count. */
    readonly meta?: string | undefined;
    /** One control on the title's baseline — a sort `Select`, or a primary action. */
    readonly trailing?: ReactNode | undefined;
    /**
     * Override the derived handle for the meta line. A testID is a contract with the suites that
     * already point at it, and a count that moves from a toolbar into this header is the same
     * count — renaming it to suit a new component's scheme is churn paid for by whoever has to
     * re-find it.
     */
    readonly metaTestID?: string | undefined;
    readonly testID?: string | undefined;
}

export function ListingHeader({
    breadcrumbs,
    title,
    meta,
    trailing,
    metaTestID,
    testID = 'listing-header',
}: ListingHeaderProps) {
    return (
        <View testID={testID} className="flex-col gap-3">
            {breadcrumbs === undefined || breadcrumbs.length === 0 ? null : (
                <Breadcrumbs testID={`${testID}-breadcrumbs`} items={breadcrumbs} />
            )}

            <View className="flex-row flex-wrap items-end justify-between gap-5">
                <View className="min-w-[280px] flex-1 flex-col gap-1.5">
                    <RNText
                        testID={`${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        /*
                         * `text-4xl` (36px), the nearest step to the design's hand-written 40 —
                         * CLAUDE.md is explicit that those in-between sizes are mood-board
                         * artefacts and snap to the scale. `tracking-display` is the pass that
                         * makes a display face read as one word at this size; normal tracking is
                         * visibly loose above about 30px.
                         */
                        className="text-4xl leading-[1.05] tracking-display text-content-primary text-start"
                    >
                        {title}
                    </RNText>

                    {meta === undefined ? null : (
                        <RNText
                            testID={metaTestID ?? `${testID}-meta`}
                            /*
                             * Announced, not merely redrawn: this line is how a filter change
                             * reports what it did, and a screen reader user gets no other signal
                             * that the grid behind it is now shorter.
                             */
                            role="status"
                            aria-live="polite"
                            className="max-w-[640px] text-base text-content-secondary text-start"
                        >
                            {meta}
                        </RNText>
                    )}
                </View>

                {trailing === undefined ? null : (
                    <View testID={`${testID}-trailing`} className="flex-col justify-end">
                        {trailing}
                    </View>
                )}
            </View>
        </View>
    );
}
