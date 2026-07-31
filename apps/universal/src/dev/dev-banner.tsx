import { MOCK_SCENARIOS, MOCK_SCENARIO_NAMES } from '@healthy360/api-client';
import type { MockScenarioName } from '@healthy360/api-client';
import { Badge, Button, Icon, Select, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { appConfig } from '../config.ts';
import { useRepositoryContext } from '../data/repository-provider.tsx';

/**
 * The mock-data banner (plan §18: mock mode must be visible during development).
 *
 * It is amber, persistent and impossible to dismiss. That is the point — the failure mode this
 * guards against is a demo, a screenshot or a bug report being taken from fixtures without anyone
 * realising. It renders only when the data mode really is `mock`, so a build against the API is
 * chrome-free.
 *
 * ## A compact developer utility, not a storefront banner
 *
 * It is deliberately a single narrow row so it never competes with the customer-facing page below
 * it: the "MOCK DATA" badge, the active scenario and a one-line note. The scenario switcher is
 * development-only and tucked behind a toggle — a dev reaches for it rarely, so it costs one click
 * rather than a permanent multi-line control. In a preview build the badge still shows but the world
 * cannot be swapped from the UI.
 */
export function DevBanner() {
    const { t } = useTranslation();
    const { scenario, setScenario } = useRepositoryContext();
    const [open, setOpen] = useState(false);

    if (!appConfig.isMockData) return null;

    const options = MOCK_SCENARIO_NAMES.map((name) => ({
        value: name,
        label: name,
        description: MOCK_SCENARIOS[name].summary,
    }));

    return (
        <View
            testID="dev-banner"
            role="status"
            accessibilityRole="alert"
            aria-live="polite"
            className="border-b border-warning-border bg-warning-subtle px-4 py-1.5"
        >
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <Icon name="warning" size="sm" className="text-warning-on-subtle" />
                <Badge testID="dev-banner-badge" tone="warning" label={t('common:dev.mockBadge')} />
                <Text testID="dev-banner-scenario" variant="caption" tone="warning">
                    {t('common:dev.mockScenario', { scenario })}
                </Text>
                <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={1}
                    className="min-w-[8rem] flex-1"
                >
                    {t('common:dev.mockDescription')}
                </Text>
                {appConfig.isDevelopment ? (
                    <Button
                        testID="dev-banner-toggle"
                        variant="ghost"
                        size="sm"
                        label={t('common:dev.switchScenario')}
                        iconEnd={<Icon name={open ? 'chevronUp' : 'chevronDown'} size="sm" />}
                        accessibilityState={{ expanded: open }}
                        onPress={() => {
                            setOpen((value) => !value);
                        }}
                    />
                ) : null}
            </View>

            {appConfig.isDevelopment && open ? (
                <View className="mt-2 max-w-[26rem]">
                    <Select<MockScenarioName>
                        testID="dev-scenario"
                        id="dev-scenario"
                        label={t('common:dev.switchScenario')}
                        hint={t('common:dev.switchScenarioHint')}
                        options={options}
                        value={scenario}
                        onChange={setScenario}
                    />
                </View>
            ) : null}
        </View>
    );
}
