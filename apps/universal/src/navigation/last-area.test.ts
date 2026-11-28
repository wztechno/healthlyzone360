import { readLastArea, rememberLastArea } from './last-area.ts';

describe('last area', () => {
    const values = new Map<string, string>();

    beforeAll(() => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
            },
        });
    });

    beforeEach(() => {
        values.clear();
    });

    it('has nothing before an area is opened', () => {
        expect(readLastArea()).toBeNull();
    });

    it('remembers the area and when', () => {
        rememberLastArea('kds', new Date('2026-11-08T10:00:00.000Z'));

        expect(readLastArea()).toEqual({ area: 'kds', at: '2026-11-08T10:00:00.000Z' });
    });

    it('treats an unreadable value as nothing', () => {
        values.set('h360.last-area', 'not json');

        expect(readLastArea()).toBeNull();
    });
});
