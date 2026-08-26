import { Heading, Inline, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * How a kitchen workspace page opens: the title with its state beside it, the one-line purpose
 * subtitle under it, and the page's actions right-aligned on the title row.
 *
 * One component rather than a per-screen `Stack` so every route under `/kitchen` opens the same
 * way — lists, ops boards and editors alike. Rule 4 governs what goes in `actions`: one primary at
 * most, and an empty slot beats a promoted navigation button or a destructive action.
 *
 * Breadcrumbs are deliberately *not* part of this header on kitchen routes: `KitchenOpsShell`
 * already renders them once above the page, and their `kitchen-breadcrumbs` test id is a contract
 * with the print stylesheet. The `breadcrumbs` slot exists for surfaces outside that shell (the
 * showcase) and stays unused inside it.
 */
export interface KitchenPageHeaderProps {
    readonly testID: string;
    readonly title: string;
    readonly subtitle?: string | undefined;
    /** `band` wraps the header in the raised panel card — the editor treatment. */
    readonly variant?: 'plain' | 'band' | undefined;
    /** Rendered above the title. Unused under `/kitchen` — see the note above. */
    readonly breadcrumbs?: ReactNode | undefined;
    /** Status badge beside the title, only where the page has a state to declare. */
    readonly statusChip?: ReactNode | undefined;
    /** The row under the title — the editor's status · unsaved · last-changed line. */
    readonly meta?: ReactNode | undefined;
    /** Back affordance above the title (editors). */
    readonly back?: ReactNode | undefined;
    /** Right-aligned on the title row. One primary maximum. */
    readonly actions?: ReactNode | undefined;
    /** Overrides for the two ids the existing suites already point at. */
    readonly titleTestID?: string | undefined;
    readonly subtitleTestID?: string | undefined;
}

export function KitchenPageHeader({
    testID,
    title,
    subtitle,
    variant = 'plain',
    breadcrumbs,
    statusChip,
    meta,
    back,
    actions,
    titleTestID,
    subtitleTestID,
}: KitchenPageHeaderProps) {
    return (
        <View
            testID={testID}
            className={
                variant === 'band'
                    ? 'gap-2 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card'
                    : 'gap-2'
            }
        >
            {breadcrumbs}
            {back}
            <View className="flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <View className="min-w-0 flex-1 gap-1">
                    {statusChip === undefined ? (
                        <Heading level={1} testID={titleTestID ?? `${testID}-title`}>
                            {title}
                        </Heading>
                    ) : (
                        <Inline space="sm" align="center" wrap>
                            <Heading level={1} testID={titleTestID ?? `${testID}-title`}>
                                {title}
                            </Heading>
                            {statusChip}
                        </Inline>
                    )}
                    {subtitle === undefined ? null : (
                        <Text tone="secondary" testID={subtitleTestID ?? `${testID}-subtitle`}>
                            {subtitle}
                        </Text>
                    )}
                    {meta}
                </View>
                {actions === undefined ? null : (
                    <Inline space="xs" align="center" wrap testID={`${testID}-actions-slot`}>
                        {actions}
                    </Inline>
                )}
            </View>
        </View>
    );
}
