import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { useIsCoarsePointer } from '../hooks/use-pointer.ts';
import { cx } from '../internal/class-names.ts';
import { KEYS, keyDownProps } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';

export const POPOVER_TRIGGERS = ['press', 'hover'] as const;
export type PopoverTrigger = (typeof POPOVER_TRIGGERS)[number];

export const POPOVER_TRIGGER_VARIANTS = ['link', 'button'] as const;
export type PopoverTriggerVariant = (typeof POPOVER_TRIGGER_VARIANTS)[number];

export const POPOVER_ALIGNS = ['start', 'end'] as const;
export type PopoverAlign = (typeof POPOVER_ALIGNS)[number];

export interface PopoverProps {
    /** Accessible name of the trigger — an icon-only trigger has no other name. */
    readonly triggerLabel: string;
    /** Visible trigger text. Omit for an icon-only trigger. */
    readonly triggerText?: string | undefined;
    readonly triggerIcon?: IconName | undefined;
    /** Heading inside the panel. */
    readonly title: string;
    readonly children: ReactNode;
    /**
     * `hover` is an *enhancement only*: on a coarse pointer it silently degrades to `press`,
     * because a touch screen has no hover state and a hover-only affordance is unreachable there.
     */
    readonly trigger?: PopoverTrigger | undefined;
    /**
     * How the trigger presents itself.
     *
     * `link` — underlined secondary text beside a glyph. The default, and right for the job this
     * component was built for: an inline "why this target?" explainer sitting in running copy,
     * where a button would interrupt the sentence.
     *
     * `button` — an outlined control on the raised surface. For a popover that is a *destination
     * for actions* rather than a footnote: an account menu in a top bar is a control among other
     * controls, and underlined text there reads as a stray link between two buttons.
     */
    readonly triggerVariant?: PopoverTriggerVariant | undefined;
    /**
     * Which edge the panel is anchored to. `start` (default) hangs it from the leading edge of the
     * trigger; `end` from the trailing edge, which is what a trigger near the end of a top bar
     * needs so its 280px panel opens inward instead of off the side of the page.
     */
    readonly align?: PopoverAlign | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Popover — a non-modal panel anchored to its trigger.
 *
 * **Non-modal on purpose.** A tooltip-sized explanation ("why this target?") that steals focus and
 * traps it is far more disruptive than the thing it explains. Focus therefore stays on the trigger;
 * Escape closes; on the web a press outside closes. Use `Dialog` when the answer genuinely must be
 * dealt with before anything else.
 *
 * **Hover is inert on coarse pointers.** `trigger="hover"` is honoured only when the primary
 * pointer is fine. On a phone the same component opens on press, which means one implementation
 * covers both and neither is a special case that can rot.
 *
 * **No physical positioning.** The panel is an absolutely positioned sibling with `top-full` and no
 * horizontal inset at all, so it aligns to the anchor's leading edge in both directions without a
 * `left`, `right`, `start` or `end` offset — the inset logical properties the RTL spike found
 * unreliable across React Native and react-native-web.
 */
export function Popover({
    triggerLabel,
    triggerText,
    triggerIcon = 'info',
    title,
    children,
    trigger = 'press',
    triggerVariant = 'link',
    align = 'start',
    disabled = false,
    className,
    testID,
}: PopoverProps) {
    const generated = useId();
    const base = testID ?? `popover-${generated.replace(/:/g, '')}`;
    const panelId = `${base}-panel`;
    const [open, setOpen] = useState(false);
    const coarse = useIsCoarsePointer();
    const hoverEnabled = trigger === 'hover' && !coarse;
    const openRef = useRef(open);
    openRef.current = open;
    const containerRef = useRef<View | null>(null);

    // Escape closes from anywhere: the trigger keeps focus, so a handler bound only to the trigger
    // would miss a press made while the pointer is over the panel. The pointer listener is the
    // click-outside half of the same contract.
    useEffect(() => {
        if (Platform.OS !== 'web' || !open) return;
        if (typeof document === 'undefined') return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === KEYS.escape) setOpen(false);
        };
        const onPointerDown = (event: Event) => {
            const node = containerRef.current as unknown as {
                readonly contains?: (target: unknown) => boolean;
            } | null;
            if (node?.contains?.(event.target) === true) return;
            setOpen(false);
        };

        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    const onTriggerKeyDown = (event: WebKeyEvent) => {
        if (event.key === KEYS.escape && openRef.current) {
            event.preventDefault();
            setOpen(false);
        }
    };

    const hoverProps = hoverEnabled
        ? {
              onHoverIn: () => {
                  setOpen(true);
              },
              onHoverOut: () => {
                  setOpen(false);
              },
          }
        : {};

    return (
        <View ref={containerRef} testID={testID} className={cx('flex-col', className)}>
            <Pressable
                testID={`${base}-trigger`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                aria-label={triggerLabel}
                aria-expanded={open}
                aria-controls={panelId}
                aria-haspopup="dialog"
                accessibilityState={{ expanded: open, disabled }}
                aria-disabled={disabled}
                disabled={disabled}
                focusable={!disabled}
                {...hoverProps}
                {...keyDownProps(onTriggerKeyDown)}
                onPress={() => {
                    setOpen((current) => !current);
                }}
                className={cx(
                    'min-h-touch flex-row items-center gap-1.5 self-start rounded-lg',
                    triggerVariant === 'button'
                        ? 'border border-stroke bg-surface-raised px-3.5 py-2'
                        : 'px-2 py-1',
                )}
            >
                <Icon name={triggerIcon} size="sm" className="text-content-secondary" />
                {triggerText === undefined ? null : (
                    <RNText
                        className={cx(
                            'text-sm text-start',
                            triggerVariant === 'button'
                                ? 'font-medium text-content-primary'
                                : 'text-content-secondary underline',
                        )}
                    >
                        {triggerText}
                    </RNText>
                )}
            </Pressable>

            {open ? (
                <View
                    testID={panelId}
                    nativeID={panelId}
                    role="dialog"
                    aria-label={title}
                    accessibilityLabel={title}
                    className={cx(
                        'absolute top-full z-tooltip mt-1 w-[280px] max-w-[92%] flex-col gap-2 rounded-lg border border-stroke-subtle bg-surface-raised p-3 shadow-elevation-3',
                        /*
                         * `start` adds nothing, and that is deliberate — asserted by
                         * "anchors the panel with no horizontal inset at all". An absolutely
                         * positioned box with neither edge set resolves to its static position,
                         * which is already the trigger's leading edge, and it does so in both
                         * directions without a utility that could be got the wrong way round.
                         * `end-0` is the opt-in for a trigger sitting near the end of the page,
                         * where the panel would otherwise open off the side; it is logical, so it
                         * mirrors under RTL rather than pinning to a physical edge.
                         */
                        align === 'end' ? 'end-0' : null,
                    )}
                >
                    <RNText
                        testID={`${base}-title`}
                        accessibilityRole="header"
                        aria-level={3}
                        className="text-sm font-semibold text-content-primary text-start"
                    >
                        {title}
                    </RNText>
                    {children}
                </View>
            ) : null}
        </View>
    );
}
