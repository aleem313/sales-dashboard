<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\AssignProfilesRequest;
use App\Http\Requests\CreateProfileRequest;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ProfileController extends ApiController
{
    public function index(): JsonResponse
    {
        $profiles = Profile::with('agent:id,name,email')
            ->orderBy('profile_name')
            ->get()
            ->map(fn ($p) => $this->formatProfile($p));

        return $this->success($profiles);
    }

    public function store(CreateProfileRequest $request): JsonResponse
    {
        $profile = Profile::create($request->validated());

        // Auto-provision webhook nodes in n8n (best-effort)
        $n8nSync = $this->syncToN8n($profile->profile_name);

        return $this->created([
            'profile' => $this->formatProfile($profile),
            'n8nSync' => $n8nSync,
        ]);
    }

    public function toggleActive(Profile $profile): JsonResponse
    {
        $profile->update(['active' => !$profile->active]);

        return $this->success([
            'id' => $profile->id,
            'active' => $profile->active,
        ], $profile->active ? 'Profile activated.' : 'Profile deactivated.');
    }

    public function updateAgent(Request $request, Profile $profile): JsonResponse
    {
        $request->validate([
            'agent_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        $profile->update(['agent_id' => $request->agent_id]);

        return $this->success([
            'id' => $profile->id,
            'agent_id' => $profile->agent_id,
        ], 'Profile agent updated.');
    }

    public function assignToAgent(AssignProfilesRequest $request, User $agent): JsonResponse
    {
        if (!$agent->isAgent()) {
            return $this->notFound('Agent not found.');
        }

        $profileIds = $request->profileIds;

        // Unassign profiles currently assigned to this agent that aren't in the new list
        Profile::where('agent_id', $agent->id)
            ->whereNotIn('id', $profileIds)
            ->update(['agent_id' => null]);

        // Assign selected profiles to this agent
        Profile::whereIn('id', $profileIds)
            ->update(['agent_id' => $agent->id]);

        $agent->load('profiles');

        return $this->success([
            'agent_id' => $agent->id,
            'profiles' => $agent->profiles->map(fn ($p) => [
                'id' => $p->id,
                'profile_id' => $p->profile_id,
                'profile_name' => $p->profile_name,
            ]),
        ], 'Profiles assigned.');
    }

    /**
     * Public endpoint — n8n fetches this to get profile→agent mapping.
     * No auth required. Always fresh.
     */
    public function mapping(): JsonResponse
    {
        $profiles = Profile::with('agent:id,name')
            ->where('active', true)
            ->orderBy('profile_name')
            ->get();

        $mapping = [];
        foreach ($profiles as $p) {
            $mapping[$p->profile_name] = [
                'assigned_agent' => $p->agent?->name ?? '',
                'agent_id' => $p->agent_id ? (string) $p->agent_id : '',
                'profile_id' => $p->profile_id,
                'stack' => $p->stack ?? '',
            ];
        }

        return response()->json($mapping, 200, [
            'Cache-Control' => 'public, s-maxage=60, stale-while-revalidate=30',
        ]);
    }

    /**
     * Auto-provision webhook + respond nodes in n8n for a new profile.
     */
    public function syncN8n(Request $request): JsonResponse
    {
        $request->validate(['profileName' => ['required', 'string']]);

        $result = $this->syncToN8n($request->profileName);

        if (!$result['success']) {
            return $this->error($result['error'] ?? 'n8n sync failed.', 500);
        }

        return $this->success($result);
    }

    private function syncToN8n(string $profileName): array
    {
        $apiUrl = config('services.n8n.api_url');
        $apiKey = config('services.n8n.api_key');
        $workflowId = config('services.n8n.workflow_id', 'EWnZg3svZWwcIRs4');

        if (!$apiUrl || !$apiKey) {
            return ['success' => false, 'error' => 'N8N_API_URL and N8N_API_KEY not configured', 'webhookUrl' => ''];
        }

        $webhookPath = strtolower(str_replace(' ', '-', $profileName)) . '-profile-webhook';
        $webhookNodeName = "Webhook - {$profileName}";
        $respondNodeName = "Respond - {$profileName}";

        try {
            // Get current workflow
            $workflow = Http::withHeaders(['X-N8N-API-KEY' => $apiKey])
                ->get("{$apiUrl}/api/v1/workflows/{$workflowId}")
                ->throw()
                ->json();

            // Check if nodes already exist
            $exists = collect($workflow['nodes'])->contains('name', $webhookNodeName);
            if ($exists) {
                return [
                    'success' => true,
                    'message' => "Webhook node \"{$webhookNodeName}\" already exists",
                    'webhookUrl' => "https://ikonicdev.app.n8n.cloud/webhook/{$webhookPath}",
                    'alreadyExists' => true,
                ];
            }

            // Calculate position below last webhook
            $webhookNodes = collect($workflow['nodes'])->filter(fn ($n) => $n['type'] === 'n8n-nodes-base.webhook');
            $maxY = $webhookNodes->max(fn ($n) => $n['position'][1]) ?? 0;
            $newY = $maxY + 224;

            // Add webhook + respond nodes
            $workflow['nodes'][] = [
                'name' => $webhookNodeName,
                'type' => 'n8n-nodes-base.webhook',
                'typeVersion' => 2,
                'position' => [-1408, $newY],
                'parameters' => ['httpMethod' => 'POST', 'path' => $webhookPath, 'responseMode' => 'responseNode', 'options' => (object) []],
            ];
            $workflow['nodes'][] = [
                'name' => $respondNodeName,
                'type' => 'n8n-nodes-base.respondToWebhook',
                'typeVersion' => 1.1,
                'position' => [-1216, $newY],
                'parameters' => ['options' => (object) []],
            ];

            // Add connections
            $workflow['connections'][$webhookNodeName] = [
                'main' => [[['node' => $respondNodeName, 'type' => 'main', 'index' => 0]]],
            ];

            // Find next merge input index
            $mergeInputs = collect($workflow['connections'])
                ->flatMap(fn ($conn) => collect($conn['main'] ?? [])->flatten(1))
                ->filter(fn ($c) => ($c['node'] ?? '') === 'Merge All Webhooks')
                ->pluck('index');
            $nextIndex = $mergeInputs->isEmpty() ? 0 : $mergeInputs->max() + 1;

            $workflow['connections'][$respondNodeName] = [
                'main' => [[['node' => 'Merge All Webhooks', 'type' => 'main', 'index' => $nextIndex]]],
            ];

            // Save workflow
            Http::withHeaders(['X-N8N-API-KEY' => $apiKey])
                ->put("{$apiUrl}/api/v1/workflows/{$workflowId}", [
                    'nodes' => $workflow['nodes'],
                    'connections' => $workflow['connections'],
                    'settings' => $workflow['settings'] ?? [],
                ])
                ->throw();

            // Re-activate if it was active
            if ($workflow['active'] ?? false) {
                Http::withHeaders(['X-N8N-API-KEY' => $apiKey])
                    ->post("{$apiUrl}/api/v1/workflows/{$workflowId}/activate")
                    ->throw();
            }

            return [
                'success' => true,
                'message' => "Created webhook nodes for \"{$profileName}\"",
                'webhookUrl' => "https://ikonicdev.app.n8n.cloud/webhook/{$webhookPath}",
                'alreadyExists' => false,
            ];
        } catch (\Exception $e) {
            return ['success' => false, 'error' => $e->getMessage(), 'webhookUrl' => ''];
        }
    }

    private function formatProfile(Profile $p): array
    {
        return [
            'id' => $p->id,
            'profile_id' => $p->profile_id,
            'profile_name' => $p->profile_name,
            'platform' => $p->platform,
            'stack' => $p->stack,
            'vollna_filter_tag' => $p->vollna_filter_tag,
            'agent_id' => $p->agent_id,
            'agent_name' => $p->relationLoaded('agent') ? $p->agent?->name : null,
            'active' => $p->active,
            'created_at' => $p->created_at?->toISOString(),
        ];
    }
}
