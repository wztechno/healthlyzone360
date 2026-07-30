import type { VdSafetyNotice } from '@healthy360/api-client/contracts';
import { Callout, Chip, Inline, Stack, Text } from '@healthy360/design-system';
import type { CalloutTone } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { allergenKey } from '../marketplace/format.ts';

/**
 * The session's safety notices, and the standing allergen reminder.
 *
 * `VdSafetyNotice.severity` maps to a tone, and the tone brings its own icon, so a warning is never
 * warning-coloured text alone. The named allergens are rendered as chips rather than folded into the
 * sentence: an allergen is the one thing on this screen a person may be scanning for.
 *
 * The reminder below is *not* derived from data and does not pretend to be. It is standing copy that
 * says a kitchen can change a recipe, which is true whether or not the session happens to carry a
 * notice — and it is the honest thing to show on a meal proposal that has not been through a
 * kitchen's allergen list yet.
 */
const SEVERITY_TONE: Readonly<Record<VdSafetyNotice['severity'], CalloutTone>> = {
    information: 'info',
    warning: 'warning',
    escalation: 'danger',
};

export interface SafetyNoticesProps {
    readonly notices: readonly VdSafetyNotice[];
    readonly testID?: string | undefined;
}

export function SafetyNotices({ notices, testID = 'vd-safety-notices' }: SafetyNoticesProps) {
    const { t } = useTranslation();

    if (notices.length === 0) return null;

    return (
        <Stack space="sm" testID={testID}>
            {notices.map((notice) => (
                <Callout
                    key={notice.code}
                    testID={`${testID}-${notice.code}`}
                    role="note"
                    tone={SEVERITY_TONE[notice.severity]}
                    title={t(`virtualDietitian:safetyNotice.severity.${notice.severity}`)}
                    body={notice.message}
                >
                    {notice.allergens.length === 0 ? null : (
                        <Stack space="xs">
                            <Text variant="caption" tone="secondary">
                                {t('virtualDietitian:safetyNotice.allergensTitle')}
                            </Text>
                            <Inline space="xs" wrap testID={`${testID}-${notice.code}-allergens`}>
                                {notice.allergens.map((allergen) => (
                                    <Chip
                                        key={allergen}
                                        tone="warning"
                                        icon="warning"
                                        label={t(allergenKey(allergen), {
                                            defaultValue: allergen,
                                        })}
                                    />
                                ))}
                            </Inline>
                        </Stack>
                    )}
                </Callout>
            ))}
        </Stack>
    );
}

export function AllergenReminder({
    testID = 'vd-allergen-reminder',
}: {
    readonly testID?: string;
}) {
    const { t } = useTranslation();

    return (
        <Callout
            testID={testID}
            role="note"
            tone="warning"
            title={t('virtualDietitian:allergenReminder.title')}
            body={t('virtualDietitian:allergenReminder.body')}
        />
    );
}
