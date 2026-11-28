import { Icon } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * The top of the green module rail: the brand's leaf in a round white pill, as the admin frame
 * boards draw it. The page panel no longer carries a brand block — its header names the module.
 */
export function AreaRailTop({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    return (
        <View
            testID={testID}
            role="img"
            aria-label={t('marketplace:brand.name')}
            className="mb-3 h-11 w-11 items-center justify-center rounded-full bg-surface-sidebar-active"
        >
            <Icon name="leaf" size="lg" className="text-content-on-sidebar-active" />
        </View>
    );
}

/** The admin frame's page panel is 240px — shared by every desk area. */
export const DESK_SIDEBAR_WIDTH = 240;
