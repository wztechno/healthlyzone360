import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * InlineBanner — a short message in the flow of a screen, not over it.
 *
 * The three jobs the handoff names (§3) are saved, check and conflict, and they have one thing in
 * common: each is *about the thing on screen* and each needs to stay readable while the person acts
 * on it. A toast is wrong for all three — it covers content, it leaves before a conflict has been
 * understood, and on a save that takes two seconds it arrives after the eye has moved on.
 *
 * So this sits in the layout, above the form or under the toolbar, and it stays until the state it
 * describes changes.
 *
 * ## Conflict is the one that earns the component
 *
 * The four-write, lock-version save sequence can fail because someone else saved first. That is not
 * an error the person made and not one a retry fixes blindly — they need to know what happened and
 * be offered a way through, which is what `actions` is for. Rendering that as a red toast that
 * vanishes is how a lost edit becomes a support ticket.
 *
 * `role="status"` for the quiet tones and `role="alert"` for `danger`, so a screen reader
 * interrupts for a conflict and merely announces a save. Every tone pairs its colour with an icon —
 * the standing rule, and the reason `icon` can be overridden but not silently dropped.
 */

export const BANNER_TONES = ['info', 'success', 'warning', 'danger'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

const TONE_SURFACE: Readonly<Record<BannerTone, string>> = {
    info: 'bg-info-subtle border-info-border',
    success: 'bg-success-subtle border-success-border',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
};

const TONE_TEXT: Readonly<Record<BannerTone, string>> = {
    info: 'text-info-on-subtle',
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
};

const TONE_ICON: Readonly<Record<BannerTone, IconName>> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'error',
};

export interface InlineBannerProps {
    readonly message: string;
    readonly tone?: BannerTone | undefined;
    /** Overrides the tone's icon. It cannot be removed — colour never carries the meaning alone. */
    readonly icon?: IconName | undefined;
    /** A second line: what to do about it. The conflict case's "Reload and reapply your changes". */
    readonly detail?: string | undefined;
    /** Buttons on the trailing edge. Keep to one or two — this is a banner, not a dialog. */
    readonly actions?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function InlineBanner({
    message,
    tone = 'info',
    icon,
    detail,
    actions,
    className,
    testID,
}: InlineBannerProps) {
    const density = useDensity();
    const compact = density === 'compact';
    const messageClass = compact ? 'text-role-body font-admin' : 'text-sm';
    const detailClass = compact ? 'text-role-caption font-admin' : 'text-xs';

    return (
        <View
            testID={testID}
            // A conflict interrupts; a save does not. `alert` is assertive and `status` is polite,
            // and the difference is whether the message is worth cutting across whatever the screen
            // reader is currently saying.
            role={tone === 'danger' ? 'alert' : 'status'}
            accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
            aria-live={tone === 'danger' ? 'assertive' : 'polite'}
            className={cx(
                'flex-row items-center border',
                compact
                    ? 'gap-control-sm rounded-sm px-control-sm py-tight'
                    : 'gap-2 rounded-lg px-3 py-2',
                TONE_SURFACE[tone],
                className,
            )}
        >
            <Icon
                name={icon ?? TONE_ICON[tone]}
                size="sm"
                className={TONE_TEXT[tone]}
                testID={testID === undefined ? undefined : `${testID}-icon`}
            />

            <View className="flex-1 flex-col gap-0.5">
                <RNText className={cx(messageClass, TONE_TEXT[tone], 'text-start')}>
                    {message}
                </RNText>
                {detail === undefined ? null : (
                    <RNText className={cx(detailClass, TONE_TEXT[tone], 'text-start')}>
                        {detail}
                    </RNText>
                )}
            </View>

            {actions}
        </View>
    );
}
