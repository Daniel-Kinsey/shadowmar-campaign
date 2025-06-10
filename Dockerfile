# Use the official Node.js runtime as base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S shadowmar -u 1001

# Copy the rest of the application code
COPY . .

# Create public directory and move index.html there
RUN mkdir -p public
RUN mv index.html public/ 2>/dev/null || true

# Create directory for database and set permissions
RUN mkdir -p /app/data && chown -R shadowmar:nodejs /app

# Switch to non-root user
USER shadowmar

# Expose the port the app runs on
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 3000, path: '/api/health', timeout: 2000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) process.exit(0); \
      else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Define the command to run the application
CMD ["npm", "start"]