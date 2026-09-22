import type { ReactElement } from 'react';

import type { IconName, IconSize } from './icon.tsx';

/**
 * The drawn icons — native half. Nothing is drawn: `react-native-svg` is a native module this
 * package does not take for a handful of decorative marks, so every name falls back to its glyph.
 */
export function drawIcon(
    _name: IconName,
    _size: IconSize,
    _className: string | undefined,
    _label: string | undefined,
    _testID: string | undefined,
    _isRtl: boolean,
): ReactElement | null {
    return null;
}
