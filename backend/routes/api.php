<?php

use App\Http\Controllers\Api\V1\AgentController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ProfileController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes (v1)
|--------------------------------------------------------------------------
|
| All routes here are prefixed with /api/v1/ (configured in bootstrap/app.php).
| Group by domain: auth, agents, profiles, jobs, stats, projects, tasks, etc.
|
*/

// Health check
Route::get('/ping', fn () => response()->json(['status' => 'ok', 'timestamp' => now()->toISOString()]));

// ──────────────────────────────────────────────
// Public routes (no auth required)
// ──────────────────────────────────────────────

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
Route::get('/auth/github', [AuthController::class, 'github']);
Route::get('/auth/github/callback', [AuthController::class, 'githubCallback']);

// Public profile mapping for n8n (no auth, always fresh)
Route::get('/profiles/mapping', [ProfileController::class, 'mapping']);

// Webhook routes (token/HMAC auth, no Sanctum)
// Route::prefix('webhooks')->middleware('throttle:webhooks')->group(function () {
//     Route::post('/n8n', [N8nWebhookController::class, 'handle'])->middleware('hmac');
//     Route::post('/tasks', [TaskWebhookController::class, 'handle'])->middleware('webhook.token');
// });

// ──────────────────────────────────────────────
// Protected routes (Sanctum auth required)
// ──────────────────────────────────────────────

Route::middleware('auth:sanctum')->group(function () {
    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    // ── Admin-only routes ──
    Route::middleware('admin')->group(function () {
        // Agent management
        Route::get('/agents', [AgentController::class, 'index']);
        Route::post('/agents', [AgentController::class, 'store']);
        Route::get('/agents/{agent}', [AgentController::class, 'show']);
        Route::patch('/agents/{agent}/toggle-active', [AgentController::class, 'toggleActive']);
        Route::put('/agents/{agent}/assign-profiles', [ProfileController::class, 'assignToAgent']);

        // Profile management
        Route::get('/profiles', [ProfileController::class, 'index']);
        Route::post('/profiles', [ProfileController::class, 'store']);
        Route::patch('/profiles/{profile}/toggle-active', [ProfileController::class, 'toggleActive']);
        Route::patch('/profiles/{profile}/agent', [ProfileController::class, 'updateAgent']);
        Route::post('/profiles/sync-n8n', [ProfileController::class, 'syncN8n']);
    });

    // ── Agent+ routes (any authenticated user) ──
    // Jobs, stats, projects, tasks — to be added in M2+
});
