import {
    NUTRITION_LEVELS,
    SEMANTIC_ROLES,
    brand,
    contrastRatio,
    elevation,
    formatContrast,
    fontFamilies,
    lineHeights,
    radius,
    spacing,
    themes,
} from '@healthy360/design-tokens';
import { useLocale } from '@healthy360/i18n';
import { useColorScheme } from 'nativewind';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appConfig } from '../src/config.ts';

/**
 * NativeWind styling spike (plan §19, 05-universal-frontend.md §7.2).
 *
 * NativeWind is *provisional* until it is shown to work across English/Arabic, web/native and
 * light/dark. This screen is that proof, and it is deliberately a single route rather than a
 * component library: nothing else should be built on NativeWind until this passes.
 *
 * RTL policy: every class here is a **logical** utility (ms/me, ps/pe, start/end, border-s/border-e,
 * text-start). Physical utilities and `rtl:`/`ltr:` variants are banned by the root ESLint config,
 * because NativeWind 4's direction variants do not work on native.
 */

const BRAND_STOPS = [100, 300, 500, 700, 900] as const;
const ELEVATION_LEVELS = [0, 1, 2, 3, 4, 5] as const;
const SPACING_SAMPLES = ['1', '2', '4', '6', '8'] as const;
const RADIUS_SAMPLES = ['sm', 'md', 'lg', 'xl', '2xl'] as const;

function Section({
    testID,
    title,
    description,
    children,
}: {
    testID: string;
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <View testID={testID} className="gap-3 border-s-4 border-s-stroke-focus ps-4">
            <Text className="text-xl font-semibold text-content-primary text-start">{title}</Text>
            <Text className="text-sm text-content-secondary text-start">{description}</Text>
            <View className="gap-3">{children}</View>
        </View>
    );
}

export default function NativeWindSpikeScreen() {
    const { t } = useTranslation();
    const { locale, direction, setLocale } = useLocale();
    const { colorScheme, toggleColorScheme } = useColorScheme();
    const insets = useSafeAreaInsets();

    const theme = colorScheme === 'dark' ? themes.dark : themes.light;
    const script = locale.startsWith('ar') ? 'arabic' : 'latin';

    return (
        <ScrollView
            testID="spike-screen"
            className="flex-1 bg-surface-base"
            contentContainerClassName="gap-8 p-6 pb-16"
            contentContainerStyle={{ paddingTop: insets.top + spacing['6'] }}
        >
            <View className="gap-2">
                <Text
                    testID="spike-title"
                    className="text-3xl font-bold text-content-primary text-start"
                >
                    {t('designSystem:spike.title')}
                </Text>
                <Text className="text-base text-content-secondary text-start">
                    {t('designSystem:spike.subtitle')}
                </Text>
                <Text className="text-xs text-content-disabled text-start">
                    {`APP_MODE=${appConfig.appMode} · APP_ENV=${appConfig.appEnv} · DATA_MODE=${appConfig.dataMode}`}
                </Text>
            </View>

            {/* ── Controls ─────────────────────────────────────────────────────────────────────── */}
            <View testID="spike-controls" className="flex-row flex-wrap items-center gap-3">
                <Pressable
                    testID="toggle-theme"
                    accessibilityRole="button"
                    onPress={toggleColorScheme}
                    className="min-h-touch justify-center rounded-lg bg-surface-brand px-4 py-2"
                >
                    <Text className="text-sm font-medium text-content-on-brand">
                        {t('designSystem:controls.toggleTheme')}
                    </Text>
                </Pressable>

                <Pressable
                    testID="toggle-locale"
                    accessibilityRole="button"
                    onPress={() => {
                        void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                    }}
                    className="min-h-touch justify-center rounded-lg bg-surface-accent px-4 py-2"
                >
                    <Text className="text-sm font-medium text-content-on-accent">
                        {t('designSystem:controls.toggleLocale')}
                    </Text>
                </Pressable>

                <View className="gap-1">
                    <Text
                        testID="current-theme"
                        className="text-xs text-content-secondary text-start"
                    >
                        {t('designSystem:controls.currentTheme', { theme: colorScheme ?? 'light' })}
                    </Text>
                    <Text
                        testID="current-locale"
                        className="text-xs text-content-secondary text-start"
                    >
                        {t('designSystem:controls.currentLocale', { locale })}
                    </Text>
                    <Text
                        testID="current-direction"
                        className="text-xs text-content-secondary text-start"
                    >
                        {t('designSystem:controls.currentDirection', {
                            direction: t(`direction.${direction}`),
                        })}
                    </Text>
                </View>
            </View>

            {/* ── Logical properties ───────────────────────────────────────────────────────────── */}
            <Section
                testID="section-logical"
                title={t('designSystem:spike.sections.logical')}
                description={t('designSystem:spike.logical.description')}
            >
                <View
                    testID="logical-row"
                    className="flex-row items-center rounded-lg border border-stroke bg-surface-raised ps-6 pe-3 py-3"
                    /*
                     * The same intent expressed twice on purpose, because the two paths behave
                     * differently and the spike exists to show it:
                     *
                     *  - the `ps-`/`pe-` class names compile to CSS logical properties and mirror
                     *    live when `dir` changes;
                     *  - these inline React Native style props are what native needs, but
                     *    react-native-web resolves `marginStart`/`borderStartWidth` to physical
                     *    `margin-left`/`border-left-width` at render time, so they do **not**
                     *    re-mirror on a live web direction change.
                     *
                     * Conclusion carried into the design system (5b): direction-sensitive spacing is
                     * expressed with logical *utilities*; inline start/end style props are reserved
                     * for values a class cannot express.
                     */
                    style={{
                        marginStart: spacing['4'],
                        marginEnd: spacing['1'],
                        paddingStart: spacing['3'],
                        borderStartWidth: 4,
                        borderStartColor: theme.colours.focusRing,
                    }}
                >
                    <View
                        testID="logical-marker"
                        className="me-3 size-3 rounded-full bg-surface-brand"
                    />
                    <Text
                        testID="logical-leading"
                        className="flex-1 text-sm text-content-primary text-start"
                        // `textAlign: 'auto'` is React Native's logical alignment: it follows the writing
                        // direction instead of pinning text to a physical side.
                        style={{ textAlign: 'auto' }}
                    >
                        {t('designSystem:spike.logical.leading')}
                    </Text>
                    <Text
                        testID="logical-trailing"
                        className="ms-3 text-sm text-content-secondary text-end"
                    >
                        {t('designSystem:spike.logical.trailing')}
                    </Text>
                </View>
                <Text className="text-xs text-content-disabled text-start">
                    {t('designSystem:spike.logical.marker')}
                </Text>
            </Section>

            {/* ── Colour ───────────────────────────────────────────────────────────────────────── */}
            <Section
                testID="section-colour"
                title={t('designSystem:spike.sections.colour')}
                description={t('designSystem:spike.colour.description')}
            >
                <View className="flex-row flex-wrap gap-2">
                    {BRAND_STOPS.map((stop) => (
                        <View
                            key={stop}
                            testID={`brand-swatch-${stop}`}
                            className="h-14 w-20 items-center justify-center rounded-md"
                            style={{ backgroundColor: brand[stop] }}
                        >
                            <Text
                                className="text-xs font-medium"
                                style={{
                                    color:
                                        stop >= 500 ? '#ffffff' : themes.light.colours.textPrimary,
                                }}
                            >
                                {`brand.${stop}`}
                            </Text>
                        </View>
                    ))}
                </View>

                {SEMANTIC_ROLES.map((role) => {
                    const set = theme.semantic[role];
                    return (
                        <View
                            key={role}
                            testID={`semantic-${role}`}
                            className="flex-row flex-wrap gap-2"
                        >
                            {(['subtle', 'default', 'strong'] as const).map((slot) => {
                                const background = set[slot];
                                const foreground =
                                    slot === 'subtle'
                                        ? set.onSubtle
                                        : slot === 'default'
                                          ? set.onDefault
                                          : set.onStrong;
                                return (
                                    <View
                                        key={slot}
                                        testID={`semantic-${role}-${slot}`}
                                        className="min-w-touch grow rounded-md px-3 py-2"
                                        style={{ backgroundColor: background }}
                                    >
                                        <Text
                                            className="text-xs font-medium text-start"
                                            style={{ color: foreground }}
                                        >
                                            {`${role}.${slot}`}
                                        </Text>
                                        <Text
                                            className="text-xs text-start"
                                            style={{ color: foreground }}
                                        >
                                            {t('designSystem:swatch.contrast', {
                                                ratio: formatContrast(
                                                    contrastRatio(foreground, background),
                                                ),
                                            })}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    );
                })}
            </Section>

            {/* ── Typography ───────────────────────────────────────────────────────────────────── */}
            <Section
                testID="section-typography"
                title={t('designSystem:spike.sections.typography')}
                description={t('designSystem:spike.typography.description')}
            >
                <Text
                    testID="sample-latin"
                    className="font-latin text-lg text-content-primary text-start"
                    style={{ lineHeight: lineHeights.latin.lg }}
                >
                    {t('designSystem:spike.sample.latin')}
                </Text>
                <Text
                    testID="sample-arabic"
                    className="font-arabic text-lg text-content-primary text-start"
                    style={{ lineHeight: lineHeights.arabic.lg }}
                >
                    {t('designSystem:spike.sample.arabic')}
                </Text>
                <Text className="text-xs text-content-disabled text-start">
                    {`${fontFamilies[script].regular} · line-height ${lineHeights[script].lg}px`}
                </Text>
            </Section>

            {/* ── Spacing and radius ───────────────────────────────────────────────────────────── */}
            <Section
                testID="section-spacing"
                title={t('designSystem:spike.sections.spacing')}
                description={t('designSystem:spike.spacing.description')}
            >
                <View className="flex-row items-end gap-2">
                    {SPACING_SAMPLES.map((step) => (
                        <View key={step} className="items-center gap-1">
                            <View
                                testID={`spacing-${step}`}
                                className="bg-surface-brand"
                                style={{ width: spacing[step], height: spacing[step] }}
                            />
                            <Text className="text-xs text-content-secondary">{spacing[step]}</Text>
                        </View>
                    ))}
                </View>
                <View className="flex-row items-center gap-2">
                    {RADIUS_SAMPLES.map((name) => (
                        <View key={name} className="items-center gap-1">
                            <View
                                testID={`radius-${name}`}
                                className="size-10 bg-surface-brand-subtle"
                                style={{ borderRadius: radius[name] }}
                            />
                            <Text className="text-xs text-content-secondary">{name}</Text>
                        </View>
                    ))}
                </View>
            </Section>

            {/* ── Elevation ────────────────────────────────────────────────────────────────────── */}
            <Section
                testID="section-elevation"
                title={t('designSystem:spike.sections.elevation')}
                description={t('designSystem:spike.elevation.description')}
            >
                <View className="flex-row flex-wrap gap-3">
                    {ELEVATION_LEVELS.map((level) => (
                        <View
                            key={level}
                            testID={`elevation-${level}`}
                            className="size-16 items-center justify-center rounded-lg bg-surface-raised"
                            style={elevation[level].native}
                        >
                            <Text className="text-xs text-content-primary">{level}</Text>
                        </View>
                    ))}
                </View>
            </Section>

            {/* ── Nutrition scale ──────────────────────────────────────────────────────────────── */}
            <Section
                testID="section-nutrition"
                title={t('designSystem:spike.sections.nutrition')}
                description={t('designSystem:spike.nutrition.description')}
            >
                <View className="flex-row flex-wrap gap-2">
                    {NUTRITION_LEVELS.map((level) => {
                        const stop = theme.nutrition[level];
                        return (
                            <View
                                key={level}
                                testID={`nutrition-${level}`}
                                className="grow rounded-md px-3 py-2"
                                style={{ backgroundColor: stop.colour }}
                            >
                                <Text
                                    className="text-xs font-medium text-start"
                                    style={{ color: stop.on }}
                                >
                                    {level}
                                </Text>
                                <Text className="text-xs text-start" style={{ color: stop.on }}>
                                    {stop.pattern}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            </Section>
        </ScrollView>
    );
}
