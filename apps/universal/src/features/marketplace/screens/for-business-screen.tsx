import { Icon, cx, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Animated,
    Easing,
    Image,
    Platform,
    Pressable,
    StyleSheet,
    Text as RNText,
    View,
} from 'react-native';
import type { ImageSourcePropType, StyleProp, ViewStyle } from 'react-native';

import { resolveMarketingImage } from '../../../media/entity-image.tsx';
import { useGoToAuth } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { ShopDialog, ShopDialogButton } from '../../../ui/shop-dialog.tsx';
import { ShopSwitch } from '../../../ui/shop-switch.tsx';

const APPLY_HREF = '/apply';
const B = 'marketplace:forBusiness.board';

/** The four steps of becoming a business customer, in order. */
const STEPS = ['apply', 'review', 'sign', 'order'] as const;
type Step = (typeof STEPS)[number];
const STEP_POINTS: Readonly<Record<Step, readonly string[]>> = {
    apply: ['p1', 'p2', 'p3', 'p4'],
    review: ['p1', 'p2', 'p3'],
    sign: ['p1', 'p2', 'p3'],
    order: ['p1', 'p2', 'p3'],
};
const STEP_MS = 5000;

const SECTIONS: readonly (readonly [string, boolean])[] = [
    ['company', true],
    ['registration', true],
    ['locations', true],
    ['contacts', true],
    ['volume', false],
    ['terms', false],
];

/** The illustrations' dishes — stock photographs, as everywhere else the shop shows a dish. */
const DISHES: readonly { readonly key: string; readonly photo: string; readonly qty: number }[] = [
    { key: 'dishChicken', photo: 'dishes/marinated-chicken-breast.card', qty: 40 },
    { key: 'dishCordon', photo: 'dishes/cordon-bleu-piece.card', qty: 25 },
    { key: 'dishMayo', photo: 'dishes/garlic-mayo.card', qty: 40 },
];

const FAQ = ['1', '2', '3', '4'] as const;

/**
 * `/for-business` — the Business board from the canvas's Explorations page: a canopy band with the
 * promise, the way in and three perks beside a stack of floating cards (an agreement, a quotation, a
 * delivery); then how it works as four steps that play through on their own, each opening a panel
 * that shows the step; what a team gets; the questions; and a closing band.
 *
 * ## No price, anywhere
 *
 * Business rates are agreed per account and never published. The illustrations carry quantities
 * ("× 40"), terms ("Net 30") and states — never an amount of money.
 *
 * ## The way in
 *
 * "Apply for a business account" opens the application for somebody signed in; for a visitor it
 * asks first, because an application belongs to an account — sign in or create one, and come back
 * to the application (gap-01). "Already approved? Sign in" is the door for an existing buyer.
 */
export function ForBusinessScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const goToAuth = useGoToAuth();
    const { phase } = useSession();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    const [enquiryOpen, setEnquiryOpen] = useState(false);

    const apply = () => {
        if (signedIn) router.push(APPLY_HREF as never);
        else setEnquiryOpen(true);
    };

    return (
        <View testID="for-business-screen" className="w-full flex-col pb-12">
            <Hero onApply={apply} />
            <HowItWorks />
            <Gets />
            <Questions />

            <View
                testID="for-business-end"
                className="relative mt-16 flex-col gap-5 overflow-hidden rounded-[32px] bg-surface-canopy px-7 py-8 md:px-9 lg:flex-row lg:items-center"
            >
                <View
                    aria-hidden
                    className="absolute -end-[90px] -top-[120px] h-[300px] w-[300px] rounded-full bg-stage-green opacity-15"
                />
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-3xl font-bold text-content-on-canopy text-start"
                >
                    {t(`${B}.endTitle`)}
                </RNText>
                <View className="flex-row flex-wrap items-center gap-3 lg:ms-auto">
                    <Pressable
                        testID="for-business-sign-in"
                        role="link"
                        accessibilityRole="link"
                        onPress={() => {
                            goToAuth('/sign-in');
                        }}
                        className="min-h-touch justify-center px-2"
                    >
                        <RNText className="text-sm font-semibold text-content-on-canopy-muted hover:underline">
                            {t(`${B}.signInApproved`)}
                        </RNText>
                    </Pressable>
                    <ApplyButton testID="for-business-apply-end" onPress={apply} />
                </View>
            </View>

            {/* Shop · Shared looks + other, pin 1. */}
            <ShopDialog
                testID="for-business-enquiry"
                open={enquiryOpen}
                onClose={() => {
                    setEnquiryOpen(false);
                }}
                icon="briefcase"
                title={t('marketplace:forBusiness.enquiryTitle')}
                description={t('marketplace:forBusiness.enquiryBody')}
                actions={
                    <>
                        <ShopDialogButton
                            testID="for-business-enquiry-register"
                            label={t('marketplace:nav.register')}
                            onPress={() => {
                                setEnquiryOpen(false);
                                goToAuth('/register', APPLY_HREF);
                            }}
                        />
                        <ShopDialogButton
                            testID="for-business-enquiry-sign-in"
                            kind="brand"
                            icon="arrowForward"
                            iconAfter
                            label={t('marketplace:nav.signIn')}
                            onPress={() => {
                                setEnquiryOpen(false);
                                goToAuth('/sign-in', APPLY_HREF);
                            }}
                        />
                    </>
                }
            />
        </View>
    );
}

/** The board's lime-on-canopy call to action. */
function ApplyButton({
    testID,
    onPress,
}: {
    readonly testID: string;
    readonly onPress: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className="h-14 flex-row items-center gap-2.5 self-start rounded-[18px] bg-stage-green px-6 transition duration-normal ease-standard hover:-translate-y-0.5 active:opacity-85"
        >
            <RNText className="text-base font-bold text-surface-canopy">{t(`${B}.apply`)}</RNText>
            <Icon name="arrowForward" size="md" className="text-surface-canopy" />
        </Pressable>
    );
}

/* ── hero ───────────────────────────────────────────────────────────────────────────────────── */

function Hero({ onApply }: { readonly onApply: () => void }) {
    const { t } = useTranslation();
    const perks: readonly (readonly [string, IconName])[] = [
        ['invoice', 'receipt'],
        ['perLocation', 'mapPin'],
        ['recurring', 'calendarDays'],
    ];
    return (
        <View className="relative overflow-hidden rounded-[32px] bg-surface-canopy px-6 pb-14 pt-12 md:px-12">
            <View
                aria-hidden
                className="absolute -end-[140px] -top-[200px] h-[560px] w-[560px] rounded-full bg-stage-green opacity-15"
            />
            <View
                aria-hidden
                className="absolute -start-[120px] top-[220px] h-[300px] w-[300px] rounded-full bg-content-on-canopy opacity-5"
            />
            <View className="flex-col gap-10 lg:flex-row lg:items-center">
                <View className="min-w-0 flex-col lg:flex-1">
                    <View className="h-8 flex-row items-center gap-2 self-start rounded-full bg-content-on-canopy/10 pe-3 ps-1.5">
                        <View className="h-[22px] w-[22px] items-center justify-center rounded-full bg-stage-green">
                            <Icon name="building" size="sm" className="text-surface-canopy" />
                        </View>
                        <RNText className="text-sm font-semibold text-content-on-canopy">
                            {t('marketplace:forBusiness.title')}
                        </RNText>
                    </View>
                    <RNText
                        testID="for-business-title"
                        accessibilityRole="header"
                        aria-level={1}
                        className="mt-[18px] max-w-[620px] font-display text-4xl font-bold leading-[44px] text-content-on-canopy text-start md:text-6xl md:leading-[60px]"
                    >
                        {t(`${B}.heroTitle`)}{' '}
                        <RNText className="text-stage-green">{t(`${B}.heroAccent`)}</RNText>
                    </RNText>
                    <View className="mt-7">
                        <ApplyButton testID="for-business-request-quotation" onPress={onApply} />
                    </View>
                    <View className="mt-6 flex-row flex-wrap gap-x-[18px] gap-y-2">
                        {perks.map(([key, icon]) => (
                            <View key={key} className="flex-row items-center gap-2">
                                <View className="h-[22px] w-[22px] items-center justify-center rounded-full bg-stage-green/20">
                                    <Icon name={icon} size="sm" className="text-stage-green" />
                                </View>
                                <RNText className="text-sm font-semibold text-content-on-canopy-muted">
                                    {t(`${B}.perk.${key}`)}
                                </RNText>
                            </View>
                        ))}
                    </View>
                </View>
                <View aria-hidden className="hidden h-[400px] w-[520px] lg:flex">
                    <Floating delay={0} className="start-0 top-2.5 w-[330px] p-[18px]">
                        <MockHead title={t(`${B}.mock.agreement`)} state={t(`${B}.mock.active`)} />
                        {(
                            [
                                ['paymentTerms', 'net30'],
                                ['notice', 'days30'],
                                ['leadTime', 'days2'],
                                ['minimum', 'meals40'],
                            ] as const
                        ).map(([label, value], index) => (
                            <KeyValue
                                key={label}
                                first={index === 0}
                                label={t(`${B}.mock.${label}`)}
                                value={t(`${B}.mock.${value}`)}
                            />
                        ))}
                    </Floating>
                    <Floating delay={2000} className="end-0 top-[150px] w-[300px] p-4">
                        <MockHead title={t(`${B}.mock.quotation`)} state={t(`${B}.mock.quoted`)} />
                        {DISHES.map((dish) => (
                            <View key={dish.key} className="mt-2.5 flex-row items-center gap-2.5">
                                <Photo source={resolveMarketingImage(dish.photo)} size={36} />
                                <RNText className="flex-1 text-sm text-content-primary text-start">
                                    {t(`${B}.mock.${dish.key}`)}
                                </RNText>
                                <RNText className="font-display text-sm font-bold tabular-nums text-content-primary">
                                    {t(`${B}.mock.times`, { count: dish.qty })}
                                </RNText>
                            </View>
                        ))}
                    </Floating>
                    <Floating
                        delay={4000}
                        className="bottom-1.5 start-10 h-[52px] flex-row items-center gap-2.5 rounded-full pe-4 ps-2"
                    >
                        <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-brand-subtle">
                            <Icon name="check" size="md" className="text-content-on-brand-subtle" />
                        </View>
                        <RNText className="text-sm font-bold text-content-primary">
                            {t(`${B}.mock.delivered`)}
                        </RNText>
                    </Floating>
                </View>
            </View>
        </View>
    );
}

/**
 * The hero cards' bob on the web, as a CSS keyframe animation: the browser runs a transform-only
 * animation on the compositor, so the cards and their wide shadows are painted once and slid, not
 * repainted every frame from JavaScript (which is what made them stutter). `will-change` keeps
 * each card on its own layer.
 */
const WEB_BOB = StyleSheet.create({
    bob: {
        // react-native-web's own keyframe styles (its ActivityIndicator spins the same way).
        // @ts-expect-error -- web-only style keys, absent from React Native's style types.
        animationKeyframes: [
            {
                '0%': { transform: 'translateY(0px)' },
                '50%': { transform: 'translateY(-8px)' },
                '100%': { transform: 'translateY(0px)' },
            },
        ],
        animationDuration: '6s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
        animationFillMode: 'both',
        willChange: 'transform',
    },
});

/** A card of the hero's illustration, bobbing gently on its own beat. */
function Floating({
    delay,
    className,
    children,
}: {
    readonly delay: number;
    readonly className: string;
    readonly children: ReactNode;
}) {
    const { enabled } = useMotion();
    const web = Platform.OS === 'web';
    const [bob] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (!enabled || web) return undefined;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(bob, {
                    toValue: 1,
                    duration: 3000,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
                Animated.timing(bob, {
                    toValue: 0,
                    duration: 3000,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
            ]),
        );
        const timer = setTimeout(() => {
            loop.start();
        }, delay);
        return () => {
            clearTimeout(timer);
            loop.stop();
        };
    }, [bob, delay, enabled, web]);
    const frame = cx('absolute rounded-3xl bg-surface-raised shadow-elevation-4', className);
    if (web) {
        return (
            <View
                className={frame}
                style={
                    enabled
                        ? // `animationDelay` is react-native-web's, outside React Native's style types.
                          ([
                              WEB_BOB.bob,
                              { animationDelay: `${String(delay)}ms` },
                          ] as unknown as StyleProp<ViewStyle>)
                        : undefined
                }
            >
                {children}
            </View>
        );
    }
    return (
        <Animated.View
            className={frame}
            style={{
                transform: [
                    { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
}

function MockHead({
    title,
    state,
    tone = 'ok',
}: {
    readonly title: string;
    readonly state: string;
    readonly tone?: 'ok' | 'amber';
}) {
    return (
        <View className="flex-row items-center justify-between gap-2">
            <RNText className="font-display text-base font-bold text-content-primary text-start">
                {title}
            </RNText>
            <View
                className={cx(
                    'h-6 flex-row items-center gap-1.5 rounded-full px-2',
                    tone === 'ok' ? 'bg-surface-brand-subtle' : 'bg-surface-raised',
                )}
            >
                <View
                    className={cx(
                        'h-1.5 w-1.5 rounded-full',
                        tone === 'ok' ? 'bg-surface-brand' : 'bg-warning-strong',
                    )}
                />
                <RNText
                    className={cx(
                        'text-xs font-bold',
                        tone === 'ok' ? 'text-content-on-brand-subtle' : 'text-warning-on-subtle',
                    )}
                >
                    {state}
                </RNText>
            </View>
        </View>
    );
}

function KeyValue({
    label,
    value,
    first,
}: {
    readonly label: string;
    readonly value: string;
    readonly first: boolean;
}) {
    return (
        <View
            className={cx(
                'flex-row justify-between border-t border-stroke-subtle py-[9px]',
                first ? 'mt-2.5' : '',
            )}
        >
            <RNText className="text-sm text-content-secondary">{label}</RNText>
            <RNText className="text-sm font-bold text-content-primary">{value}</RNText>
        </View>
    );
}

function Photo({
    source,
    size,
}: {
    readonly source: ImageSourcePropType | null;
    readonly size: number;
}) {
    if (source === null) {
        return (
            <View
                className="rounded-[10px] bg-surface-sunken"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <Image
            source={source}
            alt=""
            resizeMode="cover"
            style={{ width: size, height: size, borderRadius: size > 38 ? 11 : 10 }}
        />
    );
}

/* ── how it works ───────────────────────────────────────────────────────────────────────────── */

function SectionTitle({ children }: { readonly children: string }) {
    return (
        <RNText
            accessibilityRole="header"
            aria-level={2}
            className="mb-[22px] font-display text-3xl font-bold text-content-primary text-start md:text-4xl"
        >
            {children}
        </RNText>
    );
}

/**
 * The four steps as tabs that play through on their own — each runs a bar along its foot for five
 * seconds, then hands over — until the person picks one, which stops the tour. Reduced motion never
 * starts it.
 */
function HowItWorks() {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const [step, setStep] = useState(0);
    const [auto, setAuto] = useState(true);
    const playing = auto && enabled;

    useEffect(() => {
        if (!playing) return undefined;
        const timer = setTimeout(() => {
            setStep((current) => (current + 1) % STEPS.length);
        }, STEP_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [playing, step]);

    const key = STEPS[step] ?? 'apply';
    return (
        <View testID="for-business-steps" className="mt-16 flex-col">
            <SectionTitle>{t(`${B}.howTitle`)}</SectionTitle>
            <View
                role="tablist"
                aria-label={t(`${B}.stepsLabel`)}
                className="flex-row flex-wrap gap-3"
            >
                {STEPS.map((name, index) => {
                    const on = index === step;
                    const past = index < step;
                    return (
                        <Pressable
                            key={name}
                            testID={`for-business-step-${name}`}
                            role="tab"
                            aria-selected={on}
                            accessibilityState={{ selected: on }}
                            onPress={() => {
                                setStep(index);
                                setAuto(false);
                            }}
                            className={cx(
                                'relative min-w-[200px] flex-1 basis-[45%] flex-col items-start gap-1 overflow-hidden rounded-[22px] border-[1.5px] bg-surface-raised px-4 pb-[18px] pt-4 transition duration-normal ease-standard hover:-translate-y-0.5 lg:basis-0',
                                on
                                    ? 'border-surface-brand shadow-elevation-3'
                                    : 'border-stroke-subtle',
                            )}
                        >
                            <View
                                className={cx(
                                    'mb-2 h-10 w-10 items-center justify-center rounded-[14px]',
                                    on
                                        ? 'bg-surface-brand'
                                        : past
                                          ? 'bg-surface-brand-subtle'
                                          : 'bg-surface-base',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'font-display text-base font-bold',
                                        on
                                            ? 'text-content-on-brand'
                                            : past
                                              ? 'text-content-on-brand-subtle'
                                              : 'text-content-primary',
                                    )}
                                >
                                    {String(index + 1)}
                                </RNText>
                            </View>
                            <RNText className="font-display text-lg font-bold text-content-primary text-start">
                                {t(`${B}.step.${name}.label`)}
                            </RNText>
                            <RNText className="text-sm text-content-secondary text-start">
                                {t(`${B}.step.${name}.sub`)}
                            </RNText>
                            <StepBar
                                state={
                                    past ? 'full' : on ? (playing ? 'running' : 'full') : 'empty'
                                }
                                runKey={step}
                            />
                        </Pressable>
                    );
                })}
            </View>

            <View
                role="tabpanel"
                testID={`for-business-panel-${key}`}
                className="mt-3.5 flex-col gap-7 rounded-[28px] border border-stroke-subtle bg-surface-raised p-7 shadow-elevation-2 lg:flex-row lg:items-center"
            >
                <View className="min-w-0 flex-col lg:flex-1">
                    <RNText className="font-display text-3xl font-bold text-content-primary text-start">
                        {t(`${B}.step.${key}.title`)}
                    </RNText>
                    <View className="mt-4 flex-col gap-2.5">
                        {STEP_POINTS[key].map((point) => (
                            <View key={point} className="flex-row items-center gap-2.5">
                                <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-brand-subtle">
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand-subtle"
                                    />
                                </View>
                                <RNText className="flex-1 text-base text-content-primary text-start">
                                    {t(`${B}.step.${key}.${point}`)}
                                </RNText>
                            </View>
                        ))}
                    </View>
                </View>
                <View className="w-full rounded-[22px] bg-surface-base p-[18px] lg:w-[520px]">
                    {key === 'apply' ? <ApplyPreview /> : null}
                    {key === 'review' ? <ReviewPreview /> : null}
                    {key === 'sign' ? <SignPreview /> : null}
                    {key === 'order' ? <OrderPreview /> : null}
                </View>
            </View>
        </View>
    );
}

/*
 * On the web a running bar fills with CSS keyframes. React Native Web has no native driver, and a
 * `width` driven by `Animated` wrote the bar's style from JavaScript on every frame of every step,
 * for as long as the page was open. A scale is also cheaper for the browser than a width.
 */
const WEB_FILL = StyleSheet.create({
    // `willChange` is react-native-web's; not every React Native type version declares it.
    bar: { willChange: 'transform' } as unknown as ViewStyle,
    running: {
        // @ts-expect-error -- web-only style keys, absent from React Native's style types.
        animationKeyframes: [
            { '0%': { transform: 'scaleX(0)' }, '100%': { transform: 'scaleX(1)' } },
        ],
        animationDuration: `${String(STEP_MS)}ms`,
        animationTimingFunction: 'linear',
        animationFillMode: 'both',
    },
});

/** The bar along a step's foot: empty ahead, full behind, running on the current one. */
function StepBar({
    state,
    runKey,
}: {
    readonly state: 'empty' | 'full' | 'running';
    readonly runKey: number;
}) {
    const { axisSign } = useMotion();
    const web = Platform.OS === 'web';
    const [fill] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (web) return undefined;
        if (state !== 'running') {
            fill.setValue(state === 'full' ? 1 : 0);
            return undefined;
        }
        fill.setValue(0);
        const run = Animated.timing(fill, {
            toValue: 1,
            duration: STEP_MS,
            easing: Easing.linear,
            useNativeDriver: false,
        });
        run.start();
        return () => {
            run.stop();
        };
    }, [fill, runKey, state, web]);
    if (web) {
        // The fill is a CSS scale on the web, keyed so each new run replays it (see `WEB_FILL`).
        return (
            <View aria-hidden className="absolute bottom-0 end-0 start-0 h-1 bg-surface-base">
                <View
                    key={runKey}
                    className="h-full w-full bg-surface-brand"
                    style={
                        // react-native-web keys, outside React Native's style types.
                        [
                            WEB_FILL.bar,
                            { transformOrigin: axisSign === 1 ? 'left' : 'right' },
                            state === 'running'
                                ? WEB_FILL.running
                                : { transform: `scaleX(${state === 'full' ? '1' : '0'})` },
                        ] as unknown as StyleProp<ViewStyle>
                    }
                />
            </View>
        );
    }
    return (
        <View aria-hidden className="absolute bottom-0 end-0 start-0 h-1 bg-surface-base">
            <Animated.View
                className="h-full bg-surface-brand"
                style={{
                    width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }}
            />
        </View>
    );
}

function ApplyPreview() {
    const { t } = useTranslation();
    const done = SECTIONS.filter(([, ok]) => ok).length;
    return (
        <View className="flex-col">
            <View className="flex-row items-center justify-between">
                <RNText className="font-display text-base font-bold text-content-primary">
                    {t(`${B}.application`)}
                </RNText>
                <RNText className="text-sm text-content-secondary">
                    {t(`${B}.sectionsDone`, { done, total: SECTIONS.length })}
                </RNText>
            </View>
            <View className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-raised">
                <View
                    className="h-full rounded-full bg-surface-brand"
                    style={{ width: `${Math.round((done / SECTIONS.length) * 100)}%` }}
                />
            </View>
            {SECTIONS.map(([name, ok]) => (
                <View
                    key={name}
                    className="mt-1.5 h-11 flex-row items-center gap-2.5 rounded-xl bg-surface-raised px-3"
                >
                    <View
                        className={cx(
                            'h-[22px] w-[22px] items-center justify-center rounded-full border-2',
                            ok ? 'border-surface-brand bg-surface-brand' : 'border-stroke',
                        )}
                    >
                        {ok ? (
                            <Icon name="check" size="sm" className="text-content-on-brand" />
                        ) : null}
                    </View>
                    <RNText className="text-sm text-content-primary">
                        {t(`${B}.section.${name}`)}
                    </RNText>
                </View>
            ))}
        </View>
    );
}

function ReviewPreview() {
    const { t } = useTranslation();
    const rows: readonly (readonly [string, 'ok' | 'now' | 'next'])[] = [
        ['submitted', 'ok'],
        ['inReview', 'now'],
        ['approved', 'next'],
    ];
    return (
        <View className="flex-col">
            {rows.map(([name, state], index) => (
                <View key={name} className="relative flex-row items-center gap-3 py-3">
                    {index < rows.length - 1 ? (
                        <View
                            aria-hidden
                            className="absolute bottom-[-12px] start-[15px] top-11 w-0.5 bg-stroke"
                        />
                    ) : null}
                    <View
                        className={cx(
                            'h-8 w-8 items-center justify-center rounded-full border-2',
                            state === 'ok'
                                ? 'border-surface-brand bg-surface-brand'
                                : state === 'now'
                                  ? 'border-surface-brand bg-surface-raised'
                                  : 'border-stroke bg-surface-raised',
                        )}
                    >
                        <Icon
                            name={
                                state === 'ok' ? 'check' : state === 'now' ? 'clock' : 'circleCheck'
                            }
                            size="sm"
                            className={
                                state === 'ok'
                                    ? 'text-content-on-brand'
                                    : state === 'now'
                                      ? 'text-content-on-brand-subtle'
                                      : 'text-content-secondary'
                            }
                        />
                    </View>
                    <RNText className="text-base font-bold text-content-primary">
                        {t(`${B}.review.${name}`)}
                    </RNText>
                </View>
            ))}
            <View className="mt-2 flex-row items-center gap-2 rounded-xl border border-dashed border-stroke bg-surface-raised px-3 py-2.5">
                <Icon name="infoCircle" size="sm" className="text-content-secondary" />
                <RNText className="flex-1 text-sm text-content-secondary text-start">
                    {t(`${B}.review.ask`)}
                </RNText>
            </View>
        </View>
    );
}

function SignPreview() {
    const { t } = useTranslation();
    const digits = ['4', '8', '1', '', '', ''];
    return (
        <View className="flex-col">
            <MockHead title={t(`${B}.mock.agreement`)} state={t(`${B}.readyToSign`)} tone="amber" />
            <KeyValue first label={t(`${B}.mock.paymentTerms`)} value={t(`${B}.mock.net30`)} />
            <KeyValue first={false} label={t(`${B}.mock.notice`)} value={t(`${B}.mock.days30`)} />
            <RNText className="mt-3.5 text-sm font-semibold text-content-secondary text-start">
                {t(`${B}.codeSent`)}
            </RNText>
            <View className="mt-3.5 flex-row gap-2">
                {digits.map((digit, index) => (
                    <View
                        key={index}
                        className={cx(
                            'h-14 w-12 items-center justify-center rounded-[14px] border-[1.5px] bg-surface-raised',
                            digit !== '' || index === 3 ? 'border-surface-brand' : 'border-stroke',
                        )}
                    >
                        <RNText className="font-display text-xl font-bold text-content-primary">
                            {digit}
                        </RNText>
                    </View>
                ))}
            </View>
        </View>
    );
}

function OrderPreview() {
    const { t } = useTranslation();
    const [quantities, setQuantities] = useState(() => DISHES.map((dish) => dish.qty));
    const [weekly, setWeekly] = useState(true);
    const total = quantities.reduce((sum, value) => sum + value, 0);
    const change = (index: number, by: number) => {
        setQuantities((current) =>
            current.map((value, at) => (at === index ? Math.max(10, value + by) : value)),
        );
    };
    return (
        <View className="flex-col">
            <View className="flex-row items-center justify-between">
                <RNText className="font-display text-base font-bold text-content-primary">
                    {t(`${B}.quoteRequest`)}
                </RNText>
                <RNText className="text-sm tabular-nums text-content-secondary">
                    {t(`${B}.mealsCount`, { count: total })}
                </RNText>
            </View>
            {DISHES.map((dish, index) => {
                const name = t(`${B}.mock.${dish.key}`);
                return (
                    <View
                        key={dish.key}
                        className="mt-1.5 flex-row items-center gap-2.5 rounded-[14px] bg-surface-raised p-2"
                    >
                        <Photo source={resolveMarketingImage(dish.photo)} size={40} />
                        <RNText className="min-w-0 flex-1 text-sm font-bold text-content-primary text-start">
                            {name}
                        </RNText>
                        <View className="h-10 flex-row items-center rounded-xl bg-surface-base p-[3px]">
                            <StepperButton
                                label={t(`${B}.fewer`, { dish: name })}
                                icon="minus"
                                onPress={() => {
                                    change(index, -5);
                                }}
                            />
                            <RNText className="w-[38px] text-center font-display text-base font-bold tabular-nums text-content-primary">
                                {String(quantities[index] ?? 0)}
                            </RNText>
                            <StepperButton
                                label={t(`${B}.more`, { dish: name })}
                                icon="plus"
                                onPress={() => {
                                    change(index, 5);
                                }}
                            />
                        </View>
                    </View>
                );
            })}
            <View className="mt-2.5 flex-row items-center gap-2.5 rounded-[14px] bg-surface-raised px-3 py-2.5">
                <Icon name="calendarDays" size="md" className="text-content-on-brand-subtle" />
                <View className="flex-1">
                    <ShopSwitch
                        testID="for-business-weekly"
                        label={t(`${B}.everyWeek`)}
                        checked={weekly}
                        onChange={setWeekly}
                    />
                </View>
            </View>
            <View
                aria-hidden
                className="mt-3 h-[50px] flex-row items-center justify-between rounded-[15px] bg-surface-brand px-4"
            >
                <RNText className="text-base font-bold text-content-on-brand">
                    {t(`${B}.requestQuote`)}
                </RNText>
                <Icon name="arrowForward" size="md" className="text-content-on-brand" />
            </View>
            <View className="mt-2.5 flex-row gap-1.5">
                {(['submitted', 'quoted', 'accepted'] as const).map((state, index) => (
                    <View
                        key={state}
                        className={cx(
                            'h-[30px] flex-1 flex-row items-center justify-center gap-1 rounded-full',
                            index === 0 ? 'bg-surface-brand-subtle' : 'bg-surface-raised',
                        )}
                    >
                        {index === 0 ? (
                            <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                        ) : null}
                        <RNText
                            className={cx(
                                'text-xs font-semibold',
                                index === 0
                                    ? 'text-content-on-brand-subtle'
                                    : 'text-content-secondary',
                            )}
                        >
                            {t(`${B}.quoteState.${state}`)}
                        </RNText>
                    </View>
                ))}
            </View>
        </View>
    );
}

function StepperButton({
    label,
    icon,
    onPress,
}: {
    readonly label: string;
    readonly icon: IconName;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-surface-raised hover:bg-surface-brand-subtle"
        >
            <Icon name={icon} size="sm" className="text-content-primary" />
        </Pressable>
    );
}

/* ── what a team gets ───────────────────────────────────────────────────────────────────────── */

function Gets() {
    const { t } = useTranslation();
    const days = t(`${B}.weekdays`).split(' ');
    const tile = (name: string, visual: ReactNode) => (
        <View
            key={name}
            testID={`for-business-gets-${name}`}
            className="min-w-[220px] flex-1 basis-[45%] rounded-3xl border border-stroke-subtle bg-surface-raised p-5 transition duration-normal ease-standard hover:-translate-y-1 hover:shadow-elevation-3 lg:basis-0"
        >
            <View
                aria-hidden
                className="mb-4 h-[110px] flex-row items-end justify-center gap-2.5 rounded-2xl bg-surface-base p-3.5"
            >
                {visual}
            </View>
            <RNText className="font-display text-lg font-bold text-content-primary text-start">
                {t(`${B}.gets.${name}.title`)}
            </RNText>
            <RNText className="mt-1 text-sm text-content-secondary text-start">
                {t(`${B}.gets.${name}.body`)}
            </RNText>
        </View>
    );
    return (
        <View testID="for-business-gets" className="mt-16 flex-col">
            <SectionTitle>{t(`${B}.getsTitle`)}</SectionTitle>
            <View className="flex-row flex-wrap gap-3.5">
                {tile(
                    'volume',
                    (
                        [
                            [30, '40+'],
                            [52, '100+'],
                            [74, '250+'],
                        ] as const
                    ).map(([height, label]) => (
                        <View key={label} className="items-center gap-1">
                            <View
                                className="w-[42px] rounded-t-[10px] rounded-b bg-surface-brand opacity-40"
                                style={{ height }}
                            />
                            <RNText className="text-xs font-semibold text-content-secondary">
                                {label}
                            </RNText>
                        </View>
                    )),
                )}
                {tile(
                    'invoice',
                    <View className="w-full flex-col justify-center gap-1.5 self-stretch">
                        {(['o1', 'o2', 'o3'] as const).map((office) => (
                            <View
                                key={office}
                                className="h-7 flex-row items-center gap-2 rounded-[9px] bg-surface-raised px-2.5"
                            >
                                <View className="h-2 w-2 rounded-full bg-surface-brand" />
                                <RNText className="text-xs text-content-primary">
                                    {t(`${B}.gets.invoice.${office}`)}
                                </RNText>
                            </View>
                        ))}
                    </View>,
                )}
                {tile(
                    'recurring',
                    <View className="flex-row items-center gap-2 self-center">
                        {days.map((day, index) => (
                            <View key={`${day}-${index}`} className="items-center gap-1">
                                <View
                                    className={cx(
                                        'h-[22px] w-[22px] rounded-[7px]',
                                        index === days.length - 1
                                            ? 'bg-stroke-subtle'
                                            : 'bg-surface-brand',
                                    )}
                                />
                                <RNText className="text-xs font-semibold text-content-secondary">
                                    {day}
                                </RNText>
                            </View>
                        ))}
                    </View>,
                )}
                {tile(
                    'dashboard',
                    [34, 58, 44, 72, 52, 80].map((height, index) => (
                        <View
                            key={index}
                            className="w-[18px] rounded-t-[5px] rounded-b-sm bg-surface-brand opacity-70"
                            style={{ height }}
                        />
                    )),
                )}
            </View>
        </View>
    );
}

/* ── questions ──────────────────────────────────────────────────────────────────────────────── */

function Questions() {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(FAQ[0]);
    return (
        <View testID="for-business-faq" className="mt-16 flex-col">
            <SectionTitle>{t(`${B}.faqTitle`)}</SectionTitle>
            <View className="flex-row flex-wrap items-start gap-2.5">
                {FAQ.map((n) => {
                    const on = open === n;
                    return (
                        <View
                            key={n}
                            className="min-w-[280px] flex-1 basis-[45%] overflow-hidden rounded-[20px] border border-stroke-subtle bg-surface-raised"
                        >
                            <Pressable
                                testID={`for-business-faq-${n}`}
                                role="button"
                                accessibilityRole="button"
                                aria-expanded={on}
                                accessibilityState={{ expanded: on }}
                                onPress={() => {
                                    setOpen(on ? null : n);
                                }}
                                className="min-h-16 flex-row items-center gap-3 px-[18px] py-3"
                            >
                                <RNText className="flex-1 text-base font-bold text-content-primary text-start">
                                    {t(`${B}.faq.q${n}`)}
                                </RNText>
                                <View
                                    className={cx(
                                        'h-8 w-8 items-center justify-center rounded-full transition duration-normal ease-standard',
                                        on
                                            ? 'rotate-45 bg-surface-brand-subtle'
                                            : 'bg-surface-base',
                                    )}
                                >
                                    <Icon
                                        name="plus"
                                        size="sm"
                                        className={
                                            on
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-primary'
                                        }
                                    />
                                </View>
                            </Pressable>
                            {on ? (
                                <RNText className="px-[18px] pb-[18px] text-sm leading-[21px] text-content-secondary text-start">
                                    {t(`${B}.faq.a${n}`)}
                                </RNText>
                            ) : null}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}
