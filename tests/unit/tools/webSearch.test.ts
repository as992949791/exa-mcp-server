import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySearchResponse, searchResponse } from "../../fixtures/exaResponses.js";
import { FakeMcpServer } from "../../helpers/fakeMcpServer.js";

const { ExaMock, exaConstructorMock, requestMock } = vi.hoisted(() => {
  const requestMock = vi.fn();
  const exaConstructorMock = vi.fn();
  class ExaMock {
    request = requestMock;

    constructor(...args: unknown[]) {
      exaConstructorMock(...args);
    }
  }

  return {
    ExaMock,
    exaConstructorMock,
    requestMock,
  };
});

vi.mock("exa-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("exa-js")>()),
  Exa: ExaMock,
}));

vi.mock("agnost", () => ({
  checkpoint: vi.fn(),
}));

describe("registerWebSearchTool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("sends a sanitized search request and formats highlighted results", async () => {
    const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
    const server = new FakeMcpServer();
    requestMock.mockResolvedValue(searchResponse);

    registerWebSearchTool(server as any, {
      exaApiKey: "test-key",
      defaultSearchType: "fast",
      mcpSessionId: "session-123",
    });

    const result = await server.getTool("web_search_exa").handler({
      query: "category:news AI breakthroughs",
      numResults: 2,
    });

    expect(exaConstructorMock).toHaveBeenCalledWith("test-key");
    expect(requestMock).toHaveBeenCalledWith(
      "/search",
      "POST",
      {
        query: "AI breakthroughs",
        type: "fast",
        numResults: 2,
        category: "news",
        contents: {
          highlights: true,
        },
      },
      undefined,
      { "x-exa-integration": "web-search-mcp", "x-exa-mcp-session-id": "session-123" },
    );
    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          _meta: { searchTime: 0.42 },
        },
      ],
    });
    expect((result as any).content[0].text).toContain("Title: Result One");
    expect((result as any).content[0].text).toContain("First highlight");
  });

  it("opts into dynamic highlights and preserves integration headers", async () => {
    const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
    const server = new FakeMcpServer();
    requestMock.mockResolvedValue(searchResponse);

    registerWebSearchTool(server as any, { mcpSessionId: "session-123" });
    const tool = server.getTool("web_search_exa");
    const schema = tool.inputSchema as Record<string, { parse: (value: unknown) => unknown }>;

    const result = await tool.handler({ query: "AI breakthroughs", dynamicHighlights: true });

    expect(requestMock).toHaveBeenCalledWith(
      "/search",
      "POST",
      expect.objectContaining({ contents: { highlights: { dynamic: true } } }),
      undefined,
      {
        "x-exa-integration": "web-search-mcp",
        "x-exa-mcp-session-id": "session-123",
        "Exa-Beta": "dynamic-highlights-2026-08-28",
      },
    );
    expect(schema.dynamicHighlights).toBeDefined();
    expect(schema.dynamicHighlights.parse(true)).toBe(true);
    expect((result as any).content[0].text).toContain("First highlight");
  });

  it.each([undefined, false])(
    "keeps standard highlights when dynamicHighlights is %s",
    async (dynamicHighlights) => {
      const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
      const server = new FakeMcpServer();
      requestMock.mockResolvedValue(searchResponse);
      registerWebSearchTool(server as any);

      await server
        .getTool("web_search_exa")
        .handler({ query: "AI breakthroughs", dynamicHighlights });

      expect(requestMock).toHaveBeenCalledWith(
        "/search",
        "POST",
        expect.objectContaining({ contents: { highlights: true } }),
        undefined,
        { "x-exa-integration": "web-search-mcp" },
      );
    },
  );

  it("uses an instant default search type when configured", async () => {
    const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
    const server = new FakeMcpServer();
    requestMock.mockResolvedValue(searchResponse);

    registerWebSearchTool(server as any, {
      defaultSearchType: "instant",
    });

    await server.getTool("web_search_exa").handler({
      query: "AI breakthroughs",
    });

    expect(requestMock).toHaveBeenCalledWith(
      "/search",
      "POST",
      expect.objectContaining({
        type: "instant",
      }),
      undefined,
      expect.any(Object),
    );
  });

  it("returns a friendly message when Exa has no results", async () => {
    const { registerWebSearchTool } = await import("../../../src/tools/webSearch.js");
    const server = new FakeMcpServer();
    requestMock.mockResolvedValue(emptySearchResponse);

    registerWebSearchTool(server as any);

    await expect(
      server.getTool("web_search_exa").handler({
        query: "nothing",
      }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "No search results found. Please try a different query." }],
    });
  });
});
