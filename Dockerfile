# Use a Node base image
FROM node:20

# Install dependencies: Python3 and ffmpeg (needed for audio conversion)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl

# Download the latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your code
COPY . .

# Build your TypeScript code
RUN npm run build

# Start the app
CMD ["npm", "start"]