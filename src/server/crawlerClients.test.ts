import { describe, it, expect, vi, beforeEach } from "vitest";
import { FastCrawler, BrowserCrawler } from "./crawlerClients";
import { HttpCrawler, PuppeteerCrawler, Configuration } from "crawlee";

// Mock crawlee
vi.mock("crawlee", async () => {
  const actual = await vi.importActual("crawlee");
  return {
    ...actual as any,
    HttpCrawler: vi.fn(),
    PuppeteerCrawler: vi.fn(),
    Configuration: vi.fn().mockImplementation(() => ({})),
  };
});

// Mock puppeteer
vi.mock("puppeteer", () => ({
  default: {
    connect: vi.fn(),
    launch: vi.fn(),
    executablePath: vi.fn(),
    defaultArgs: vi.fn(),
  },
}));

describe("FastCrawler", () => {
  it("should be instantiable", () => {
    const crawler = new FastCrawler();
    expect(crawler).toBeDefined();
  });

  it("should call crawler.run with the provided URL", async () => {
    let capturedRun: any;
    (HttpCrawler as any).mockImplementation((options: any) => {
      const mockRun = vi.fn().mockImplementation(async () => {
        // Simulate successful request handling
        await options.requestHandler({
          body: Buffer.from("<html><body>Test</body></html>"),
          response: {
            statusCode: 200,
            headers: { "content-type": "text/html" },
            url: "http://example.com",
          },
          request: { url: "http://example.com" },
        } as any);
      });
      capturedRun = mockRun;
      return { run: mockRun };
    });

    const crawler = new FastCrawler();
    const result = await crawler.fetch("http://example.com");

    expect(capturedRun).toHaveBeenCalledWith([{
      url: "http://example.com",
      headers: {},
    }]);
    expect(result.content).toContain("Test");
    expect(result.statusCode).toBe(200);
  });

  it("should throw if crawler results in error", async () => {
    (HttpCrawler as any).mockImplementation((options: any) => {
      const mockRun = vi.fn().mockImplementation(async () => {
        await options.failedRequestHandler({
          error: new Error("Crawler failed"),
        } as any);
      });
      return { run: mockRun };
    });

    const crawler = new FastCrawler();
    await expect(crawler.fetch("http://example.com")).rejects.toThrow("Crawler failed");
  });
});

describe("BrowserCrawler", () => {
  it("should be instantiable", () => {
    const crawler = new BrowserCrawler("ws://browserless:3000");
    expect(crawler).toBeDefined();
  });

  it("should call crawler.run with the provided URL", async () => {
    let capturedRun: any;
    (PuppeteerCrawler as any).mockImplementation((options: any) => {
      const mockRun = vi.fn().mockImplementation(async () => {
        // Simulate successful request handling
        await options.requestHandler({
          page: {
            content: vi.fn().mockResolvedValue("<html><body>Browser Test</body></html>"),
            url: vi.fn().mockReturnValue("http://example.com"),
          },
          response: {
            headers: vi.fn().mockReturnValue({ "content-type": "text/html" }),
            status: vi.fn().mockReturnValue(200),
          },
          request: { url: "http://example.com" },
        } as any);
      });
      capturedRun = mockRun;
      return { run: mockRun };
    });

    const crawler = new BrowserCrawler("ws://browserless:3000");
    const result = await crawler.fetch("http://example.com");

    expect(capturedRun).toHaveBeenCalledWith([{
      url: "http://example.com",
      headers: {},
    }]);
    expect(result.content).toContain("Browser Test");
    expect(result.statusCode).toBe(200);
  });
});
