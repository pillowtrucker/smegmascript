# Multi-stage build for smegmascript bot

# Stage 1: Dependencies
FROM node:24-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production

# Stage 2: Runtime
FROM node:24-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S smegma -u 1001

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY --chown=smegma:nodejs . .

# Switch to non-root user
USER smegma

# Expose port for health checks (if needed)
EXPOSE 3000

# Default to bot mode
CMD ["node", "bot.js"]
