import type { KitchenOrder } from '@healthy360/api-client/contracts';

import { allDayTotals } from './kds-board.ts';
import type { KdsBoard } from './kds-board.ts';

function order(lines: readonly [string, string][]): KitchenOrder {
    return {
        lines: lines.map(([nameEn, quantity]) => ({ nameEn, nameAr: `${nameEn} ar`, quantity })),
    } as unknown as KitchenOrder;
}

function board(parts: Partial<KdsBoard>): KdsBoard {
    return { incoming: [], preparing: [], done: [], upcoming: [], ...parts };
}

describe('allDayTotals', () => {
    it('adds a dish up across Incoming and In preparation, biggest first', () => {
        const totals = allDayTotals(
            board({
                incoming: [
                    order([
                        ['Soup', '1'],
                        ['Wrap', '4'],
                    ]),
                ],
                preparing: [order([['Soup', '2']])],
            }),
        );

        expect(totals.map((line) => [line.nameEn, line.quantity])).toEqual([
            ['Wrap', 4],
            ['Soup', 3],
        ]);
    });

    it('leaves out what is cooked and what is for another day', () => {
        const totals = allDayTotals(
            board({
                done: [order([['Soup', '2']])],
                upcoming: [{ day: '2026-11-09', tickets: [order([['Wrap', '5']])] }],
            }),
        );

        expect(totals).toEqual([]);
    });
});
