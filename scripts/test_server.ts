
import express from 'express';
import { createServer } from 'http';

const app = express();
const PORT = 31199;

app.get('/', (req, res) => {
    res.send(`
        <html>
            <body>
                <h1>Test Page</h1>
                <img src="/image.png" id="test-img" />
                <script>
                    console.log("Page Loaded");
                    // Trigger API call
                    setTimeout(() => {
                        fetch('/api/data').then(r => r.json()).then(console.log);
                    }, 500);
                </script>
            </body>
        </html>
    `);
});

app.get('/image.png', (req, res) => {
    // Send a 1x1 pixel PNG
    const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKw66AAAAABJRU5ErkJggg==', 'base64');
    res.type('image/png');
    res.send(buffer);
});

app.get('/api/data', (req, res) => {
    res.json({ status: "captured" });
});

// Mock Upload Endpoint
app.post('/api/files/:bucket/upload', (req, res) => {
    console.log("Mock Upload Hit");
    res.json({
        success: true,
        files: [{
            urls: { original: "http://localhost:31199/uploads/test.png" }
        }]
    });
});

createServer(app).listen(PORT, () => {
    console.log(`Test Server running on http://localhost:${PORT}`);
});
