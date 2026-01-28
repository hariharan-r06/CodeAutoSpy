# 🔬 CodeAutoSpy - AI-Powered CI/CD Failure Auto-Fix Agent

<div align="center">

![CodeAutoSpy](https://img.shields.io/badge/CodeAutoSpy-AI%20Agent-blueviolet?style=for-the-badge&logo=robot)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Gemini AI](https://img.shields.io/badge/Gemini%202.5-AI-blue?style=flat-square&logo=google)](https://ai.google.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-316192?style=flat-square&logo=postgresql)](https://postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-Queue-DC382D?style=flat-square&logo=redis)](https://redis.io/)

**Automatically diagnose and fix CI/CD build failures using Google Gemini AI** 🚀

*Push broken code → CI fails → AI fixes it → PR created → All in under 2 minutes!*

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [How It Works](#-how-it-works)
- [API Endpoints](#-api-endpoints)
- [Supported Languages](#-supported-languages)
- [Safety Features](#-safety-features)
- [Project Structure](#-project-structure)

---

## 🎯 Overview

**CodeAutoSpy** is an intelligent, autonomous agent that monitors GitHub CI/CD pipelines, automatically diagnoses build failures, and creates Pull Requests with AI-generated fixes. It acts as a "self-healing" system for your codebase.

### The Problem It Solves

| Problem | Solution |
|---------|----------|
| Developers spend 15-30% of time debugging CI failures | Automatic detection and fixing |
| Simple syntax errors block deployments | AI understands context and fixes instantly |
| Build failures at night go unnoticed | 24/7 monitoring with Discord/Slack alerts |
| Repetitive errors waste developer time | Pattern recognition and automated fixes |

---

## ✨ Features

### Core Features
- 🔍 **Intelligent Log Analysis** - AI-powered parsing to identify exact error locations
- 🛠️ **Automated Code Fixes** - Generates minimal, surgical fixes for common errors
- 🚀 **Automatic PR Creation** - Creates well-documented Pull Requests with fixes
- 📢 **Real-time Notifications** - Discord and Slack integration for instant alerts

### Safety Features
- 🛡️ **Rate Limiting** - Prevents infinite fix loops (configurable per repo)
- 📊 **Confidence Scoring** - Only auto-fixes high-confidence cases
- 🔒 **Protected Paths** - Never modifies sensitive files (.env, configs, etc.)

### Multi-Language Support
- JavaScript/TypeScript, Python, Java, C/C++, Go, Rust, Docker

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │   Push      │───▶│  CI/CD Run  │───▶│  Failure!   │                      │
│  │   Code      │    │  (Actions)  │    │  Webhook    │                      │
│  └─────────────┘    └─────────────┘    └──────┬──────┘                      │
└────────────────────────────────────────────────┼────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CODEAUTOSPY SERVER                                 │
│                                                                              │
│  ┌──────────────────┐                                                        │
│  │  Webhook Handler │◀─────── GitHub POST /webhooks/github                   │
│  │  (Express.js)    │                                                        │
│  └────────┬─────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │   Bull Queue     │────────▶│     Redis        │                          │
│  │   (Job Queue)    │         │   (Job Storage)  │                          │
│  └────────┬─────────┘         └──────────────────┘                          │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                        AI AGENT PIPELINE                          │       │
│  │                                                                   │       │
│  │  ┌─────────┐    ┌───────────┐    ┌─────────┐    ┌──────────┐    │       │
│  │  │ SCOUT   │───▶│ RETRIEVER │───▶│ SURGEON │───▶│ OPERATOR │    │       │
│  │  │         │    │           │    │         │    │          │    │       │
│  │  │Analyze  │    │Fetch Code │    │Generate │    │Create PR │    │       │
│  │  │Logs     │    │from GitHub│    │AI Fix   │    │on GitHub │    │       │
│  │  └─────────┘    └───────────┘    └─────────┘    └──────────┘    │       │
│  │                           │                                       │       │
│  │                           ▼                                       │       │
│  │                  ┌─────────────────┐                             │       │
│  │                  │   Gemini AI     │                             │       │
│  │                  │  (gemini-2.5)   │                             │       │
│  │                  └─────────────────┘                             │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────┐         ┌──────────────────┐                          │
│  │   PostgreSQL     │         │   Notifications   │                          │
│  │   (Prisma ORM)   │         │  Discord/Slack    │                          │
│  └──────────────────┘         └──────────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🤖 The 4 AI Agents

| Agent | Purpose | Technology |
|-------|---------|------------|
| **Scout** 🔍 | Analyzes build logs, identifies failing file/line | Regex + Gemini AI |
| **Retriever** 📥 | Fetches source code and context from GitHub | GitHub API |
| **Surgeon** 🔧 | Generates code fixes using AI | Gemini 2.5 Flash |
| **Operator** 🚀 | Creates PRs or Issues on GitHub | GitHub API |

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| **Node.js 18+** | Runtime environment |
| **Express.js** | Web server framework |
| **ES Modules** | Modern JavaScript modules |

### AI/ML
| Technology | Purpose |
|------------|---------|
| **Google Gemini AI** | Code analysis and fix generation |
| **gemini-2.5-flash** | Fast model for analysis and fixes |

### Database & Queue
| Technology | Purpose |
|------------|---------|
| **PostgreSQL** | Primary database |
| **Prisma ORM** | Database access layer |
| **Redis** | Job queue backend |
| **Bull** | Redis-based job queue |

### Integrations
| Technology | Purpose |
|------------|---------|
| **GitHub API (Octokit)** | Fetch logs, create PRs, manage branches |
| **Discord Webhook** | Real-time notifications |
| **Slack Webhook** | Team notifications |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| **Docker** | Containerization |
| **Docker Compose** | Multi-container orchestration |
| **ngrok** | Local tunnel for webhook testing |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- GitHub Personal Access Token (with repo permissions)
- Google Gemini API Key ([Get one here](https://aistudio.google.com/apikey))

### 1. Clone and Install

```bash
git clone https://github.com/hariharan-r06/CodeAutoSpy.git
cd CodeAutoSpy
npm install
```

### 2. Configure Environment

Create a `.env` file with:

```env
# GitHub Configuration
GITHUB_TOKEN=ghp_your_github_personal_access_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here

# Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/codeautopsy

# Redis
REDIS_URL=redis://localhost:6379

# Notifications (Optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Server
PORT=3000
```

### 3. Start Services

```bash
# Start PostgreSQL and Redis
docker-compose up -d db redis

# Initialize database
npm run db:push
npm run db:generate

# Start the server
npm run dev
```

### 4. Expose Webhook (Local Development)

```bash
# Using ngrok
ngrok http 3000

# Your webhook URL: https://<ngrok-id>.ngrok-free.app/webhooks/github
```

### 5. Configure GitHub Webhook

1. Go to your repository → **Settings** → **Webhooks**
2. Click **Add webhook**
3. Configure:
   - **Payload URL**: `https://<your-ngrok-url>/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Same as `GITHUB_WEBHOOK_SECRET` in `.env`
   - **Events**: Select **"Workflow jobs"**
4. Click **Add webhook**

### 6. Test It!

Push code with a syntax error to your repo and watch CodeAutoSpy create a fix PR! 🎉

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | ✅ | - | GitHub PAT with repo access |
| `GEMINI_API_KEY` | ✅ | - | Google Gemini API key |
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `REDIS_URL` | ✅ | - | Redis connection URL |
| `GITHUB_WEBHOOK_SECRET` | ✅ | - | Webhook signature secret |
| `DISCORD_WEBHOOK_URL` | ❌ | - | Discord notifications |
| `SLACK_WEBHOOK_URL` | ❌ | - | Slack notifications |
| `PORT` | ❌ | 3000 | Server port |
| `MIN_CONFIDENCE_FOR_PR` | ❌ | 0.7 | Minimum confidence for auto-PR |
| `MAX_FIX_ATTEMPTS_PER_HOUR` | ❌ | 5 | Rate limit per repo |

---

## 🔄 How It Works

### Flow Diagram

```
1. Developer pushes code with error
        ↓
2. GitHub Actions runs and FAILS
        ↓
3. GitHub sends webhook to CodeAutoSpy
        ↓
4. Scout Agent analyzes build logs
   → Identifies: file, line number, error type
        ↓
5. Retriever Agent fetches source code
   → Gets file content from GitHub
        ↓
6. Surgeon Agent generates fix
   → Uses Gemini AI to create minimal fix
        ↓
7. Operator Agent creates PR
   → Branches, commits, and opens PR
        ↓
8. Notification sent to Discord/Slack
        ↓
9. Developer reviews and merges PR ✅
```

### Example Scenario

**Input (Broken Code):**
```javascript
const About = ( => {  // Missing closing parenthesis
  return <div>About</div>
}
```

**Output (Fixed Code):**
```javascript
const About = () => {  // Fixed!
  return <div>About</div>
}
```

**Result:** PR #1 created with title "[CodeAutopsy] Fix Error in src/pages/About.jsx"

---

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info and status |
| `/webhooks/github` | POST | GitHub webhook receiver |
| `/webhooks/health` | GET | Health check |
| `/webhooks/status` | GET | Queue and event statistics |

---

## 🌐 Supported Languages

| Language | Error Types Supported |
|----------|----------------------|
| **JavaScript/TypeScript** | SyntaxError, ReferenceError, TypeError, Import errors |
| **Python** | SyntaxError, IndentationError, ImportError, ModuleNotFoundError |
| **Java** | Compilation errors, ClassNotFoundException |
| **C/C++** | Compilation errors, linker errors |
| **Go** | Compilation errors, undefined identifiers |
| **Rust** | Compiler errors (E0425, E0308, etc.) |
| **Docker** | COPY failed, RUN failed, build errors |

---

## 🛡️ Safety Features

### Confidence Scoring
- Each fix gets a confidence score (0-1)
- **Auto-PR**: confidence ≥ 0.7
- **Create Issue**: confidence ≥ 0.5
- **Skip**: confidence < 0.5

### Rate Limiting
- Maximum 5 fix attempts per repository per hour
- Prevents infinite fix loops

### Protected Paths
Never modifies:
- `.env` files
- `package-lock.json`, `yarn.lock`
- `.github/workflows/` files
- `config/` and `secrets/` directories

---

## 📁 Project Structure

```
CodeAutoSpy/
├── src/
│   ├── agents/               # AI Agents
│   │   ├── scout.js          # Log analysis
│   │   ├── retriever.js      # Code fetching
│   │   ├── surgeon.js        # Fix generation
│   │   └── operator.js       # PR creation
│   ├── config/               # Configuration
│   │   ├── database.js       # Prisma client
│   │   ├── gemini.js         # Gemini AI setup
│   │   └── github.js         # GitHub API (Octokit)
│   ├── prompts/              # AI Prompts
│   │   ├── scout-prompt.js
│   │   └── surgeon-prompt.js
│   ├── queue/
│   │   └── fix-queue.js      # Bull job queue
│   ├── webhooks/
│   │   └── github-listener.js
│   ├── notifications/
│   │   └── discord.js
│   ├── utils/
│   │   ├── error-parser.js
│   │   ├── language-detector.js
│   │   └── logger.js
│   └── server.js             # Main Express server
├── prisma/
│   └── schema.prisma         # Database schema
├── docker-compose.yml
├── .env
└── package.json
```

---

## 🐳 Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ by Hariharan R**

[Report Bug](https://github.com/hariharan-r06/CodeAutoSpy/issues) · [Request Feature](https://github.com/hariharan-r06/CodeAutoSpy/issues)

</div>
