import { Badge, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { CataloguePageHeader } from './catalogue/catalogue-page-header.tsx';

/**
 * The pieces the four Workbench screens draw the same way (Workbench handoff §3y).
 *
 * Kept beside the screens rather than promoted, on the Catalogue's rule: one surface's vocabulary.
 */

/**
 * The page opening: title and one upper chip. **No subtitle**, on any screen — §3y records that the
 * family description was removed as redundant with the title, the chip and the cards beneath it.
 *
 * The chip names the *kind* of surface — the authority it needs or the consequence it carries — and
 * never a count; counts are the summary cards' job, once.
 */
export function WorkbenchHeader({
    title,
    chip,
    chipTone,
    testID,
    titleTestID,
}: {
    readonly title: string;
    readonly chip: string;
    readonly chipTone: BadgeTone;
    readonly testID: string;
    readonly titleTestID?: string | undefined;
}) {
    return (
        <CataloguePageHeader
            testID={testID}
            title={title}
            titleTestID={titleTestID}
            titleAside={<Badge tone={chipTone} label={chip} testID={`${testID}-chip`} />}
        />
    );
}

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
