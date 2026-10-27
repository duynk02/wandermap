import { ArgumentsHost, Logger } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('exception log privacy', () => {
  it('does not log private message content, tokens, raw SQL or query parameters', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }) };
    const request = { method: 'POST', url: '/conversations?token=private-token', originalUrl: '/conversations?token=private-token', requestId: 'test-request', headers: {} };
    const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ArgumentsHost;
    try {
      new ApiExceptionFilter().catch(new Error('private message SELECT secret FROM private_data; private-token'), host);
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-token|private message|SELECT|private_data/);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, message: 'An unexpected error occurred.', requestId: 'test-request' }));
    } finally { log.mockRestore(); }
  });
});
