import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message: string | string[] = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const responseBody = body as { message?: string | string[]; error?: string; code?: string };
        message = responseBody.message ?? exception.message;
        code = responseBody.code ?? (responseBody.error ? responseBody.error.toUpperCase().replaceAll(' ', '_') : this.codeForStatus(status));
      }
    } else {
      const dbError = exception as { code?: string; constraint?: string };
      if (dbError?.code === '23505') { status = HttpStatus.CONFLICT; code = 'DUPLICATE_RESOURCE'; message = 'A resource with these details already exists.'; }
      else if (dbError?.code === '23503') { status = HttpStatus.BAD_REQUEST; code = 'INVALID_REFERENCE'; message = 'A referenced resource does not exist or cannot be deleted.'; }
      else if (dbError?.code === '23514' || dbError?.code === '23502' || dbError?.code === '22P02' || dbError?.code === '22007' || dbError?.code === '22001') { status = HttpStatus.BAD_REQUEST; code = 'INVALID_DATA'; message = 'The provided data is invalid.'; }
      else this.logger.error(`Unhandled exception for ${request.method} ${request.url}`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: request.requestId ?? request.headers['x-request-id'] ?? undefined,
    });
  }

  private codeForStatus(status: number) {
    const names: Record<number, string> = {
      400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
      409: 'CONFLICT', 422: 'UNPROCESSABLE_ENTITY', 429: 'TOO_MANY_REQUESTS',
    };
    return names[status] ?? 'HTTP_ERROR';
  }
}
