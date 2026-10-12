import { Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The pieces the four Workbench screens draw the same way (Workbench handoff §3y).
 *
 * Kept beside the screens rather than promoted, on the Catalogue's rule: one surface's vocabulary.
 */

/**
 * A section's opening: the 16px card title, an optional quiet aside after it.
 *
 * A chart sits in its own white card (Kitchen Ops sample), so the default (`below`) draws no rule —
 * the card's edge already frames the drawing. `above` keeps the hairline for a family section,
 * where it separates stacked groups on the page.
 */
export function WorkbenchSectionHeading({
    title,
    aside,
    rule = 'below',
    testID,
}: {
    readonly title: string;
    readonly aside?: ReactNode | undefined;
    readonly rule?: 'above' | 'below' | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            className={
                rule === 'above'
                    ? 'flex-row flex-wrap items-baseline gap-tight border-t border-stroke-subtle pt-snug'
                    : 'flex-row flex-wrap items-baseline gap-tight'
            }
        >
            <Text variant="section" accessibilityRole="header" aria-level={2} testID={testID}>
                {title}
            </Text>
            {typeof aside === 'string' ? (
                <Text variant="caption" tone="secondary">
                    {aside}
                </Text>
            ) : (
                aside
            )}
        </View>
    );
}
