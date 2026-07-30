import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const CONNECTIVITY_STATES = ['online', 'offline', 'reconnecting', 'restored'] as const;
export type ConnectivityState = (typeof CONNECTIVITY_STATES)[number];

interface StatePresentation {
    readonly containerClass: string;
    readonly textClass: string;
    readonly icon: IconName;
    readonly titleKey: string;
    readonly bodyKey: string | null;
    /** Interruptive states are announced immediately; a recovery is announced politely. */
    readonly assertive: boolean;
}

const PRESENTATION: Readonly<Record<Exclude<ConnectivityState, 'online'>, StatePresentation>> = {
    offline: {
        containerClass: 'bg-warning-subtle border-warning-border',
        textClass: 'text-warning-on-subtle',
        icon: 'offline',
        titleKey: 'common:network.offlineTitle',
        bodyKey: 'common:network.offlineBody',
        assertive: true,
    },
    reconnecting: {
        containerClass: 'bg-info-subtle border-info-border',
        textClass: 'text-info-on-subtle',
        icon: 'refresh',
        titleKey: 'common:network.reconnectingTitle',
        bodyKey: 'common:network.reconnectingBody',
        assertive: false,
    },
    restored: {
        containerClass: 'bg-success-subtle border-success-border',
        textClass: 'text-success-on-subtle',
        icon: 'success',
        titleKey: 'common:network.backOnline',
        bodyKey: null,
        assertive: false,
    },
};

export interface OfflineIndicatorProps {
    readonly state: ConnectivityState;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Offline indicator.
 *
 * Renders nothing at all when the connection is healthy — a persistent "you are online" banner is
 * chrome nobody reads. The three abnormal states are a live region so the change is announced
 * without stealing focus: `assertive` while the user is cut off, `polite` once things are on the
 * mend.
 *
 * The component is presentational. Where the state comes from (NetInfo on native,
 * `navigator.onLine` on the web) is the application's concern, which keeps the design system free
 * of a native module dependency.
 */
export function OfflineIndicator({ state, className, testID }: OfflineIndicatorProps) {
    const { t } = useTranslation();
    if (state === 'online') return null;

    const presentation = PRESENTATION[state];

    return (
        <View
            testID={testID}
            role="status"
            accessibilityRole="alert"
            aria-live={presentation.assertive ? 'assertive' : 'polite'}
            accessibilityLiveRegion={presentation.assertive ? 'assertive' : 'polite'}
            className={cx(
                'flex-row items-center gap-2 border-b px-4 py-2',
                presentation.containerClass,
                className,
            )}
        >
            <Icon name={presentation.icon} size="sm" className={presentation.textClass} />
            <View className="flex-1 flex-col">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-title`}
                    className={cx('text-sm font-medium text-start', presentation.textClass)}
                >
                    {t(presentation.titleKey)}
                </RNText>
                {presentation.bodyKey === null ? null : (
                    <RNText className={cx('text-xs text-start', presentation.textClass)}>
                        {t(presentation.bodyKey)}
                    </RNText>
                )}
            </View>
        </View>
    );
}
