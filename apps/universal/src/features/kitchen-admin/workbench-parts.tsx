import { Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The pieces the four Workbench screens draw the same way (Workbench handoff §3y).
 *
 * Kept beside the screens rather than promoted, on the Catalogue's rule: one surface's vocabulary.
 */

/**
 * A section's opening: a 13px upper heading on a hairline, an optional quiet aside after it.
 *
 * The rule is *above* for a family section (it separates stacked groups) and *below* for a chart
 * (it sits over the drawing) — `rule` states which, so both shapes come from one component.
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
                    ? 'flex-row flex-wrap items-baseline gap-tight border-t border-stroke-subtle pb-1.5 pt-snug'
                    : 'flex-row flex-wrap items-baseline gap-tight border-b border-stroke-subtle pb-1.5'
            }
        >
            <Text
                variant="section"
                accessibilityRole="header"
                aria-level={2}
                className="uppercase tracking-wide"
                testID={testID}
            >
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
