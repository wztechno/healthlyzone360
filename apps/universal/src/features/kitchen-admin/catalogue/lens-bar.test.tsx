import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { LensBar } from './lens-bar.tsx';
import type { LensFigure, LensMixPart } from './lens-bar.tsx';

/**
 * The Lens bar draws what it is handed: the figures, the mix, the tokens and one Clear. Which rows
 * the figures count is the list hook's business and is tested there.
 */

function Bar({
    counts,
}: {
    readonly counts: { readonly published: number; readonly draft: number } | null;
}) {
    const [status, setStatus] = useState<'published' | 'draft' | null>(null);
    const figures: readonly LensFigure[] = [
        {
            key: 'all',
            label: 'All',
            value: counts === null ? null : counts.published + counts.draft,
            active: status === null,
            onPress: () => {
                setStatus(null);
            },
        },
        {
            key: 'draft',
            label: 'Draft',
            value: counts?.draft ?? null,
            tone: 'warning',
            alarm: false,
            active: status === 'draft',
            onPress: () => {
                setStatus('draft');
            },
        },
    ];
    const mix: readonly LensMixPart[] = [
        {
            key: 'published',
            value: counts?.published ?? 0,
            tone: 'success',
            dimmed: status === 'draft',
        },
        { key: 'draft', value: counts?.draft ?? 0, tone: 'warning' },
    ];
    return (
        <LensBar
            testID="lens"
            label="Summary and filters"
            figures={figures}
            mix={mix}
            mixLabel="mix"
            search=""
            onSearchChange={() => undefined}
            searchLabel="Search"
            tokens={
                status === null
                    ? []
                    : [
                          {
                              key: 'status',
                              label: `Status: ${status}`,
                              removeLabel: 'Remove status',
                              onRemove: () => {
                                  setStatus(null);
                              },
                          },
                      ]
            }
            result="1 of 3"
            clearLabel="Clear"
            {...(status === null
                ? {}
                : {
                      onClear: () => {
                          setStatus(null);
                      },
                  })}
        />
    );
}

describe('LensBar', () => {
    it('holds each figure’s line with a placeholder until its count lands', async () => {
        const { rerender } = await render(<Bar counts={null} />);

        expect(screen.getByTestId('lens-figure-draft-loading')).toBeTruthy();
        expect(screen.queryByTestId('lens-mix-draft')).toBeNull();

        await act(async () => {
            await rerender(<Bar counts={{ published: 2, draft: 1 }} />);
        });

        expect(screen.getByTestId('lens-figure-draft-value')).toHaveTextContent('1');
        expect(screen.getByTestId('lens-figure-all-value')).toHaveTextContent('3');
        expect(screen.getByTestId('lens-mix-published')).toBeTruthy();
        expect(screen.getByTestId('lens-mix-draft')).toBeTruthy();
    });

    it('marks the figure in force, shows its token, and lets go on Clear', async () => {
        await render(<Bar counts={{ published: 2, draft: 1 }} />);
        expect(screen.queryByTestId('lens-clear')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('lens-figure-draft'));
        });
        expect(screen.getByTestId('lens-figure-draft').props.accessibilityState).toEqual(
            expect.objectContaining({ selected: true }),
        );
        // The ✕ is the native glyph of the token's remove button.
        expect(screen.getByTestId('lens-token-status')).toHaveTextContent(/^Status: draft/);

        await act(async () => {
            fireEvent.press(screen.getByTestId('lens-clear'));
        });
        expect(screen.queryByTestId('lens-token-status')).toBeNull();
        expect(screen.getByTestId('lens-figure-all').props.accessibilityState).toEqual(
            expect.objectContaining({ selected: true }),
        );
    });
});
