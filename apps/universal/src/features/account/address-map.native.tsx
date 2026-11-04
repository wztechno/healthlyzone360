import { Icon } from '@healthy360/design-system';
import { View } from 'react-native';

/**
 * On a phone there is no SVG library, so the preview's map is a few roads drawn as rotated bars and
 * a still pin with its rings — the same "this is a place", without the motion.
 */
export function AddressMap({ testID }: { readonly testID?: string | undefined }) {
    return (
        <View testID={testID} aria-hidden className="relative h-[220px] overflow-hidden">
            <View
                className="absolute -start-10 top-[150px] h-2.5 w-[460px] bg-content-on-canopy/20"
                style={{ transform: [{ rotate: '-14deg' }] }}
            />
            <View
                className="absolute start-[120px] -top-5 h-[280px] w-[7px] bg-content-on-canopy/20"
                style={{ transform: [{ rotate: '6deg' }] }}
            />
            <View className="absolute inset-0 items-center justify-center">
                <View className="absolute h-16 w-16 rounded-full border-2 border-stage-green opacity-40" />
                <View className="h-10 w-10 items-center justify-center rounded-full bg-stage-green">
                    <Icon name="mapPin" size="md" className="text-surface-canopy" />
                </View>
            </View>
        </View>
    );
}
