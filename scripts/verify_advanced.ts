
import { CrawlerServiceClient } from "@mchen-lab/service-clients";

async function run() {
    const client = new CrawlerServiceClient({ baseUrl: "http://localhost:31171" });
    const targetUrl = "http://localhost:31199";

    /*
     * Test Case 1: Advanced Fetch
     * - Execute JS (console log)
     * - Capture API (/api/data)
     * - Download Image (/image.png) and "upload" it to mock
     */
    console.log("--- Starting Advanced Verification ---");
    
    try {
        const result = await client.advancedFetch(targetUrl, {
            jsAction: "console.log('Injected JS Working');",
            apiPatterns: ["/api/"],
            imagesToDownload: [`${targetUrl}/image.png`],
            uploadConfig: {
                baseUrl: targetUrl, // Point upload to our mock for verification
                apiKey: "test-key",
                bucket: "test-bucket"
            }
        });

        console.log("Status Code:", result.statusCode);
        console.log("API Calls:", JSON.stringify(result.apiCalls, null, 2));
        console.log("Resources:", JSON.stringify(result.resources, null, 2));

        // Validation
        const apiCaptured = result.apiCalls?.some(c => c.url.includes("/api/data"));
        const imgDownloaded = result.resources?.some(r => r.originalUrl.includes("/image.png") && r.status === "success");
        const imgUploaded = result.resources?.some(r => r.uploadedUrl?.includes("uploads/test.png"));

        if (apiCaptured && imgDownloaded && imgUploaded) {
            console.log("\n✅ VERIFICATION SUCCESS: All features working.");
        } else {
            console.error("\n❌ VERIFICATION FAILED");
            if (!apiCaptured) console.error("- API Capture Failed");
            if (!imgDownloaded) console.error("- Image Download Failed");
            if (!imgUploaded) console.error("- Image Upload Failed");
            process.exit(1);
        }

    } catch (e) {
        console.error("Fetch Failed:", e);
        process.exit(1);
    }
}

run();
