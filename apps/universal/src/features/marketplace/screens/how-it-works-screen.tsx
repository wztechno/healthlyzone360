import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { isFeatureAvailable } from '../../availability.ts';
import { ExtraButton } from '../../account/account-extra.tsx';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { useGoToAuth } from '../../../navigation/use-return-to.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';

/**
 * The four steps.
 *
 * Numbered as data rather than written out four times, so the ordinal, the icon and the copy key
 * cannot drift apart — the failure mode being a step labelled "3" sitting second on the page after
 * somebody reorders the JSX.
 */
const STEPS: readonly {
    readonly key: string;
    readonly icon: IconName;
    /** The board's tile tint behind each step's glyph, and the glyph's ink on it. */
    readonly tile: string;
    readonly ink: string;
}[] = [
    {
        key: 'tell',
        icon: 'user',
        tile: 'bg-surface-brand-subtle',
        ink: 'text-content-on-brand-subtle',
    },
    { key: 'target', icon: 'success', tile: 'bg-info-subtle', ink: 'text-info-on-subtle' },
    { key: 'plan', icon: 'calendar', tile: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    {
        key: 'eat',
        icon: 'organisation',
        tile: 'bg-surface-accent-subtle',
        ink: 'text-content-on-accent-subtle',
    },
];

/**
 * How it works, drawn as the Explorations board: a canopy band naming the page with the four steps
 * as a path of chips beside it, the four steps as photo cards in a row, then "Have a look around"
 * on the brand's soft green and the medical note.
 *
 * The medical disclaimer belongs here even though the page shows no figures. It describes a product
 * that calculates a nutrition target, and the place to say "this is an estimate, not medical
 * advice" is where the promise is made, not only where the number appears.
 *
 * ## The last button is the reader's next step
 *
 * A visitor is offered an account, and the trip to registration carries this page back. Somebody
 * already signed in was offered "Create account" too (browse-15); their next step is the one the
 * fourth card describes — a plan for the week — so that is what they get instead.
 */
export function HowItWorksScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const goToAuth = useGoToAuth();
    const { phase } = useSession();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';

    return (
        <View testID="how-it-works-screen" className="w-full flex-col pb-12">
            <View className="relative overflow-hidden rounded-[28px] bg-surface-canopy px-6 py-8 md:px-10 md:py-9">
                <View
                    aria-hidden
                    className="absolute -end-[120px] -top-[170px] h-[460px] w-[460px] rounded-full bg-stage-green opacity-15"
                />
                <View className="flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <View className="min-w-0 flex-col lg:flex-1">
                        <RNText className="text-xs font-bold uppercase tracking-widest text-content-on-canopy-muted text-start">
                            {t('marketplace:nav.howItWorks')}
                        </RNText>
                        <RNText
                            testID="how-it-works-title"
                            accessibilityRole="header"
                            aria-level={1}
                            className="mt-2.5 font-display text-4xl font-bold leading-[44px] text-content-on-canopy text-start md:text-5xl md:leading-[56px]"
                        >
                            {t('marketplace:howItWorks.title')}
                        </RNText>
                        <RNText className="mt-3 max-w-[560px] text-lg font-medium leading-7 text-content-on-canopy-muted text-start">
                            {t('marketplace:howItWorks.subtitle')}
                        </RNText>
                    </View>
                    <View
                        aria-hidden
                        className="flex-row flex-wrap gap-2 lg:max-w-[420px] lg:justify-end"
                    >
                        {STEPS.map((step, index) => (
                            <View
                                key={step.key}
                                className="h-9 flex-row items-center gap-2 rounded-full border border-content-on-canopy/15 bg-content-on-canopy/10 pe-3.5 ps-1.5"
                            >
                                <View className="h-6 w-6 items-center justify-center rounded-full bg-stage-green">
                                    <RNText className="text-xs font-bold text-surface-canopy">
                                        {String(index + 1)}
                                    </RNText>
                                </View>
                                <RNText className="text-sm font-semibold text-content-on-canopy">
                                    {t(`marketplace:howItWorks.path.${step.key}`)}
                                </RNText>
                            </View>
                        ))}
                    </View>
                </View>
            </View>

            <View
                testID="how-it-works-steps"
                className="mt-8 flex-col gap-5 md:flex-row md:flex-wrap"
            >
                {STEPS.map((step, index) => (
                    <View
                        key={step.key}
                        testID={`how-it-works-step-${step.key}`}
                        className="min-w-0 flex-col overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-sm md:basis-[47%] md:grow lg:basis-0"
                    >
                        <View className="relative">
                            <EntityImage
                                source={resolveMarketingImage(`how-it-works/${step.key}.tile`)}
                                decorative
                                seed={`how-${step.key}`}
                                label={t(`marketplace:howItWorks.step.${step.key}.title`)}
                                aspect="wide"
                                flush
                                className="h-[180px]"
                            />
                            <View className="absolute -bottom-6 start-5 h-12 w-12 items-center justify-center rounded-full border-[6px] border-surface-raised bg-surface-brand">
                                <RNText className="font-display text-xl font-bold text-content-on-brand">
                                    {String(index + 1)}
                                </RNText>
                            </View>
                        </View>
                        <View className="flex-1 flex-col gap-2 px-[22px] pb-6 pt-4">
                            <View
                                aria-hidden
                                className={cx(
                                    '-mt-9 h-10 w-10 items-center justify-center self-end rounded-[13px]',
                                    step.tile,
                                )}
                            >
                                <Icon name={step.icon} size="md" className={step.ink} />
                            </View>
                            <RNText
                                accessibilityRole="header"
                                aria-level={2}
                                className="font-display text-xl font-bold leading-[26px] text-content-primary text-start"
                            >
                                {t(`marketplace:howItWorks.step.${step.key}.title`)}
                            </RNText>
                            <RNText className="text-sm font-medium leading-6 text-content-secondary text-start">
                                {t(`marketplace:howItWorks.step.${step.key}.body`)}
                            </RNText>
                        </View>
                    </View>
                ))}
            </View>

            <View
                testID="how-it-works-next"
                className="mt-7 flex-col gap-5 rounded-[26px] bg-surface-brand-subtle px-7 py-6 lg:flex-row lg:items-center lg:justify-between"
            >
                <View className="min-w-0 flex-col">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-2xl font-bold text-content-on-brand-subtle text-start"
                    >
                        {t('marketplace:howItWorks.nextTitle')}
                    </RNText>
                    <RNText className="mt-1 text-base font-medium text-content-on-brand-subtle text-start">
                        {t('marketplace:howItWorks.nextBody')}
                    </RNText>
                </View>
                <View className="flex-row flex-wrap items-center gap-2.5">
                    <ExtraButton
                        testID="how-it-works-browse"
                        label={t('marketplace:landing.browseKitchens')}
                        icon="chevronForward"
                        onPress={() => {
                            router.push('/kitchens');
                        }}
                    />
                    {isFeatureAvailable('dietitianDirectory') ? (
                        <ExtraButton
                            testID="how-it-works-dietitians"
                            tone="secondary"
                            label={t('marketplace:howItWorks.meetDietitians')}
                            onPress={() => {
                                router.push('/dietitians');
                            }}
                        />
                    ) : null}
                    {signedIn ? (
                        <ExtraButton
                            testID="how-it-works-plans"
                            tone="secondary"
                            label={t('marketplace:howItWorks.browsePlans')}
                            onPress={() => {
                                router.push('/plans');
                            }}
                        />
                    ) : (
                        <ExtraButton
                            testID="how-it-works-register"
                            tone="secondary"
                            label={t('marketplace:nav.register')}
                            onPress={() => {
                                goToAuth('/register');
                            }}
                        />
                    )}
                </View>
            </View>

            <View className="mt-5">
                <MedicalDisclaimer />
            </View>
        </View>
    );
}
