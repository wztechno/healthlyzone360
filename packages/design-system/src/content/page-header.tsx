import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { InfoTip } from '../overlays/info-tip.tsx';
import { Inline } from '../primitives/stack.tsx';

/**
 * How an admin page that is not a list opens — an editor, a record, a settings page.
 *
 * ```
 *  ↩ Open batch                                                    <- back, only where it helps
 *  New recipe  ● Draft  🔒  (i)                [1/3 checks]  [Save draft]
 * ```
 *
 * - **The title** is 24px Space Grotesk, bold, on one line.
 * - **The aside** sits beside it: the record's status, a lock, a count.
 * - **The (i)** holds what the page is for, when it needs saying. Never a sentence under the title.
 * - **The actions** keep the inline end of the title row. One primary at most.
 *
 * No breadcrumb: the top bar's trail already names the page. A list page has no `PageHeader` at
 * all — its `LensBar` is its opening.
 */
export interface PageHeaderProps {
    /**
     * Translated. Omit while the record's name is still loading, or where the page leaves its name
     * to the trail (a stepped form): the aside and the actions keep their places.
     */
    readonly title?: string | undefined;
    /** Beside the title — a status the record as a whole is in. */
    readonly titleAside?: ReactNode | undefined;
    /** Translated. What the page is for, behind an (i) beside the title. */
    readonly info?: string | undefined;
    /** At the title row's inline end. One primary at most. */
    readonly actions?: ReactNode | undefined;
    /** Above the title: a way back the trail cannot give (a printed sheet's "Open batch"). */
    readonly back?: ReactNode | undefined;
    /** Overrides the derived `{testID}-title` for a suite that already points at another id. */
    readonly titleTestID?: string | undefined;
    readonly testID: string;
}

export function PageHeader({
    title,
    titleAside,
    info,
    actions,
    back,
    titleTestID,
    testID,
}: PageHeaderProps) {
    return (
        <View testID={testID} className="gap-2">
            {back}
            <View className="flex-row flex-wrap items-center justify-between gap-tight">
                <Inline space="sm" align="center" wrap className="min-w-0 flex-1">
                    {title === undefined ? null : (
                        <RNText
                            testID={titleTestID ?? `${testID}-title`}
                            accessibilityRole="header"
                            aria-level={1}
                            numberOfLines={1}
                            className="font-display text-role-title font-bold tracking-display text-content-primary"
                        >
                            {title}
                        </RNText>
                    )}
                    {titleAside}
                    {info === undefined ? null : (
                        <InfoTip label={title ?? ''} text={info} testID={`${testID}-info`} />
                    )}
                </Inline>
                {actions === undefined || actions === null ? null : (
                    <Inline space="xs" align="center" wrap testID={`${testID}-actions`}>
                        {actions}
                    </Inline>
                )}
            </View>
        </View>
    );
}
