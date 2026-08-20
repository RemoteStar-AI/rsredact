export class RedactError extends Error {
  constructor(message: string, readonly code: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RedactError';
  }
}

export class UnsupportedInputError extends RedactError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_INPUT');
    this.name = 'UnsupportedInputError';
  }
}

export class ProviderError extends RedactError {
  constructor(message: string, readonly provider: string, cause?: unknown) {
    super(message, 'PROVIDER_ERROR', cause);
    this.name = 'ProviderError';
  }
}

export class MissingDependencyError extends RedactError {
  constructor(pkg: string, why: string) {
    super(`${pkg} is required to ${why}. Install it with: npm i ${pkg}`, 'MISSING_DEPENDENCY');
    this.name = 'MissingDependencyError';
  }
}
