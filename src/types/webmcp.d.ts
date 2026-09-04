type WebMCPJsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

interface WebMCPToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

interface WebMCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: WebMCPJsonSchema;
  annotations?: WebMCPToolAnnotations;
  execute: (input: Record<string, unknown>) => string | Promise<string>;
}

interface RegisteredWebMCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: WebMCPJsonSchema;
  annotations?: WebMCPToolAnnotations;
}

interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

interface ModelContextGetToolOptions {
  fromOrigins?: string[];
}

interface ModelContextExecuteToolOptions {
  signal?: AbortSignal;
}

interface ModelContext {
  registerTool(
    tool: WebMCPTool,
    options?: ModelContextRegisterToolOptions,
  ): Promise<undefined>;
  getTools(options?: ModelContextGetToolOptions): Promise<RegisteredWebMCPTool[]>;
  executeTool(
    tool: RegisteredWebMCPTool,
    inputObject: Record<string, unknown>,
    options?: ModelContextExecuteToolOptions,
  ): Promise<string>;
}

interface Document {
  readonly modelContext: ModelContext;
}
