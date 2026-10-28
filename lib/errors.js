// Two error kinds, so nothing upstream ever reaches a browser by accident.
//   UserFacingError  our own message, written to be shown to the user
//   UpstreamError    YouTube / Groq / network; `detail` is for server logs only
// toClientError() is the single place an error becomes something a client may see.

export class UserFacingError extends Error {
  constructor(message, code = 'INVALID_INPUT', status = 400) {
    super(message);
    this.name = 'UserFacingError';
    this.code = code;
    this.status = status;
  }
}

export class UpstreamError extends Error {
  constructor(service, status, detail = '') {
    super(`${service} request failed (${status})`);
    this.name = 'UpstreamError';
    this.service = service;
    this.upstreamStatus = status;
    this.detail = String(detail).slice(0, 500);
  }
}

export function toClientError(err) {
  if (err instanceof UserFacingError) return { code: err.code, message: err.message };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { code: 'TIMEOUT', message: 'That took too long. Try again in a moment.' };
  }
  if (err instanceof UpstreamError) {
    if (err.service === 'youtube' && err.upstreamStatus === 403) {
      return { code: 'UPSTREAM_BUSY', message: 'YouTube is limiting requests right now. Try again shortly.' };
    }
    if (err.service === 'youtube' && err.upstreamStatus === 404) {
      return { code: 'NOT_FOUND', message: 'YouTube could not find that channel.' };
    }
    if (err.service === 'ai') {
      return { code: 'AI_UNAVAILABLE', message: 'The analysis service is busy. Try again in a moment.' };
    }
  }
  return { code: 'ANALYSIS_FAILED', message: 'Analysis failed. Try again.' };
}
