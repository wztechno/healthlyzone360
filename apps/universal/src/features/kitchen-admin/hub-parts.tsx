import { Card, Heading, Inline, Text, cx } from '@healthy360/design-system';
import type { LensTone } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

/**
 * The overview boards' parts — the panels and their count boxes — drawn once for
 * the kitchen's overview (`screens/kitchen-home-screen.tsx`) and the corporate buyer's
 * (`business/screens/corporate-dashboard-screen.tsx`), which the corporate canvas draws in the same
 * look.
 */

export type Tone = 'warning' | 'ok' | 'neutral';

export const DOT_CLASS: Readonly<Record<Tone, string>> = {
    warning: 'bg-warning-border',
    ok: 'bg-surface-brand',
    neutral: 'bg-stroke-strong',
};

/** The same tone, for a figure chip (`FigureChips`). */
export const LENS_TONE: Readonly<Record<Tone, LensTone>> = {
    warning: 'warning',
    ok: 'brand',
    neutral: 'neutral',
};

export const COUNT_CLASS: Readonly<Record<Tone, { readonly box: string; readonly ink: string }>> = {
    warning: { box: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    ok: { box: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    neutral: { box: 'bg-surface-sunken', ink: 'text-content-secondary' },
};

/** A panel: a title, what sits beside it, then its lines. */
export function Panel({
    testID,
    title,
    count,
    link,
    grow = false,
    children,
}: {
    readonly testID: string;
    readonly title: string;
    readonly count?: ReactNode;
    readonly link?: { readonly label: string; readonly onPress: () => void } | undefined;
    /** The last card of a column: takes what is left, so the two columns end level. */
    readonly grow?: boolean | undefined;
    readonly children: ReactNode;
}) {
    return (
        <Card
            testID={testID}
            padding="none"
            tone="raised"
            className={cx('min-w-0 border-stroke-subtle p-1.5', grow ? 'flex-1' : '')}
        >
            <Inline space="sm" align="center" wrap={false} className="px-3 pb-2 pt-3">
                <Heading level={2}>{title}</Heading>
                {count}
                {link === undefined ? null : (
                    <Pressable
                        role="link"
                        onPress={link.onPress}
                        className="ms-auto min-h-6 justify-center"
                    >
                        <Text variant="label" tone="brand">
                            {link.label}
                        </Text>
                    </Pressable>
                )}
            </Inline>
            {children}
        </Card>
    );
}
