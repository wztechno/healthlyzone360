import { Button, Card, Inline, Stack, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The chrome every ordered-row editor in this workspace shares.
 *
 * Recipe lines, recipe outputs, recipe steps, product pack variants and meal availability days are
 * five different things that are edited in exactly one way: a list of cards, each with a position, a
 * pair of move buttons, a remove control, an undo for the last removal and a live region that says
 * where a row landed. Extracted here so there is one definition of that behaviour rather than five —
 * the recipe module (K1.2) already argued the case in prose, and K1.4 is the slice that would have
 * made it a copy.
 *
 * The three rules the shell exists to hold:
 *
 * 1. **Keys are stable and are never the array index.** A row keeps its identity across a move, a
 *    removal and an undo, so React keeps its input state and a screen reader keeps its focus. The
 *    *position* a person reads is computed from the row's place in the current array, never from a
 *    key or a stored ordinal.
 * 2. **Reordering is two buttons and an announcement, not a drag.** The design system has no
 *    accessible drag-and-drop, and inventing one would exclude every keyboard and screen-reader user
 *    from the operation these editors exist for. {@link RowAnnouncer} says where the row landed,
 *    because a silent reorder is invisible to somebody who cannot see the list jump.
 * 3. **Removal is immediate and reversible.** No confirmation dialog — a row is cheap to retype and
 *    a modal on every removal makes a six-row form unbearable. {@link UndoBar} appears instead, and
 *    the caller restores the row *to its old position* rather than appending it, which is the
 *    difference between an undo and a re-add.
 */

export interface RowShellProps {
    readonly testID: string;
    /** What this row is called, already numbered by the caller — "Line 3", "Pack 1". */
    readonly title: string;
    /** 1-based position in the list as it currently stands. */
    readonly position: number;
    readonly total: number;
    readonly canManage: boolean;
    /**
     * Called with the destination **index**, so `position - 2` is up and `position` is down.
     *
     * Omit it for a list whose array order carries no meaning — a meal's availability days are keyed
     * by calendar date, and a Move up button on a Tuesday would offer to reorder something that is
     * already ordered by what it is. The buttons then do not render at all rather than rendering
     * disabled, because a permanently disabled control is furniture.
     */
    readonly onMove?: ((to: number) => void) | undefined;
    readonly onRemove: () => void;
    readonly badge?: ReactNode | undefined;
    readonly children: ReactNode;
}

export function RowShell({
    testID,
    title,
    position,
    total,
    canManage,
    onMove,
    onRemove,
    badge,
    children,
}: RowShellProps) {
    const { t } = useTranslation();

    return (
        <Card testID={testID} padding="sm">
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Inline space="sm" align="center" wrap>
                        <Text variant="label" testID={`${testID}-position`}>
                            {title}
                        </Text>
                        {badge}
                    </Inline>

                    {canManage ? (
                        <Inline space="xs" wrap justify="end">
                            {onMove === undefined ? null : (
                                <>
                                    <Button
                                        testID={`${testID}-move-up`}
                                        size="sm"
                                        variant="ghost"
                                        label={t('kitchen:rows.moveUp')}
                                        disabled={position <= 1}
                                        onPress={() => {
                                            onMove(position - 2);
                                        }}
                                    />
                                    <Button
                                        testID={`${testID}-move-down`}
                                        size="sm"
                                        variant="ghost"
                                        label={t('kitchen:rows.moveDown')}
                                        disabled={position >= total}
                                        onPress={() => {
                                            onMove(position);
                                        }}
                                    />
                                </>
                            )}
                            <Button
                                testID={`${testID}-remove`}
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:rows.remove')}
                                onPress={onRemove}
                            />
                        </Inline>
                    ) : null}
                </Inline>

                {children}
            </Stack>
        </Card>
    );
}

/** The live region every row editor announces moves through. Polite: a move is not an emergency. */
export function RowAnnouncer({
    message,
    testID,
}: {
    readonly message: string;
    readonly testID: string;
}) {
    return (
        <Text testID={testID} role="status" aria-live="polite" variant="caption" tone="secondary">
            {message}
        </Text>
    );
}

export interface UndoBarProps {
    /** What was removed, already worded by the caller — the row's own name is in it. */
    readonly label: string;
    readonly onUndo: () => void;
    readonly testID: string;
}

export function UndoBar({ label, onUndo, testID }: UndoBarProps) {
    const { t } = useTranslation();

    return (
        <Inline space="sm" align="center" wrap>
            <Text testID={`${testID}-removed`} variant="caption">
                {label}
            </Text>
            <Button
                testID={`${testID}-undo`}
                size="sm"
                variant="ghost"
                label={t('kitchen:common.undo')}
                onPress={onUndo}
            />
        </Inline>
    );
}
