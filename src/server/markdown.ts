
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export function extractMainContent(html: string, url?: string): { content: string; title: string; textContent: string } | null {
    if (!html) return null;
    try {
        const doc = new JSDOM(html, { url }).window.document;
        const reader = new Readability(doc);
        const article = reader.parse();
        
        if (!article) return null;
        
        return {
            content: article.content || "", // HTML with Readability applied
            title: article.title || "",
            textContent: article.textContent || ""
        };
    } catch (error) {
        console.error("Content extraction failed:", error);
        return null;
    }
}

export function htmlToMarkdown(html: string, url?: string): string {
    if (!html) return "";

    try {
        // 1 & 2. Extract Main Content
        const extracted = extractMainContent(html, url);
        
        // Fallback to raw body if extraction fails
        let contentHtml = "";
        let title = "";
        
        if (extracted) {
            contentHtml = extracted.content;
            title = extracted.title;
        } else {
             const doc = new JSDOM(html, { url }).window.document;
             contentHtml = doc.body ? doc.body.innerHTML : "";
        }

        // 3. Convert to Markdown
        const turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            hr: "---",
            bulletListMarker: "-",
        });
        
        // Remove scripts/styles if they remain (Readability usually handles this)
        turndownService.remove(['script', 'style', 'noscript']);

        const markdown = turndownService.turndown(contentHtml || "");
        
        // Add Title/Metadata if available
        if (title) {
            return `# ${title}\n\n${markdown}`;
        }
        
        return markdown;

    } catch (error) {
        console.error("Markdown conversion failed:", error);
        return ""; // gracefully failure
    }
}
