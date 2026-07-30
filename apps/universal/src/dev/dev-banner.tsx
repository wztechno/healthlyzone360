import { MOCK_SCENARIOS, MOCK_SCENARIO_NAMES } from '@healthy360/api-client';
import type { MockScenarioName } from '@healthy360/api-client';
import { Badge, Icon, Select, Text } from '@healthy360/design-system';
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
 * The scenario switcher is development-only. In a preview build the banner still shows, but the
 * world cannot be swapped from the UI.
 */
export function DevBanner() {
    const { t } = useTranslation();
    const { scenario, setScenario } = useRepositoryContext();

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
            className="flex-col gap-2 border-b border-warning-border bg-warning-subtle px-4 py-2"
        >
            <View className="flex-row flex-wrap items-center gap-2">
                <Icon name="warning" size="sm" className="text-warning-on-subtle" />
                <Badge testID="dev-banner-badge" tone="warning" label={t('common:dev.mockBadge')} />
                <Text testID="dev-banner-scenario" variant="caption" tone="warning">
                    {t('common:dev.mockScenario', { scenario })}
                </Text>
                <Text variant="caption" tone="secondary" className="flex-1">
                    {t('common:dev.mockDescription')}
                </Text>
            </View>

            {appConfig.isDevelopment ? (
                <Select<MockScenarioName>
                    testID="dev-scenario"
                    id="dev-scenario"
                    label={t('common:dev.switchScenario')}
                    hint={t('common:dev.switchScenarioHint')}
                    options={options}
                    value={scenario}
                    onChange={setScenario}
                />
            ) : null}
        </View>
    );
}
