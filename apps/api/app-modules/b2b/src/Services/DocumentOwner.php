<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Models\B2bApplication;
use Healthy360\Organisations\Models\Organisation;

/**
 * Which of the three things a `kyc_documents` row belongs to.
 *
 * The database enforces "exactly one owner" with `num_nonnulls(...) = 1`. This
 * class enforces the same rule one layer up, in the type system: there is no
 * way to construct it with two owners or none, so `KycDocumentService::store()`
 * cannot be called ambiguously and never has to check.
 *
 * Three named constructors rather than a nullable triple for the same reason
 * the schema uses real foreign keys rather than an `owner_type`/`owner_id`
 * pair — the shape should make the invalid state unrepresentable rather than
 * merely rejected.
 */
final readonly class DocumentOwner
{
    private function __construct(
        public ?string $userId,
        public ?string $applicationId,
        public ?string $organisationId,
    ) {}

    /** A person's own identity document — the D2C shape (appendix D-bis #2). */
    public static function user(string $userId): self
    {
        return new self($userId, null, null);
    }

    public static function application(B2bApplication|string $application): self
    {
        return new self(null, $application instanceof B2bApplication ? (string) $application->getKey() : $application, null);
    }

    /** A provisioned corporate customer's paperwork, after approval. */
    public static function organisation(Organisation|string $organisation): self
    {
        return new self(null, null, $organisation instanceof Organisation ? (string) $organisation->getKey() : $organisation);
    }

    /**
     * The three owner columns, ready to write.
     *
     * @return array{user_id: string|null, b2b_application_id: string|null, organisation_id: string|null}
     */
    public function columns(): array
    {
        return [
            'user_id' => $this->userId,
            'b2b_application_id' => $this->applicationId,
            'organisation_id' => $this->organisationId,
        ];
    }

    /** The owner kind, for audit metadata and for the object path. */
    public function kind(): string
    {
        return match (true) {
            $this->applicationId !== null => 'b2b_application',
            $this->organisationId !== null => 'organisation',
            default => 'user',
        };
    }

    public function id(): string
    {
        return $this->applicationId ?? $this->organisationId ?? (string) $this->userId;
    }
}
