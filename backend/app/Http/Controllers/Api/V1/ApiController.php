<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

abstract class ApiController extends Controller
{
    protected function success(mixed $data = null, string $message = 'OK', int $status = 200): JsonResponse
    {
        $response = ['message' => $message];

        if ($data !== null) {
            $response['data'] = $data;
        }

        return response()->json($response, $status);
    }

    protected function created(mixed $data = null, string $message = 'Created'): JsonResponse
    {
        return $this->success($data, $message, 201);
    }

    protected function error(string $message = 'Error', int $status = 400, array $errors = []): JsonResponse
    {
        $response = ['message' => $message];

        if (!empty($errors)) {
            $response['errors'] = $errors;
        }

        return response()->json($response, $status);
    }

    protected function notFound(string $message = 'Resource not found.'): JsonResponse
    {
        return $this->error($message, 404);
    }

    protected function forbidden(string $message = 'Forbidden.'): JsonResponse
    {
        return $this->error($message, 403);
    }

    protected function paginated($query, int $perPage = 25): JsonResponse
    {
        $paginator = $query->paginate($perPage);

        return response()->json([
            'data' => $paginator->items(),
            'total' => $paginator->total(),
            'page' => $paginator->currentPage(),
            'limit' => $paginator->perPage(),
            'totalPages' => $paginator->lastPage(),
        ]);
    }
}
