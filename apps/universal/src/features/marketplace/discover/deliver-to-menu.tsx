import { Button, Icon, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { CustomerAddress } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

import { useAddressesQuery, useUpdateAddressMutation } from '../../../data/account-hooks.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';

/** Where one saved address is added or amended; `new` adds one. */
const ADDRESS_PATH = '/customer/account/addresses';

/** The glyph a saved address wears, read from the name the person gave it. */
function addressIcon(label: string): IconName {
    const name = label.trim().toLowerCase();
    if (name === 'home' || name === 'المنزل' || name === 'البيت') return 'home';
    if (name === 'work' || name === 'office' || name === 'العمل' || name === 'المكتب') {
        return 'building';
    }
    return 'mapPin';
}

/**
 * **Deliver to** — the accepted design's address dropdown: the saved addresses as a radio list, each
 * with its edit button, "Add a new address", and "Deliver here".
 *
 * A session knows one address, the default, so choosing another and pressing Deliver here makes
 * that one the default (the same change the account page makes). Signed out, the trigger asks the
 * person to sign in instead of opening.
 */
export function DeliverToMenu({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    const router = useRouter();
    const goToAuth = useGoToAuth();
    const here = useCurrentHref();
    const { me } = useSession();
    const signedIn = me !== null;
    const addresses = useAddressesQuery(signedIn);
    const update = useUpdateAddressMutation();
    const saved = addresses.data ?? [];
    const home = saved.find((address) => address.isDefault) ?? saved[0];

    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);
    const chosen = saved.find((address) => address.id === picked) ?? home;
    const root = useRef<View>(null);

    // Escape and a press outside close it, as the design's popovers do.
    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onPointer = (event: PointerEvent) => {
            const node = root.current as unknown as HTMLElement | null;
            if (node !== null && !node.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [open]);

    // The address editor, which comes back here when it is done.
    const openEditor = (address: string) => {
        setOpen(false);
        router.push(withReturnTo(`${ADDRESS_PATH}/${address}`, here) as never);
    };

    const deliverHere = () => {
        if (chosen !== undefined && !chosen.isDefault) {
            update.mutate({
                addressId: chosen.id,
                request: {
                    label: chosen.label,
                    areaId: chosen.areaId,
                    line1: chosen.line1,
                    line2: chosen.line2 ?? undefined,
                    building: chosen.building ?? undefined,
                    floor: chosen.floor ?? undefined,
                    notes: chosen.notes ?? undefined,
                    makeDefault: true,
                },
            });
        }
        setOpen(false);
    };

    return (
        <View ref={root} className="relative z-raised shrink-0">
            <Pressable
                testID={`${testID}-deliver-to`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={
                    home === undefined
                        ? t('marketplace:discover.chooseArea')
                        : t('marketplace:discover.deliverToLabel', { area: home.areaName })
                }
                aria-haspopup="dialog"
                aria-expanded={open}
                accessibilityState={{ expanded: open }}
                onPress={() => {
                    if (!signedIn) {
                        goToAuth('/sign-in');
                        return;
                    }
                    setPicked(null);
                    setOpen((current) => !current);
                }}
                className={[
                    'h-12 flex-row items-center gap-2.5 rounded-full pe-4 ps-3 transition duration-normal ease-standard hover:bg-surface-brand-subtle',
                    open ? 'bg-surface-brand-subtle' : '',
                ].join(' ')}
            >
                <Icon name="mapPin" className="text-content-on-brand-subtle" />
                <View className="flex-col items-start">
                    <RNText className="hidden text-xs font-medium text-content-secondary md:flex">
                        {t('marketplace:discover.deliverTo')}
                    </RNText>
                    <RNText
                        testID={`${testID}-area`}
                        numberOfLines={1}
                        className="max-w-[140px] text-sm font-semibold text-content-primary"
                    >
                        {home === undefined ? t('marketplace:discover.chooseArea') : home.areaName}
                    </RNText>
                </View>
                <View className={open ? 'hidden rotate-180 md:flex' : 'hidden md:flex'}>
                    <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                </View>
            </Pressable>

            {open ? (
                <View
                    testID={`${testID}-addresses`}
                    role="dialog"
                    aria-label={t('marketplace:discover.deliverTo')}
                    className="absolute start-0 top-full z-tooltip mt-3 w-[380px] rounded-3xl border border-stroke-subtle bg-surface-raised p-4 shadow-elevation-3 web:max-w-[calc(100vw-32px)]"
                >
                    <View className="flex-row items-center gap-2">
                        <View className="h-6 w-6 items-center justify-center rounded-lg bg-surface-brand-subtle">
                            <Icon
                                name="mapPin"
                                size="sm"
                                className="text-content-on-brand-subtle"
                            />
                        </View>
                        <RNText
                            role="heading"
                            aria-level={2}
                            className="font-display text-base font-bold text-content-primary"
                        >
                            {t('marketplace:discover.deliverTo')}
                        </RNText>
                    </View>

                    <View
                        role="radiogroup"
                        aria-label={t('marketplace:discover.savedAddresses')}
                        className="mt-3 flex-col gap-2"
                    >
                        {saved.map((address) => (
                            <AddressRow
                                key={address.id}
                                testID={`${testID}-address-${address.id}`}
                                address={address}
                                selected={address.id === chosen?.id}
                                onPick={() => {
                                    setPicked(address.id);
                                }}
                                onEdit={() => {
                                    openEditor(address.id);
                                }}
                            />
                        ))}
                        <Pressable
                            testID={`${testID}-add-address`}
                            role="button"
                            accessibilityRole="button"
                            onPress={() => {
                                openEditor('new');
                            }}
                            className="h-11 flex-row items-center justify-center gap-1.5 rounded-2xl border border-dashed border-stroke-strong transition duration-normal ease-standard hover:border-surface-brand hover:bg-surface-base"
                        >
                            <Icon name="plus" size="sm" className="text-content-brand" />
                            <RNText className="text-sm font-semibold text-content-brand">
                                {t('marketplace:discover.addAddress')}
                            </RNText>
                        </Pressable>
                    </View>

                    {chosen === undefined ? null : (
                        <View className="mt-4 flex-row items-center gap-3 border-t border-stroke-subtle pt-3">
                            <RNText
                                numberOfLines={1}
                                className="me-auto min-w-0 shrink text-xs text-content-secondary text-start"
                            >
                                {chosen.areaName}
                            </RNText>
                            <Button
                                testID={`${testID}-deliver-here`}
                                size="sm"
                                label={t('marketplace:discover.deliverHere')}
                                loading={update.isPending}
                                onPress={deliverHere}
                            />
                        </View>
                    )}
                </View>
            ) : null}
        </View>
    );
}

/** One saved address: the pick (a radio) and, beside it, its edit button. */
function AddressRow({
    testID,
    address,
    selected,
    onPick,
    onEdit,
}: {
    readonly testID: string;
    readonly address: CustomerAddress;
    readonly selected: boolean;
    readonly onPick: () => void;
    readonly onEdit: () => void;
}) {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const [dot] = useState(() => new Animated.Value(selected ? 1 : 0));

    useEffect(() => {
        const to = selected ? 1 : 0;
        if (!enabled) {
            dot.setValue(to);
            return;
        }
        Animated.timing(dot, {
            toValue: to,
            duration: 250,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, [dot, enabled, selected]);

    return (
        <View
            className={[
                'flex-row items-center rounded-2xl border transition duration-normal ease-standard',
                selected
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke bg-surface-raised hover:border-stroke-strong',
            ].join(' ')}
        >
            <Pressable
                testID={testID}
                role="radio"
                accessibilityRole="radio"
                aria-checked={selected}
                accessibilityState={{ checked: selected }}
                onPress={onPick}
                className="min-w-0 flex-1 flex-row items-center gap-2.5 py-2.5 pe-1.5 ps-2.5"
            >
                <View
                    className={
                        selected
                            ? 'h-9 w-9 items-center justify-center rounded-xl bg-surface-brand'
                            : 'h-9 w-9 items-center justify-center rounded-xl bg-surface-base'
                    }
                >
                    <Icon
                        name={addressIcon(address.label)}
                        size="sm"
                        className={selected ? 'text-content-on-brand' : 'text-content-primary'}
                    />
                </View>
                <View className="min-w-0 flex-1 flex-col items-start">
                    <View className="flex-row items-center gap-1.5">
                        <RNText
                            numberOfLines={1}
                            className="text-sm font-bold text-content-primary text-start"
                        >
                            {address.label}
                        </RNText>
                        {address.isDefault ? (
                            <RNText className="rounded-md bg-surface-base px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-content-secondary">
                                {t('marketplace:discover.defaultAddress')}
                            </RNText>
                        ) : null}
                    </View>
                    <RNText
                        numberOfLines={1}
                        className={[
                            'max-w-[220px] text-xs text-start',
                            selected ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                        ].join(' ')}
                    >
                        {t('marketplace:discover.addressLine', {
                            area: address.areaName,
                            line: address.line1,
                        })}
                    </RNText>
                </View>
                <View
                    className={
                        selected
                            ? 'h-5 w-5 items-center justify-center rounded-full border-2 border-surface-brand'
                            : 'h-5 w-5 items-center justify-center rounded-full border-2 border-stroke-strong'
                    }
                >
                    <Animated.View
                        className="h-2.5 w-2.5 rounded-full bg-surface-brand"
                        style={{ transform: [{ scale: dot }] }}
                    />
                </View>
            </Pressable>
            <Pressable
                testID={`${testID}-edit`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('marketplace:discover.editAddress', { label: address.label })}
                onPress={onEdit}
                className="me-1.5 h-9 w-9 items-center justify-center rounded-xl hover:bg-surface-raised"
            >
                <Icon name="pen" size="sm" className="text-content-secondary" />
            </Pressable>
        </View>
    );
}
