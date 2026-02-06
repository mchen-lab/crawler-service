# Crawler Service

This project was bootstrapped with [@mchen-lab/app-kit](https://github.com/mchen-lab/app-kit). It provides a robust crawling service with support for basic HTML fetching, headless browser rendering, and advanced features like API capture and image downloading.

## Getting Started

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Initialize Git (Recommended)**
    To capture the commit hash for the "About" dialog, initialize a git repository and make an initial commit:
    ```bash
    git init && git add . && git commit -m "initial commit"
    ```

3.  **Start Development Server**
    Use the provided `restart.sh` script to start the server. This script handles port cleanup and log rotation:
    ```bash
    ./restart.sh
    ```
    Alternatively, you can run `npm run dev`.

4.  **Build for Production**
    ```bash
    npm run build
    ```

## Configuration & Persistence
 
This project follows specific standards for configuration and data management:

-   **`DATA_DIR`**: Location for configuration files (defaults to `./data`). All UI settings are saved to `data/settings.json`.
-   **`LOGS_DIR`**: Location for persistent log files (defaults to `./logs`). The server automatically appends logs to `logs/app.log`.

### Environment Overrides
You can override default configuration keys using environment variables. For example, to override `exampleSetting`:
```bash
EXAMPLE_SETTING="custom-value" ./restart.sh
```

## Project Structure

```
├── data/           # Persistent configuration (settings.json)
├── logs/           # Persistent application logs (app.log)
├── src/
    ├── server/     # Backend logic (Express + AppKit)
    └── frontend/   # Frontend React application
└── libs/           # Local dependencies (app-kit.tgz)
```

## API Usage

The service exposes endpoints for fetching web content.

### 1. Standard Fetch (`/api/fetch`)

Basic fetching for HTML content. Supports both fast (HTTP) and browser-based engines.

**Method:** `POST`

**Body:**
```json
{
  "url": "https://example.com",
  "engine": "auto",       // "auto" | "fast" | "browser"
  "renderJs": false,      // true to use browser engine
  "proxy": "http://...",  // Optional proxy URL
  "format": "html"        // "html" | "markdown" | "html-stripped"
}
```

### 2. Advanced Fetch (`/api/fetch/advanced`)

Advanced capabilities including API capture, custom JS execution, and image downloading/uploading.

**Method:** `POST`

**Body:**
```json
{
  "url": "https://example.com/spa-page",
  "preset": "chrome",     // Uses specialized headers for anti-bot evasion
  "format": "markdown",   // "html" | "markdown" | "html-stripped"
  
  // Execute custom JavaScript before extraction
  "jsAction": "window.scrollTo(0, document.body.scrollHeight);",
  
  // Capture background API calls matching these patterns
  "apiPatterns": ["/api/v1/comments", "/graphql"],
  
  // Download specific images using the active browser session
  "imagesToDownload": ["https://example.com/image1.jpg"],
  
  // Automatically upload downloaded images to uploader-service
  "uploadConfig": {
    "baseUrl": "http://upload-service:3000",
    "apiKey": "your-api-key",
    "bucket": "images"
  }
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "url": "https://example.com/spa-page",
  "content": "<html>...</html>",
  "markdown": "# Page Title...",
  "apiCalls": [
    {
      "url": "https://example.com/api/v1/comments",
      "method": "GET",
      "responseBody": { ... }
    }
  ],
  "resources": [
    {
      "originalUrl": "https://example.com/image1.jpg",
      "status": "success",
      "uploadedUrl": "http://upload-service/files/..."
    }
  ]
}
```
