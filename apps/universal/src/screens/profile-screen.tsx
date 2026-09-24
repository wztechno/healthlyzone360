import {
    Accordion,
    Avatar,
    Badge,
    Button,
    Callout,
    Card,
    Inline,
    ListItem,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import type { MembershipStatus } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../access/gate.tsx';
import { useSession } from '../session/session-provider.tsx';
import { FactGrid, MarkTile, SettingsPage } from '../ui/settings-page.tsx';

/** A membership's state in the badge's vocabulary: only an active one is plainly good news. */
const MEMBERSHIP_TONE: Readonly<Record<MembershipStatus, BadgeTone>> = {
    pending: 'info',
    active: 'success',
    suspended: 'warning',
    expired: 'neutral',
    revoked: 'danger',
};

/**
 * Your profile — read-only.
 *
 * Everything shown comes from `GET /api/v1/me`, and nothing here is editable: the API has no
 * endpoint that writes a name, a language or a time zone, and a control that does nothing is worse
 * than its absence (plan §16). What *can* be acted on is linked — the password, which has its own
 * page, and the sessions, which have theirs.
 *
 * ```
 * Your profile
 * ┌──────────────────────────────────────────────────────────────┐
 * │ (LH)  Layla Haddad                                           │
 * │       layla@example.com   ● Email verified                   │
 * └──────────────────────────────────────────────────────────────┘
 * Account               — name, email, language, time zone, since
 * Sign-in and security  — password, two-factor, devices
 * Current context       — organisation, branch, roles; permissions folded
 * Your organisations    — one row each, the current one marked
 * Outstanding consents  — a warning callout, or one quiet line
 * ```
 *
 * The order is the reader's: who am I, how do I get in, where am I working, and only then the
 * long tail. Permissions are folded because a manager's list runs to forty codes, and forty badges
 * open by default push the organisations off the page for a question almost nobody is asking.
 */
export function ProfileScreen() {
    const { t } = useTranslation();
    const { me } = useSession();
    const formatter = useFormatter();
    const router = useRouter();
    const canManageDevices = useCan('device.manage_own');

    if (me === null) {
        return (
            <Stack testID="profile-screen" space="md">
                <Spinner size="large" showLabel />
            </Stack>
        );
    }

    const { user, profile, memberships, activeContext, pendingConsents } = me;
    const membership = memberships.find(
        (candidate) => candidate.id === activeContext?.membershipId,
    );
    const branch = membership?.branches.find(
        (candidate) => candidate.id === activeContext?.branchId,
    );
    const permissions = activeContext?.permissions ?? [];
    const entitlements = activeContext?.entitlements ?? [];

    const fullName = [profile.givenName, profile.familyName]
        .filter((part): part is string => part !== null && part !== '')
        .join(' ');
    const language =
        profile.preferredLocale === 'ar'
            ? t('common:locale.arabic')
            : profile.preferredLocale === 'en'
              ? t('common:locale.english')
              : profile.preferredLocale;
    const emailVerified = user.emailVerifiedAt !== null;

    return (
        <SettingsPage
            testID="profile-screen"
            titleTestID="profile-title"
            title={t('auth:profile.title')}
            subtitle={t('auth:profile.subtitle')}
        >
            {/* Who this is, before any label says so. */}
            <Card padding="md" testID="profile-identity">
                <View className="flex-row items-center gap-4">
                    <Avatar name={profile.displayName} seed={user.id} size="lg" />
                    <Stack space="xs" className="min-w-0 flex-1">
                        <Text variant="title" numberOfLines={1}>
                            {profile.displayName}
                        </Text>
                        <Text tone="secondary" numberOfLines={1}>
                            {user.email}
                        </Text>
                        <Inline space="xs" wrap>
                            <Badge
                                testID="profile-email-verified"
                                tone={emailVerified ? 'success' : 'warning'}
                                label={
                                    emailVerified
                                        ? t('auth:profile.emailVerified')
                                        : t('auth:profile.emailUnverified')
                                }
                            />
                        </Inline>
                    </Stack>
                </View>
            </Card>

            <Card title={t('auth:profile.account')} padding="md">
                <FactGrid
                    facts={[
                        ...(fullName === ''
                            ? []
                            : [
                                  {
                                      key: 'name',
                                      label: t('auth:profile.name'),
                                      value: fullName,
                                      testID: 'profile-name',
                                  },
                              ]),
                        {
                            key: 'display-name',
                            label: t('auth:profile.displayName'),
                            value: profile.displayName,
                            testID: 'profile-display-name',
                        },
                        {
                            key: 'email',
                            label: t('auth:profile.email'),
                            value: user.email,
                            testID: 'profile-email',
                        },
                        {
                            key: 'locale',
                            label: t('auth:profile.locale'),
                            value: language,
                            testID: 'profile-locale',
                        },
                        {
                            key: 'time-zone',
                            label: t('auth:profile.timeZone'),
                            value: profile.timeZone ?? t('auth:profile.none'),
                            testID: 'profile-time-zone',
                        },
                        {
                            key: 'member-since',
                            label: t('auth:profile.memberSince'),
                            // `GET /api/v1/me` does not expose an account creation date, so in `api`
                            // mode this arrives empty. Formatting it anyway would print "Invalid
                            // Date" at people; "none" is the truth (recorded as a backend follow-up).
                            value:
                                user.createdAt === ''
                                    ? t('auth:profile.none')
                                    : formatter.formatDate(user.createdAt),
                            testID: 'profile-member-since',
                        },
                    ]}
                />
            </Card>

            <Card title={t('auth:profile.security')} padding="sm">
                <ListItem
                    testID="profile-password"
                    leading={<MarkTile name="keyRound" />}
                    title={t('auth:profile.password')}
                    description={t('auth:profile.passwordHint')}
                    trailing={
                        <Button
                            testID="profile-change-password"
                            variant="secondary"
                            size="sm"
                            label={t('auth:profile.changePassword')}
                            onPress={() => {
                                router.push('/change-password');
                            }}
                        />
                    }
                />
                <ListItem
                    testID="profile-two-factor-row"
                    leading={<MarkTile name="shield" />}
                    title={t('auth:profile.twoFactor')}
                    description={t('auth:profile.twoFactorHint')}
                    trailing={
                        <Badge
                            testID="profile-two-factor"
                            tone={user.twoFactorEnabled ? 'success' : 'neutral'}
                            label={
                                user.twoFactorEnabled
                                    ? t('auth:profile.twoFactorEnabled')
                                    : t('auth:profile.twoFactorDisabled')
                            }
                        />
                    }
                />
                {/* Only offered to somebody the devices page would let in. */}
                {canManageDevices ? (
                    <ListItem
                        testID="profile-devices"
                        leading={<MarkTile name="monitorSmartphone" />}
                        title={t('common:nav.devices')}
                        description={t('auth:profile.devicesHint')}
                        chevron
                        onPress={() => {
                            router.push('/devices');
                        }}
                    />
                ) : null}
            </Card>

            <Card title={t('auth:profile.context')} padding="md">
                {activeContext === null || membership === undefined ? (
                    <Text testID="profile-no-context" tone="secondary">
                        {t('auth:profile.noContext')}
                    </Text>
                ) : (
                    <FactGrid
                        facts={[
                            {
                                key: 'organisation',
                                label: t('auth:profile.organisation'),
                                value: membership.organisation.name,
                                testID: 'profile-organisation',
                            },
                            {
                                key: 'branch',
                                label: t('auth:profile.branch'),
                                value: branch?.name ?? t('auth:profile.noBranch'),
                                testID: 'profile-branch',
                            },
                            {
                                key: 'roles',
                                label: t('auth:profile.roles'),
                                value:
                                    membership.roles.map((role) => role.name).join(', ') ||
                                    t('auth:profile.none'),
                                testID: 'profile-roles',
                            },
                        ]}
                    />
                )}

                <Accordion
                    testID="profile-access"
                    multiple
                    items={[
                        {
                            key: 'permissions',
                            testID: 'profile-permissions',
                            title: t('auth:profile.permissionsTitle', {
                                count: permissions.length,
                            }),
                            children:
                                permissions.length === 0 ? (
                                    <Text testID="profile-permissions-none" tone="secondary">
                                        {t('auth:profile.none')}
                                    </Text>
                                ) : (
                                    <Inline space="xs" wrap>
                                        {permissions.map((permission) => (
                                            <Badge
                                                key={permission}
                                                testID={`profile-permission-${permission}`}
                                                label={t(
                                                    `accessAdmin:codes.${permission}.name` as never,
                                                    { defaultValue: permission },
                                                )}
                                            />
                                        ))}
                                    </Inline>
                                ),
                        },
                        {
                            key: 'entitlements',
                            testID: 'profile-entitlements',
                            title: t('auth:profile.entitlementsTitle', {
                                count: entitlements.length,
                            }),
                            children:
                                entitlements.length === 0 ? (
                                    <Text testID="profile-entitlements-none" tone="secondary">
                                        {t('auth:profile.none')}
                                    </Text>
                                ) : (
                                    <Inline space="xs" wrap>
                                        {entitlements.map((entitlement) => (
                                            <Badge
                                                key={entitlement}
                                                testID={`profile-entitlement-${entitlement}`}
                                                tone="info"
                                                icon={null}
                                                label={entitlement}
                                            />
                                        ))}
                                    </Inline>
                                ),
                        },
                    ]}
                />
            </Card>

            <Card title={t('auth:profile.memberships')} padding="sm">
                {memberships.length === 0 ? (
                    <Text testID="profile-memberships-none" tone="secondary" className="px-3 py-2">
                        {t('auth:profile.none')}
                    </Text>
                ) : (
                    memberships.map((entry) => (
                        <ListItem
                            key={entry.id}
                            testID={`profile-membership-${entry.organisation.slug}`}
                            leading={
                                <Avatar
                                    name={entry.organisation.name}
                                    seed={entry.organisation.id}
                                    size="md"
                                />
                            }
                            title={entry.organisation.name}
                            description={
                                entry.roles.map((role) => role.name).join(', ') ||
                                t('auth:profile.none')
                            }
                            trailing={
                                <Inline space="xs" align="center">
                                    {entry.id === membership?.id ? (
                                        <Badge
                                            testID={`profile-membership-${entry.organisation.slug}-current`}
                                            tone="brand"
                                            label={t('auth:profile.currentMembership')}
                                        />
                                    ) : null}
                                    <Badge
                                        tone={MEMBERSHIP_TONE[entry.status]}
                                        label={t(`auth:profile.membershipStatus.${entry.status}`)}
                                    />
                                </Inline>
                            }
                        />
                    ))
                )}
            </Card>

            {pendingConsents.length === 0 ? (
                <Card title={t('auth:profile.consents')} padding="md">
                    <Text testID="profile-consents-none" tone="secondary">
                        {t('auth:profile.consentsNone')}
                    </Text>
                </Card>
            ) : (
                <Callout
                    testID="profile-consents"
                    tone="warning"
                    title={t('auth:profile.consents')}
                    body={t('auth:profile.consentsBody')}
                >
                    <Inline space="xs" wrap>
                        {pendingConsents.map((consent) => (
                            <Badge
                                key={consent.code}
                                testID={`profile-consent-${consent.code}`}
                                tone={consent.required ? 'warning' : 'neutral'}
                                label={`${consent.code} · ${consent.version}`}
                            />
                        ))}
                    </Inline>
                </Callout>
            )}
        </SettingsPage>
    );
}
