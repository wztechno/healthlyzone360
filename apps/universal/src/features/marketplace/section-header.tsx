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
    readonly testID?: string | undefined;
}

export function SectionHeader({
    title,
    description,
    level = 2,
    action,
    testID,
}: SectionHeaderProps) {
    return (
        <Stack space="xs" testID={testID}>
            <Inline space="sm" align="center" justify="between">
                <Heading
                    level={level}
                    testID={testID === undefined ? undefined : `${testID}-title`}
                >
                    {title}
                </Heading>
                {action === undefined ? null : (
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
 * the whole width — seven kitchens meant six cards at 373 and a seventh at 1152, a billboard with
 * an 864-unit image under a tidy grid. The cap is not a taste: 1152 is the shell's content width,
 * the grid's gap is 16, and three cells fit, so `(1152 - 2 × 16) ÷ 3` is exactly what a cell gets
 * when the row is full. Capping there can therefore never change a full row — it only stops a
 * short one from stretching.
 */
export function CardGridItem({ children, testID }: CardGridProps) {
    return (
        <View testID={testID} className="min-w-[260px] max-w-[373px] flex-1 grow basis-[280px]">
            {children}
        </View>
    );
}
