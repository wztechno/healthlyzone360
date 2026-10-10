import { View } from 'react-native';

import { cx } from '../internal/class-names.ts';
import type { SectionGridProps } from './section-grid-shared.ts';

export type { SectionGridProps } from './section-grid-shared.ts';

/** SectionGrid — native. One column; the pairing is a web desk layout. */
export function SectionGrid({ children, className, testID }: SectionGridProps) {
    return (
        <View testID={testID} className={cx('flex-col gap-base', className)}>
            {children}
        </View>
    );
}
