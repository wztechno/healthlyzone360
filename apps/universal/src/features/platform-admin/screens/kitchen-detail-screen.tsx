import type { PlatformKitchen, PlatformKitchenOwner } from '@healthy360/api-client/contracts';
import { apiFailure, isReactivatable, isTradingStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useInviteOwnerMutation,
    usePlatformKitchenQuery,
    useReactivateKitchenMutation,
    useRevokeOwnerMutation,
    useSuspendKitchenMutation,
} from '../../../data/platform-admin-hooks.ts';
import { ownerRowTestId, tenantStatusKey, tenantStatusTone } from '../format.ts';

/**
 * `/platform-admin/kitchens/{kitchen}` — one kitchen, and everything the platform can do to it.
 *
 * ## Three destructive-ish actions, three confirmations, and each says what actually happens
 *
 * Suspending, reactivating and ending an owner's membership all open a `Dialog` first. The bodies
 * are not "are you sure" — they are the consequence, stated: what disappears from the marketplace,
 * what the kitchen's own staff can still do, and, for the last owner, that nobody will be able to
 * run the kitchen afterwards. A confirmation that only asks whether you meant it is a click, not a
 * decision.
 *
 * ## The last-owner warning is a warning and not a block
 *
 * The API allows it deliberately — a kitchen whose only owner has left has to be able to have that
 * membership ended before a replacement exists — and returns `remainingOwners` so this screen can
 * say so both before (in the dialog) and after (in the toast). Refusing here would put the client
 * in disagreement with the server about what is legal.
 *
 * ## `lockVersion` travels from the loaded record
 *
 * Both lifecycle mutations send the version this screen is currently showing. If somebody else
 * changed the kitchen in the meantime the write is refused with a conflict and the operator reloads
 * — which is the entire point, and the reason the console does not cache a version of its own.
 */
export function PlatformKitchenDetailScreen() {
    return (
        <Gate area="platform-admin" testID="platform-admin-kitchen">
            <KitchenDetail />
        </Gate>
    );
}

type PendingAction = 'suspend' | 'reactivate' | null;

function KitchenDetail() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();
    const params = useLocalSearchParams<{ kitchen?: string }>();
    const identifier = typeof params.kitchen === 'string' ? params.kitchen : undefined;

    const kitchen = usePlatformKitchenQuery(identifier);

    const [pending, setPending] = useState<PendingAction>(null);
    const [suspendReason, setSuspendReason] = useState('');
    const [revoking, setRevoking] = useState<PlatformKitchenOwner | null>(null);

    const suspend = useSuspendKitchenMutation();
    const reactivate = useReactivateKitchenMutation();
    const revoke = useRevokeOwnerMutation();

    const failure = toFailure(kitchen.error);
    const record = kitchen.data;

    if (kitchen.isPending) {
        return (
            <Stack space="sm" testID="platform-admin-kitchen-loading">
                <Skeleton testID="platform-admin-kitchen-skeleton" heightClassName="h-8" />
                <Skeleton heightClassName="h-24" />
                <Skeleton heightClassName="h-24" />
            </Stack>
        );
    }

    if (failure !== null || record === undefined) {
        return (
            <Stack space="md" testID="platform-admin-kitchen-error-screen">
                <Button
                    testID="platform-admin-kitchen-back"
                    variant="ghost"
                    label={t('platformAdmin:detail.backToList')}
                    onPress={() => {
                        router.push('/platform-admin' as never);
                    }}
                />
                <ErrorState
                    testID="platform-admin-kitchen-error"
                    // A resolved query with no record is only reachable when the identifier in the
                    // URL names nothing — a stale bookmark, or a slug somebody typed. Synthesising
                    // the failure the API would have sent keeps that on one rendering path rather
                    // than adding a second empty state for a case the server already has a code
                    // for.
                    failure={failure ?? apiFailure('resource.not_found')}
                    title={t('platformAdmin:detail.errorTitle')}
                    onRetry={() => {
                        void kitchen.refetch();
                    }}
                    retrying={kitchen.isFetching}
                />
            </Stack>
        );
    }

    const ownerColumns: readonly TableColumn<PlatformKitchenOwner>[] = [
        {
            key: 'person',
            header: t('platformAdmin:owners.column.person'),
            rowHeader: true,
            render: (owner) => (
                <Text testID={`${ownerRowTestId(owner.membershipId)}-name`} variant="bodyStrong">
                    {owner.name ?? t('platformAdmin:owners.unnamed')}
                </Text>
            ),
        },
        {
            key: 'email',
            header: t('platformAdmin:owners.column.email'),
            flex: 2,
            render: (owner) => (
                <Text testID={`${ownerRowTestId(owner.membershipId)}-email`} tone="secondary">
                    {owner.email}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('platformAdmin:owners.column.status'),
            render: (owner) => (
                <Badge
                    testID={`${ownerRowTestId(owner.membershipId)}-status`}
                    tone="success"
                    label={owner.status}
                />
            ),
        },
    ];

    return (
        <Stack space="lg" testID="platform-admin-kitchen-screen">
            <Button
                testID="platform-admin-kitchen-back"
                variant="ghost"
                label={t('platformAdmin:detail.backToList')}
                onPress={() => {
                    router.push('/platform-admin' as never);
                }}
            />

            <Stack space="xs">
                <Inline space="sm" align="center" wrap>
                    <Heading level={1} testID="platform-admin-kitchen-title">
                        {record.name}
                    </Heading>
                    <Badge
                        testID="platform-admin-kitchen-status"
                        tone={tenantStatusTone(record.status)}
                        label={t(tenantStatusKey(record.status))}
                    />
                </Inline>
                <Text tone="secondary" testID="platform-admin-kitchen-slug">
                    {record.slug} · {record.countryCode} · {record.currencyCode}
                </Text>
            </Stack>

            {record.status === 'suspended' ? (
                <Card padding="md" testID="platform-admin-kitchen-suspended">
                    <Stack space="xs">
                        <Heading level={2}>{t('platformAdmin:detail.suspendedTitle')}</Heading>
                        {record.suspendedAt === null ? null : (
                            <Text variant="caption" tone="secondary">
                                {t('platformAdmin:detail.suspendedOn', {
                                    date: formatter.formatDate(record.suspendedAt),
                                })}
                            </Text>
                        )}
                        <Text testID="platform-admin-kitchen-suspension-reason">
                            {record.suspensionReason ?? t('platformAdmin:detail.suspendedNoReason')}
                        </Text>
                    </Stack>
                </Card>
            ) : null}

            <Inline space="sm" wrap testID="platform-admin-kitchen-lifecycle">
                {isTradingStatus(record.status) ? (
                    <Button
                        testID="platform-admin-kitchen-suspend"
                        variant="danger"
                        label={t('platformAdmin:lifecycle.suspend')}
                        onPress={() => {
                            setSuspendReason('');
                            setPending('suspend');
                        }}
                    />
                ) : null}
                {isReactivatable(record.status) ? (
                    <Button
                        testID="platform-admin-kitchen-reactivate"
                        label={t('platformAdmin:lifecycle.reactivate')}
                        onPress={() => {
                            setPending('reactivate');
                        }}
                    />
                ) : null}
                {record.status === 'closed' ? (
                    <Text testID="platform-admin-kitchen-closed-note" tone="secondary">
                        {t('platformAdmin:lifecycle.closedNote')}
                    </Text>
                ) : null}
            </Inline>

            <CatalogueCard kitchen={record} />

            <Card padding="md" testID="platform-admin-kitchen-branches">
                <Stack space="sm">
                    <Heading level={2}>{t('platformAdmin:detail.branchesTitle')}</Heading>
                    <Table
                        testID="platform-admin-kitchen-branches-table"
                        caption={t('platformAdmin:detail.branchesTitle')}
                        captionHidden
                        rows={record.branches}
                        rowKey={(branch) => String(branch.id)}
                        columns={[
                            {
                                key: 'name',
                                header: t('platformAdmin:detail.branchColumn.name'),
                                rowHeader: true,
                                render: (branch) => <Text>{branch.name}</Text>,
                            },
                            {
                                key: 'city',
                                header: t('platformAdmin:detail.branchColumn.city'),
                                render: (branch) => (
                                    <Text tone="secondary">
                                        {branch.city ?? t('platformAdmin:detail.noCity')}
                                    </Text>
                                ),
                            },
                            {
                                key: 'timezone',
                                header: t('platformAdmin:detail.branchColumn.timezone'),
                                render: (branch) => <Text tone="secondary">{branch.timezone}</Text>,
                            },
                            {
                                key: 'status',
                                header: t('platformAdmin:detail.branchColumn.status'),
                                render: (branch) => (
                                    <Badge
                                        tone={branch.status === 'active' ? 'success' : 'neutral'}
                                        label={t(
                                            `platformAdmin:detail.branchStatus.${branch.status}`,
                                        )}
                                    />
                                ),
                            },
                        ]}
                    />
                </Stack>
            </Card>

            <Card padding="md" testID="platform-admin-kitchen-owners">
                <Stack space="sm">
                    <Stack space="xs">
                        <Heading level={2}>{t('platformAdmin:owners.title')}</Heading>
                        <Text tone="secondary">{t('platformAdmin:owners.subtitle')}</Text>
                    </Stack>

                    {record.owners.length === 0 ? (
                        <Stack space="xs" testID="platform-admin-kitchen-owners-empty">
                            <Text variant="bodyStrong">{t('platformAdmin:owners.emptyTitle')}</Text>
                            <Text tone="secondary">{t('platformAdmin:owners.emptyBody')}</Text>
                        </Stack>
                    ) : (
                        <Table<PlatformKitchenOwner>
                            testID="platform-admin-kitchen-owners-table"
                            caption={t('platformAdmin:owners.title')}
                            captionHidden
                            columns={ownerColumns}
                            rows={record.owners}
                            rowKey={(owner) => String(owner.membershipId)}
                            rowAction={{
                                header: t('platformAdmin:owners.revoke'),
                                render: (owner) => (
                                    <Button
                                        testID={`${ownerRowTestId(owner.membershipId)}-revoke`}
                                        size="sm"
                                        variant="danger"
                                        label={t('platformAdmin:owners.revoke')}
                                        onPress={() => {
                                            setRevoking(owner);
                                        }}
                                    />
                                ),
                            }}
                        />
                    )}
                </Stack>
            </Card>

            <InviteOwnerCard kitchen={record} />

            <Dialog
                testID="platform-admin-suspend-dialog"
                open={pending === 'suspend'}
                onClose={() => {
                    setPending(null);
                }}
                title={t('platformAdmin:lifecycle.suspendTitle', { name: record.name })}
                description={t('platformAdmin:lifecycle.suspendBody')}
                actions={
                    <>
                        <Button
                            testID="platform-admin-suspend-cancel"
                            variant="quiet"
                            label={t('platformAdmin:detail.backToList')}
                            onPress={() => {
                                setPending(null);
                            }}
                        />
                        <Button
                            testID="platform-admin-suspend-confirm"
                            variant="danger"
                            label={t('platformAdmin:lifecycle.suspendConfirm')}
                            loading={suspend.isPending}
                            onPress={() => {
                                suspend.mutate(
                                    {
                                        kitchen: record.slug,
                                        lockVersion: record.lockVersion,
                                        ...(suspendReason.trim() === ''
                                            ? {}
                                            : { reason: suspendReason.trim() }),
                                    },
                                    {
                                        onSuccess: () => {
                                            setPending(null);
                                            toast.show({
                                                testID: 'platform-admin-suspended-toast',
                                                tone: 'success',
                                                message: t('platformAdmin:lifecycle.suspended', {
                                                    name: record.name,
                                                }),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <TextInputField
                    testID="platform-admin-suspend-reason"
                    label={t('platformAdmin:lifecycle.suspendReasonLabel')}
                    hint={t('platformAdmin:lifecycle.suspendReasonHint')}
                    value={suspendReason}
                    onChangeText={setSuspendReason}
                    multiline
                />
            </Dialog>

            <Dialog
                testID="platform-admin-reactivate-dialog"
                open={pending === 'reactivate'}
                onClose={() => {
                    setPending(null);
                }}
                title={t('platformAdmin:lifecycle.reactivateTitle', { name: record.name })}
                description={t('platformAdmin:lifecycle.reactivateBody')}
                actions={
                    <>
                        <Button
                            testID="platform-admin-reactivate-cancel"
                            variant="quiet"
                            label={t('platformAdmin:detail.backToList')}
                            onPress={() => {
                                setPending(null);
                            }}
                        />
                        <Button
                            testID="platform-admin-reactivate-confirm"
                            label={t('platformAdmin:lifecycle.reactivateConfirm')}
                            loading={reactivate.isPending}
                            onPress={() => {
                                reactivate.mutate(
                                    { kitchen: record.slug, lockVersion: record.lockVersion },
                                    {
                                        onSuccess: () => {
                                            setPending(null);
                                            toast.show({
                                                testID: 'platform-admin-reactivated-toast',
                                                tone: 'success',
                                                message: t('platformAdmin:lifecycle.reactivated', {
                                                    name: record.name,
                                                }),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />

            <Dialog
                testID="platform-admin-revoke-dialog"
                open={revoking !== null}
                onClose={() => {
                    setRevoking(null);
                }}
                title={t('platformAdmin:owners.revokeTitle')}
                description={t('platformAdmin:owners.revokeBody', {
                    name: revoking?.name ?? revoking?.email ?? '',
                    kitchen: record.name,
                })}
                actions={
                    <>
                        <Button
                            testID="platform-admin-revoke-cancel"
                            variant="quiet"
                            label={t('platformAdmin:detail.backToList')}
                            onPress={() => {
                                setRevoking(null);
                            }}
                        />
                        <Button
                            testID="platform-admin-revoke-confirm"
                            variant="danger"
                            label={t('platformAdmin:owners.revokeConfirm')}
                            loading={revoke.isPending}
                            onPress={() => {
                                const target = revoking;
                                if (target === null) return;

                                revoke.mutate(
                                    { kitchen: record.slug, membership: target.membershipId },
                                    {
                                        onSuccess: (result) => {
                                            setRevoking(null);
                                            toast.show({
                                                testID: 'platform-admin-revoked-toast',
                                                tone:
                                                    result.remainingOwners === 0
                                                        ? 'warning'
                                                        : 'success',
                                                message:
                                                    result.remainingOwners === 0
                                                        ? t('platformAdmin:owners.revokedLast')
                                                        : t('platformAdmin:owners.revoked'),
                                            });
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {record.owners.length === 1 ? (
                    <Text testID="platform-admin-revoke-last-warning" tone="danger">
                        {t('platformAdmin:owners.revokeLastWarning')}
                    </Text>
                ) : null}
            </Dialog>
        </Stack>
    );
}

function CatalogueCard({ kitchen }: { readonly kitchen: PlatformKitchen }) {
    const { t } = useTranslation();

    const figures: readonly {
        readonly key: string;
        readonly label: string;
        readonly value: number;
    }[] = [
        {
            key: 'meals',
            label: t('platformAdmin:detail.catalogueMeals'),
            value: kitchen.catalogue.meals,
        },
        {
            key: 'products',
            label: t('platformAdmin:detail.catalogueProducts'),
            value: kitchen.catalogue.products,
        },
        {
            key: 'plans',
            label: t('platformAdmin:detail.cataloguePlans'),
            value: kitchen.catalogue.plans,
        },
        {
            key: 'published',
            label: t('platformAdmin:detail.cataloguePublished'),
            value: kitchen.catalogue.published,
        },
        {
            key: 'draft',
            label: t('platformAdmin:detail.catalogueDraft'),
            value: kitchen.catalogue.draft,
        },
    ];

    return (
        <Card padding="md" testID="platform-admin-kitchen-catalogue">
            <Stack space="sm">
                <Heading level={2}>{t('platformAdmin:detail.catalogueTitle')}</Heading>
                <Inline space="lg" wrap>
                    {figures.map((figure) => (
                        <Stack key={figure.key} space="none">
                            <Text
                                testID={`platform-admin-kitchen-catalogue-${figure.key}`}
                                variant="bodyStrong"
                            >
                                {String(figure.value)}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {figure.label}
                            </Text>
                        </Stack>
                    ))}
                </Inline>
            </Stack>
        </Card>
    );
}

function InviteOwnerCard({ kitchen }: { readonly kitchen: PlatformKitchen }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const invite = useInviteOwnerMutation();

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');

    const failure = toFailure(invite.error);

    return (
        <Card padding="md" testID="platform-admin-invite">
            <Stack space="sm">
                <Stack space="xs">
                    <Heading level={2}>{t('platformAdmin:invite.title')}</Heading>
                    <Text tone="secondary">{t('platformAdmin:invite.subtitle')}</Text>
                    <Text variant="caption" tone="secondary">
                        {t('platformAdmin:invite.supersedes')}
                    </Text>
                </Stack>

                <TextInputField
                    testID="platform-admin-invite-email"
                    label={t('platformAdmin:invite.emailLabel')}
                    placeholder={t('platformAdmin:invite.emailPlaceholder')}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    required
                    {...(failure?.code === 'validation.failed' && failure.fields.email !== undefined
                        ? { error: failure.fields.email[0] }
                        : {})}
                />

                <TextInputField
                    testID="platform-admin-invite-name"
                    label={t('platformAdmin:invite.nameLabel')}
                    hint={t('platformAdmin:invite.nameHint')}
                    value={name}
                    onChangeText={setName}
                />

                <TextInputField
                    testID="platform-admin-invite-message"
                    label={t('platformAdmin:invite.messageLabel')}
                    hint={t('platformAdmin:invite.messageHint')}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                />

                <Inline space="sm" wrap>
                    <Button
                        testID="platform-admin-invite-submit"
                        label={t('platformAdmin:invite.submit')}
                        loading={invite.isPending}
                        disabled={email.trim() === ''}
                        onPress={() => {
                            invite.mutate(
                                {
                                    kitchen: kitchen.slug,
                                    email: email.trim(),
                                    ...(name.trim() === '' ? {} : { name: name.trim() }),
                                    ...(message.trim() === '' ? {} : { message: message.trim() }),
                                },
                                {
                                    onSuccess: (result) => {
                                        setEmail('');
                                        setName('');
                                        setMessage('');
                                        toast.show({
                                            testID: 'platform-admin-invited-toast',
                                            tone: result.mailed ? 'success' : 'warning',
                                            message: result.mailed
                                                ? t('platformAdmin:invite.sent', {
                                                      email: result.email,
                                                      date: formatter.formatDate(result.expiresAt),
                                                  })
                                                : t('platformAdmin:invite.sentNotMailed', {
                                                      email: result.email,
                                                  }),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}
