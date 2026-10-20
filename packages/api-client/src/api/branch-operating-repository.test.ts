import { KitchenBranchId } from '@healthy360/domain-types';
import { expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createTransport } from './transport.ts';

/**
 * `GET /kitchen/branch-operating` names the zone its times are read in (`meta.timezone`).
 *
 * The mapper used to write a literal 'UTC', so the Opening hours page told a Beirut kitchen its
 * hours were in UTC — three hours off — while the server held Asia/Beirut all along.
 */
it('reads the branch time zone from the reply rather than assuming UTC', async () => {
    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async () =>
            new Response(
                JSON.stringify({
                    data: [
                        {
                            id: 'row-2',
                            branch_id: 'branch-1',
                            weekday: 2,
                            is_open: true,
                            opens_at: '08:00',
                            closes_at: '23:59',
                            order_cut_off_at: null,
                        },
                    ],
                    meta: {
                        timezone: 'Asia/Beirut',
                        configured_weekdays: [2],
                        open_day_count: 1,
                        is_complete: false,
                    },
                }),
                { status: 200 },
            ),
    });

    const week = await createApiKitchenAdminReads(transport).getBranchOperating(
        KitchenBranchId.unsafe('branch-1'),
    );

    expect(week.timeZone).toBe('Asia/Beirut');
    expect(week.days[1]).toMatchObject({ weekday: 2, opensAt: '08:00', closesAt: '23:59' });
});
