import { Card, TagRow, cx } from '@healthy360/design-system';
import type { TagRowItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/** Shared by both title branches, so the link and the plain title are the same thing to read. */
const TITLE_CLASS = 'min-w-0 flex-1 text-lg leading-tight text-content-primary text-start';

/**
 * The card a browse grid is made of.
 *
 * ## Why one component and not four
 *
 * A kitchen and a meal are drawn the same way in HealthZone (`HealthZone.dc.html:772-791`): media,
 * then a name with one figure on its baseline, a line of prose, a row of small tags, and facts
 * pinned to the foot of the card behind a rule. Before this, each card rebuilt that shape by hand
 * and no two agreed — `padding="none"` with `px-4 pt-4` here, `padding="md"` there, `Card`'s
 * `footer` prop in three files and a hand-rolled `mt-auto` in the fourth, `border-stroke-subtle` in
 * one and `border-surface-sunken` in the next. Every spacing fix therefore had to be made four
 * times, and in practice was made once.
 *
 * So the geometry lives here, and the cards became adapters that say what their entity *is* rather
 * than how a card is built.
 *
 * **Two cards deliberately do not use it.** `catalogue/plan-card.tsx` is three stacked sections
 * around three controls — a comparison checkbox, a commitment picker and an open action — and
 * `marketplace/dietitian-card.tsx` leads with a portrait *beside* the name rather than media above
 * it. Both would have to be bent out of shape to fit, and bending the shared component to fit them
 * is how it stops being a shape at all. They share `Tag` and `TagRow` instead.
 *
 * ## The decisions inside it
 *
 * **`trailing` sits on the title's baseline.** It is the rating on a kitchen, the price on a meal.
 * It is also where a card puts the *absence* of one — "Not rated yet" belongs beside the name, not
 * on a line of its own, and giving it a line of its own is what turned a kitchen card into four
 * stacked scraps of small text.
 *
 * **The footer rule is inset, and the footer is still `Card`'s.** HealthZone draws the rule inside
 * the card's padding, so it spans the text column rather than the card. That is achieved with the
 * border on an inner view — *not* by abandoning `Card`'s `footer` prop, which is what pins the
 * footer to a common height across a row of cards whose bodies run to different lengths, and which
 * `catalogue.ltr.spec.ts` measures directly.
 *
 * **The hover lift follows the target.** `interactive` is passed only when the whole card is
 * pressable: a card that is merely a container for its own controls must not claim to be one.
 */
export interface BrowseCardFacts {
    /** The leading fact — a delivery time, a duration. */
    readonly start: string;
    /** The trailing fact — a fee, a price. */
    readonly end?: string | undefined;
    readonly startTestID?: string | undefined;
    readonly endTestID?: string | undefined;
}

export interface BrowseCardProps {
    /** The media band. An `EntityImage`, or nothing at all. */
    readonly media?: ReactNode | undefined;
    /**
     * Makes the photograph open the same place the title does, for a card whose title carries the
     * link because the card itself cannot (see `titleAction`).
     *
     * Deliberately **not** a second tab stop: it is `focusable={false}` and hidden from assistive
     * technology, because a screen reader announcing the same destination twice is worse than not
     * announcing the picture at all. It is a mouse and thumb convenience, restoring the half of
     * "press the card" that people actually aim at, and the design puts an `onClick` there for
     * exactly that reason.
     */
    readonly mediaAction?: (() => void) | undefined;
    readonly title: string;
    /** How many lines the title may run to before it truncates. */
    readonly titleLines?: number | undefined;
    /**
     * Makes the *title* the link instead of the card.
     *
     * For a card that carries a control of its own — an Add button, a comparison checkbox. A
     * control nested inside a pressable is unreachable by keyboard on the web and ambiguous on
     * touch (`nested-interactive`), so such a card is a plain grouping element and the title is
     * what you press. Name it with the same string the whole-card target would have used, or the
     * link is a quieter target than the card it replaces rather than an equivalent one.
     */
    readonly titleAction?:
        | {
              readonly onPress: () => void;
              readonly accessibilityLabel: string;
              readonly testID?: string | undefined;
          }
        | undefined;
    /** On the title's baseline: a `Rating`, a price, or the note that says there is no rating. */
    readonly trailing?: ReactNode | undefined;
    /** One or two lines of prose under the title. */
    readonly meta?: string | undefined;
    readonly metaLines?: number | undefined;
    /** For a reserved measure — `min-h-[40px]` keeps a one-line description level with a two. */
    readonly metaClassName?: string | undefined;
    readonly tags?: readonly TagRowItem[] | undefined;
    /** How many tags to draw before the rest collapse into a `+N`. */
    readonly maxTags?: number | undefined;
    /** Anything else the body carries, under the tags. */
    readonly children?: ReactNode | undefined;
    /** The two pinned facts. Use `footer` instead when the foot of the card carries a control. */
    readonly facts?: BrowseCardFacts | undefined;
    /** A footer that is not two facts — a price beside an Add button, say. Wins over `facts`. */
    readonly footer?: ReactNode | undefined;
    /**
     * `false` when the footer draws its own rule further down — a footer carrying two pinned lines
     * *above* the rule and a price below it. The padding stays; only the border goes.
     */
    readonly footerRule?: boolean | undefined;
    readonly onPress?: (() => void) | undefined;
    readonly accessibilityLabel?: string | undefined;
    readonly className?: string | undefined;
    readonly testID: string;
}

export function BrowseCard({
    media,
    mediaAction,
    title,
    titleLines = 2,
    titleAction,
    trailing,
    meta,
    metaLines = 2,
    metaClassName,
    tags,
    maxTags,
    children,
    facts,
    footer,
    footerRule = true,
    onPress,
    accessibilityLabel,
    className,
    testID,
}: BrowseCardProps) {
    const factsFooter =
        facts === undefined ? null : (
            <View className="flex-row items-baseline justify-between gap-3">
                <RNText
                    testID={facts.startTestID ?? `${testID}-fact-start`}
                    numberOfLines={1}
                    className="min-w-0 flex-1 text-xs text-content-secondary text-start"
                >
                    {facts.start}
                </RNText>
                {facts.end === undefined ? null : (
                    <RNText
                        testID={facts.endTestID ?? `${testID}-fact-end`}
                        numberOfLines={1}
                        className="text-xs text-content-secondary text-end"
                    >
                        {facts.end}
                    </RNText>
                )}
            </View>
        );

    const resolvedFooter = footer ?? factsFooter;

    return (
        <Card
            testID={testID}
            padding="none"
            tone="raised"
            interactive={onPress !== undefined}
            className={className ?? 'grow'}
            {...(onPress === undefined ? {} : { onPress })}
            {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
            {...(resolvedFooter === null
                ? {}
                : {
                      footer: footerRule ? (
                          // The padding is the footer's; the rule sits inside it, so it spans the
                          // text column the way the design draws it rather than the whole card.
                          <View className="px-4 pb-4">
                              <View className="border-t border-stroke-subtle pt-3">
                                  {resolvedFooter}
                              </View>
                          </View>
                      ) : (
                          <View className="px-4 pb-4 pt-3">{resolvedFooter}</View>
                      ),
                  })}
        >
            {media === undefined || mediaAction === undefined ? (
                media
            ) : (
                <Pressable
                    testID={`${testID}-media`}
                    onPress={mediaAction}
                    focusable={false}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    {media}
                </Pressable>
            )}

            {/*
             * `gap-2` is HealthZone's 7px, snapped to the scale. The body pays for its own inset
             * because the card is `padding="none"` — which is what lets the media sit flush to the
             * corner instead of floating inside a rounded box.
             *
             * `pb-2` is a floor, not a gap. The body takes the card's slack and the footer is
             * pinned under it, so on a card whose content happens to fill its cell — a kitchen
             * whose name runs to two lines, say — the last thing in the body came to rest directly
             * on the footer's own `pt-3` and the tag row sat crowded against the rule while its
             * neighbours in the same row had thirty units of air. This reserves the difference.
             * It costs nothing on a card with slack: there the free space is already below the
             * content, and the padding merely sits inside it.
             */}
            <View className="flex-col gap-2 px-4 pb-2 pt-4">
                <View className="flex-row items-baseline justify-between gap-2">
                    {titleAction === undefined ? (
                        <RNText
                            testID={`${testID}-title`}
                            numberOfLines={titleLines}
                            className={TITLE_CLASS}
                        >
                            {title}
                        </RNText>
                    ) : (
                        <Pressable
                            testID={titleAction.testID ?? `${testID}-open`}
                            role="link"
                            accessibilityRole="link"
                            accessibilityLabel={titleAction.accessibilityLabel}
                            focusable
                            onPress={titleAction.onPress}
                            className="min-w-0 flex-1"
                        >
                            <RNText
                                testID={`${testID}-title`}
                                numberOfLines={titleLines}
                                className={TITLE_CLASS}
                            >
                                {title}
                            </RNText>
                        </Pressable>
                    )}
                    {trailing}
                </View>

                {meta === undefined || meta === '' ? null : (
                    <RNText
                        testID={`${testID}-meta`}
                        numberOfLines={metaLines}
                        className={cx(
                            'text-xs leading-5 text-content-secondary text-start',
                            metaClassName,
                        )}
                    >
                        {meta}
                    </RNText>
                )}

                {tags === undefined || tags.length === 0 ? null : (
                    <TagRow
                        testID={`${testID}-tags`}
                        items={tags}
                        className="pt-0.5"
                        {...(maxTags === undefined ? {} : { max: maxTags })}
                    />
                )}

                {children}
            </View>
        </Card>
    );
}
