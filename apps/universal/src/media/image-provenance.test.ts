import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * The gate that turns "every ingredient and recipe has an image" from a claim into a check.
 *
 * Four different things can go wrong here and only one of them is visible on disk, which is why
 * this file exists beside `image-manifest.test.tsx` rather than inside it:
 *
 * 1. **A record silently has no photograph.** A disk-only check passes vacuously for a record that
 *    was never sourced — there is no file, so there is nothing to find missing. The inventory is
 *    what makes the absence detectable, so the central assertion is that every record it lists is
 *    either imaged or explicitly blocked, and never neither.
 * 2. **A licence is not one we may ship.** Unknown is rejected rather than assumed, and the
 *    Unsplash License is admitted only for the hundred files that predate the policy.
 * 3. **A credit that a licence obliges is incomplete.** CC BY and CC BY-SA need a creator, the
 *    licence, a link to the source and a statement that the work was modified. Half a credit is
 *    not compliance, so all four are asserted together.
 * 4. **An image is reused, or an output file has rotted.** Two records sharing a source file or
 *    the same bytes is the defect this whole exercise removes, and a recorded output hash is what
 *    catches a truncated or hand-edited file that still has the right name.
 */

const imagesRoot = join(__dirname, '..', '..', 'assets', 'images');

interface Output {
    readonly file: string;
    readonly sha256: string;
    readonly bytes: number;
}

interface ProvenanceEntry {
    readonly record_ref: string | null;
    readonly source_title: string;
    readonly source_url: string;
    readonly creator: string;
    readonly licence: string;
    readonly licence_url: string;
    readonly attribution_required: boolean;
    readonly modifications: string;
    readonly content_sha256?: string;
    readonly legacy?: boolean;
    readonly outputs: Record<string, Output>;
    readonly review?: { readonly verdict?: string };
}

interface Provenance {
    readonly licence_policy: { readonly allowed: string[]; readonly legacy: string[] };
    readonly images: Record<string, ProvenanceEntry>;
    readonly blocked: { readonly record_ref: string; readonly reason: string }[];
}

interface InventoryRecord {
    readonly ref: string;
    readonly kind: string;
    readonly slug: string;
    readonly family: string;
}

const provenance = JSON.parse(
    readFileSync(join(imagesRoot, 'provenance.json'), 'utf8'),
) as Provenance;

const inventory = (
    JSON.parse(readFileSync(join(imagesRoot, 'image-inventory.json'), 'utf8')) as {
        records: InventoryRecord[];
    }
).records;

const entries = Object.values(provenance.images);

function webpFilesOnDisk(): string[] {
    const files: string[] = [];
    for (const family of readdirSync(imagesRoot)) {
        const dir = join(imagesRoot, family);
        if (!statSync(dir).isDirectory()) continue;
        for (const file of readdirSync(dir)) {
            if (file.endsWith('.webp')) files.push(`${family}/${file}`);
        }
    }
    return files.sort();
}

describe('image provenance', () => {
    it('accounts for every record in the inventory — imaged or explicitly blocked', () => {
        const imaged = new Set(entries.map((entry) => entry.record_ref).filter(Boolean));
        const blocked = new Set(provenance.blocked.map((entry) => entry.record_ref));

        const unaccounted = inventory
            .filter((record) => !imaged.has(record.ref) && !blocked.has(record.ref))
            .map((record) => record.ref);

        expect(unaccounted).toEqual([]);
    });

    it('never counts a blocked record as imaged', () => {
        const imaged = new Set(entries.map((entry) => entry.record_ref).filter(Boolean));
        const both = provenance.blocked
            .map((entry) => entry.record_ref)
            .filter((ref) => imaged.has(ref));

        expect(both).toEqual([]);
    });

    it('has a provenance entry for every WebP on disk, and a file for every entry', () => {
        const declared = entries
            .flatMap((entry) => Object.values(entry.outputs).map((output) => output.file))
            .sort();

        expect(declared).toEqual(webpFilesOnDisk());
    });

    it('ships only licences on the allowlist, and Unsplash only where grandfathered', () => {
        const allowed = new Set(provenance.licence_policy.allowed);
        const legacy = new Set(provenance.licence_policy.legacy);

        for (const [key, entry] of Object.entries(provenance.images)) {
            if (entry.legacy === true) {
                expect(legacy).toContain(entry.licence);
                continue;
            }
            expect({ key, licence: entry.licence }).toEqual({
                key,
                licence: expect.stringMatching(
                    new RegExp(`^(${[...allowed].join('|').replace(/\./g, '\\.')})$`),
                ),
            });
        }
    });

    it('can fully attribute every image whose licence demands it', () => {
        for (const [key, entry] of Object.entries(provenance.images)) {
            if (!entry.attribution_required) continue;

            // All four, together: a credit missing any one of them does not satisfy CC BY.
            expect({
                key,
                creator: entry.creator !== '',
                licenceUrl: entry.licence_url !== '',
                sourceUrl: entry.source_url !== '',
                modifications: entry.modifications !== '',
            }).toEqual({
                key,
                creator: true,
                licenceUrl: true,
                sourceUrl: true,
                modifications: true,
            });
        }
    });

    it('gives every record its own photograph — no source and no bytes reused', () => {
        const bySource = new Map<string, string>();
        const byHash = new Map<string, string>();

        for (const [key, entry] of Object.entries(provenance.images)) {
            const source = entry.source_title;
            expect({ key, source, clashesWith: bySource.get(source) ?? null }).toEqual({
                key,
                source,
                clashesWith: null,
            });
            bySource.set(source, key);

            const hash = entry.content_sha256;
            if (hash === undefined) continue;
            expect({ key, clashesWith: byHash.get(hash) ?? null }).toEqual({
                key,
                clashesWith: null,
            });
            byHash.set(hash, key);
        }
    });

    it('matches every output file against its recorded hash', () => {
        for (const [key, entry] of Object.entries(provenance.images)) {
            for (const output of Object.values(entry.outputs)) {
                const actual = createHash('sha256')
                    .update(readFileSync(join(imagesRoot, output.file)))
                    .digest('hex');

                expect({ key, file: output.file, sha256: actual }).toEqual({
                    key,
                    file: output.file,
                    sha256: output.sha256,
                });
            }
        }
    });

    it('names the library every image came through', () => {
        // A credit reading "via Wikimedia Commons" under a Flickr photograph would be a false
        // attribution, so the library is recorded per image rather than assumed.
        const unnamed = Object.entries(provenance.images)
            .filter(([, entry]) => !(entry as { provider?: string }).provider)
            .map(([key]) => key);

        expect(unnamed).toEqual([]);
    });

    it('verified every Openverse licence on the photograph’s own page', () => {
        // Openverse relays a licence recorded when it indexed the photograph. The brief asks for
        // each licence to be verified at its source, so anything that did not come straight from
        // Commons must carry the evidence found on the publisher's page.
        const unverified = Object.entries(provenance.images)
            .filter(([, entry]) => entry.legacy !== true)
            .filter(([, entry]) => (entry as { provider?: string }).provider !== 'wikimedia')
            .filter(([, entry]) => {
                const atSource = (entry as { verified?: { at_source?: { evidence?: string } } })
                    .verified?.at_source;
                return !atSource?.evidence;
            })
            .map(([key]) => key);

        expect(unverified).toEqual([]);
    });

    it('has a human verdict on every newly sourced image', () => {
        const unreviewed = Object.entries(provenance.images)
            .filter(([, entry]) => entry.legacy !== true)
            .filter(([, entry]) => entry.review?.verdict !== 'accepted')
            .map(([key]) => key);

        expect(unreviewed).toEqual([]);
    });
});
