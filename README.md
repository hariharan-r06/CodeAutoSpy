# 🤖 CodeAutopsy - AI-Powered CI/CD Failure Auto-Fix Agent

<div align="center">

![CodeAutopsy Logo](https://img.shields.io/badge/CodeAutopsy-AI%20Agent-blueviolet?style=for-the-badge&logo=robot)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Gemini AI](https://img.shields.io/badge/Gemini-AI-blue?style=flat-square&logo=google)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**Automatically diagnose and fix CI/CD build failures using Gemini AI** 🔬

</div>

---

## 🎯 What is CodeAutopsy?

CodeAutopsy is an intelligent AI agent that monitors your GitHub CI/CD pipelines, automatically diagnoses build failures, generates fixes, and creates Pull Requests—all in under 2 minutes.

### ✨ Key Features

- 🔍 **Intelligent Log Analysis** - Uses Gemini AI to parse build logs and identify exact error locations
- 🛠️ **Automated Code Fixes** - Generates minimal, surgical fixes for common errors
- 🚀 **Automatic PR Creation** - Creates well-documented Pull Requests with the fix
- 📢 **Real-time Notifications** - Discord and Slack integration for instant alerts
- 🛡️ **Safety Guardrails** - Rate limiting, confidence scoring, and protected paths
- 🌐 **Multi-Language Support** - Python, JavaScript, TypeScript, Java, C, Go, Rust, Docker

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CodeAutopsy Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GitHub Actions     Webhook        Scout         Retriever       Surgeon    │
│  ┌─────────────┐   ┌─────────┐   ┌─────────┐   ┌───────────┐   ┌─────────┐ │
│  │   Build     │   │ Express │   │ Analyze │   │  Fetch    │   │ Generate│ │
│  │   Fails     │──▶│ Server  │──▶│  Logs   │──▶│  Source   │──▶│   Fix   │ │
│  │             │   │         │   │         │   │   Code    │   │         │ │
│  └─────────────┘   └─────────┘   └─────────┘   └───────────┘   └─────────┘ │
│                                                                      │      │
│                                                                      ▼      │
│  ┌─────────────┐   ┌─────────┐                               ┌─────────┐   │
│  │  Discord/   │◀──│Operator │◀──────────────────────────────│Validate │   │
│  │   Slack     │   │Create PR│                               │  Fix    │   │
│  └─────────────┘   └─────────┘                               └─────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for PostgreSQL and Redis)
- GitHub Personal Access Token
- Google Gemini API Key

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/codeautopsy.git
cd codeautopsy
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required
GITHUB_TOKEN=ghp_your_github_token
GEMINI_API_KEY=your_gemini_api_key

# Database (Docker will use defaults)
DATABASE_URL=postgresql://postgres:password@localhost:5432/codeautopsy

# Redis
REDIS_URL=redis://localhost:6379

# Optional: Notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### 3. Start Services

```bash
# Start PostgreSQL and Redis with Docker
docker-compose up -d db redis

# Run database migrations
npx prisma db push
npx prisma generate

# Start the server
npm run dev
```

### 4. Expose Webhook (for local development)

```bash
# Using ngrok
ngrok http 3000

# Your webhook URL will be: https://<ngrok-id>.ngrok.io/webhooks/github
```

### 5. Configure GitHub Webhook

1. Go to your repository → Settings → Webhooks
2. Add webhook:
   - **Payload URL**: `https://<your-url>/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: (same as `GITHUB_WEBHOOK_SECRET` in `.env`)
   - **Events**: Select "Workflow jobs" and "Workflow runs"

---

## 📖 Usage

### Trigger a Fix (Push Broken Code)

```bash
# Example: Push code with a syntax error
echo "def broken_function(x, y:" > test.py
git add test.py
git commit -m "Add feature"
git push origin main
```

### What Happens Next

1. **GitHub Actions** fails (within ~30 seconds)
2. **CodeAutopsy** receives webhook (immediately)
3. **Scout** analyzes logs (5-10 seconds)
4. **Retriever** fetches source (2-5 seconds)
5. **Surgeon** generates fix (10-30 seconds)
6. **Operator** creates PR (5-10 seconds)
7. **Discord/Slack** notification sent

**Total Time: < 2 minutes!**

### Example Discord Notification

```
✅ CodeAutopsy: Fix Deployed

📦 Repository: username/my-app
🌿 Branch: main
🔴 Error Type: SyntaxError
📄 File Fixed: test.py
📊 Confidence: 95%
🔗 Pull Request: View PR #42
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | ✅ | GitHub PAT with repo access |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection URL |
| `GITHUB_WEBHOOK_SECRET` | ⚠️ | Webhook signature secret |
| `DISCORD_WEBHOOK_URL` | ❌ | Discord notifications |
| `SLACK_WEBHOOK_URL` | ❌ | Slack notifications |
| `MIN_CONFIDENCE_FOR_PR` | ❌ | Minimum confidence for auto-PR (default: 0.85) |
| `MAX_FIX_ATTEMPTS_PER_HOUR` | ❌ | Rate limit per repo (default: 5) |
| `PROTECTED_PATHS` | ❌ | Comma-separated paths to never modify |

### Protected Paths

By default, CodeAutopsy will never modify:
- `config/` directories
- `secrets/` directories
- `.github/workflows/` files
- `.env` files

Add more via `PROTECTED_PATHS=path1,path2,path3`

---

## 🧪 Testing

### Run Unit Tests

```bash
npm test
```

### Run with Coverage

```bash
npm test -- --coverage
```

### Test Scenarios

The test suite includes:
- Scout agent log parsing
- Surgeon code generation
- Webhook handling
- Integration pipeline

---

## 🐳 Docker Deployment

### Full Stack with Docker Compose

```bash
# Build and start everything
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down
```

### With Queue Monitoring (Bull Board)

```bash
# Start with monitoring profile
docker-compose --profile monitoring up -d

# Access Bull Board at http://localhost:3001
```

---

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info |
| `/webhooks/github` | POST | GitHub webhook receiver |
| `/webhooks/health` | GET | Health check |
| `/webhooks/status` | GET | Queue and event status |
| `/api/queue` | GET | Queue statistics |
| `/api/trigger` | POST | Manual trigger (testing) |

---

## 🌐 Supported Languages

| Language | Error Types Supported |
|----------|----------------------|
| **Python** | SyntaxError, IndentationError, ModuleNotFoundError, ImportError |
| **JavaScript** | SyntaxError, ReferenceError, TypeError, Module not found |
| **TypeScript** | TS2304, TS2322, TS2339, compilation errors |
| **Java** | ClassNotFoundException, NullPointerException, compilation errors |
| **C/C++** | Compilation errors, linker errors, undefined references |
| **Go** | Compilation errors, package errors, undefined identifiers |
| **Rust** | E0425, E0308, borrow checker errors |
| **Docker** | COPY failed, RUN failed, build errors |

---

## 🛡️ Safety Features

### Confidence Scoring

Each fix is assigned a confidence score (0-1) based on:
- Change size (smaller = higher confidence)
- Validation checks
- Error type commonality
- Syntax verification

**Auto-PR**: confidence ≥ 0.85
**Issue creation**: confidence ≥ 0.50

### Rate Limiting

- Maximum 5 fix attempts per repository per hour
- Configurable via `MAX_FIX_ATTEMPTS_PER_HOUR`

### Protected Files

- Never modifies critical config files
- Blacklist paths via `PROTECTED_PATHS`

---

## 🔧 Development

### Project Structure

```
codeautopsy/
├── src/
│   ├── server.js              # Main Express server
│   ├── config/                # Configuration modules
│   │   ├── database.js        # Prisma client
│   │   ├── gemini.js          # Gemini AI setup
│   │   └── github.js          # GitHub API client
│   ├── agents/                # Core AI agents
│   │   ├── scout.js           # Log analysis
│   │   ├── retriever.js       # Code fetching
│   │   ├── surgeon.js         # Fix generation
│   │   └── operator.js        # PR creation
│   ├── prompts/               # Gemini prompts
│   ├── webhooks/              # Webhook handlers
│   ├── queue/                 # Bull queue
│   ├── notifications/         # Discord/Slack
│   └── utils/                 # Utilities
├── prisma/
│   └── schema.prisma          # Database schema
├── tests/                     # Test files
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### Adding New Language Support

1. Add patterns to `src/utils/error-parser.js`
2. Add language detection to `src/utils/language-detector.js`
3. Add language rules to `src/prompts/surgeon-prompt.js`

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

---

## 🙏 Acknowledgments

- **Google Gemini AI** for powerful code understanding
- **Octokit** for GitHub API interactions
- **Bull** for reliable job queue
- **Prisma** for database ORM

---

<div align="center">

**Built with ❤️ by the CodeAutopsy Team**

[Report Bug](https://github.com/yourusername/codeautopsy/issues) · [Request Feature](https://github.com/yourusername/codeautopsy/issues)

</div>
