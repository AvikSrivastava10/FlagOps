import { errorHttpStatus, FlagOpsError, type ErrorBody, type ErrorCode } from '@flagops/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export function errorBody(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

function isClientError(error: FastifyError): boolean {
  return error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500;
}

/**
 * Turns every error that reaches Fastify into the documented error body (architecture.md 15 and
 * 18.1). Only errors FlagOps did not expect are logged here, with their stack; the code that raises
 * a FlagOpsError logs it at the level its operation calls for (18.2).
 */
export function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof FlagOpsError) {
    return reply.status(error.httpStatus).send(errorBody(error.code, error.message, error.details));
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = error.validation.map((issue) => ({
      location: error.validationContext,
      path: issue.instancePath,
      message: issue.message,
    }));
    return reply
      .status(errorHttpStatus.validation_failed)
      .send(
        errorBody('validation_failed', 'The request is invalid; see details.issues', { issues }),
      );
  }
  if (isClientError(error)) {
    // Fastify's own request errors: malformed JSON, a body over the limit, an unsupported media type.
    return reply
      .status(errorHttpStatus.validation_failed)
      .send(errorBody('validation_failed', error.message));
  }
  request.log.error({ err: error }, 'Request failed with an unexpected error');
  return reply
    .status(errorHttpStatus.internal_error)
    .send(
      errorBody(
        'internal_error',
        `FlagOps hit an unexpected error. Quote request ${request.id} when you report it.`,
        { requestId: request.id },
      ),
    );
}
