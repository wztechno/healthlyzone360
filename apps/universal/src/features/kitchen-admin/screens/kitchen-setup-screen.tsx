import type { KitchenSetupStep } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Cascade,
    ErrorState,
    FormSkeleton,
    useToast,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useGoLiveMutation, useKitchenSetupQuery } from '../../../data/kitchen-ops-hooks.ts';
import { GO_LIVE_PERMISSION, KITCHEN_SETUP_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { SetupStep } from './wholesale-setup-screen.tsx';

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
 * `/kitchen/setup` — the steps between a new kitchen and its first customer order, in the wholesale
 * checklist's shape. Until the owner presses Go live, customers are refused and the desk is warned.
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
    const ready = steps.every((step) => !step.required || step.done);

    return (
        <Cascade space="md" testID={`${PAGE}-screen`}>
            <KitchenPageHeader
                testID={`${PAGE}-header`}
                title={t('kitchen:families.setup.name')}
                subtitle={t('kitchen:setup.subtitle')}
            />

            <Callout
                testID={`${PAGE}-state`}
                tone={isLive ? 'success' : 'warning'}
                icon={isLive ? 'circleCheck' : 'warning'}
                title={t(isLive ? 'kitchen:setup.liveTitle' : 'kitchen:setup.notOpenTitle')}
                body={t(isLive ? 'kitchen:setup.liveBody' : 'kitchen:setup.notOpenBody')}
            />

            {steps.map((step, index) => (
                <SetupStep
                    key={step.key}
                    testID={`${PAGE}-${step.key}`}
                    ordinal={index + 1}
                    title={t(`kitchen:setup.step.${step.key}.title`)}
                    done={step.done}
                    body={t(`kitchen:setup.step.${step.key}.body`)}
                    action={
                        <Button
                            testID={`${PAGE}-${step.key}-open`}
                            variant="secondary"
                            size="sm"
                            label={t('kitchen:setup.open')}
                            onPress={() => {
                                router.push(STEP_HREF[step.key] as never);
                            }}
                        />
                    }
                />
            ))}

            {goLiveFailure === null ? null : (
                <Callout
                    testID={`${PAGE}-go-live-error`}
                    role="alert"
                    tone="danger"
                    title={t('kitchen:setup.goLiveError')}
                    body={goLiveFailure.message}
                />
            )}

            {isLive || !canGoLive ? null : (
                <Button
                    testID={`${PAGE}-go-live`}
                    label={t('kitchen:setup.goLive')}
                    loading={goLive.isPending}
                    disabled={!ready || goLive.isPending}
                    onPress={() => {
                        goLive.mutate(undefined, {
                            onSuccess: () => {
                                toast.show({
                                    testID: `${PAGE}-live-toast`,
                                    tone: 'success',
                                    message: t('kitchen:setup.liveToast'),
                                });
                            },
                        });
                    }}
                />
            )}
        </Cascade>
    );
}
