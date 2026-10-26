import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { showFloatingLabel } from '../actions/floating-label.ts';
import type { FloatingLabel } from '../actions/floating-label.ts';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { KEYS, keyDownProps } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';

export interface InfoTipProps {
    /** What the tip is about — a field's label, a section's title. Named in the trigger's label. */
    readonly label: string;
    /** The sentence itself. One or two short lines; anything longer is a page, not a tip. */
    readonly text: string;
    /**
     * The glyph. The circled `i` by default; a mark that *is* the fact — the recipe editor's lock
     * for "kitchen only" — can stand in for it, with the sentence behind it all the same.
     */
    readonly icon?: IconName | undefined;
    readonly testID?: string | undefined;
}

/**
 * Info tip — a small (i) beside a label that shows a sentence of guidance on hover, focus or press.
 *
 * ## Why guidance lives here and not on the page
 *
 * A hint drawn as a line of text between a label and its control makes that field one line taller
 * than its neighbours, so a row of fields stops lining up; and a page of such lines reads as fine
 * print rather than as a form. The guidance a field genuinely needs is kept, behind this glyph, and
 * takes no room until somebody asks for it. `FormField` draws its `hint` this way and `FormSection`
 * its `description`, so a caller passes text and never places the tip itself.
 *
 * ## Small, deliberately
 *
 * `Popover` is the panel for content with a heading and controls, and its trigger is a 44px target:
 * on a label row that would make the label taller than the hint it replaced. This is a 14px glyph
 * with a hit slop, sitting on the label's own line.
 *
 * ## The bubble
 *
 * On the web the sentence is drawn on `document.body` by `showFloatingLabel` — the icon buttons'
 * hover label, in its wrapping form — because a child of the field is clipped by every scroll port
 * and card above it. Natively it is an in-tree bubble under the glyph. Either way it is decoration:
 * the trigger carries the sentence as its accessible hint and points `aria-describedby` at a hidden
 * copy, so a screen reader hears it without the bubble.
 *
 * Hover opens it for a mouse, focus for a keyboard, and a press toggles it — the only way in on a
 * touch screen. Escape, blur and a press elsewhere close it.
 */
export function InfoTip({ label, text, icon = 'infoCircle', testID }: InfoTipProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `info-tip-${generated.replace(/:/g, '')}`;
    const textId = `${base}-text`;
    const name = t('designSystem:infoTip.label', { label });

    const [open, setOpen] = useState(false);
    const floating = useRef<FloatingLabel | null>(null);
    const target = useRef<unknown>(null);
    const containerRef = useRef<View | null>(null);

    const hide = useCallback(() => {
        floating.current?.hide();
        floating.current = null;
        setOpen(false);
    }, []);

    const show = useCallback(
        (from: unknown) => {
            if (Platform.OS === 'web') {
                floating.current?.hide();
                floating.current = showFloatingLabel(
                    from ?? target.current,
                    text,
                    `${base}-bubble`,
                    'below',
                    { wrap: true },
                );
            }
            setOpen(true);
        },
        [base, text],
    );

    // Gone on unmount, and with Escape from anywhere while it is showing.
    useEffect(() => hide, [hide]);
    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === KEYS.escape) hide();
        };
        // A press elsewhere closes it; a press on the glyph is the trigger's own business.
        const onPointerDown = (event: Event) => {
            const node = containerRef.current as unknown as {
                readonly contains?: (other: unknown) => boolean;
            } | null;
            if (node?.contains?.(event.target) === true) return;
            hide();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open, hide]);

    const currentTarget = (event: unknown) =>
        (event as { currentTarget?: unknown } | null)?.currentTarget ?? null;

    return (
        <View ref={containerRef} testID={testID} className="relative z-auto">
            <Pressable
                testID={`${base}-trigger`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={name}
                aria-label={name}
                accessibilityHint={text}
                aria-describedby={textId}
                aria-expanded={open}
                hitSlop={8}
                {...keyDownProps((event: WebKeyEvent) => {
                    if (event.key === KEYS.escape && open) {
                        event.preventDefault();
                        hide();
                    }
                })}
                onHoverIn={(event) => {
                    target.current = currentTarget(event);
                    show(target.current);
                }}
                onHoverOut={hide}
                onFocus={(event) => {
                    target.current = currentTarget(event);
                    show(target.current);
                }}
                onBlur={hide}
                onPress={(event) => {
                    // A mouse has already opened it by hovering, so a click keeps it open rather
                    // than toggling it shut under the pointer. Natively a press is the only way
                    // in, so it toggles.
                    if (open) {
                        if (Platform.OS !== 'web') hide();
                        return;
                    }
                    target.current = currentTarget(event);
                    show(target.current);
                }}
                className="items-center justify-center rounded-full"
            >
                {/* The drawn circle, not `info`: that one is the font's ⓘ, soft at 14px. */}
                <Icon name={icon} size="sm" className="text-content-secondary" />
            </Pressable>

            {/* What `aria-describedby` points at: present, unseen, never a second announcement. */}
            <RNText nativeID={textId} className="absolute h-px w-px overflow-hidden opacity-0">
                {text}
            </RNText>

            {open && Platform.OS !== 'web' ? (
                <View
                    testID={`${base}-bubble`}
                    aria-hidden
                    style={{ pointerEvents: 'none' }}
                    className="absolute top-full z-tooltip mt-1 w-[240px] rounded-sm bg-surface-brand px-2 py-1"
                >
                    <RNText className="text-role-caption text-content-on-brand text-start">
                        {text}
                    </RNText>
                </View>
            ) : null}
        </View>
    );
}
