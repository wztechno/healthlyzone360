import { describe, expect, it } from 'vitest';

import { memoiseAsync } from './once.ts';

describe('memoiseAsync', () => {
    it('hands every concurrent caller the same promise and loads once', async () => {
        let loads = 0;
        const load = memoiseAsync(async () => {
            loads += 1;
            return { value: 42 };
        });

        const first = load();
        const second = load();
        expect(second).toBe(first);

        const results = await Promise.all([first, second, load()]);
        expect(loads).toBe(1);
        expect(results[0]).toBe(results[2]);
    });

    it('keeps a success: later callers get the settled value without loading again', async () => {
        let loads = 0;
        const load = memoiseAsync(async () => ++loads);

        expect(await load()).toBe(1);
        expect(await load()).toBe(1);
        expect(loads).toBe(1);
    });

    it('does not keep a rejection: concurrent callers share it, the next call retries', async () => {
        let loads = 0;
        const load = memoiseAsync(async () => {
            loads += 1;
            if (loads === 1) throw new Error('transient');
            return 'recovered';
        });

        const results = await Promise.allSettled([load(), load()]);
        expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
        expect(loads).toBe(1);

        expect(await load()).toBe('recovered');
        expect(loads).toBe(2);
    });
});
