<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyHmacSignature
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = config('services.n8n.webhook_secret');

        if (empty($secret)) {
            return response()->json(['message' => 'Webhook secret not configured.'], 500);
        }

        $signature = $request->header('X-Webhook-Signature')
            ?? $request->header('X-Hub-Signature-256');

        if (empty($signature)) {
            return response()->json(['message' => 'Missing webhook signature.'], 401);
        }

        $payload = $request->getContent();
        $expected = hash_hmac('sha256', $payload, $secret);

        // Support "sha256=..." prefix format
        $signature = str_replace('sha256=', '', $signature);

        if (!hash_equals($expected, $signature)) {
            return response()->json(['message' => 'Invalid webhook signature.'], 401);
        }

        return $next($request);
    }
}
