import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useAddressesQuery,
    useRemoveAddressMutation,
} from '../../../data/account-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';

/**
 * `/customer/account/addresses` — where a person's orders go.
 *
 * ## The area is shown, not the area identifier
 *
 * `CustomerAddress` carries `areaName` alongside `areaId` precisely so a list costs one request:
 * the server resolves the name because it owns the area table, and the alternative — a second call
 * per row, or a client-side lookup table that goes stale — buys nothing. So the row shows the
 * person's own label, the street, and the area's published name.
 *
 * ## Deletion asks first, and says what is being deleted
 *
 * `removeAddress` is not reversible and there is no undo behind it, so the confirmation names the
 * address rather than asking "are you sure?" about an unnamed thing. A person with a Home and an
 * Office needs to know which one the dialog is about, and the dialog is frequently the only place
 * they will look.
 */

const TEST_ID = 'addresses-screen';

export function AddressesScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const addresses = useAddressesQuery();
    const remove = useRemoveAddressMutation();

    /** The address the confirmation is about. `null` closes the dialog. */
    const [pendingRemoval, setPendingRemoval] = useState<{
        readonly id: string;
        readonly label: string;
    } | null>(null);

    const items = addresses.data ?? [];
    const removeFailure = toFailure(remove.error);

    const addButton = (
        <Button
            testID={`${TEST_ID}-add`}
            label={t('account:addresses.add')}
            onPress={() => {
                router.push('/customer/account/addresses/new' as never);
            }}
        />
    );

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:addresses.title')}
                </Heading>
                <Text tone="secondary">{t('account:addresses.subtitle')}</Text>
            </Stack>

            {removeFailure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-remove-error`}
                    role="alert"
                    tone="danger"
                    title={removeFailure.message}
                />
            )}

            <QueryStates
                query={addresses}
                isEmpty={items.length === 0}
                emptyTitle={t('account:addresses.empty')}
                emptyBody={t('account:addresses.emptyBody')}
                emptyActions={addButton}
                skeletonCount={2}
                testID={TEST_ID}
            >
                <Stack space="sm" testID={`${TEST_ID}-list`}>
                    {items.map((address) => (
                        <Card key={address.id} testID={`address-row-${address.id}`} padding="md">
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text variant="bodyStrong">{address.label}</Text>
                                    {address.isDefault ? (
                                        <Badge
                                            testID={`address-row-${address.id}-default`}
                                            tone="info"
                                            label={t('account:addresses.default')}
                                        />
                                    ) : null}
                                </Inline>

                                <Text tone="secondary" testID={`address-row-${address.id}-area`}>
                                    {address.areaName}
                                </Text>
                                <Text tone="secondary" variant="caption">
                                    {[address.line1, address.line2, address.building, address.floor]
                                        .filter((part) => part !== null && part.trim().length > 0)
                                        .join(t('account:addresses.partSeparator'))}
                                </Text>

                                <Inline space="sm" wrap>
                                    <Button
                                        testID={`address-row-${address.id}-edit`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('account:addresses.edit')}
                                        onPress={() => {
                                            router.push(
                                                `/customer/account/addresses/${address.id}` as never,
                                            );
                                        }}
                                    />
                                    <Button
                                        testID={`address-row-${address.id}-remove`}
                                        size="sm"
                                        variant="ghost"
                                        label={t('account:addresses.remove')}
                                        onPress={() => {
                                            setPendingRemoval({
                                                id: address.id,
                                                label: address.label,
                                            });
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </Card>
                    ))}

                    <Inline space="sm">{addButton}</Inline>
                </Stack>
            </QueryStates>

            <Dialog
                testID={`${TEST_ID}-remove-dialog`}
                open={pendingRemoval !== null}
                title={t('account:addresses.removeTitle')}
                description={t('account:addresses.removeBody', {
                    label: pendingRemoval?.label ?? '',
                })}
                onClose={() => {
                    setPendingRemoval(null);
                }}
                actions={
                    <Inline space="sm">
                        <Button
                            testID={`${TEST_ID}-remove-cancel`}
                            variant="quiet"
                            label={t('common:action.cancel')}
                            onPress={() => {
                                setPendingRemoval(null);
                            }}
                        />
                        <Button
                            testID={`${TEST_ID}-remove-confirm`}
                            // Destructive, so it is `danger` rather than the primary it was.
                            // Rule 4 is explicit that letting a destructive action occupy the
                            // primary slot is worse than leaving the slot empty — and here it was
                            // not even empty, it was the strongest control in a dialog whose other
                            // option is "keep my address".
                            variant="danger"
                            label={t('account:addresses.remove')}
                            loading={remove.isPending}
                            onPress={() => {
                                if (pendingRemoval === null) return;
                                remove.mutate(pendingRemoval.id, {
                                    onSuccess: () => {
                                        setPendingRemoval(null);
                                    },
                                });
                            }}
                        />
                    </Inline>
                }
            />
        </Stack>
    );
}
