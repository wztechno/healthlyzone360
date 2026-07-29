<?php

use Illuminate\Support\Facades\Route;

// Spike verification route (ADR-0001 modular spike). Replaced by real
// Support endpoints as the module gains functionality.
Route::get('/support/ping', fn () => response()->json(['data' => ['pong' => true]]))
    ->name('support.ping');
