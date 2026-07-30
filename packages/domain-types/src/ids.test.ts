import { describe, expect, it } from 'vitest';

import {
    BranchId,
    ID_CODECS,
    InvalidIdentifierError,
    OrganisationId,
    UUID_PATTERN,
    UserId,
    isUuid,
    uuidVersion,
} from './ids.ts';

const UUID_V7 = '01935f6c-1a2b-7c3d-8e4f-0123456789ab';
const UUID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('isUuid', () => {
    it.each([UUID_V7, UUID_V4, UUID_V7.toUpperCase()])('accepts %s', (value) => {
        expect(isUuid(value)).toBe(true);
    });

    it.each([
        ['empty string', ''],
        ['missing hyphens', '01935f6c1a2b7c3d8e4f0123456789ab'],
        ['too short', '01935f6c-1a2b-7c3d-8e4f-0123456789a'],
        ['nil uuid (version nibble 0)', '00000000-0000-0000-0000-000000000000'],
        ['bad variant nibble', '01935f6c-1a2b-7c3d-0e4f-0123456789ab'],
        ['non-hex characters', '01935f6c-1a2b-7c3d-8e4f-0123456789zz'],
    ])('rejects %s', (_label, value) => {
        expect(isUuid(value)).toBe(false);
    });

    it.each([[null], [undefined], [42], [{}], [[UUID_V7]]])('rejects non-string %s', (value) => {
        expect(isUuid(value)).toBe(false);
    });
});

describe('uuidVersion', () => {
    it('reads the version nibble', () => {
        expect(uuidVersion(UUID_V7)).toBe(7);
        expect(uuidVersion(UUID_V4)).toBe(4);
    });

    it('returns null for malformed input', () => {
        expect(uuidVersion('not-a-uuid')).toBeNull();
    });
});

describe('identifier codecs', () => {
    it('exposes one codec per foundation identifier', () => {
        expect(Object.keys(ID_CODECS).sort()).toEqual([
            'BranchId',
            'DeviceId',
            'MembershipId',
            'OrganisationId',
            'RoleId',
            'UserId',
        ]);
    });

    it.each(Object.entries(ID_CODECS))('%s.parse brands a valid uuid', (label, codec) => {
        expect(codec.label).toBe(label);
        expect(codec.parse(UUID_V7)).toBe(UUID_V7);
        expect(codec.is(UUID_V7)).toBe(true);
    });

    it.each(Object.entries(ID_CODECS))('%s.parse throws on invalid input', (label, codec) => {
        expect(() => codec.parse('nope')).toThrow(InvalidIdentifierError);
        try {
            codec.parse('nope');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidIdentifierError);
            expect((error as InvalidIdentifierError).label).toBe(label);
            expect((error as InvalidIdentifierError).received).toBe('nope');
            expect((error as Error).message).toContain(label);
        }
    });

    it('safeParse returns null instead of throwing', () => {
        expect(UserId.safeParse('nope')).toBeNull();
        expect(UserId.safeParse(UUID_V7)).toBe(UUID_V7);
    });

    it('unsafe brands without validating (fixtures only)', () => {
        expect(UserId.unsafe('fixture-user')).toBe('fixture-user');
    });

    it('keeps distinct identifier types nominally separate', () => {
        const organisation = OrganisationId.parse(UUID_V7);
        const branch = BranchId.parse(UUID_V7);

        // Compile-time proof: assigning across brands is rejected. Runtime values are equal strings.
        // @ts-expect-error branded identifiers are not interchangeable
        const misassigned: OrganisationId = branch;

        expect(misassigned).toBe(organisation);
    });
});

describe('UUID_PATTERN', () => {
    it('is case-insensitive and anchored', () => {
        expect(UUID_PATTERN.flags).toContain('i');
        expect(UUID_PATTERN.test(` ${UUID_V7}`)).toBe(false);
        expect(UUID_PATTERN.test(`${UUID_V7} `)).toBe(false);
    });
});
