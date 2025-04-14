FROM oven/bun:latest

WORKDIR /app

# Copy package files and install dependencies
COPY bun.lockb package.json ./
RUN bun install

# Copy the rest of the application
COPY . .

# Run the DNS server
CMD ["bun", "src/index.ts"]

