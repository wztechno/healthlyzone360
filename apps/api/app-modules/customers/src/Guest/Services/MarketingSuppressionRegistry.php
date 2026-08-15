<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Services;

use Healthy360\Customers\Guest\Enums\SuppressionKind;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Models\MarketingSuppression;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Identity\Services\ContactValueNormaliser;

/**
 * The single write path for suppressions.
 *
 * **Two entry points because there are two moments, and one of them has no
 * plaintext.** A purge suppresses contacts it is about to delete, and at that
 * moment `contact_points.value_hash` is already the exact digest wanted — so
 * `suppressContact()` copies it across rather than re-deriving from the
 * plaintext it would otherwise have to hold on to. `suppress()` is for a value
 * arriving from outside (an unsubscribe link, an operator), where normalising
 * before hashing is the whole job.
 *
 * That the two produce identical digests is not a coincidence to be tested for
 * later: both are `ContactValueHasher` over the normalised form, which is the
 * same guarantee `ContactPointRegistry` relies on.
 *
 * **Writes are idempotent and never downgrade.** A destination already
 * suppressed by a `deletion` and then hit by an `opt_out` keeps the deletion,
 * because the sources have different lifetimes — an `opt_out` may be lifted by a
 * later opt-in and a `deletion` may not, so letting the weaker one overwrite
 * would make an erasure liftable by asking the person to subscribe again.
 */
final class MarketingSuppressionRegistry
{
    public function __construct(
        private readonly ContactValueNormaliser $normaliser,
        private readonly ContactValueHasher $hasher,
    ) {}

    /**
     * Suppress a destination we still hold the row for.
     *
     * The digest is taken from the contact point rather than recomputed: at
     * purge time the plaintext is about to be deleted, and re-deriving from it
     * would mean keeping it alive one step longer than necessary for no gain.
     */
    public function suppressContact(ContactPoint $contact, SuppressionSource $source = SuppressionSource::Deletion): MarketingSuppression
    {
        return $this->write(SuppressionKind::forChannel($contact->channel), $contact->value_hash, $source);
    }

    /**
     * Suppress a destination supplied as a value.
     *
     * @throws InvalidContactValue
     */
    public function suppress(ContactChannel $channel, string $value, SuppressionSource $source = SuppressionSource::Deletion): MarketingSuppression
    {
        $hash = $this->hasher->hash($this->normaliser->normalise($channel, $value));

        return $this->write(SuppressionKind::forChannel($channel), $hash, $source);
    }

    /**
     * Whether this destination must not be contacted.
     *
     * @throws InvalidContactValue
     */
    public function isSuppressed(ContactChannel $channel, string $value): bool
    {
        $hash = $this->hasher->hash($this->normaliser->normalise($channel, $value));

        return MarketingSuppression::query()
            ->where('kind', SuppressionKind::forChannel($channel))
            ->where('contact_hash', $hash)
            ->exists();
    }

    private function write(SuppressionKind $kind, string $hash, SuppressionSource $source): MarketingSuppression
    {
        $existing = MarketingSuppression::query()
            ->where('kind', $kind)
            ->where('contact_hash', $hash)
            ->first();

        if ($existing instanceof MarketingSuppression) {
            // Never downgraded. A deletion outranks an opt-out, permanently.
            if ($source === SuppressionSource::Deletion && $existing->source !== SuppressionSource::Deletion) {
                $existing->forceFill(['source' => $source, 'suppressed_at' => now()])->save();
            }

            return $existing;
        }

        return MarketingSuppression::query()->create([
            'kind' => $kind,
            'contact_hash' => $hash,
            'source' => $source,
            'suppressed_at' => now(),
        ]);
    }
}
