import { Button, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import type { HeadingLevel } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * A titled section, with an optional single action on the trailing edge.
 *
 * It exists so that heading *level* is a decision made once per screen rather than per block. A
 * marketplace page is a stack of sections, and the fastest way to a broken heading order — an axe
 * failure and a genuinely disorientating screen-reader experience — is for each block to guess.
 */
export interface SectionHeaderProps {
    readonly title: string;
    readonly description?: string | undefined;
    readonly level?: HeadingLevel | undefined;
    /** A single "see all" style control. More than one belongs in the section body. */
    readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
    /**
     * A short standing fact on the trailing edge — "Updated daily", a count. Not a control, and
     * ignored when `action` is present: the trailing slot holds one thing, and a button and a
     * label competing for it is how a header stops reading as a header.
     */
    readonly meta?: string | undefined;
    readonly testID?: string | undefined;
}

export function SectionHeader({
    title,
    description,
    level = 2,
    action,
    meta,
    testID,
}: SectionHeaderProps) {
    return (
        <Stack space="xs" testID={testID}>
            {/*
             * A rule under the title, and the trailing item on the title's baseline.
             *
             * The rule is what separates one section from the next on a long browse page. Without
             * it a stack of sections is a stack of headings floating in equal whitespace, and the
             * eye has nothing to tell it where a collection begins — which is the whole job of the
             * line in the design.
             *
             * `baseline`, not `center`: the trailing label is `text-sm` against a `text-2xl`
             * heading, and centring a small item against a large one leaves it visibly adrift.
             * Sitting them on a shared baseline is what makes the pair read as one line.
             */}
            <Inline
                space="sm"
                align="baseline"
                justify="between"
                className="border-b border-stroke-subtle pb-3"
            >
                <Heading
                    level={level}
                    testID={testID === undefined ? undefined : `${testID}-title`}
                >
                    {title}
                </Heading>
                {action === undefined ? (
                    meta === undefined ? null : (
                        <Text
                            testID={testID === undefined ? undefined : `${testID}-meta`}
                            tone="secondary"
                            variant="caption"
                            className="uppercase tracking-widest"
                        >
                            {meta}
                        </Text>
                    )
                ) : (
                    <Button
                        testID={testID === undefined ? undefined : `${testID}-action`}
                        size="sm"
                        variant="ghost"
                        label={action.label}
                        onPress={action.onPress}
                    />
                )}
            </Inline>
            {description === undefined ? null : <Text tone="secondary">{description}</Text>}
        </Stack>
    );
}

/**
 * The card grid.
 *
 * A wrapping row of flexible cards rather than the horizontally scrolling rail the reference
 * research suggests (doc 17, MKT-09). Deliberate: a rail puts half the collection behind a gesture
 * that keyboard users reach last and screen-reader users reach by accident, and the wrap already
 * delivers the property MKT-09 actually cares about — no page-level horizontal scroll at any
 * viewport. Recorded as a divergence rather than an omission.
 */
export interface CardGridProps {
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}

export function CardGrid({ children, testID }: CardGridProps) {
    return (
        <View testID={testID} className="flex-row flex-wrap gap-4">
            {children}
        </View>
    );
}

/**
 * One cell of {@link CardGrid}: at least 260 units wide, sharing the row otherwise, and never
 * wider than a cell in a full row.
 *
 * That last clause is the `max-w`. A wrapping row gives its free space to whatever is on the line,
 * so a collection whose count is not a multiple of the column count ended with a card blown up to
 * the whole width — a billboard with an enormous image under a tidy grid. The cap is not a taste:
 * 1152 is the shell's content width and the grid's gap is 16, so `(1152 - 3 × 16) ÷ 4` is exactly
 * what a cell gets when a four-column row is full. Capping there can never change a full row — it
 * only stops a short one from stretching.
 *
 * **Four across, not three.** The cell was 260–373 wide, which fits three, and at 373 a 4:3 image
 * is 280 units tall — so each card opened with a photograph the height of a small poster and the
 * price fell below the fold of the grid. The design sets these at four across; the card narrows to
 * ~276, the same image lands at ~207, and the whole card becomes something you can compare against
 * its neighbour without scrolling. Nothing about the card had to change to fix its height: the
 * width was the problem.
 */
export function CardGridItem({ children, testID }: CardGridProps) {
    return (
        <View testID={testID} className="min-w-[250px] max-w-[276px] flex-1 grow basis-[250px]">
            {children}
        </View>
    );
}

/**
 * A tighter grid, for tiles that carry a picture and a label and nothing else.
 *
 * A category tile is not a small product card — it has no description, no figures and no price, so
 * sizing it like one leaves a 260px box holding two lines of text. The design sets these at 170px
 * against the card grid's 260, which fits six across the content width where the card grid fits
 * three, and that difference is the point: a row of categories should read as an index, not as
 * another shelf of products competing with the one below it.
 *
 * The gap closes with it — 12 against the card grid's 16 — because tiles this size sitting on a
 * card-sized gap read as scattered rather than as a set.
 */
export function TileGrid({ children, testID }: CardGridProps) {
    return (
        <View testID={testID} className="flex-row flex-wrap gap-3">
            {children}
        </View>
    );
}

/**
 * One cell of {@link TileGrid}.
 *
 * The cap follows the same reasoning as {@link CardGridItem}'s and is computed the same way: a
 * wrapping row hands its slack to whatever is on the line, so without one a set of five tiles ends
 * with a lone tile stretched across the full width. At 1152px content, a 12px gap and six columns,
 * `(1152 - 5 × 12) ÷ 6` is 182 — so 182 is exactly what a tile gets in a full row, and capping
 * there can only ever restrain a short one.
 */
export function TileGridItem({ children, testID }: CardGridProps) {
    return (
        <View testID={testID} className="min-w-[170px] max-w-[182px] flex-1 grow basis-[170px]">
            {children}
        </View>
    );
}
