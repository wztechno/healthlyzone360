import { useIsRtl } from '@healthy360/i18n';
import { Text as RNText, View } from 'react-native';
import { Pressable } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { KEYS, keyDownProps } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';

export const TABS_VARIANTS = ['underline', 'segmented', 'steps'] as const;
export type TabsVariant = (typeof TABS_VARIANTS)[number];

export interface TabItem<T extends string = string> {
    readonly value: T;
    readonly label: string;
    readonly icon?: IconName | undefined;
    /**
     * A figure the tab's own content holds — the nine raw materials behind Production.
     *
     * Rendered after the label in the mono role, one step down and in secondary ink, so it reads as
     * an annotation on the tab rather than as part of its name. It stays out of
     * `accessibilityLabel` for the same reason: a screen reader announcing "Production 9, tab, 2 of
     * 5" buries the position behind a number that changes every time a line is added. A caller that
     * needs the count spoken puts it in the label instead.
     *
     * `0` draws; `undefined` does not. An empty tab saying so is the point of the figure.
     */
    readonly count?: number | undefined;
    /**
     * What on this tab needs attention — the shelf life still blank on Description, the packaging
     * line at zero on Packaging. Drawn as a solid pill after the count on the `steps` variant only:
     * the tab row is where a reader looks for *which* tab to open, so it is where the tab that
     * blocks the save says so.
     *
     * Unlike `count`, it **is** spoken: `label` is appended to the tab's accessible name ("Packaging,
     * 1 warning"). A problem a screen reader user cannot hear about until they open every tab is not
     * a signal at all. `0` draws nothing, because there is nothing to report.
     */
    readonly issues?:
        | {
              readonly count: number;
              readonly tone: 'danger' | 'warning';
              /** Translated — `1 required`, `2 warnings`. */
              readonly label: string;
          }
        | undefined;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

export interface TabsProps<T extends string = string> {
    /** Accessible name for the tab list. A tablist without one is an unnamed landmark to axe. */
    readonly label: string;
    readonly items: readonly TabItem<T>[];
    readonly value: T;
    readonly onChange: (value: T) => void;
    readonly variant?: TabsVariant | undefined;
    /** Stretch the tabs to fill the row — the usual choice for a two- or three-way segmented set. */
    readonly block?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const COMFORTABLE_LIST_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline: 'flex-row flex-wrap items-end gap-1 border-b border-stroke-subtle',
    segmented: 'flex-row flex-wrap items-stretch gap-1 rounded-lg bg-surface-sunken p-1',
    steps: 'flex-row flex-wrap items-stretch gap-1 rounded-lg border border-stroke-subtle bg-surface-sunken p-1',
};

/**
 * The admin's five recipe tabs are a 32px row, not a 44px one, and the segmented set loses its
 * 12px corner for the control radius.
 *
 * The segmented **track** is a control, so its outer height is a control height: `h-control-sm`,
 * the same 28px as the `sm` input frame and the search field it sits beside in every admin toolbar
 * and form row. That is 24px tabs (`h-control-xs`) inside a 2px inset. A 4px inset around 28px tabs
 * made the track 36px, so a segmented set in a row of fields stood 8px taller than its neighbours
 * and pushed its label out of line with theirs.
 */
const COMPACT_LIST_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline: 'flex-row flex-wrap items-end gap-hair border-b border-stroke-subtle',
    segmented: 'flex-row flex-wrap items-stretch gap-0.5 rounded-sm bg-surface-sunken p-0.5',
    /*
     * The step row the Catalogue's recipe editor opens on: a sunken track with a hairline, holding
     * one raised tab per step. Not a control height — it is the form's opening, not a field in a
     * row of fields — so it keeps the panel radius and a 4px inset around 36px tabs.
     */
    steps: 'flex-row flex-wrap items-stretch gap-hair rounded-md border border-stroke-subtle bg-surface-sunken p-hair',
};

const LIST_VARIANT: Readonly<Record<Density, Readonly<Record<TabsVariant, string>>>> = {
    comfortable: COMFORTABLE_LIST_VARIANT,
    compact: COMPACT_LIST_VARIANT,
};

const COMFORTABLE_TAB_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline: 'min-h-touch flex-row items-center justify-center gap-2 border-b-2 px-3 py-2',
    segmented: 'min-h-touch flex-row items-center justify-center gap-2 rounded-md px-3 py-2',
    steps: 'min-h-touch min-w-0 flex-row items-center justify-start gap-2 rounded-md px-3 py-2',
};

const COMPACT_TAB_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline:
        'h-control-md flex-row items-center justify-center gap-control-md border-b-2 px-control-md',
    segmented:
        'h-control-xs flex-row items-center justify-center gap-control-sm rounded-sm px-control-sm',
    steps: 'h-control-lg min-w-0 flex-row items-center justify-start gap-control-sm rounded-sm px-control-sm',
};

const TAB_VARIANT: Readonly<Record<Density, Readonly<Record<TabsVariant, string>>>> = {
    comfortable: COMFORTABLE_TAB_VARIANT,
    compact: COMPACT_TAB_VARIANT,
};

const TAB_SELECTED: Readonly<Record<TabsVariant, string>> = {
    underline: 'border-stroke-focus',
    // The subtle fill with its tested text pair, and brand-500 exactly where §1.3 keeps it — on a
    // border (KITCHEN.md 7g: the selected window chip).
    segmented: 'border border-brand-500 bg-surface-brand-subtle',
    // The open step is a raised card on the sunken track; the numbered dot carries the brand.
    steps: 'border border-stroke bg-surface-raised shadow-elevation-card',
};

const TAB_UNSELECTED: Readonly<Record<TabsVariant, string>> = {
    underline: 'border-transparent',
    // Transparent border, not none: a border that appears only on selection would shift the row's
    // geometry by a pixel every time the choice changes.
    segmented: 'border border-transparent bg-transparent',
    steps: 'border border-transparent bg-transparent',
};

/**
 * Tabs and segmented control — one component, because they are one behaviour.
 *
 * Two accessibility decisions carry the weight here.
 *
 * **Roving tab stop.** Only the selected tab is focusable, so a tab list of eleven diets costs a
 * keyboard user one Tab press rather than eleven. Movement inside the list is by arrow key, which
 * is what `role="tablist"` promises a screen reader user it will do.
 *
 * **Direction-aware arrows.** The browser does not remap arrow keys for a right-to-left document,
 * so the component does: in Arabic, ArrowLeft moves to the *next* tab, because the next tab is on
 * the left. The visual order needs no work at all — the tabs are a `flex-row` in source order, so
 * the row itself mirrors.
 *
 * **`steps`** is the Catalogue editor's opening: equal tabs on a sunken track, each numbered, each
 * carrying its count and — when something on it blocks the save — a solid issue pill. It is still a
 * tab list, not a stepper: every step is reachable from the row, and the numbers state the order a
 * form is written in rather than a gate.
 */
export function Tabs<T extends string = string>({
    label,
    items,
    value,
    onChange,
    variant = 'underline',
    block = false,
    className,
    testID,
}: TabsProps<T>) {
    const isRtl = useIsRtl();
    const density = useDensity();

    const selectableIndexes = items
        .map((item, index) => (item.disabled === true ? -1 : index))
        .filter((index) => index >= 0);

    const move = (delta: number) => {
        if (selectableIndexes.length === 0) return;
        const currentIndex = items.findIndex((item) => item.value === value);
        const position = selectableIndexes.indexOf(currentIndex);
        const from = position === -1 ? 0 : position;
        const next = (from + delta + selectableIndexes.length) % selectableIndexes.length;
        const target = items[selectableIndexes[next]!];
        if (target !== undefined) onChange(target.value);
    };

    const jump = (position: 'first' | 'last') => {
        const index = position === 'first' ? selectableIndexes[0] : selectableIndexes.at(-1);
        if (index === undefined) return;
        const target = items[index];
        if (target !== undefined) onChange(target.value);
    };

    const onKeyDown = (event: WebKeyEvent) => {
        const forward = isRtl ? KEYS.arrowLeft : KEYS.arrowRight;
        const backward = isRtl ? KEYS.arrowRight : KEYS.arrowLeft;

        if (event.key === forward) {
            event.preventDefault();
            move(1);
        } else if (event.key === backward) {
            event.preventDefault();
            move(-1);
        } else if (event.key === KEYS.home) {
            event.preventDefault();
            jump('first');
        } else if (event.key === KEYS.end) {
            event.preventDefault();
            jump('last');
        }
    };

    return (
        <View
            testID={testID}
            role="tablist"
            accessibilityRole="tablist"
            aria-label={label}
            accessibilityLabel={label}
            aria-orientation="horizontal"
            className={cx(LIST_VARIANT[density][variant], className)}
        >
            {items.map((item, index) => {
                const selected = item.value === value;
                const disabled = item.disabled === true;
                const steps = variant === 'steps';
                const issues =
                    steps && item.issues !== undefined && item.issues.count > 0
                        ? item.issues
                        : null;
                return (
                    <Pressable
                        key={item.value}
                        testID={item.testID}
                        role="tab"
                        accessibilityRole="tab"
                        accessibilityLabel={
                            issues === null ? item.label : `${item.label}, ${issues.label}`
                        }
                        aria-selected={selected}
                        accessibilityState={{ selected, disabled }}
                        aria-disabled={disabled}
                        disabled={disabled}
                        // Roving tab stop: the list is one stop, arrows move within it.
                        focusable={selected && !disabled}
                        {...keyDownProps(onKeyDown)}
                        onPress={() => {
                            onChange(item.value);
                        }}
                        className={cx(
                            TAB_VARIANT[density][variant],
                            selected ? TAB_SELECTED[variant] : TAB_UNSELECTED[variant],
                            block || steps ? 'flex-1' : null,
                            disabled ? 'opacity-50' : null,
                        )}
                    >
                        {!steps ? null : (
                            <View
                                aria-hidden
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                className={cx(
                                    'h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                    selected
                                        ? 'border-transparent bg-surface-brand'
                                        : 'border-stroke-subtle bg-surface-raised',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'tabular-nums text-role-micro',
                                        selected
                                            ? 'text-content-on-brand'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {String(index + 1)}
                                </RNText>
                            </View>
                        )}
                        {item.icon === undefined ? null : (
                            <Icon
                                name={item.icon}
                                size="sm"
                                className={
                                    selected
                                        ? variant === 'segmented'
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-primary'
                                        : 'text-content-secondary'
                                }
                            />
                        )}
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                steps ? 'min-w-0 flex-1 text-start' : 'text-center',
                                density === 'compact' ? 'text-role-label' : 'text-sm',
                                selected
                                    ? variant === 'segmented'
                                        ? 'font-semibold text-content-on-brand-subtle'
                                        : 'font-semibold text-content-primary'
                                    : 'text-content-secondary',
                            )}
                        >
                            {item.label}
                        </RNText>
                        {item.count === undefined ? null : (
                            <RNText
                                aria-hidden
                                testID={
                                    item.testID === undefined ? undefined : `${item.testID}-count`
                                }
                                className="tabular-nums text-role-micro text-content-secondary"
                            >
                                {String(item.count)}
                            </RNText>
                        )}
                        {issues === null ? null : (
                            <View
                                aria-hidden
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                testID={
                                    item.testID === undefined ? undefined : `${item.testID}-issues`
                                }
                                className={cx(
                                    'h-4 min-w-4 items-center justify-center rounded-full px-1',
                                    issues.tone === 'danger'
                                        ? 'bg-danger-strong'
                                        : 'bg-warning-strong',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'tabular-nums text-role-micro',
                                        issues.tone === 'danger'
                                            ? 'text-danger-on-strong'
                                            : 'text-warning-on-strong',
                                    )}
                                >
                                    {String(issues.count)}
                                </RNText>
                            </View>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

export type SegmentedControlProps<T extends string = string> = Omit<TabsProps<T>, 'variant'>;

/** The segmented presentation of {@link Tabs}: same semantics, denser chrome. */
export function SegmentedControl<T extends string = string>(props: SegmentedControlProps<T>) {
    return <Tabs {...props} variant="segmented" />;
}
