import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const CALLOUT_TONES = ['info', 'warning', 'danger', 'success'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

const TONE_CLASS: Readonly<Record<CalloutTone, string>> = {
    info: 'bg-info-subtle',
    warning: 'bg-warning-subtle',
    danger: 'bg-danger-subtle',
    success: 'bg-success-subtle',
};

const TONE_TEXT_CLASS: Readonly<Record<CalloutTone, string>> = {
    info: 'text-info-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    success: 'text-success-on-subtle',
};

/** The mark's ink: the tone's `DEFAULT`, fuller than the text so the shape leads the line. */
const TONE_MARK_CLASS: Readonly<Record<CalloutTone, string>> = {
    info: 'text-info',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
};

/** Lucide's marks on the web; each falls back to its glyph (ⓘ ⚠ ✖ ✔) on native. */
const TONE_ICON: Readonly<Record<CalloutTone, IconName>> = {
    info: 'infoCircle',
    warning: 'alert',
    danger: 'circleX',
    success: 'circleCheck',
};

export const CALLOUT_ROLES = ['note', 'status', 'alert'] as const;
export type CalloutRole = (typeof CALLOUT_ROLES)[number];

export const CALLOUT_SIZES = ['regular', 'compact'] as const;
export type CalloutSize = (typeof CALLOUT_SIZES)[number];

export interface CalloutProps {
    readonly title: string;
    readonly tone?: CalloutTone | undefined;
    /** Plain supporting copy. Use `children` instead when the body needs structure. */
    readonly body?: string | undefined;
    readonly children?: ReactNode | undefined;
    /** Overrides the tone's icon. `null` removes it — only when the title is unambiguous. */
    readonly icon?: IconName | null | undefined;
    /**
     * Buttons or links. `regular`: under the body in a wrapping row. `compact`: at the end of the
     * strip's own row, wrapping onto a line of their own when the text needs the room.
     */
    readonly actions?: ReactNode | undefined;
    /**
     * `note` for standing guidance (a medical disclaimer), `status` for a polite live update,
     * `alert` for something that must interrupt. Defaults to `note`.
     */
    readonly role?: CalloutRole | undefined;
    /**
     * `regular` is the padded panel; `compact` is the one-line strip `FormIssueBanner` draws. Follows
     * the density when omitted, so every notice in the kitchen admin is a strip.
     */
    readonly size?: CalloutSize | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Callout — the base of every standing notice in the application.
 *
 * It exists as one component so the application-level notices that matter (the medical disclaimer,
 * the prototype notice) cannot each invent their own markup and each get the semantics slightly
 * wrong. Those live in the app, not here: the design system stays domain-free, and a disclaimer's
 * *wording* is a product and legal decision, not a styling one.
 *
 * `role` is a deliberate prop rather than a fixed value. A disclaimer that is always present is a
 * `note`; a result that has just changed is a `status`; only something that must interrupt is an
 * `alert`. Making every callout an alert is how a screen reader user learns to ignore them.
 *
 * Tone never carries the meaning alone — each tone also brings its own icon.
 *
 * The frame is the soft one (Badges & Callouts, 1a): the tone's subtle fill with no border, a 10px
 * inset and a 13px mark in the tone's full ink. The fill already separates it from the page; a
 * border on top of it was a second edge saying the same thing.
 *
 * ## Always the full width
 *
 * A notice never shares its line. Beside a button or a field it was squeezed into a column a few
 * words wide, and in a wrapping row it sat wherever the row put it; at `w-full` it takes a line of
 * its own wherever it is placed.
 *
 * ## Two sizes
 *
 * `regular` is the panel: the title on its line, the body under it, the actions under that.
 * `compact` is the strip `FormIssueBanner` draws — 32px tall at least, the mark, then the title and
 * the body as one run of text, the actions at the end of the same row. Anything structured passed
 * as `children` (a list of short items) goes on a full-width row under the strip. The kitchen
 * admin renders under `DensityProvider value="compact"`, so every notice there is a strip unless
 * it asks for the panel.
 */
export function Callout({
    title,
    tone = 'info',
    body,
    children,
    icon,
    actions,
    role = 'note',
    size,
    className,
    testID,
}: CalloutProps) {
    const density = useDensity();
    const resolvedSize = size ?? (density === 'compact' ? 'compact' : 'regular');
    const resolvedIcon = icon === undefined ? TONE_ICON[tone] : icon;
    const part = (name: string) => (testID === undefined ? undefined : `${testID}-${name}`);
    const semantics = {
        testID,
        role,
        ...(role === 'alert' ? { accessibilityRole: 'alert' as const } : {}),
        ...(role === 'status' ? { 'aria-live': 'polite' as const } : {}),
    };

    if (resolvedSize === 'compact') {
        const hasChildren = children !== undefined && children !== null && children !== false;
        return (
            <View
                {...semantics}
                className={cx(
                    'min-h-8 w-full flex-col justify-center gap-1 rounded-md py-1 pe-1 ps-2.5',
                    TONE_CLASS[tone],
                    className,
                )}
            >
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    {resolvedIcon === null ? null : (
                        <Icon
                            testID={part('icon')}
                            name={resolvedIcon}
                            size="sm"
                            className={TONE_MARK_CLASS[tone]}
                        />
                    )}
                    {/*
                     * One run of text: the title in its weight, the body after a space. It keeps a
                     * card's width before the actions may share its line — below that they wrap to
                     * a line of their own rather than squeeze the words into a column.
                     */}
                    <RNText
                        testID={part('text')}
                        className={cx(
                            'min-w-card flex-1 text-sm text-start',
                            TONE_TEXT_CLASS[tone],
                        )}
                    >
                        <RNText testID={part('title')} className="font-semibold">
                            {title}
                        </RNText>
                        {body === undefined ? null : (
                            <>
                                {' '}
                                <RNText testID={part('body')}>{body}</RNText>
                            </>
                        )}
                    </RNText>
                    {actions === undefined ? null : (
                        <View
                            testID={part('actions')}
                            className="ms-auto flex-row flex-wrap items-center gap-1.5"
                        >
                            {actions}
                        </View>
                    )}
                </View>
                {hasChildren ? (
                    <View testID={part('children')} className="w-full flex-col">
                        {children}
                    </View>
                ) : null}
            </View>
        );
    }

    return (
        <View
            {...semantics}
            className={cx(
                'w-full flex-row items-start gap-2.5 rounded-lg px-3 py-2.5',
                TONE_CLASS[tone],
                className,
            )}
        >
            {resolvedIcon === null ? null : (
                // `mt-1` sets the 13px mark on the title's first line rather than on its top edge.
                <Icon
                    testID={part('icon')}
                    name={resolvedIcon}
                    size="sm"
                    className={cx('mt-1', TONE_MARK_CLASS[tone])}
                />
            )}

            <View className="min-w-0 flex-1 flex-col gap-0.5">
                <RNText
                    testID={part('title')}
                    className={cx('text-sm font-semibold text-start', TONE_TEXT_CLASS[tone])}
                >
                    {title}
                </RNText>

                {body === undefined ? null : (
                    <RNText
                        testID={part('body')}
                        className={cx('text-sm text-start', TONE_TEXT_CLASS[tone])}
                    >
                        {body}
                    </RNText>
                )}

                {children}

                {actions === undefined ? null : (
                    <View
                        testID={part('actions')}
                        className="flex-row flex-wrap items-center gap-1.5 pt-1.5"
                    >
                        {actions}
                    </View>
                )}
            </View>
        </View>
    );
}
