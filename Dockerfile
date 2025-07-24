# Use official Node.js image matching Baileys requirements
FROM node:18-alpine

# Create and set working directory
WORKDIR /usr/src/app

# Copy package files FIRST for better caching
COPY package*.json ./

# Install dependencies (clean cache to reduce image size)
RUN npm install --production && \
    npm cache clean --force

# Copy all other files
COPY . .

# Create necessary runtime files
RUN touch auth_info.json && \
    chmod 666 auth_info.json && \
    mkdir -p public

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

# Run the server
CMD ["node", "server.js"]
