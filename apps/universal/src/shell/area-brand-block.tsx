import { gradients } from '@healthy360/design-tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

/**
 * Brand block at the top of a desk area's rail: the violet-to-green mark the marketplace top bar
 * uses, the wordmark, and the area line under it. The kitchen and the corporate area differ by the
 * area line and nothing else.
 */
export interface AreaBrandBlockProps {
    /** The area line under the wordmark — "Kitchen operations", "Corporate account". */
    readonly subtitle: string;
    readonly testID: string;
}

/** The gradient mark with the brand's initial — the brand block's glyph, and all of it when collapsed. */
function BrandMark() {
    const { t } = useTranslation();
    return (
        <LinearGradient
            colors={gradients.accent.colours}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 32, height: 32, borderRadius: 8 }}
        >
            <View className="h-full w-full items-center justify-center">
                <RNText className="text-base font-bold text-content-on-canopy">
                    {t('marketplace:brand.name').slice(0, 1)}
                </RNText>
            </View>
        </LinearGradient>
    );
}

export function AreaBrandBlock({ subtitle, testID }: AreaBrandBlockProps) {
    const { t } = useTranslation();

    return (
        <View testID={testID} className="flex-row items-center gap-2 px-4 pb-2 pt-4">
            <BrandMark />
            <View className="min-w-0 flex-1">
                <RNText
                    numberOfLines={1}
                    className="text-base font-bold text-content-primary text-start"
                >
                    {t('marketplace:brand.name')}
                </RNText>
                <RNText numberOfLines={1} className="text-xs text-content-secondary text-start">
                    {subtitle}
                </RNText>
            </View>
        </View>
    );
}

/**
 * The top of the green module rail when the panel is collapsed: empty. The logo lives once, in the
 * white panel's brand block; this keeps the block's height so the rail's module icons start where
 * they did.
 */
export function AreaRailTop({ testID }: { readonly testID: string }) {
    return (
        <View testID={testID} className="pb-2 pt-4">
            <View className="h-8" />
        </View>
    );
}

/** The desk rail is 232px — KITCHEN.md's sidebar spec, shared by every desk area. */
export const DESK_SIDEBAR_WIDTH = 232;
