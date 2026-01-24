# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install necessary tools
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1001 -S codeautopsy && \
    adduser -S codeautopsy -u 1001

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Copy application code
COPY --chown=codeautopsy:codeautopsy src ./src
COPY --chown=codeautopsy:codeautopsy package*.json ./

# Create logs directory
RUN mkdir -p logs && chown codeautopsy:codeautopsy logs

# Switch to non-root user
USER codeautopsy

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/webhooks/health || exit 1

# Start command
CMD ["node", "src/server.js"]
