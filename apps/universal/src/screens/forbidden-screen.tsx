import { Badge, Button, Card, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { ROUTE_PATHS } from '@healthy360/permissions';
import type { DenialReason } from '@healthy360/permissions';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

export interface ForbiddenScreenProps {
    readonly reason: DenialReason;
    /** Entitlement or permission keys that were absent — shown so the refusal is actionable. */
    readonly missing?: readonly string[] | undefined;
    readonly testID?: string | undefined;
}

/**
 * The single refusal screen.
 *
 * It renders **in place** of the guarded content rather than redirecting, so the URL the user
 * actually asked for is still in the address bar. That is what makes a deep link into an
 * unpermitted area reproducible in a test and describable in a support conversation.
 *
 * Every denial reason maps to a translated title and body (`access:denial.<reason>`); the reason
 * string itself is never shown to a person.
 */
export function ForbiddenScreen({
    reason,
    missing = [],
    testID = 'forbidden',
}: ForbiddenScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Stack testID={testID} space="lg" className="p-4">
            <Card tone="danger" padding="lg">
                <Stack space="sm">
                    <Heading level={1} testID={`${testID}-title`}>
                        {t('access:forbidden.title')}
                    </Heading>
                    <Heading level={2} testID={`${testID}-reason-title`}>
                        {t(`access:denial.${reason}.title`)}
                    </Heading>
                    <Text testID={`${testID}-reason-body`} tone="secondary">
                        {t(`access:denial.${reason}.body`)}
                    </Text>
                    <Inline space="xs">
                        <Text variant="caption" tone="secondary">
                            {t('access:forbidden.reasonLabel')}
                        </Text>
                        <Badge testID={`${testID}-reason-code`} tone="danger" label={reason} />
                    </Inline>

                    {missing.length === 0 ? null : (
                        <Inline space="xs">
                            <Text variant="caption" tone="secondary">
                                {t('access:forbidden.missingLabel')}
                            </Text>
                            {missing.map((key) => (
                                <Badge
                                    key={key}
                                    testID={`${testID}-missing-${key}`}
                                    tone="warning"
                                    label={key}
                                />
                            ))}
                        </Inline>
                    )}
                </Stack>
            </Card>

            <Inline space="sm">
                <Button
                    testID={`${testID}-workspace`}
                    label={t('access:forbidden.backToWorkspace')}
                    onPress={() => {
                        router.replace(ROUTE_PATHS.workspace as never);
                    }}
                />
                <Button
                    testID={`${testID}-switch-organisation`}
                    variant="secondary"
                    label={t('access:forbidden.switchOrganisation')}
                    onPress={() => {
                        router.replace(ROUTE_PATHS.selectOrganisation as never);
                    }}
                />
            </Inline>
        </Stack>
    );
}
