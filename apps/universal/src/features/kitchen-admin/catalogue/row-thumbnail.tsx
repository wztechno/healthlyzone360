import { View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';

/**
 * A Catalogue row's photograph, at the size its layout affords.
 *
 * `table` is 20px: a 28px Catalogue row has no photography track, so the picture sits inside the
 * title cell rather than claiming a column. `narrow` is 32px, the design system's small avatar, on
 * the leading edge of the two-line row below `md`, which has the height for it.
 *
 * Decorative in both, because the title beside it already names the record and announcing the
 * picture as well would say the name twice (WCAG H67).
 */
export type RowThumbnailSize = 'table' | 'narrow';

const SIZE_CLASS: Readonly<Record<RowThumbnailSize, string>> = {
    table: 'w-5',
    narrow: 'w-8',
};

export interface RowThumbnailProps {
    /** The photograph id, e.g. `ingredient-black-pepper`; `undefined` draws the pattern. */
    readonly assetId: string | undefined;
    /** The kitchen's own photo of the record (BUG-14). Wins over `assetId`; null falls back to it. */
    readonly photoUrl?: string | null | undefined;
    /** Keeps the fallback pattern stable across renames: the row's key, not its name. */
    readonly seed: string;
    /**
     * The row's title. Hidden from assistive technology with the rest of the image, since the
     * thumbnail is decorative in both of `EntityImage`'s branches, but still a real name: the
     * fallback pattern is a named `image` role underneath, and an empty name there is an
     * accessibility defect the moment anything stops hiding it.
     */
    readonly label: string;
    readonly size: RowThumbnailSize;
    readonly testID?: string | undefined;
}

export function RowThumbnail({ assetId, photoUrl, seed, label, size, testID }: RowThumbnailProps) {
    return (
        <View className={SIZE_CLASS[size]}>
            <EntityImage
                assetId={assetId}
                photoUrl={photoUrl}
                seed={seed}
                label={label}
                aspect="square"
                variant="card"
                decorative
                testID={testID}
            />
        </View>
    );
}
