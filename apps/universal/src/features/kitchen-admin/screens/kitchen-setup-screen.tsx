import type { KitchenSetupStep } from '@healthy360/api-client/contracts';
import {
    Callout,
    Cascade,
    ErrorState,
    FormSkeleton,
    Icon,
    InfoTip,
    Text,
    cx,
    useBreakpoint,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useGoLiveMutation, useKitchenSetupQuery } from '../../../data/kitchen-ops-hooks.ts';
import { GO_LIVE_PERMISSION, KITCHEN_SETUP_PERMISSION } from '../entity-registry.ts';
import { SETUP_STEP_ICONS, SetupRoad, canDrawRoad } from '../setup/setup-road.tsx';
import { SetupStep } from './wholesale-setup-screen.tsx';

import { DeskButton } from '../desk-kit/desk-button.tsx';
const PAGE = 'kitchen-setup';

/** Where each step is finished. */
const STEP_HREF: Readonly<Record<KitchenSetupStep['key'], string>> = {
    hours: '/kitchen/branch-operating',
    delivery: '/kitchen/delivery-zones',
    menu: '/kitchen/meals',
    prices: '/kitchen/price-lists',
    team: '/kitchen/team',
};

/**
 * `/kitchen/setup` — the steps between a new kitchen and its first customer order, drawn as the road
 * to opening (`Setup — new design`, A). Until the owner presses Go live, customers are refused and
 * the desk is warned.
 *
 * The road needs width and an SVG, so below `lg` and on native the same steps are a plain list.
 */
export function KitchenSetupScreen() {
    return (
        <Gate area="kitchen" requirement={{ allOf: [KITCHEN_SETUP_PERMISSION] }} testID={PAGE}>
            <KitchenSetup />
        </Gate>
    );
}

function KitchenSetup() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const canGoLive = useCan(GO_LIVE_PERMISSION);
    const setup = useKitchenSetupQuery();
    const goLive = useGoLiveMutation();
    const failure = toFailure(setup.error);
    const goLiveFailure = toFailure(goLive.error);

    if (failure !== null) {
        return (
            <ErrorState
                testID={`${PAGE}-error`}
                failure={failure}
                onRetry={() => {
                    void setup.refetch();
                }}
                retrying={setup.isFetching}
            />
        );
    }

    if (setup.data === undefined) {
        return <FormSkeleton testID={`${PAGE}-loading`} partTestID={PAGE} sections={3} />;
    }

    const { isLive, steps } = setup.data;
    const required = steps.filter((step) => step.required);
    const optional = steps.filter((step) => !step.required);
    const doneCount = required.filter((step) => step.done).length;
    const next = isLive ? undefined : required.find((step) => !step.done);
    const ready = !isLive && next === undefined;
    const showRoad = Platform.OS === 'web' && atLeast('lg') && canDrawRoad(required);

    const open = (step: KitchenSetupStep) => {
        router.push(STEP_HREF[step.key] as never);
    };
    const pressGoLive = () => {
        goLive.mutate(undefined, {
            onSuccess: () => {
                toast.show({
                    testID: `${PAGE}-live-toast`,
                    tone: 'success',
                    message: t('kitchen:setup.liveToast'),
                });
            },
        });
    };

    const headline = t(
        isLive
            ? 'kitchen:setup.liveTitle'
            : ready
              ? 'kitchen:setup.readyTitle'
              : 'kitchen:setup.notOpenTitle',
    );

    return (
        <Cascade space="md" testID={`${PAGE}-screen`}>
            <View className="z-auto flex-row items-end justify-between gap-4">
                <View className="z-auto min-w-0 flex-1">
                    <Text variant="micro" tone="secondary" className="font-bold uppercase">
                        {t('kitchen:families.setup.name')}
                    </Text>
                    <View className="z-auto mt-1 flex-row items-center gap-2">
                        <Text variant="display" className="!text-3xl" testID={`${PAGE}-state`}>
                            {headline}
                        </Text>
                        <InfoTip
                            testID={`${PAGE}-state-info`}
                            label={headline}
                            text={t(
                                isLive ? 'kitchen:setup.liveBody' : 'kitchen:setup.notOpenBody',
                            )}
                        />
                    </View>
                </View>
                <View
                    testID={`${PAGE}-count`}
                    className="flex-row items-baseline gap-1.5"
                    role="img"
                    aria-label={t('kitchen:setup.requiredCount', {
                        done: doneCount,
                        total: required.length,
                    })}
                >
                    <Text variant="display" className="!text-4xl text-content-on-brand-subtle">
                        {formatter.formatNumber(doneCount)}
                    </Text>
                    <Text tone="secondary">
                        {t('kitchen:setup.ofTotal', {
                            total: formatter.formatNumber(required.length),
                        })}
                    </Text>
                </View>
            </View>

            {showRoad ? (
                <SetupRoad steps={required} isLive={isLive} onOpen={open} testID={`${PAGE}-road`} />
            ) : (
                required.map((step, index) => (
                    <SetupStep
                        key={step.key}
                        testID={`${PAGE}-${step.key}`}
                        ordinal={index + 1}
                        title={t(`kitchen:setup.step.${step.key}.title`)}
                        done={step.done}
                        body={t(`kitchen:setup.step.${step.key}.body`)}
                        action={
                            <DeskButton
                                testID={`${PAGE}-${step.key}-open`}
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:setup.open')}
                                onPress={() => {
                                    open(step);
                                }}
                            />
                        }
                    />
                ))
            )}

            {goLiveFailure === null ? null : (
                <Callout
                    testID={`${PAGE}-go-live-error`}
                    role="alert"
                    tone="danger"
                    title={t('kitchen:setup.goLiveError')}
                    body={goLiveFailure.message}
                />
            )}

            <View className={cx('z-auto gap-3', atLeast('md') ? 'flex-row' : 'flex-col')}>
                <View
                    testID={`${PAGE}-focus`}
                    className="z-auto min-w-0 flex-[2] flex-row items-center gap-3.5 rounded-panel bg-surface-brand-subtle p-4"
                >
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-surface-brand">
                        <Icon
                            name={next === undefined ? 'store' : SETUP_STEP_ICONS[next.key]}
                            size="md"
                            className="text-content-on-brand"
                        />
                    </View>
                    <View className="z-auto min-w-0 flex-1">
                        <Text variant="micro" tone="secondary" className="font-bold uppercase">
                            {t(
                                next !== undefined
                                    ? 'kitchen:setup.next'
                                    : isLive
                                      ? 'kitchen:families.setup.name'
                                      : 'kitchen:setup.allSet',
                            )}
                        </Text>
                        <View className="z-auto flex-row items-center gap-1.5">
                            <Text variant="title" testID={`${PAGE}-focus-title`}>
                                {next === undefined
                                    ? headline
                                    : t(`kitchen:setup.step.${next.key}.title`)}
                            </Text>
                            {next === undefined ? null : (
                                <InfoTip
                                    testID={`${PAGE}-focus-info`}
                                    label={t(`kitchen:setup.step.${next.key}.title`)}
                                    text={t(`kitchen:setup.step.${next.key}.body`)}
                                />
                            )}
                        </View>
                    </View>
                    {next === undefined ? null : (
                        <DeskButton
                            testID={`${PAGE}-focus-open`}
                            label={t('kitchen:setup.open')}
                            onPress={() => {
                                open(next);
                            }}
                        />
                    )}
                    {ready && canGoLive ? (
                        <DeskButton
                            testID={`${PAGE}-go-live`}
                            label={t('kitchen:setup.goLive')}
                            loading={goLive.isPending}
                            disabled={goLive.isPending}
                            onPress={pressGoLive}
                        />
                    ) : null}
                </View>

                {optional.map((step) => (
                    <View
                        key={step.key}
                        testID={`${PAGE}-${step.key}`}
                        className="min-w-0 flex-1 flex-row items-center gap-3.5 rounded-panel border border-dashed border-stroke-strong bg-surface-raised p-4"
                    >
                        <View className="h-11 w-11 items-center justify-center rounded-xl bg-surface-sunken">
                            <Icon
                                name={SETUP_STEP_ICONS[step.key]}
                                size="md"
                                className="text-content-secondary"
                            />
                        </View>
                        <View className="min-w-0 flex-1">
                            <Text variant="micro" tone="secondary">
                                {t(step.done ? 'kitchen:wholesale.done' : 'kitchen:setup.optional')}
                            </Text>
                            <Text variant="strong">
                                {t(`kitchen:setup.step.${step.key}.title`)}
                            </Text>
                        </View>
                        <DeskButton
                            testID={`${PAGE}-${step.key}-open`}
                            variant="secondary"
                            size="sm"
                            label={t('kitchen:setup.open')}
                            onPress={() => {
                                open(step);
                            }}
                        />
                    </View>
                ))}
            </View>
        </Cascade>
    );
}
