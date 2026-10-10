import { Card, Stack } from '@healthy360/design-system';
import { View } from 'react-native';

import { EntityImage, resolveEntityImage } from '../../../media/entity-image.tsx';
import { PhotoCredit } from '../../../media/photo-credit.tsx';

/**
 * A record's photograph as the first card in a View page's rail, with the credit its licence asks
 * for — or nothing at all when the record has no photograph.
 *
 * ## Nothing, rather than the pattern
 *
 * A list row keeps the generated pattern for an unphotographed record, because a 20px frame holds
 * the row's shape. A rail card is different: a large pattern with nothing to say would push the
 * record's status down the rail for no information, so an unmapped id renders no card. The list
 * row beside it has already said, in its own way, that there is no photograph.
 *
 * ## Two shapes, because the files are two shapes
 *
 * `square` is an ingredient or a packaging item, whose one file is a 256px square. It is drawn at
 * 128px, which is that file at twice the density — drawn across a 300px rail it would be upscaled
 * and soft. `wide` is a dish, a meal or a product, whose `detail` file is 1280px wide and fills the
 * rail sharply at 16:9.
 */
export type RecordPhotoShape = 'square' | 'wide';

export interface RecordPhotoProps {
    /** The photograph id, e.g. `ingredient-black-pepper` or `recipe-garlic-mayo`. */
    readonly assetId: string;
    /** The record's name, announced for the image. */
    readonly label: string;
    readonly shape: RecordPhotoShape;
    readonly testID: string;
}

export function RecordPhoto({ assetId, label, shape, testID }: RecordPhotoProps) {
    const variant = shape === 'square' ? 'card' : 'detail';
    if (resolveEntityImage(assetId, variant) === null) return null;

    const image = (
        <EntityImage
            assetId={assetId}
            seed={assetId}
            label={label}
            aspect={shape === 'square' ? 'square' : 'wide'}
            variant={variant}
            testID={`${testID}-image`}
        />
    );

    return (
        <Card testID={testID} tone="raised" padding="md">
            <Stack space="sm">
                {/* The wide image already spans the rail; only the square one needs a frame. */}
                {shape === 'square' ? <View className="w-32">{image}</View> : image}
                <PhotoCredit assetId={assetId} testID={`${testID}-credit`} />
            </Stack>
        </Card>
    );
}
