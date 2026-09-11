import { View } from 'react-native';

import { cx } from '../internal/class-names.ts';

/**
 * Separator — the only component in the Catalogue that draws a line.
 *
 * The handoff retires panel outlines, vertical rules and zebra striping (§1.3, §4.1) and leaves
 * exactly two lines standing: a row's `border-b` and a section's `border-t`. Funnelling both
 * through one component is what stops the third from being invented — every future "just a hairline
 * here" has to come through this file and answer for itself.
 *
 * `borderSubtle` is the separator weight; `borderDefault` is a *control outline* and is wrong here.
 * A list of 25 rows separated at control weight reads as a table with vertical rules, which is the
 * density the redesign is trying to get away from.
 *
 * ## Not `<hr>`, and decorative by default
 *
 * A separator between two list rows conveys nothing a screen reader user needs — the rows are
 * already separate elements. So it is `aria-hidden` unless a caller states otherwise, which keeps
 * 25 announcements of "separator" out of a list of 25 ingredients. `semantic` opts back in for the
 * rare case where the line genuinely divides two groups that nothing else distinguishes.
 */

export const SEPARATOR_ORIENTATIONS = ['horizontal', 'vertical'] as const;
export type SeparatorOrientation = (typeof SEPARATOR_ORIENTATIONS)[number];

export interface SeparatorProps {
    readonly orientation?: SeparatorOrientation | undefined;
    /**
     * Announce it. Off by default — see above. On the web this becomes `role="separator"`, which
     * is the one case where the line is content rather than decoration.
     */
    readonly semantic?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Separator({
    orientation = 'horizontal',
    semantic = false,
    className,
    testID,
}: SeparatorProps) {
    const geometry =
        orientation === 'horizontal'
            ? // `border-b` rather than a 1px-tall filled box: a hairline drawn as a border lands on
              // the device pixel grid at any density, where a `h-px bg-…` view is subject to
              // rounding and disappears entirely at some scale factors.
              'w-full border-b border-stroke-subtle'
            : 'self-stretch border-e border-stroke-subtle';

    const semantics = semantic
        ? {
              role: 'separator' as const,
              accessibilityRole: 'none' as const,
              'aria-orientation': orientation,
          }
        : {
              'aria-hidden': true,
              accessibilityElementsHidden: true,
              importantForAccessibility: 'no-hide-descendants' as const,
          };

    return <View testID={testID} {...semantics} className={cx(geometry, className)} />;
}
