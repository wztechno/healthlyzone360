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
                className="min-h-touch flex-row items-center gap-1.5 self-start rounded-lg px-2 py-1"
            >
                <Icon name={triggerIcon} size="sm" className="text-content-secondary" />
                {triggerText === undefined ? null : (
                    <RNText className="text-sm text-content-secondary underline text-start">
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
                    className="absolute top-full z-tooltip mt-1 w-[280px] max-w-[92%] flex-col gap-2 rounded-lg border border-stroke-subtle bg-surface-raised p-3 shadow-elevation-3"
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
