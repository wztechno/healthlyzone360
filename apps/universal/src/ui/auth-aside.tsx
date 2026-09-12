import { Icon } from '@healthy360/design-system';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

/**
 * The canopy panel beside the auth card from `lg` up — the split-panel opening the handoff draws
 * for sign-in and register (4a/4b).
 *
 * One panel for the whole auth journey rather than per-route copy: the frames vary the headline
 * between sign-in and register, but a stable brand statement through sign-in, register, the
 * organisation picker and the verify screens reads as one place, and costs no per-route plumbing
 * through the shared layout.
 *
 * Hexes ride `LinearGradient` props the way `PageHero` and the marketplace brand mark carry
 * theirs — canopy → canopy-deep → the gradient's green foot, values from the token set.
 */
export function AuthAside() {
    const { t } = useTranslation();
    const points = ['nutrition', 'planner', 'marketplace'] as const;

    return (
        <LinearGradient
            colors={['#0b3b26', '#124f33', '#0e6b41']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.4, y: 1 }}
            style={{ flex: 1 }}
        >
            <View testID="auth-aside" className="flex-1 justify-center gap-6 p-10">
                <View className="flex-row items-center gap-2">
                    <LinearGradient
                        colors={['#6d28d9', '#16a34a']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: 32, height: 32, borderRadius: 8 }}
                    >
                        <View className="h-full w-full items-center justify-center">
                            <RNText className="text-base text-content-on-canopy">
                                {t('marketplace:brand.name').slice(0, 1)}
                            </RNText>
                        </View>
                    </LinearGradient>
                    <RNText className="text-lg text-content-on-canopy">
                        {t('marketplace:brand.name')}
                    </RNText>
                </View>

                <RNText className="text-3xl leading-tight text-content-on-canopy text-start">
                    {t('auth:aside.headline')}
                </RNText>

                <View className="gap-3">
                    {points.map((key) => (
                        <View key={key} className="flex-row items-start gap-2">
                            <Icon name="check" size="sm" className="text-content-on-canopy" />
                            <RNText className="flex-1 text-sm leading-6 text-content-on-canopy-muted text-start">
                                {t(`auth:aside.points.${key}`)}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>
        </LinearGradient>
    );
}
