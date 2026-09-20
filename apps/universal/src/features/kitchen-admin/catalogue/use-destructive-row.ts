import type { ApiFailure, LocalisedText } from '@healthy360/api-client/contracts';
import { useLocale } from '@healthy360/i18n';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import { displayName } from '../format.ts';

export interface DestructiveRow<Row> {
    /** The row the confirmation dialog is open for, or `null` while it is closed. */
    readonly target: Row | null;
    readonly ask: (row: Row) => void;
    readonly cancel: () => void;
    /** Runs the mutation for the target. `onDone` gets the row's display name once it succeeds. */
    readonly confirm: (onDone: (name: string) => void) => void;
    readonly isPending: boolean;
    readonly failure: ApiFailure | null;
}

/**
 * Ask, cancel, confirm: the archive (or retire) flow every catalogue list offers on a row.
 *
 * The dialog stays open until the server accepts, so a refusal shows in the dialog with the row
 * still named. `variables` builds the mutation's input, lock version included, because each
 * family names its id differently.
 */
export function useDestructiveRow<Row extends { readonly name: LocalisedText }, Data, Variables>(
    mutation: UseMutationResult<Data, unknown, Variables>,
    variables: (row: Row) => Variables,
): DestructiveRow<Row> {
    const { locale } = useLocale();
    const [target, setTarget] = useState<Row | null>(null);

    return {
        target,
        ask: setTarget,
        cancel: () => {
            setTarget(null);
        },
        confirm: (onDone) => {
            const row = target;
            if (row === null) return;
            mutation.mutate(variables(row), {
                onSuccess: () => {
                    setTarget(null);
                    onDone(displayName(row.name, locale).value);
                },
            });
        },
        isPending: mutation.isPending,
        failure: toFailure(mutation.error),
    };
}
