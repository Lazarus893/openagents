FROM node:20-alpine

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=https://backend-production-0a4a.up.railway.app
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Build
RUN npm run build

# Run
EXPOSE 3000
CMD ["npm", "start"]
