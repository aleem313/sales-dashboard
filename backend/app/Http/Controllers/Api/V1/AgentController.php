<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\CreateAgentRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AgentController extends ApiController
{
    public function index(): JsonResponse
    {
        $agents = User::agents()
            ->with('profiles')
            ->orderBy('name')
            ->get()
            ->map(fn ($agent) => $this->formatAgent($agent));

        return $this->success($agents);
    }

    public function show(User $agent): JsonResponse
    {
        if (!$agent->isAgent()) {
            return $this->notFound('Agent not found.');
        }

        $agent->load('profiles');

        return $this->success($this->formatAgent($agent));
    }

    public function store(CreateAgentRequest $request): JsonResponse
    {
        $plainPassword = Str::random(12);

        $agent = User::create([
            'name' => $request->name,
            'email' => strtolower($request->email),
            'password' => Hash::make($plainPassword),
            'role' => 'agent',
            'active' => true,
        ]);

        return $this->created([
            'agent' => $this->formatAgent($agent),
            'credentials' => [
                'email' => $agent->email,
                'password' => $plainPassword,
            ],
        ], 'Agent created. Password shown once — save it now.');
    }

    public function toggleActive(User $agent): JsonResponse
    {
        if (!$agent->isAgent()) {
            return $this->notFound('Agent not found.');
        }

        $agent->update(['active' => !$agent->active]);

        return $this->success([
            'id' => $agent->id,
            'active' => $agent->active,
        ], $agent->active ? 'Agent activated.' : 'Agent deactivated.');
    }

    private function formatAgent(User $agent): array
    {
        return [
            'id' => $agent->id,
            'name' => $agent->name,
            'email' => $agent->email,
            'avatar_url' => $agent->avatar_url,
            'role' => $agent->role,
            'active' => $agent->active,
            'github_email' => $agent->github_email,
            'created_at' => $agent->created_at?->toISOString(),
            'profiles' => $agent->relationLoaded('profiles')
                ? $agent->profiles->map(fn ($p) => [
                    'id' => $p->id,
                    'profile_id' => $p->profile_id,
                    'profile_name' => $p->profile_name,
                    'platform' => $p->platform,
                    'stack' => $p->stack,
                    'active' => $p->active,
                ])
                : [],
        ];
    }
}
