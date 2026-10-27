import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { useMotion } from '../motion/use-motion.ts';
import { useIssueTrayContext } from './issue-tray-context.tsx';

/** How long the pill stays green after a card clears itself. */
const FLASH_MS = 900;

/**
 * The tray's pill in the top bar: how much is left on this page, from anywhere on it.
 *
 * Red with a count while something blocks the save, amber while something blocks the next step,
 * and "All set" with a tick once nothing does. Not drawn at all on a page with no tray, so it never
 * claims "all set" about a page that checks nothing. Pressing it opens and closes the tray.
 *
 * When a card clears itself the pill flashes green for a moment — the fix landing is felt even with
 * the tray closed. When a save is refused it shakes once, so the eye goes to it.
 */
export function IssueTrayButton({ testID = 'issue-tray-button' }: { readonly testID?: string }) {
    const { t } = useTranslation();
    const tray = useIssueTrayContext();
    const { enabled: motion, durations } = useMotion();
    const [flashing, setFlashing] = useState(false);
    const shake = useRef(new Animated.Value(0)).current;

    const resolvedAt = tray?.resolvedAt ?? 0;
    useEffect(() => {
        if (resolvedAt === 0) return;
        setFlashing(true);
        const timer = setTimeout(() => {
            setFlashing(false);
        }, FLASH_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [resolvedAt]);

    const nudgedAt = tray?.nudgedAt ?? 0;
    useEffect(() => {
        if (nudgedAt === 0 || !motion) return;
        const step = Math.max(40, Math.round(durations.fast / 2));
        const animation = Animated.sequence(
            [-4, 4, -3, 3, 0].map((toValue) =>
                Animated.timing(shake, { toValue, duration: step, useNativeDriver: true }),
            ),
        );
        animation.start();
        return () => {
            animation.stop();
        };
    }, [nudgedAt, motion, durations, shake]);

    if (tray === null || tray.summary === null) return null;
    const { summary, open, toggle } = tray;
    const clear = summary.tone === 'clear';
    const checking = summary.tone === 'checking';

    return (
        <AnimatedView style={{ transform: [{ translateX: shake }] }} className="self-center">
            <Pressable
                testID={testID}
                role="button"
                accessibilityRole="button"
                aria-expanded={open}
                accessibilityState={{ expanded: open }}
                accessibilityLabel={
                    clear
                        ? t('designSystem:issueTray.allSet')
                        : checking
                          ? t('designSystem:issueTray.checking')
                          : t('designSystem:issueTray.openCount', { count: summary.openCount })
                }
                onPress={toggle}
                className={cx(
                    'h-8 flex-row items-center gap-1.5 rounded-full border',
                    clear || checking ? 'px-3' : 'pe-1 ps-3',
                    clear || flashing
                        ? 'border-success-border bg-success-subtle'
                        : open
                          ? 'border-stroke-strong bg-surface-sunken'
                          : 'border-stroke-subtle bg-surface-raised',
                )}
            >
                <Icon
                    name={clear ? 'circleCheck' : checking ? 'clock' : 'listChecks'}
                    size="sm"
                    className={
                        clear
                            ? 'text-success'
                            : checking
                              ? 'text-content-secondary'
                              : 'text-content-primary'
                    }
                />
                <RNText
                    className={cx(
                        'text-xs font-semibold',
                        clear ? 'text-success-on-subtle' : 'text-content-primary',
                    )}
                >
                    {clear
                        ? t('designSystem:issueTray.allSet')
                        : checking
                          ? t('designSystem:issueTray.checking')
                          : t('designSystem:issueTray.toFix')}
                </RNText>
                {clear || checking ? null : (
                    <View
                        testID={`${testID}-count`}
                        className={cx(
                            'h-5 min-w-5 items-center justify-center rounded-full px-1.5',
                            summary.tone === 'danger' ? 'bg-danger' : 'bg-warning',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-xs font-bold tabular-nums',
                                summary.tone === 'danger'
                                    ? 'text-danger-on-default'
                                    : 'text-warning-on-default',
                            )}
                        >
                            {summary.openCount}
                        </RNText>
                    </View>
                )}
            </Pressable>
        </AnimatedView>
    );
}
