import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, mapError, mapResult, ok, unwrap, unwrapOr } from './result.ts';
import type { Result } from './result.ts';

describe('Result', () => {
    it('constructs Ok and Err with discriminating tags', () => {
        expect(ok(1)).toEqual({ ok: true, value: 1 });
        expect(err('boom')).toEqual({ ok: false, error: 'boom' });
    });

    it('narrows via isOk / isErr', () => {
        const value: Result<number, string> = ok(3);
        if (isOk(value)) {
            expect(value.value + 1).toBe(4);
        } else {
            throw new Error('expected Ok');
        }
        expect(isErr(value)).toBe(false);
    });

    it('maps the success channel only', () => {
        expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
        expect(mapResult(err<string>('nope'), (n: number) => n * 3)).toEqual(err('nope'));
    });

    it('maps the error channel only', () => {
        expect(mapError(err('nope'), (e) => e.toUpperCase())).toEqual(err('NOPE'));
        expect(mapError(ok(2), (e: string) => e.toUpperCase())).toEqual(ok(2));
    });

    it('unwrapOr falls back on Err', () => {
        expect(unwrapOr(ok(5), 0)).toBe(5);
        expect(unwrapOr(err<string>('nope'), 0)).toBe(0);
    });

    it('unwrap rethrows Error instances and wraps everything else', () => {
        const cause = new Error('original');
        expect(() => unwrap(err(cause))).toThrow(cause);
        expect(() => unwrap(err({ code: 'x' }))).toThrow(/Attempted to unwrap an Err result/);
        expect(unwrap(ok('fine'))).toBe('fine');
    });
});
