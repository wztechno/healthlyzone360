import { Badge, Card, Heading, Inline, Spinner, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSession } from '../session/session-provider.tsx';

interface RowProps {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}

function Row({ label, value, testID }: RowProps) {
    return (
        <View className="flex-row flex-wrap items-baseline gap-2 py-1">
            <Text variant="caption" tone="secondary" className="min-w-[140px]">
                {label}
            </Text>
            <Text testID={testID} className="flex-1">
                {value}
            </Text>
        </View>
    );
}

/**
 * Profile summary — read-only in Phase 1.
 *
 * Everything shown comes from `GET /api/v1/me`. Nothing here is editable, and there is deliberately
 * no "Edit" button: editing belongs to the identity module and a control that does nothing is worse
 * than its absence (plan §16).
 */
export function ProfileScreen() {
    const { t } = useTranslation();
    const { me } = useSession();
    const formatter = useFormatter();

    if (me === null) {
        return (
            <Stack testID="profile-screen" space="md">
                <Spinner size="large" showLabel />
            </Stack>
        );
    }

    const { user, profile, memberships, activeContext, pendingConsents } = me;
    const membership = memberships.find((candidate) => candidate.id === activeContext?.membershipId);
    const branch = membership?.branches.find((candidate) => candidate.id === activeContext?.branchId);

    return (
        <Stack testID="profile-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="profile-title">
                    {t('auth:profile.title')}
                </Heading>
                <Text tone="secondary">{t('auth:profile.subtitle')}</Text>
            </Stack>

            <Card title={t('auth:profile.account')} padding="md">
                <Stack space="none">
                    <Row testID="profile-email" label={t('auth:profile.email')} value={user.email} />
                    <Row
                        testID="profile-display-name"
                        label={t('auth:profile.displayName')}
                        value={profile.displayName}
                    />
                    <Row
                        testID="profile-locale"
                        label={t('auth:profile.locale')}
                        value={profile.preferredLocale}
                    />
                    <Row
                        testID="profile-time-zone"
                        label={t('auth:profile.timeZone')}
                        value={profile.timeZone ?? t('auth:profile.none')}
                    />
                    <Row
                        testID="profile-member-since"
                        label={t('auth:profile.memberSince')}
                        // `GET /api/v1/me` does not expose an account creation date, so in `api`
                        // mode this arrives empty. Formatting it anyway would print "Invalid Date"
                        // at people; "none" is the truth (recorded as a backend follow-up).
                        value={
                            user.createdAt === ''
                                ? t('auth:profile.none')
                                : formatter.formatDate(user.createdAt)
                        }
                    />
                </Stack>
                <Inline space="xs">
                    <Text variant="caption" tone="secondary">
                        {t('auth:profile.twoFactor')}
                    </Text>
                    <Badge
                        testID="profile-two-factor"
                        tone={user.twoFactorEnabled ? 'success' : 'neutral'}
                        label={
                            user.twoFactorEnabled
                                ? t('auth:profile.twoFactorEnabled')
                                : t('auth:profile.twoFactorDisabled')
                        }
                    />
                </Inline>
            </Card>

            <Card title={t('auth:profile.context')} padding="md">
                {activeContext === null || membership === undefined ? (
                    <Text testID="profile-no-context" tone="secondary">
                        {t('auth:profile.noContext')}
                    </Text>
                ) : (
                    <Stack space="none">
                        <Row
                            testID="profile-organisation"
                            label={t('auth:profile.organisation')}
                            value={membership.organisation.name}
                        />
                        <Row
                            testID="profile-branch"
                            label={t('auth:profile.branch')}
                            value={branch?.name ?? t('auth:profile.noBranch')}
                        />
                        <Row
                            testID="profile-roles"
                            label={t('auth:profile.roles')}
                            value={
                                membership.roles.map((role) => role.name).join(', ') ||
                                t('auth:profile.none')
                            }
                        />
                    </Stack>
                )}

                <Stack space="xs">
                    <Text variant="caption" tone="secondary">
                        {t('auth:profile.permissions')}
                    </Text>
                    <Inline space="xs">
                        {(activeContext?.permissions ?? []).length === 0 ? (
                            <Text testID="profile-permissions-none" tone="secondary">
                                {t('auth:profile.none')}
                            </Text>
                        ) : (
                            (activeContext?.permissions ?? []).map((permission) => (
                                <Badge
                                    key={permission}
                                    testID={`profile-permission-${permission}`}
                                    tone="neutral"
                                    label={permission}
                                />
                            ))
                        )}
                    </Inline>
                </Stack>

                <Stack space="xs">
                    <Text variant="caption" tone="secondary">
                        {t('auth:profile.entitlements')}
                    </Text>
                    <Inline space="xs">
                        {(activeContext?.entitlements ?? []).length === 0 ? (
                            <Text testID="profile-entitlements-none" tone="secondary">
                                {t('auth:profile.none')}
                            </Text>
                        ) : (
                            (activeContext?.entitlements ?? []).map((entitlement) => (
                                <Badge
                                    key={entitlement}
                                    testID={`profile-entitlement-${entitlement}`}
                                    tone="info"
                                    label={entitlement}
                                />
                            ))
                        )}
                    </Inline>
                </Stack>
            </Card>

            <Card title={t('auth:profile.memberships')} padding="md">
                {memberships.length === 0 ? (
                    <Text testID="profile-memberships-none" tone="secondary">
                        {t('auth:profile.none')}
                    </Text>
                ) : (
                    <Stack space="xs">
                        {memberships.map((entry) => (
                            <Inline key={entry.id} space="xs">
                                <Text testID={`profile-membership-${entry.organisation.slug}`}>
                                    {entry.organisation.name}
                                </Text>
                                <Badge tone="neutral" label={entry.status} />
                            </Inline>
                        ))}
                    </Stack>
                )}
            </Card>

            <Card title={t('auth:profile.consents')} padding="md">
                {pendingConsents.length === 0 ? (
                    <Text testID="profile-consents-none" tone="secondary">
                        {t('auth:profile.consentsNone')}
                    </Text>
                ) : (
                    <Inline space="xs">
                        {pendingConsents.map((consent) => (
                            <Badge
                                key={consent.code}
                                testID={`profile-consent-${consent.code}`}
                                tone={consent.required ? 'warning' : 'neutral'}
                                label={`${consent.code} · ${consent.version}`}
                            />
                        ))}
                    </Inline>
                )}
            </Card>
        </Stack>
    );
}
