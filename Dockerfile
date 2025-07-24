# Use official Node.js image
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Build the app (if needed)
# RUN npm run build

# Expose the port
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]