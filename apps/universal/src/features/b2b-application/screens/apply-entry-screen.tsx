import { Icon } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import {
    toFailure,
    useB2BApplicationQuery,
    useStartB2BApplicationMutation,
} from '../../../data/b2b-application-hooks.ts';
import { ExtraButton, ExtraCard, ExtraNote, ExtraPage } from '../../account/account-extra.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { CanopyButton } from '../apply-ui.tsx';
import { StatusPanel } from '../status-panel.tsx';
import { firstIncompleteStep, isApplicantEditable } from '../sections.ts';

/**
 * `/apply` — the door, drawn as the "Apply — start, or continue" board: a canopy band with the
 * promise and Start, three tiles for what to have to hand, and a Continue card for a draft.
 *
 * ## What it decides
 *
 * There are three situations and this screen tells them apart before drawing anything:
 *
 * 1. **No application.** An invitation, what the person will need to hand, and a button that starts
 *    one. The "what you will need" list is not decoration — a person who discovers on step five that
 *    they need a passport scan they do not have goes away and does not come back.
 * 2. **An application they are still writing.** A resume control that goes to the *first incomplete
 *    step*, not to step one. Somebody who filled in the company yesterday and came back with the
 *    trade licence should land on what is left.
 * 3. **An application that is with us.** The status panel, in place. Not a redirect: a redirect
 *    loses the address they typed, and `/apply` is the address people bookmark.
 *
 * ## `null` is a value here, not an error
 *
 * `getApplication()` answers `null` for "you have never applied", which is the normal first visit.
 * Treating it as an empty state rather than a failure is what lets the invitation be the page rather
 * than an error recovery.
 */

const TEST_ID = 'b2b-apply-entry';

/** What a person needs to hand, as the board's three tiles. */
const NEEDS: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: 'needRegistration', icon: 'fileText' },
    { key: 'needIdentity', icon: 'person' },
    { key: 'needTerms', icon: 'chartColumn' },
];

export function ApplyEntryScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();

    const application = useB2BApplicationQuery();
    const start = useStartB2BApplicationMutation();

    const current = application.data ?? null;
    const startFailure = toFailure(start.error);

    const goToStep = (slug: string) => {
        router.push(`/apply/${slug}` as never);
    };

    const begin = () => {
        start.mutate(undefined, {
            onSuccess: (created) => {
                goToStep(firstIncompleteStep(created));
            },
        });
    };

    return (
        <ExtraPage
            wide
            headless
            testID={TEST_ID}
            backTestID={`${TEST_ID}-back`}
            backLabel={t('marketplace:nav.business')}
            onBack={() => {
                router.push('/for-business' as never);
            }}
            icon="building"
            title={t('b2bApplication:entry.title')}
        >
            {startFailure === null ? null : (
                <View className="mt-[18px]">
                    <ExtraNote
                        testID={`${TEST_ID}-start-error`}
                        role="alert"
                        tone="bad"
                        icon="warning"
                        title={startFailure.message}
                    />
                </View>
            )}

            <QueryStates
                query={application}
                // Never empty in the "nothing to show" sense: `null` is a real answer with its own
                // content, so the empty branch is unreachable and the invitation renders below.
                isEmpty={false}
                emptyTitle={t('b2bApplication:entry.title')}
                testID={TEST_ID}
            >
                {current === null || isApplicantEditable(current) ? (
                    <View testID={current === null ? `${TEST_ID}-invitation` : `${TEST_ID}-resume`}>
                        {/* The board's canopy band: what this is, and the one way in. */}
                        <View className="relative mt-[18px] overflow-hidden rounded-[28px] bg-surface-canopy px-7 py-9 md:px-10">
                            <View
                                aria-hidden
                                className="absolute -end-[120px] -top-[170px] h-[460px] w-[460px] rounded-full bg-stage-green opacity-15"
                            />
                            <RNText className="text-xs font-bold uppercase tracking-widest text-stage-green text-start">
                                {t('b2bApplication:shellTitle')}
                            </RNText>
                            <RNText
                                testID={`${TEST_ID}-title`}
                                accessibilityRole="header"
                                aria-level={1}
                                className="mt-2 font-display text-3xl font-bold text-content-on-canopy text-start md:text-4xl"
                            >
                                {t('b2bApplication:entry.title')}
                            </RNText>
                            <RNText className="mt-2.5 max-w-[620px] text-base font-medium leading-6 text-content-on-canopy-muted text-start">
                                {t('b2bApplication:entry.body')}
                            </RNText>
                            {current === null ? (
                                <View className="mt-5 flex-row">
                                    <CanopyButton
                                        testID={`${TEST_ID}-start`}
                                        label={t('b2bApplication:entry.start')}
                                        busy={start.isPending}
                                        onPress={begin}
                                    />
                                </View>
                            ) : null}
                        </View>

                        <ExtraCard title={t('b2bApplication:entry.whatYouNeed')}>
                            <View className="mt-3.5 flex-col gap-3 md:flex-row">
                                {NEEDS.map((need) => (
                                    <View
                                        key={need.key}
                                        testID={`${TEST_ID}-${need.key.replace('need', 'need-').toLowerCase()}`}
                                        className="min-w-0 flex-1 rounded-[18px] border border-stroke-subtle bg-surface-base p-4"
                                    >
                                        <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-surface-brand-subtle">
                                            <Icon
                                                name={need.icon}
                                                size="md"
                                                className="text-content-on-brand-subtle"
                                            />
                                        </View>
                                        <RNText className="mt-2.5 text-sm font-bold leading-5 text-content-primary text-start">
                                            {t(`b2bApplication:entry.${need.key}`)}
                                        </RNText>
                                    </View>
                                ))}
                            </View>
                        </ExtraCard>

                        {current === null ? null : (
                            <ExtraCard>
                                <View className="flex-col gap-4 md:flex-row md:items-center">
                                    <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-brand-subtle">
                                        <Icon
                                            name="clock"
                                            size="md"
                                            className="text-content-on-brand-subtle"
                                        />
                                    </View>
                                    <View className="min-w-0 flex-1">
                                        <RNText className="text-lg font-bold text-content-primary text-start">
                                            {t('b2bApplication:entry.resume')}
                                        </RNText>
                                        <RNText className="mt-0.5 text-sm text-content-secondary text-start">
                                            {t('b2bApplication:entry.resumeBody', {
                                                date: formatter.formatDate(current.createdAt),
                                            })}
                                        </RNText>
                                    </View>
                                    <View className="flex-row flex-wrap gap-2.5">
                                        <ExtraButton
                                            testID={`${TEST_ID}-continue`}
                                            label={t('b2bApplication:entry.resume')}
                                            icon="arrowForward"
                                            onPress={() => {
                                                goToStep(firstIncompleteStep(current));
                                            }}
                                        />
                                        <ExtraButton
                                            testID={`${TEST_ID}-status`}
                                            tone="secondary"
                                            label={t('b2bApplication:entry.viewStatus')}
                                            onPress={() => {
                                                router.push('/apply/status' as never);
                                            }}
                                        />
                                    </View>
                                </View>
                            </ExtraCard>
                        )}
                    </View>
                ) : (
                    <View className="mt-[18px]">
                        <StatusPanel
                            application={current}
                            testID={`${TEST_ID}-status-panel`}
                            onOpenStep={(slug) => {
                                goToStep(slug);
                            }}
                            onOpenAgreement={() => {
                                router.push('/apply/agreement' as never);
                            }}
                            onOpenProvisioning={() => {
                                router.push('/apply/provisioning' as never);
                            }}
                        />
                    </View>
                )}
            </QueryStates>
        </ExtraPage>
    );
}
