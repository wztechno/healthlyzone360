import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

/**
 * The opening panel of a HealthZone browse surface: a standing fact, a claim, and the controls
 * that narrow what is below it — all inside one raised card on the page surface.
 *
 * ## Why a third opening, beside `PageHero` and `ListingHeader`
 *
 * `PageHero` is a *band*: two gradients and a scrim, and light copy over colour. `ListingHeader` is
 * the flat opening a filterable catalogue uses, where the count is the subtitle and one control
 * sits on the title's baseline. Neither holds a filter *set*. HealthZone's browse screen opens on a
 * card that does: the headline and the chips that narrow the grid are the same object, so the
 * question ("which kitchen cooks the way you eat?") and the way to answer it are never separated by
 * a rule, a band edge, or a scroll.
 *
 * That is also why the chips live in a slot rather than in a prop. A filter chip is a control with
 * URL state behind it — the screen owns which chips exist, what each one does, and which of them is
 * lit. This panel owns the shape they sit in and nothing else.
 *
 * ## The eyebrow is a fact, not a label
 *
 * HealthZone writes a live count above the headline ("18 kitchens delivering to 94110 right now").
 * It is announced rather than merely redrawn: the number moves when a chip is pressed, and a screen
 * reader user gets no other signal that the grid behind it is now shorter. The postcode half of the
 * design's line has no data behind it here and is deliberately not invented — see
 * `kitchens-screen.tsx`.
 */
export interface BrowsePanelProps {
    /** The standing fact above the title — a live count. Omitted until there is one to state. */
    readonly eyebrow?: string | undefined;
    /** The page's `h1`. A claim, in the display face, at the size nothing else on the page uses. */
    readonly title: string;
    /** The filter chips. Laid out as one wrapping row, in the order the screen supplies them. */
    readonly children?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

export function BrowsePanel({
    eyebrow,
    title,
    children,
    testID = 'browse-panel',
}: BrowsePanelProps) {
    return (
        <View
            testID={testID}
            className="rounded-xl border border-stroke-subtle bg-surface-raised p-6 md:p-8"
        >
            {eyebrow === undefined ? null : (
                <RNText
                    testID={`${testID}-eyebrow`}
                    role="status"
                    aria-live="polite"
                    className="pb-3 text-xs font-semibold uppercase tracking-widest text-content-secondary text-start"
                >
                    {eyebrow}
                </RNText>
            )}

            <RNText
                testID={`${testID}-title`}
                accessibilityRole="header"
                aria-level={1}
                /*
                 * `text-4xl` stepping to `text-5xl` above `md`, which is the pair the token scale
                 * offers against the design's `clamp(30px, 3.4vw, 44px)`. CLAUDE.md is explicit
                 * that the hand-written in-between sizes are mood-board artefacts.
                 *
                 * The measure is a width rather than a `ch`, which React Native does not resolve:
                 * the design balances this headline over two lines, and past about 20 characters a
                 * line the claim stops reading as one sentence.
                 */
                className="max-w-[620px] font-display text-4xl leading-[1.05] tracking-display text-content-primary text-start md:text-5xl"
            >
                {title}
            </RNText>

            {children === undefined ? null : (
                <View
                    testID={`${testID}-controls`}
                    className="flex-row flex-wrap items-center gap-2 pt-5"
                >
                    {children}
                </View>
            )}
        </View>
    );
}
