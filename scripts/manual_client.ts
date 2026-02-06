
import axios from "axios";

// Inline Types
interface AdvancedFetchOptions {
  proxy?: string;
  headers?: Record<string, string>;
  preset?: "chrome";
  jsAction?: string; 
  apiPatterns?: string[]; 
  imagesToDownload?: string[]; 
  uploadConfig?: {
    baseUrl: string;
    apiKey: string;
    bucket: string;
  };
  format?: "html" | "markdown" | "html-stripped";
}

async function advancedFetch(url: string, options: AdvancedFetchOptions) {
    const client = axios.create({ baseURL: "http://localhost:31171" });
    const response = await client.post("/api/fetch/advanced", {
        url,
        ...options
    });
    return response.data;
}

async function run() {
    const targetUrl = "http://localhost:31199";
    console.log("--- Starting Manual Verification Client ---");
    
    try {
        const result = await advancedFetch(targetUrl, {
            format: "markdown",
            jsAction: "console.log('Injected JS Working');",
            apiPatterns: ["/api/"],
            imagesToDownload: [`${targetUrl}/image.png`],
            uploadConfig: {
                baseUrl: targetUrl, 
                apiKey: "test-key",
                bucket: "test-bucket"
            }
        });

        console.log("Status Code:", result.statusCode);
        console.log("Markdown Length:", result.markdown?.length);
        console.log("Markdown Preview:", result.markdown?.substring(0, 100));
        console.log("API Calls:", JSON.stringify(result.apiCalls, null, 2));
        console.log("Resources:", JSON.stringify(result.resources, null, 2));

        const apiCaptured = result.apiCalls?.some((c: any) => c.url.includes("/api/data"));
        const imgDownloaded = result.resources?.some((r: any) => r.originalUrl.includes("/image.png") && r.status === "success");
        // Mock upload returns urls.original
        const imgUploaded = result.resources?.some((r: any) => r.uploadedUrl?.includes("uploads/test.png"));

        if (apiCaptured && imgDownloaded && imgUploaded) {
            console.log("\n✅ VERIFICATION SUCCESS: All features working.");
        } else {
            console.error("\n❌ VERIFICATION FAILED");
            if (!apiCaptured) console.error("- API Capture Failed");
            if (!imgDownloaded) console.error("- Image Download Failed");
            if (!imgUploaded) console.error("- Image Upload Failed");
            process.exit(1);
        }

    } catch (e: any) {
        console.error("Fetch Failed:", e.response ? e.response.data : e.message);
        process.exit(1);
    }
}

run();
