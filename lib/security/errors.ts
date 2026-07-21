export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export class ConfigurationError extends ApiError {
  constructor() {
    super("server_configuration_incomplete", "Server configuration is incomplete.", 503);
    this.name = "ConfigurationError";
  }
}
