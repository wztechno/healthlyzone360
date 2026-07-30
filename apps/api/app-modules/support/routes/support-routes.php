<?php

declare(strict_types=1);

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Support\Facades\Route;

/*
 * Spike verification route (ADR-0001 modular spike): proof that a module can
 * contribute routes, including through a cached route table.
 *
 * Outside /api/v1 and therefore outside the OpenAPI contract, but it answers
 * in the standard envelope anyway so there is no second response shape in
 * the codebase for anyone to copy.
 */
Route::get('/support/ping', fn () => ApiResponse::data(['pong' => true]))
    ->name('support.ping');
