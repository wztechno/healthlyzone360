<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

/**
 * What a file actually is, decided from its leading bytes.
 *
 * **The client's `Content-Type` is a claim, not a fact**, and so is the
 * extension. Both are chosen by whoever is uploading, which makes them exactly
 * the wrong thing to store as "the type" of a document a reviewer will later
 * open. This class reads the first bytes and answers from the file itself.
 *
 * Deliberately **not** `finfo`/`mime_content_type`: those consult the system's
 * magic database, which differs between a developer's laptop, the CI image and
 * production, so the same upload can be accepted in one and refused in
 * another. A short table of signatures for the five formats the platform
 * accepts is smaller, deterministic and reviewable — and if a sixth format is
 * ever needed, adding it is a deliberate act rather than a side effect of a
 * base image bump.
 *
 * An unrecognised signature returns `null`, and the caller refuses the upload.
 * Failing closed matters more here than breadth: a file the platform cannot
 * identify is a file it should not be handing to a human, particularly while
 * malware scanning is still gated (INT-008).
 */
final class DocumentTypeSniffer
{
    /**
     * Bytes to read. Enough for the longest signature the table checks — the
     * ISO base-media brand sits at offset 4 and runs to 12 — with room for the
     * RIFF/WEBP pair at 0 and 8.
     */
    private const int PEEK_BYTES = 32;

    /**
     * Signatures anchored at offset zero, longest first so a prefix cannot
     * shadow a longer match.
     *
     * @var array<string, string>
     */
    private const array LEADING_SIGNATURES = [
        "\x89PNG\r\n\x1a\n" => 'image/png',
        '%PDF-' => 'application/pdf',
        "\xFF\xD8\xFF" => 'image/jpeg',
    ];

    /**
     * ISO base-media brands, read at offset 4 after the `ftyp` box tag. HEIC
     * photographs from phones arrive under several of them and they are the
     * same container.
     *
     * @var array<string, string>
     */
    private const array ISO_BRANDS = [
        'heic' => 'image/heic',
        'heix' => 'image/heic',
        'hevc' => 'image/heic',
        'heim' => 'image/heic',
        'mif1' => 'image/heic',
        'msf1' => 'image/heic',
    ];

    /**
     * The media type of the file at `$path`, or null if the bytes match
     * nothing this class recognises.
     */
    public function sniffPath(string $path): ?string
    {
        $handle = @fopen($path, 'rb');

        if ($handle === false) {
            return null;
        }

        $head = fread($handle, self::PEEK_BYTES);
        fclose($handle);

        return $head === false ? null : $this->sniff($head);
    }

    /**
     * The media type implied by a leading run of bytes.
     */
    public function sniff(string $head): ?string
    {
        foreach (self::LEADING_SIGNATURES as $signature => $mime) {
            if (str_starts_with($head, $signature)) {
                return $mime;
            }
        }

        // RIFF....WEBP — the four size bytes between the two tags are
        // deliberately not inspected; they are a length, not a signature.
        if (str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP') {
            return 'image/webp';
        }

        if (substr($head, 4, 4) === 'ftyp') {
            $brand = substr($head, 8, 4);

            return self::ISO_BRANDS[$brand] ?? null;
        }

        return null;
    }
}
