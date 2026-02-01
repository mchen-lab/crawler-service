# Crawler Service

This project was bootstrapped with [@mchen-lab/app-kit](https://github.com/mchen-lab/app-kit).

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
│   ├── server/     # Backend logic (Express + AppKit)
│   └── frontend/   # Frontend React application
└── libs/           # Local dependencies (app-kit.tgz)
```
