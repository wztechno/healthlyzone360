import { View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';

/**
 * The record's picture at the head's start: 64px, square, clipped. A record with no photograph
 * gets `EntityImage`'s generated pattern, so every head keeps its shape.
 */
export function RecordThumb({
    assetId,
    photoUrl,
    label,
    seed,
    testID,
}: {
    readonly assetId: string | undefined;
    readonly photoUrl?: string | null | undefined;
    /** The record's name; the picture is decorative beside it. */
    readonly label: string;
    readonly seed: string;
    readonly testID: string;
}) {
    return (
        <View className="h-16 w-16 overflow-hidden rounded-xl border border-stroke-subtle bg-surface-sunken">
            <EntityImage
                assetId={assetId}
                photoUrl={photoUrl}
                seed={seed}
                label={label}
                aspect="square"
                variant="card"
                decorative
                flush
                testID={testID}
            />
        </View>
    );
}
